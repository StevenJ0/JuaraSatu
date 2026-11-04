-- R4: pesanan pembeli dan manual, reservasi atomik, status pemenuhan, dan pembatalan. Hanya menambah fungsi; tabel tidak berubah.
--
-- Urutan kunci selalu preorder lalu kapasitas, sama dengan publish_preorder, agar tidak terjadi deadlock.
-- Kunci baris kapasitas wajib: tanpa itu pesanan bersamaan bisa melebihi kapasitas, dan database tidak mencegahnya.
-- Kode error mengikuti daftar kontrak bersama (PREORDER_NOT_OPEN, CAPACITY_UNAVAILABLE, OFFER_CHANGED, IDEMPOTENCY_CONFLICT).

create function private.committed_units(p_capacity_id uuid, p_preorder_item_id uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(reservation.quantity), 0)
  from public.capacity_reservations as reservation
  where reservation.capacity_id = p_capacity_id
    and (p_preorder_item_id is null or reservation.preorder_item_id = p_preorder_item_id)
    and (reservation.state = 'allocated' or (reservation.state = 'held' and reservation.expires_at > now()));
$$;

create function private.new_order_number() returns text
language sql
volatile
set search_path = ''
as $$
  select 'CL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

create function private.record_order_event(
  p_business_id uuid,
  p_order_id uuid,
  p_event_type text,
  p_from_state text,
  p_to_state text,
  p_details jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.order_events (business_id, order_id, event_type, from_state, to_state, actor_type, actor_user_id, details_json)
  values (
    p_business_id, p_order_id, p_event_type, p_from_state, p_to_state,
    case when auth.uid() is null then 'system' else 'owner' end,
    auth.uid(),
    p_details
  );
$$;

-- Dipanggil setelah baris kapasitas terkunci. Satu perintah baru berarti snapshot baru, jadi reservasi yang baru di-commit ikut terlihat.
create function private.assert_orderable(
  p_capacity public.production_capacity,
  p_item public.preorder_items,
  p_quantity integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_quantity > p_capacity.total_units - private.committed_units(p_capacity.id, null)
     or p_quantity > p_item.quota_units - private.committed_units(p_capacity.id, p_item.id) then
    raise exception 'CAPACITY_UNAVAILABLE';
  end if;
end;
$$;

-- Satu pintu pembuatan pesanan, agar pesanan pembeli dan manual menyimpan snapshot dan reservasi dengan cara yang sama.
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
  p_payment_due_at timestamptz
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_order public.orders;
  v_order_item_id uuid;
  v_total bigint := p_item.base_price_snapshot_idr * p_quantity;
begin
  select * into v_product from public.products as product where product.id = p_item.product_id;

  insert into public.orders (
    business_id, preorder_id, public_order_number, private_token_hash, idempotency_key, request_hash, source,
    customer_name, customer_email, customer_contact, fulfillment_date, payment_mode, external_payment_status,
    external_payment_confirmed_at, order_status, fulfillment_status, subtotal_idr, discount_total_idr, total_idr, payment_due_at
  ) values (
    p_preorder.business_id, p_preorder.id, private.new_order_number(), p_token_hash, p_idempotency_key, p_request_hash, p_source,
    p_customer_name, p_customer_email, p_customer_contact, p_preorder.fulfillment_date, p_payment_mode, p_external_payment_status,
    case when p_external_payment_status = 'confirmed' then now() end,
    p_order_status, 'pending_confirmation', v_total, 0, v_total, p_payment_due_at
  ) returning * into v_order;

  -- Diskon 0 sampai kalkulator bersama dan penawaran kampanye tersedia (kontrak C2 dan C8).
  insert into public.order_items (
    business_id, order_id, preorder_item_id, product_id, product_name_snapshot, sku_snapshot, quantity,
    base_unit_price_idr, discount_bps_snapshot, discount_per_unit_idr, final_unit_price_idr,
    variable_cost_per_unit_idr, cost_quality_snapshot, line_total_idr
  ) values (
    p_preorder.business_id, v_order.id, p_item.id, p_item.product_id, p_item.product_name_snapshot, p_item.sku_snapshot, p_quantity,
    p_item.base_price_snapshot_idr, 0, 0, p_item.base_price_snapshot_idr,
    v_product.variable_cost_idr, v_product.cost_quality, v_total
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

create function private.order_result(p_order public.orders, p_replayed boolean) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', p_order.id,
    'public_order_number', p_order.public_order_number,
    'order_status', p_order.order_status,
    'total_idr', p_order.total_idr,
    'payment_due_at', p_order.payment_due_at,
    'replayed', p_replayed
  );
$$;

-- Hanya untuk server (service_role), bukan browser. Harga, business, dan status tidak pernah diambil dari input pembeli.
-- Slug yang tidak ada dan preorder yang belum terbit sama-sama PREORDER_NOT_OPEN, agar keberadaannya tidak terungkap.
create function public.create_preorder_order(
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

  if p_expected_unit_price_idr <> v_item.base_price_snapshot_idr then
    raise exception 'OFFER_CHANGED';
  end if;

  perform private.assert_orderable(v_capacity, v_item, p_quantity);

  begin
    v_order := private.insert_order(
      v_preorder, v_item, 'public', 'midtrans_sandbox', null, 'pending_payment',
      btrim(p_customer_name), lower(btrim(p_customer_email)), nullif(btrim(coalesce(p_customer_contact, '')), ''), p_quantity,
      p_token_hash, p_idempotency_key, p_request_hash, 'held', now() + make_interval(secs => p_hold_ttl_seconds)
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
create function public.create_manual_order(
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
    null, p_idempotency_key, p_request_hash, 'allocated', null
  );
  return private.order_result(v_order, false);
end;
$$;

create function private.lock_order(p_order_id uuid, p_expected_version integer, p_business_id uuid) returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order
  from public.orders as customer_order
  where customer_order.id = p_order_id and (p_business_id is null or customer_order.business_id = p_business_id)
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if p_expected_version is not null and v_order.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;
  return v_order;
end;
$$;

-- Satu arah: bayar (manual) dan konfirmasi, produksi, siap, selesai. Pindah status yang tidak sah ditolak.
create function public.advance_fulfillment(p_order_id uuid, p_expected_version integer, p_action text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders := private.lock_order(p_order_id, p_expected_version, private.current_owner_business());
  v_is_closed boolean := v_order.order_status in ('expired', 'cancelled') or v_order.fulfillment_status = 'cancelled';
begin
  if v_is_closed then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  case p_action
    when 'mark_paid' then
      if v_order.external_payment_status is distinct from 'unpaid' then
        raise exception 'ORDER_STATE_INVALID';
      end if;
      update public.orders set external_payment_status = 'confirmed', external_payment_confirmed_at = now() where id = p_order_id;
      perform private.record_order_event(v_order.business_id, p_order_id, 'external_payment_confirmed', 'unpaid', 'confirmed', null);

    when 'confirm' then
      -- Pesanan pembeli baru sampai `awaiting_confirmation` setelah pembayaran terverifikasi (R5).
      if v_order.order_status <> 'awaiting_confirmation' or v_order.fulfillment_status <> 'pending_confirmation'
         or v_order.external_payment_status = 'unpaid' then
        raise exception 'ORDER_STATE_INVALID';
      end if;
      update public.orders set order_status = 'active', fulfillment_status = 'confirmed', confirmed_at = now() where id = p_order_id;
      perform private.record_order_event(v_order.business_id, p_order_id, 'order_confirmed', v_order.fulfillment_status, 'confirmed', null);

    when 'start_production' then
      if v_order.order_status <> 'active' or v_order.fulfillment_status <> 'confirmed' then
        raise exception 'ORDER_STATE_INVALID';
      end if;
      update public.orders set fulfillment_status = 'in_production', production_started_at = now() where id = p_order_id;
      -- Biaya dibukukan saat produksi mulai; NULL berarti belum diketahui, bukan nol. Unique menjaganya sekali per item.
      insert into public.order_production_costs (business_id, order_item_id, cost_kind, quantity, cost_per_unit_idr, amount_idr, quality, incurred_at)
      select item.business_id, item.id, 'variable_production', item.quantity, item.variable_cost_per_unit_idr,
             item.quantity * item.variable_cost_per_unit_idr,
             case when item.variable_cost_per_unit_idr is null then 'unknown' else item.cost_quality_snapshot end,
             now()
      from public.order_items as item
      where item.order_id = p_order_id
      on conflict (order_item_id, cost_kind) do nothing;
      perform private.record_order_event(v_order.business_id, p_order_id, 'production_started', 'confirmed', 'in_production', null);

    when 'mark_ready' then
      if v_order.fulfillment_status <> 'in_production' then
        raise exception 'ORDER_STATE_INVALID';
      end if;
      update public.orders set fulfillment_status = 'ready', ready_at = now() where id = p_order_id;
      perform private.record_order_event(v_order.business_id, p_order_id, 'order_ready', 'in_production', 'ready', null);

    when 'fulfill' then
      if v_order.fulfillment_status <> 'ready' then
        raise exception 'ORDER_STATE_INVALID';
      end if;
      update public.orders set fulfillment_status = 'fulfilled', fulfilled_at = now() where id = p_order_id;
      perform private.record_order_event(v_order.business_id, p_order_id, 'order_fulfilled', 'ready', 'fulfilled', null);

    else
      raise exception 'VALIDATION_ERROR';
  end case;
end;
$$;

-- `expire` melepas slot yang tenggat bayarnya sudah lewat; server (job) atau pemilik boleh memanggilnya, dan mengulang tidak berefek.
-- `cancel` hanya untuk pemilik. Sebelum produksi slot dilepas. Setelah produksi alokasi dan biaya tetap ada, sesuai aturan PRD.
create function public.expire_or_cancel_order(p_order_id uuid, p_expected_version integer, p_action text, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := case when auth.uid() is null then null else private.current_owner_business() end;
  v_order public.orders := private.lock_order(p_order_id, p_expected_version, v_business_id);
  v_before_production boolean := v_order.fulfillment_status in ('pending_confirmation', 'confirmed');
begin
  if p_action = 'expire' then
    if v_order.order_status = 'expired' then
      return;
    end if;
    if v_order.order_status <> 'pending_payment' or v_order.payment_due_at is null or v_order.payment_due_at > now() then
      raise exception 'ORDER_STATE_INVALID';
    end if;
    update public.orders set order_status = 'expired', fulfillment_status = 'cancelled' where id = p_order_id;
    update public.capacity_reservations
    set state = 'released', released_at = now(), release_reason = 'expired'
    where order_id = p_order_id and state = 'held';
    perform private.record_order_event(v_order.business_id, p_order_id, 'order_expired', 'pending_payment', 'expired', null);
    return;
  end if;

  if p_action <> 'cancel' or v_business_id is null or btrim(coalesce(p_reason, '')) = '' or char_length(p_reason) > 500 then
    raise exception 'VALIDATION_ERROR';
  end if;
  if v_order.order_status in ('expired', 'cancelled') or v_order.fulfillment_status in ('fulfilled', 'cancelled') then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  update public.orders
  set order_status = 'cancelled',
      fulfillment_status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = btrim(p_reason),
      external_payment_status = case when external_payment_status = 'unpaid' then 'voided' else external_payment_status end
  where id = p_order_id;

  if v_before_production then
    update public.capacity_reservations
    set state = 'released', released_at = now(), release_reason = 'cancelled'
    where order_id = p_order_id and state in ('held', 'allocated');
  end if;

  perform private.record_order_event(
    v_order.business_id, p_order_id, 'order_cancelled', v_order.order_status, 'cancelled',
    jsonb_build_object('slot_released', v_before_production)
  );
end;
$$;

revoke all on function private.committed_units(uuid, uuid) from public;
revoke all on function private.new_order_number() from public;
revoke all on function private.record_order_event(uuid, uuid, text, text, text, jsonb) from public;
revoke all on function private.assert_orderable(public.production_capacity, public.preorder_items, integer) from public;
revoke all on function private.insert_order(public.preorders, public.preorder_items, text, text, text, text, text, text, text, integer, text, text, text, text, timestamptz) from public;
revoke all on function private.order_result(public.orders, boolean) from public;
revoke all on function private.lock_order(uuid, integer, uuid) from public;

revoke all on function public.create_preorder_order(text, integer, text, text, text, text, text, text, bigint, integer) from public, anon, authenticated;
revoke all on function public.create_manual_order(uuid, integer, text, text, text, boolean, text, text) from public, anon, service_role;
revoke all on function public.advance_fulfillment(uuid, integer, text) from public, anon, service_role;
revoke all on function public.expire_or_cancel_order(uuid, integer, text, text) from public, anon;

grant execute on function public.create_preorder_order(text, integer, text, text, text, text, text, text, bigint, integer) to service_role;
grant execute on function public.create_manual_order(uuid, integer, text, text, text, boolean, text, text) to authenticated;
grant execute on function public.advance_fulfillment(uuid, integer, text) to authenticated;
grant execute on function public.expire_or_cancel_order(uuid, integer, text, text) to authenticated, service_role;
