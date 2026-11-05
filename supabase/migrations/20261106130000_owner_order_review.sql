-- Sisa perintah pemilik dari PRD §8 dan §13. Hanya menambah dan mengganti fungsi; tabel tidak berubah.

-- PRD §9.2: pesanan manual boleh di luar preorder, tetap memakai kapasitas yang sama. Kapasitas dikunci seperti pesanan lain,
-- dan kuota preorder tidak dihitung karena memang tidak terkait preorder mana pun.
create function public.create_standalone_manual_order(
  p_capacity_id uuid,
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
  v_business_id uuid := private.current_owner_business();
  v_capacity public.production_capacity;
  v_product public.products;
  v_existing public.orders;
  v_order public.orders;
  v_preorder public.preorders;
  v_item public.preorder_items;
begin
  if p_quantity is null or p_quantity not between 1 and 10000
     or btrim(coalesce(p_customer_name, '')) = '' or char_length(p_customer_name) > 160
     or char_length(coalesce(p_customer_email, '')) > 254
     or char_length(coalesce(p_customer_contact, '')) > 120
     or p_is_paid is null
     or coalesce(p_idempotency_key, '') = '' or coalesce(p_request_hash, '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_capacity
  from public.production_capacity as capacity
  where capacity.id = p_capacity_id and capacity.business_id = v_business_id
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  select * into v_existing
  from public.orders as customer_order
  where customer_order.business_id = v_business_id and customer_order.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return private.order_result(v_existing, true);
  end if;

  if now() >= v_capacity.fulfillment_window_end_at then
    raise exception 'SCHEDULE_CLOSED';
  end if;

  select * into v_product from public.products as product where product.id = v_capacity.product_id;
  if not v_product.is_active then
    raise exception 'PRODUCT_INACTIVE';
  end if;

  if p_quantity > v_capacity.total_units - private.committed_units(v_capacity.id, null) then
    raise exception 'CAPACITY_UNAVAILABLE';
  end if;

  -- `insert_order` hanya membaca field ini. Id preorder dan itemnya kosong, karena pesanan ini memang tidak terkait preorder.
  v_preorder.business_id := v_business_id;
  v_preorder.fulfillment_date := v_capacity.fulfillment_date;
  v_item.product_id := v_product.id;
  v_item.capacity_id := v_capacity.id;
  v_item.base_price_snapshot_idr := v_product.base_price_idr;
  v_item.product_name_snapshot := v_product.name;
  v_item.sku_snapshot := v_product.sku;

  v_order := private.insert_order(
    v_preorder, v_item, 'manual', 'external_manual', case when p_is_paid then 'confirmed' else 'unpaid' end, 'awaiting_confirmation',
    btrim(p_customer_name), nullif(lower(btrim(coalesce(p_customer_email, ''))), ''), nullif(btrim(coalesce(p_customer_contact, '')), ''), p_quantity,
    null, p_idempotency_key, p_request_hash, 'allocated', null,
    0, null, null
  );
  return private.order_result(v_order, false);
end;
$$;

-- PRD §11.4: biaya yang belum diketahui saat produksi boleh dilengkapi pemilik dengan catatan. Snapshot item tidak diubah.
create function public.resolve_production_cost(
  p_order_id uuid,
  p_expected_version integer,
  p_cost_per_unit_idr bigint,
  p_quality text,
  p_note text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders := private.lock_order(p_order_id, p_expected_version, private.current_owner_business());
  v_cost public.order_production_costs;
begin
  if p_cost_per_unit_idr is null or p_cost_per_unit_idr < 0 or p_cost_per_unit_idr > 1000000000
     or p_quality not in ('estimated', 'verified')
     or btrim(coalesce(p_note, '')) = '' or char_length(p_note) > 500 then
    raise exception 'VALIDATION_ERROR';
  end if;

  select cost.* into v_cost
  from public.order_production_costs as cost
  join public.order_items as item on item.id = cost.order_item_id
  where item.order_id = p_order_id
  for update of cost;

  if not found or v_cost.quality <> 'unknown' then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  update public.order_production_costs
  set cost_per_unit_idr = p_cost_per_unit_idr,
      amount_idr = v_cost.quantity * p_cost_per_unit_idr,
      quality = p_quality,
      resolved_by_user_id = auth.uid(),
      resolution_note = btrim(p_note)
  where id = v_cost.id;

  perform private.record_order_event(v_order.business_id, p_order_id, 'production_cost_resolved', 'unknown', p_quality, null);
end;
$$;

-- PRD §8: batal setelah lunas perlu catatan pengembalian, karena pengembalian penuh di luar lingkup P0.
drop function public.expire_or_cancel_order(uuid, integer, text, text);

create function public.expire_or_cancel_order(
  p_order_id uuid,
  p_expected_version integer,
  p_action text,
  p_reason text,
  p_refund_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := case when auth.uid() is null then null else private.current_owner_business() end;
  v_order public.orders := private.lock_order(p_order_id, p_expected_version, v_business_id);
  v_before_production boolean := v_order.fulfillment_status in ('pending_confirmation', 'confirmed');
  v_is_paid boolean;
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
    perform private.close_active_payment_attempts(v_order, 'expired');
    perform private.record_order_event(v_order.business_id, p_order_id, 'order_expired', 'pending_payment', 'expired', null);
    return;
  end if;

  if p_action <> 'cancel' or v_business_id is null or btrim(coalesce(p_reason, '')) = '' or char_length(p_reason) > 500
     or char_length(coalesce(p_refund_note, '')) > 500 then
    raise exception 'VALIDATION_ERROR';
  end if;
  if v_order.order_status in ('expired', 'cancelled') or v_order.fulfillment_status in ('fulfilled', 'cancelled') then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  v_is_paid := v_order.external_payment_status = 'confirmed'
    or exists (select 1 from public.payments as payment where payment.order_id = p_order_id and payment.applied_at is not null);
  if v_is_paid and btrim(coalesce(p_refund_note, '')) = '' then
    raise exception 'REFUND_NOTE_REQUIRED';
  end if;

  update public.orders
  set order_status = 'cancelled',
      fulfillment_status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = btrim(p_reason),
      review_reason = case when v_is_paid then btrim(p_refund_note) else review_reason end,
      external_payment_status = case when external_payment_status = 'unpaid' then 'voided' else external_payment_status end
  where id = p_order_id;

  if v_before_production then
    update public.capacity_reservations
    set state = 'released', released_at = now(), release_reason = 'cancelled'
    where order_id = p_order_id and state in ('held', 'allocated');
  end if;

  perform private.close_active_payment_attempts(v_order, 'cancelled');
  perform private.record_order_event(
    v_order.business_id, p_order_id, 'order_cancelled', v_order.order_status, 'cancelled',
    jsonb_build_object('slot_released', v_before_production, 'refund_note_recorded', v_is_paid)
  );
end;
$$;

-- PRD §8: preorder batal hanya sebelum ada pesanan. Kunci yang sama dengan pesanan baru, jadi keduanya tidak bisa sama-sama berhasil.
create function public.cancel_published_preorder(p_preorder_id uuid, p_expected_version integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (private.lock_owned_preorder(p_preorder_id, p_expected_version)).status <> 'published' then
    raise exception 'PREORDER_NOT_PUBLISHED';
  end if;

  if exists (select 1 from public.orders as customer_order where customer_order.preorder_id = p_preorder_id) then
    raise exception 'PREORDER_HAS_ORDERS';
  end if;

  update public.preorders set status = 'cancelled' where id = p_preorder_id;
end;
$$;

revoke all on function public.create_standalone_manual_order(uuid, integer, text, text, text, boolean, text, text) from public, anon, service_role;
revoke all on function public.resolve_production_cost(uuid, integer, bigint, text, text) from public, anon, service_role;
revoke all on function public.expire_or_cancel_order(uuid, integer, text, text, text) from public, anon;
revoke all on function public.cancel_published_preorder(uuid, integer) from public, anon, service_role;

grant execute on function public.create_standalone_manual_order(uuid, integer, text, text, text, boolean, text, text) to authenticated;
grant execute on function public.resolve_production_cost(uuid, integer, bigint, text, text) to authenticated;
grant execute on function public.expire_or_cancel_order(uuid, integer, text, text, text) to authenticated, service_role;
grant execute on function public.cancel_published_preorder(uuid, integer) to authenticated;
