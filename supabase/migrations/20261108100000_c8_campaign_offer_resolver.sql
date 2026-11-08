-- C8: harga dan atribusi pesanan dari kampanye terbit yang sedang aktif.
--
-- Konfigurasi kampanye (offer_type, discount_bps, starts_at, ends_at) sudah dibekukan saat publish oleh
-- publish_campaign dan trigger campaign_guard (PUBLISHED_CAMPAIGN_IMMUTABLE), jadi resolver cukup membaca baris itu.
-- Aturan aktif sama dengan projectPublishedOffer (campaign-execution/projections.ts): status published, belum ditutup,
-- waktu server di [max(starts_at, published_at), ends_at), dan preorder masih terbit serta belum lewat ends_at.
-- read_preorder_offer dan create_preorder_order sama-sama memakai current_order_offer, jadi harga tampil dan harga pesanan
-- selalu dari aturan yang sama.

-- Diskon berlaku untuk semua checkout baru, termasuk pembeli tanpa link (PRD D-10). pricing_campaign_id hanya diisi bila
-- kampanye benar-benar mengubah harga (percent_discount); kampanye normal_price tidak mengklaim pesanan organik.
create or replace function private.current_order_offer(p_preorder_id uuid)
returns table (discount_bps integer, pricing_campaign_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(active.discount_bps, 0), active.id
  from (select 1) as anchor
  left join lateral (
    select campaign.id, campaign.discount_bps
    from public.campaigns as campaign
    join public.preorders as preorder
      on preorder.id = campaign.preorder_id and preorder.business_id = campaign.business_id
    where campaign.preorder_id = p_preorder_id
      and campaign.status = 'published'
      and campaign.closed_at is null
      and campaign.published_at is not null
      and campaign.offer_type = 'percent_discount'
      and campaign.discount_bps between 1 and 9999
      and now() >= greatest(campaign.starts_at, campaign.published_at)
      and now() < campaign.ends_at
      and preorder.status = 'published'
      and now() < preorder.ends_at
    limit 1
  ) as active on true;
$$;

-- Ref atribusi adalah slug kampanye dari link kampanye. Hanya sah bila kampanye milik preorder yang sama dan sedang
-- aktif (PRD 9.4, D-11). Ref palsu, milik preorder lain, belum mulai, kedaluwarsa, atau ditutup memberi NULL.
-- Atribusi terpisah dari harga: pesanan organik tetap mendapat diskon tanpa atribusi.
create or replace function private.resolve_attribution(p_preorder_id uuid, p_attribution_ref text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select campaign.id
  from public.campaigns as campaign
  join public.preorders as preorder
    on preorder.id = campaign.preorder_id and preorder.business_id = campaign.business_id
  where p_attribution_ref is not null
    and campaign.slug = p_attribution_ref
    and campaign.preorder_id = p_preorder_id
    and campaign.status = 'published'
    and campaign.closed_at is null
    and campaign.published_at is not null
    and now() >= greatest(campaign.starts_at, campaign.published_at)
    and now() < campaign.ends_at
    and preorder.status = 'published'
    and now() < preorder.ends_at
  limit 1;
$$;

CREATE OR REPLACE FUNCTION public.create_preorder_order(p_slug text, p_quantity integer, p_customer_name text, p_customer_email text, p_customer_contact text, p_token_hash text, p_idempotency_key text, p_request_hash text, p_expected_unit_price_idr bigint, p_hold_ttl_seconds integer, p_attribution_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_preorder public.preorders;
  v_item public.preorder_items;
  v_capacity public.production_capacity;
  v_existing public.orders;
  v_order public.orders;
  v_discount_bps integer;
  v_pricing_campaign_id uuid;
begin
  if p_quantity is null or p_quantity not between 1 and 10000
     or btrim(coalesce(p_customer_name, '')) = '' or char_length(p_customer_name) > 160
     or coalesce(btrim(p_customer_email), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(btrim(p_customer_email)) > 254
     or char_length(coalesce(p_customer_contact, '')) > 120
     or coalesce(p_token_hash, '') = '' or coalesce(p_idempotency_key, '') = '' or coalesce(p_request_hash, '') = ''
     or p_expected_unit_price_idr is null
     or p_hold_ttl_seconds is null or p_hold_ttl_seconds <= 0
     or char_length(coalesce(p_attribution_ref, '')) > 200 then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_preorder from public.preorders as preorder where preorder.slug = p_slug for share;
  if not found then
    raise exception 'PREORDER_NOT_OPEN';
  end if;

  select * into v_item from public.preorder_items as item where item.preorder_id = v_preorder.id;
  select * into v_capacity from public.production_capacity as capacity where capacity.id = v_item.capacity_id for update;

  -- Dicek sebelum status preorder: respons yang hilang harus bisa diambil ulang walau preorder sudah ditutup.
  select * into v_existing
  from public.orders as customer_order
  where customer_order.business_id = v_preorder.business_id and customer_order.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from p_request_hash or v_existing.private_token_hash is distinct from p_token_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return private.order_result(v_existing, true);
  end if;

  if v_preorder.status <> 'published'
     or now() < v_preorder.starts_at
     or now() >= v_preorder.ends_at
     or now() >= v_capacity.intake_cutoff_at then
    raise exception 'PREORDER_NOT_OPEN';
  end if;

  -- Kunci kampanye terbit sebelum membaca offer: tutup kampanye menunggu pesanan ini selesai, atau pesanan melihat
  -- kampanye yang sudah ditutup. Dikunci terakhir (setelah preorder dan kapasitas) agar tidak menambah siklus kunci.
  perform 1 from public.campaigns as campaign
  where campaign.preorder_id = v_preorder.id and campaign.status = 'published'
  for share;

  select offer.discount_bps, offer.pricing_campaign_id into v_discount_bps, v_pricing_campaign_id
  from private.current_order_offer(v_preorder.id) as offer;

  if p_expected_unit_price_idr <> v_item.base_price_snapshot_idr - private.discount_per_unit(v_item.base_price_snapshot_idr, v_discount_bps) then
    raise exception 'OFFER_CHANGED';
  end if;

  perform private.assert_orderable(v_capacity, v_item, p_quantity);

  begin
    v_order := private.insert_order(
      v_preorder, v_item, 'public', 'midtrans_sandbox', null, 'pending_payment',
      btrim(p_customer_name), lower(btrim(p_customer_email)), nullif(btrim(coalesce(p_customer_contact, '')), ''), p_quantity,
      p_token_hash, p_idempotency_key, p_request_hash, 'held', now() + make_interval(secs => p_hold_ttl_seconds),
      v_discount_bps, v_pricing_campaign_id, private.resolve_attribution(v_preorder.id, p_attribution_ref)
    );
  exception
    when unique_violation then
      raise exception 'IDEMPOTENCY_CONFLICT';
  end;

  return private.order_result(v_order, false);
end;
$function$;

-- Publish dan tutup kampanye mengunci konteks lewat fungsi ini. Versi sebelumnya mengunci kapasitas lalu preorder,
-- kebalikan dari create_preorder_order (preorder lalu kapasitas), dan terbukti deadlock (40P01) saat tutup kampanye
-- berjalan bersamaan dengan checkout. Isi lain tidak berubah.
CREATE OR REPLACE FUNCTION private.lock_campaign_context(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE camp public.campaigns; po public.preorders; item public.preorder_items;
 cap public.production_capacity; prod public.products; used bigint; event_used bigint; paid bigint;
BEGIN
 SELECT * INTO STRICT camp FROM public.campaigns WHERE id=p_campaign_id;
 SELECT * INTO STRICT item FROM public.preorder_items WHERE preorder_id=camp.preorder_id;
 -- Preorder dikunci sebelum kapasitas, sama dengan checkout dan fungsi inti lain. Urutan terbalik deadlock dengan checkout.
 SELECT * INTO STRICT po FROM public.preorders WHERE id=camp.preorder_id FOR UPDATE;
 SELECT * INTO STRICT cap FROM public.production_capacity WHERE id=item.capacity_id FOR UPDATE;
 SELECT * INTO STRICT item FROM public.preorder_items WHERE id=item.id FOR UPDATE;
 SELECT * INTO STRICT prod FROM public.products WHERE id=item.product_id FOR UPDATE;
 SELECT * INTO STRICT camp FROM public.campaigns WHERE id=p_campaign_id FOR UPDATE;
 SELECT coalesce(sum(quantity),0) INTO used FROM public.capacity_reservations
 WHERE capacity_id=cap.id AND (state='allocated' OR (state='held' AND expires_at>clock_timestamp()));
 SELECT coalesce(sum(quantity),0) INTO event_used FROM public.capacity_reservations
 WHERE preorder_item_id=item.id AND (state='allocated' OR (state='held' AND expires_at>clock_timestamp()));
 SELECT coalesce(sum(i.quantity),0) INTO paid FROM public.orders o JOIN public.order_items i ON i.order_id=o.id
 WHERE o.preorder_id=po.id AND o.order_status='active' AND o.fulfillment_status<>'cancelled' AND
 (o.external_payment_status='confirmed' OR EXISTS(SELECT 1 FROM public.payments p WHERE p.order_id=o.id AND p.applied_at IS NOT NULL));
 RETURN jsonb_build_object('businessId',camp.business_id,'preorderId',po.id,'itemId',item.id,'capacityId',cap.id,
  'capacityVersion',cap.version,'preorderVersion',po.version,'preorderItemVersion',item.version,
  'productVersion',prod.version,'campaignVersion',camp.version,'basePriceIdr',item.base_price_snapshot_idr,
  'variableCostIdr',prod.variable_cost_idr,'costQuality',prod.cost_quality,
  'orderableUnits',greatest(least(cap.total_units-used,item.quota_units-event_used),0),
  'paidUnits',paid,'targetUnits',item.target_units,'startsAt',po.starts_at,'endsAt',po.ends_at,'preorderStatus',po.status);
END $function$;
