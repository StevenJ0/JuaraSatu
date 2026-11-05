-- Colokan harga: pesanan pembeli dihitung dari penawaran aktif dengan rumus bersama PRD §9.1. Tabel tidak berubah.
--
-- `private.current_order_offer` adalah satu-satunya tempat yang perlu diganti saat kampanye tersedia (kontrak C8). Selama
-- belum ada kampanye, diskonnya 0. Pesanan manual tetap memakai harga dasar, karena penawaran hanya untuk checkout pembeli.

create function private.current_order_offer(p_preorder_id uuid)
returns table (discount_bps integer, pricing_campaign_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select 0, null::uuid;
$$;

-- Rumus yang sama dengan kalkulator bersama (kontrak C2). Pembagian bilangan bulat positif sama dengan floor.
create function private.discount_per_unit(p_base_price_idr bigint, p_discount_bps integer) returns bigint
language sql
immutable
set search_path = ''
as $$
  select p_base_price_idr * p_discount_bps / 10000;
$$;

drop function private.insert_order(
  public.preorders, public.preorder_items, text, text, text, text, text, text, text, integer, text, text, text, text, timestamptz
);

create function private.insert_order(
  p_preorder public.preorders,
  p_item public.preorder_items,
  p_source text,
  p_payment_mode text,
  p_external_payment_status text,
  p_order_status text,
  p_customer_name text,
  p_customer_email text,
  p_customer_contact text,
  p_quantity integer,
  p_token_hash text,
  p_idempotency_key text,
  p_request_hash text,
  p_reservation_state text,
  p_payment_due_at timestamptz,
  p_discount_bps integer,
  p_pricing_campaign_id uuid
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_order public.orders;
  v_order_item_id uuid;
  v_discount_per_unit bigint := private.discount_per_unit(p_item.base_price_snapshot_idr, p_discount_bps);
  v_final_unit_price bigint := p_item.base_price_snapshot_idr - v_discount_per_unit;
begin
  select * into v_product from public.products as product where product.id = p_item.product_id;

  insert into public.orders (
    business_id, preorder_id, pricing_campaign_id, public_order_number, private_token_hash, idempotency_key, request_hash, source,
    customer_name, customer_email, customer_contact, fulfillment_date, payment_mode, external_payment_status,
    external_payment_confirmed_at, order_status, fulfillment_status, subtotal_idr, discount_total_idr, total_idr, payment_due_at
  ) values (
    p_preorder.business_id, p_preorder.id, p_pricing_campaign_id, private.new_order_number(), p_token_hash, p_idempotency_key, p_request_hash, p_source,
    p_customer_name, p_customer_email, p_customer_contact, p_preorder.fulfillment_date, p_payment_mode, p_external_payment_status,
    case when p_external_payment_status = 'confirmed' then now() end,
    p_order_status, 'pending_confirmation',
    p_quantity * p_item.base_price_snapshot_idr, p_quantity * v_discount_per_unit, p_quantity * v_final_unit_price, p_payment_due_at
  ) returning * into v_order;

  insert into public.order_items (
    business_id, order_id, preorder_item_id, product_id, product_name_snapshot, sku_snapshot, quantity,
    base_unit_price_idr, discount_bps_snapshot, discount_per_unit_idr, final_unit_price_idr,
    variable_cost_per_unit_idr, cost_quality_snapshot, line_total_idr, pricing_campaign_id
  ) values (
    p_preorder.business_id, v_order.id, p_item.id, p_item.product_id, p_item.product_name_snapshot, p_item.sku_snapshot, p_quantity,
    p_item.base_price_snapshot_idr, p_discount_bps, v_discount_per_unit, v_final_unit_price,
    v_product.variable_cost_idr, v_product.cost_quality, p_quantity * v_final_unit_price, p_pricing_campaign_id
  ) returning id into v_order_item_id;

  insert into public.capacity_reservations (business_id, order_id, order_item_id, preorder_item_id, capacity_id, quantity, state, expires_at)
  values (p_preorder.business_id, v_order.id, v_order_item_id, p_item.id, p_item.capacity_id, p_quantity, p_reservation_state, p_payment_due_at);

  perform private.record_order_event(
    p_preorder.business_id, v_order.id, 'order_created', null, p_order_status,
    jsonb_build_object('source', p_source, 'quantity', p_quantity)
  );
  return v_order;
end;
$$;

-- Hanya untuk server (service_role), bukan browser. Harga, business, dan status tidak pernah diambil dari input pembeli.
-- Slug yang tidak ada dan preorder yang belum terbit sama-sama PREORDER_NOT_OPEN, agar keberadaannya tidak terungkap.
create or replace function public.create_preorder_order(
  p_slug text,
  p_quantity integer,
  p_customer_name text,
  p_customer_email text,
  p_customer_contact text,
  p_token_hash text,
  p_idempotency_key text,
  p_request_hash text,
  p_expected_unit_price_idr bigint,
  p_hold_ttl_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
     or p_hold_ttl_seconds is null or p_hold_ttl_seconds <= 0 then
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
      v_discount_bps, v_pricing_campaign_id
    );
  exception
    when unique_violation then
      raise exception 'IDEMPOTENCY_CONFLICT';
  end;

  return private.order_result(v_order, false);
end;
$$;

-- Pesanan manual berbagi kapasitas dan kuota dengan pesanan pembeli. Slot langsung dipakai walau belum dibayar, tanpa batas waktu,
-- dan status pembayarannya dicatat terpisah agar tidak terlihat seperti pembayaran Midtrans.
create or replace function public.create_manual_order(
  p_preorder_id uuid,
  p_quantity integer,
  p_customer_name text,
  p_customer_email text,
  p_customer_contact text,
  p_is_paid boolean,
  p_idempotency_key text,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preorder public.preorders;
  v_item public.preorder_items;
  v_capacity public.production_capacity;
  v_existing public.orders;
  v_order public.orders;
begin
  if p_quantity is null or p_quantity not between 1 and 10000
     or btrim(coalesce(p_customer_name, '')) = '' or char_length(p_customer_name) > 160
     or char_length(coalesce(p_customer_email, '')) > 254
     or char_length(coalesce(p_customer_contact, '')) > 120
     or p_is_paid is null
     or coalesce(p_idempotency_key, '') = '' or coalesce(p_request_hash, '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_preorder
  from public.preorders as preorder
  where preorder.id = p_preorder_id and preorder.business_id = private.current_owner_business()
  for share;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  select * into v_item from public.preorder_items as item where item.preorder_id = v_preorder.id;
  select * into v_capacity from public.production_capacity as capacity where capacity.id = v_item.capacity_id for update;

  select * into v_existing
  from public.orders as customer_order
  where customer_order.business_id = v_preorder.business_id and customer_order.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return private.order_result(v_existing, true);
  end if;

  if v_preorder.status <> 'published' or now() >= v_capacity.fulfillment_window_end_at then
    raise exception 'PREORDER_NOT_OPEN';
  end if;

  perform private.assert_orderable(v_capacity, v_item, p_quantity);

  v_order := private.insert_order(
    v_preorder, v_item, 'manual', 'external_manual', case when p_is_paid then 'confirmed' else 'unpaid' end, 'awaiting_confirmation',
    btrim(p_customer_name), nullif(lower(btrim(coalesce(p_customer_email, ''))), ''), nullif(btrim(coalesce(p_customer_contact, '')), ''), p_quantity,
    null, p_idempotency_key, p_request_hash, 'allocated', null,
    0, null
  );
  return private.order_result(v_order, false);
end;
$$;

-- Untuk halaman pembeli (C1), supaya harga yang tampil selalu sama dengan harga yang dihitung saat memesan.
create function public.read_preorder_offer(p_preorder_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'discount_bps', offer.discount_bps,
    'pricing_campaign_id', offer.pricing_campaign_id,
    'final_unit_price_idr', item.base_price_snapshot_idr - private.discount_per_unit(item.base_price_snapshot_idr, offer.discount_bps)
  )
  from public.preorder_items as item
  cross join lateral private.current_order_offer(item.preorder_id) as offer
  where item.preorder_id = p_preorder_id;
$$;

revoke all on function private.current_order_offer(uuid) from public;
revoke all on function private.discount_per_unit(bigint, integer) from public;
revoke all on function private.insert_order(public.preorders, public.preorder_items, text, text, text, text, text, text, text, integer, text, text, text, text, timestamptz, integer, uuid) from public;
revoke all on function public.read_preorder_offer(uuid) from public, anon, authenticated;
grant execute on function public.read_preorder_offer(uuid) to service_role;
