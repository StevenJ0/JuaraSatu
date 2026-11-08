-- A6-F1: bound new order prices and enforce owner CAS; no data backfill or ACL changes.
BEGIN;

CREATE OR REPLACE FUNCTION private.discount_per_unit(p_base_price_idr bigint, p_discount_bps integer)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
BEGIN
  IF p_base_price_idr IS NULL OR p_base_price_idr NOT BETWEEN 1 AND 1000000000
     OR p_discount_bps IS NULL OR p_discount_bps NOT BETWEEN 0 AND 9999 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  RETURN floor(p_base_price_idr::numeric * p_discount_bps / 10000)::bigint;
END;
$function$
;

CREATE OR REPLACE FUNCTION private.insert_order(p_preorder preorders, p_item preorder_items, p_source text, p_payment_mode text, p_external_payment_status text, p_order_status text, p_customer_name text, p_customer_email text, p_customer_contact text, p_quantity integer, p_token_hash text, p_idempotency_key text, p_request_hash text, p_reservation_state text, p_payment_due_at timestamp with time zone, p_discount_bps integer, p_pricing_campaign_id uuid, p_attribution_campaign_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product public.products;
  v_order public.orders;
  v_order_item_id uuid;
  v_discount_per_unit bigint;
  v_final_unit_price bigint;
begin
  -- Bound the undiscounted subtotal before bigint arithmetic or any persistent side effect.
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000
     OR p_item.base_price_snapshot_idr IS NULL OR p_item.base_price_snapshot_idr NOT BETWEEN 1 AND 1000000000
     OR p_item.base_price_snapshot_idr::numeric * p_quantity > 1000000000 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  v_discount_per_unit := private.discount_per_unit(p_item.base_price_snapshot_idr, p_discount_bps);
  v_final_unit_price := p_item.base_price_snapshot_idr - v_discount_per_unit;

  select * into v_product from public.products as product where product.id = p_item.product_id;
  IF v_product.variable_cost_idr IS NOT NULL AND v_product.variable_cost_idr NOT BETWEEN 0 AND 1000000000 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;

  insert into public.orders (
    business_id, preorder_id, attribution_campaign_id, pricing_campaign_id, public_order_number, private_token_hash, idempotency_key, request_hash, source,
    customer_name, customer_email, customer_contact, fulfillment_date, payment_mode, external_payment_status,
    external_payment_confirmed_at, order_status, fulfillment_status, subtotal_idr, discount_total_idr, total_idr, payment_due_at
  ) values (
    p_preorder.business_id, p_preorder.id, p_attribution_campaign_id, p_pricing_campaign_id, private.new_order_number(), p_token_hash, p_idempotency_key, p_request_hash, p_source,
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
$function$
;

CREATE OR REPLACE FUNCTION private.lock_order(p_order_id uuid, p_expected_version integer, p_business_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Only the real service-role expiry path has no owner scope and may omit CAS.
  if p_expected_version is null and (p_business_id is null
      and auth.uid() is null and auth.role() = 'service_role'
      and current_setting('role', true) = 'service_role') IS NOT TRUE then
    raise exception 'VERSION_CONFLICT';
  end if;
  if p_expected_version is not null and (p_expected_version <= 0 or v_order.version is distinct from p_expected_version) then
    raise exception 'VERSION_CONFLICT';
  end if;
  return v_order;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.lock_owned_preorder(p_preorder_id uuid, p_expected_version integer)
 RETURNS preorders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_preorder public.preorders;
begin
  select * into v_preorder
  from public.preorders as preorder
  where preorder.id = p_preorder_id and preorder.business_id = private.current_owner_business()
  for update;

  if not found then
    raise exception 'PREORDER_NOT_FOUND';
  end if;
  if p_expected_version is null or p_expected_version <= 0 or v_preorder.version is distinct from p_expected_version then
    raise exception 'PREORDER_VERSION_CONFLICT';
  end if;
  return v_preorder;
end;
$function$
;

COMMIT;
