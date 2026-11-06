-- Domain inti Rafi (R1 sampai R5) di atas baseline v2.1 milik Steven (20261103000000_initial_v21).
--
-- Menggantikan 13 migration lama Rafi (20261102091442 sampai 20261106150000) saat branch ai-campaign digabung.
-- Tabel inti sudah dibuat baseline, jadi berkas ini hanya menambah yang dipakai aplikasi pemilik dan pembeli:
-- kolom categories, fungsi RPC, policy tulis, bucket foto, index baca, dan penjaga kapasitas.
-- Trigger dan constraint Steven tetap berlaku dan lebih ketat, jadi fungsi di sini harus lolos keduanya.
-- Fungsi inti Steven yang namanya sama tetapi parameternya beda (publish_preorder, apply_verified_payment,
-- create_business_with_owner, claim_jobs) dibiarkan. Aplikasi memakai versi di bawah ini.

set check_function_bodies = off;
set search_path = public, extensions;

-- Pemilik schema private hanya membuka helper yang dipakai constraint dan policy di bawah.
grant usage on schema private to authenticated, service_role;

-- Fungsi
CREATE OR REPLACE FUNCTION private.are_valid_business_categories(p_categories text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select array_ndims(p_categories) = 1
    and cardinality(p_categories) between 1 and 3
    and not exists (
      select 1 from unnest(p_categories) as category
      where category is null or char_length(btrim(category)) not between 1 and 80
    )
    and (
      select count(distinct lower(btrim(category))) from unnest(p_categories) as category
    ) = cardinality(p_categories);
$function$
;
CREATE OR REPLACE FUNCTION private.assert_orderable(p_capacity production_capacity, p_item preorder_items, p_quantity integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_quantity > p_capacity.total_units - private.committed_units(p_capacity.id, null)
     or p_quantity > p_item.quota_units - private.committed_units(p_capacity.id, p_item.id) then
    raise exception 'CAPACITY_UNAVAILABLE';
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.close_active_payment_attempts(p_order orders, p_status text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with closed as (
    update public.payments
    set status = p_status, is_active_attempt = false
    where order_id = p_order.id and is_active_attempt
    returning id
  )
  insert into public.job_runs (job_type, entity_id, business_id, dedupe_key)
  select 'reconcile', closed.id, p_order.business_id, 'payment:' || closed.id from closed
  on conflict (job_type, dedupe_key) do nothing;
$function$
;
CREATE OR REPLACE FUNCTION private.committed_units(p_capacity_id uuid, p_preorder_item_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(sum(reservation.quantity), 0)
  from public.capacity_reservations as reservation
  where reservation.capacity_id = p_capacity_id
    and (p_preorder_item_id is null or reservation.preorder_item_id = p_preorder_item_id)
    and (reservation.state = 'allocated' or (reservation.state = 'held' and reservation.expires_at > now()));
$function$
;
CREATE OR REPLACE FUNCTION private.current_order_offer(p_preorder_id uuid)
 RETURNS TABLE(discount_bps integer, pricing_campaign_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select 0, null::uuid; $function$
;
CREATE OR REPLACE FUNCTION private.current_owner_business()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_business_id uuid;
begin
  select member.business_id into v_business_id
  from public.business_members as member
  where member.user_id = auth.uid() and member.role = 'owner';

  if v_business_id is null then
    raise exception 'PREORDER_NOT_FOUND' using errcode = '42501';
  end if;
  return v_business_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.discount_per_unit(p_base_price_idr bigint, p_discount_bps integer)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_base_price_idr * p_discount_bps / 10000;
$function$
;
CREATE OR REPLACE FUNCTION private.enqueue_paid_email(p_order orders)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.job_runs (job_type, entity_id, business_id, dedupe_key)
  values ('send_paid_email', p_order.id, p_order.business_id, p_order.id || ':paid-v1')
  on conflict (job_type, dedupe_key) do nothing;
$function$
;
CREATE OR REPLACE FUNCTION private.guard_capacity_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  committed_units bigint;
begin
  if new.total_units < old.total_units then
    select coalesce(sum(reservation.quantity), 0)
    into committed_units
    from public.capacity_reservations as reservation
    where reservation.capacity_id = old.id
      and (
        reservation.state = 'allocated'
        or (reservation.state = 'held' and reservation.expires_at > now())
      );

    if new.total_units < committed_units then
      raise exception 'CAPACITY_BELOW_COMMITMENT';
    end if;
  end if;

  -- Cutoff dibekukan setelah publish (D-13).
  if (new.intake_cutoff_at, new.fulfillment_window_end_at)
       is distinct from (old.intake_cutoff_at, old.fulfillment_window_end_at)
     and exists (
       select 1
       from public.preorder_items as item
       join public.preorders as preorder on preorder.id = item.preorder_id
       where item.capacity_id = old.id
         and preorder.status = 'published'
     ) then
    raise exception 'CAPACITY_SCHEDULE_FROZEN';
  end if;

  return new;
end;
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
  v_discount_per_unit bigint := private.discount_per_unit(p_item.base_price_snapshot_idr, p_discount_bps);
  v_final_unit_price bigint := p_item.base_price_snapshot_idr - v_discount_per_unit;
begin
  select * into v_product from public.products as product where product.id = p_item.product_id;

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
CREATE OR REPLACE FUNCTION private.is_business_owner(p_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.business_members
    where business_id = p_business_id
      and user_id = (select auth.uid())
  );
$function$
;
CREATE OR REPLACE FUNCTION private.job_backoff(p_attempt integer)
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_attempt when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '15 minutes' else interval '60 minutes' end;
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
  if p_expected_version is not null and v_order.version <> p_expected_version then
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
  if v_preorder.version <> p_expected_version then
    raise exception 'PREORDER_VERSION_CONFLICT';
  end if;
  return v_preorder;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.new_order_number()
 RETURNS text
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select 'CL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$function$
;
CREATE OR REPLACE FUNCTION private.order_result(p_order orders, p_replayed boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'order_id', p_order.id,
    'public_order_number', p_order.public_order_number,
    'order_status', p_order.order_status,
    'total_idr', p_order.total_idr,
    'payment_due_at', p_order.payment_due_at,
    'replayed', p_replayed
  );
$function$
;
CREATE OR REPLACE FUNCTION private.owns_product_photo(p_object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when split_part(p_object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_business_owner(split_part(p_object_name, '/', 1)::uuid)
    else false
  end;
$function$
;
CREATE OR REPLACE FUNCTION private.payment_attempt_result(p_payment payments, p_action text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'action', p_action,
    'payment_id', p_payment.id,
    'provider_order_id', p_payment.provider_order_id,
    'attempt_number', p_payment.attempt_number,
    'amount_idr', p_payment.amount_idr,
    'status', p_payment.status,
    'qr_content', p_payment.qr_content,
    'qr_expires_at', p_payment.qr_expires_at
  );
$function$
;
CREATE OR REPLACE FUNCTION private.record_order_event(p_business_id uuid, p_order_id uuid, p_event_type text, p_from_state text, p_to_state text, p_details jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.order_events (business_id, order_id, event_type, from_state, to_state, actor_type, actor_user_id, details_json)
  values (
    p_business_id, p_order_id, p_event_type, p_from_state, p_to_state,
    case when auth.uid() is null then 'system' else 'owner' end,
    auth.uid(),
    p_details
  );
$function$
;
CREATE OR REPLACE FUNCTION private.resolve_attribution(p_preorder_id uuid, p_attribution_ref text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select null::uuid;
$function$
;
CREATE OR REPLACE FUNCTION public.accept_late_payment(p_order_id uuid, p_expected_version integer, p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_business_id uuid := private.current_owner_business();
  v_order public.orders;
  v_order_item public.order_items;
  v_item public.preorder_items;
  v_capacity public.production_capacity;
  v_payment public.payments;
  v_previous_status text;
begin
  select * into v_order_item
  from public.order_items as item
  where item.order_id = p_order_id and item.business_id = v_business_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  perform 1 from public.preorders as preorder
  where preorder.id = (select item.preorder_id from public.preorder_items as item where item.id = v_order_item.preorder_item_id)
  for share;
  select * into v_item from public.preorder_items as item where item.id = v_order_item.preorder_item_id;
  select * into v_capacity from public.production_capacity as capacity where capacity.id = v_item.capacity_id for update;

  v_order := private.lock_order(p_order_id, p_expected_version, v_business_id);
  v_previous_status := v_order.order_status;

  select * into v_payment
  from public.payments as payment
  where payment.id = p_payment_id and payment.order_id = p_order_id and payment.status = 'paid_sandbox' and payment.applied_at is null
  for update;

  if v_order.order_status <> 'requires_review'
     or v_payment.id is null
     or now() >= v_capacity.fulfillment_window_end_at
     or exists (select 1 from public.payments as payment where payment.order_id = p_order_id and payment.applied_at is not null) then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  perform private.assert_orderable(v_capacity, v_item, v_order_item.quantity);

  update public.capacity_reservations
  set state = 'allocated', expires_at = null, released_at = null, release_reason = null
  where order_item_id = v_order_item.id;
  update public.payments set applied_at = now(), review_reason = null where id = p_payment_id;
  update public.orders
  set order_status = 'awaiting_confirmation', fulfillment_status = 'pending_confirmation', cancelled_at = null, cancel_reason = null, review_reason = null
  where id = p_order_id
  returning * into v_order;

  perform private.record_order_event(v_order.business_id, p_order_id, 'late_payment_accepted', v_previous_status, 'awaiting_confirmation', jsonb_build_object('payment_id', p_payment_id));
  perform private.enqueue_paid_email(v_order);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.advance_fulfillment(p_order_id uuid, p_expected_version integer, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.apply_verified_payment(p_provider_order_id text, p_provider_event_key text, p_payload_hash text, p_provider_status text, p_provider_transaction_id text, p_amount_idr bigint, p_provider_paid_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payment_id uuid;
  v_order_id uuid;
  v_order public.orders;
  v_payment public.payments;
  v_event public.payment_events;
  v_hold public.capacity_reservations;
  v_terminal_status text := case p_provider_status when 'expire' then 'expired' when 'cancel' then 'cancelled' when 'deny' then 'failed' when 'failure' then 'failed' end;
  v_has_applied boolean;
  v_review_reason text;
  v_outcome text;
begin
  if coalesce(p_provider_order_id, '') = '' or coalesce(p_provider_event_key, '') = '' or coalesce(p_payload_hash, '') = ''
     or coalesce(p_provider_status, '') = '' or p_amount_idr is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  select payment.id, payment.order_id into v_payment_id, v_order_id from public.payments as payment where payment.provider_order_id = p_provider_order_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  select * into v_order from public.orders as customer_order where customer_order.id = v_order_id for update;
  select * into v_payment from public.payments as payment where payment.id = v_payment_id for update;

  select * into v_event from public.payment_events as event where event.payment_id = v_payment.id and event.provider_event_key = p_provider_event_key;
  if found then
    v_outcome := case when v_event.provider_status <> p_provider_status or p_amount_idr <> v_payment.amount_idr then 'conflict' else 'duplicate' end;
    return jsonb_build_object(
      'outcome', v_outcome, 'payment_id', v_payment.id, 'order_id', v_order.id, 'order_status', v_order.order_status,
      'payload_changed', v_event.payload_hash <> p_payload_hash
    );
  end if;

  if p_amount_idr <> v_payment.amount_idr then
    v_outcome := 'amount_mismatch';

  elsif p_provider_status = 'settlement' then
    if v_payment.status = 'paid_sandbox' then
      v_outcome := 'ignored';
    else
      update public.payments
      set status = 'paid_sandbox',
          is_active_attempt = false,
          provider_paid_at = coalesce(p_provider_paid_at, now()),
          verified_at = now(),
          provider_transaction_id = coalesce(provider_transaction_id, p_provider_transaction_id)
      where id = v_payment.id;

      select exists (select 1 from public.payments as payment where payment.order_id = v_order.id and payment.applied_at is not null) into v_has_applied;

      if v_order.order_status = 'pending_payment' and not v_has_applied then
        select * into v_hold
        from public.capacity_reservations as reservation
        where reservation.order_id = v_order.id and reservation.state = 'held' and reservation.expires_at > now()
        for update;
      end if;

      if v_hold.id is not null then
        update public.payments set applied_at = now() where id = v_payment.id;
        update public.capacity_reservations set state = 'allocated', expires_at = null where id = v_hold.id;
        update public.orders set order_status = 'awaiting_confirmation' where id = v_order.id returning * into v_order;
        perform private.record_order_event(v_order.business_id, v_order.id, 'payment_applied', 'pending_payment', 'awaiting_confirmation', jsonb_build_object('payment_id', v_payment.id));
        perform private.enqueue_paid_email(v_order);
        v_outcome := 'applied';

      elsif v_has_applied then
        -- Pembayaran pertama tetap sah, jadi pesanan tidak diganggu. Fakta kedua dicatat agar pemilik bisa mengurus pengembaliannya.
        update public.payments set review_reason = 'duplicate_settlement' where id = v_payment.id;
        perform private.record_order_event(v_order.business_id, v_order.id, 'duplicate_settlement_recorded', null, null, jsonb_build_object('payment_id', v_payment.id));
        v_outcome := 'review';

      else
        v_review_reason := case v_order.order_status when 'cancelled' then 'order_cancelled' when 'expired' then 'order_expired' when 'requires_review' then 'additional_settlement' else 'hold_expired' end;
        update public.payments set review_reason = v_review_reason where id = v_payment.id;
        if v_order.order_status <> 'requires_review' then
          update public.capacity_reservations
          set state = 'released', released_at = now(), release_reason = 'expired'
          where order_id = v_order.id and state = 'held';
          update public.orders set order_status = 'requires_review', fulfillment_status = 'cancelled', review_reason = v_review_reason where id = v_order.id;
          perform private.record_order_event(v_order.business_id, v_order.id, 'late_payment_received', v_order.order_status, 'requires_review', jsonb_build_object('payment_id', v_payment.id));
        end if;
        v_outcome := 'review';
      end if;
    end if;

  elsif p_provider_status = 'pending' then
    -- Notifikasi lama tidak menurunkan status, jadi hanya percobaan yang baru dibuat yang berubah.
    update public.payments
    set status = 'pending', provider_transaction_id = coalesce(provider_transaction_id, p_provider_transaction_id)
    where id = v_payment.id and status = 'initiating';
    v_outcome := 'recorded';

  elsif v_terminal_status is not null then
    if v_payment.status = 'paid_sandbox' then
      v_outcome := 'ignored';
    else
      update public.payments set status = v_terminal_status, is_active_attempt = false where id = v_payment.id;
      v_outcome := 'recorded';
    end if;

  else
    v_outcome := 'ignored';
  end if;

  insert into public.payment_events (business_id, payment_id, provider_event_key, payload_hash, provider_status, signature_valid, verified_at, processed_at, outcome)
  values (v_order.business_id, v_payment.id, p_provider_event_key, p_payload_hash, p_provider_status, true, now(), now(), v_outcome);

  select * into v_order from public.orders as customer_order where customer_order.id = v_order_id;
  return jsonb_build_object('outcome', v_outcome, 'payment_id', v_payment.id, 'order_id', v_order.id, 'order_status', v_order.order_status, 'payload_changed', false);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cancel_preorder_draft(p_preorder_id uuid, p_expected_version integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (private.lock_owned_preorder(p_preorder_id, p_expected_version)).status <> 'draft' then
    raise exception 'PREORDER_NOT_DRAFT';
  end if;

  update public.preorders set status = 'cancelled' where id = p_preorder_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cancel_published_preorder(p_preorder_id uuid, p_expected_version integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (private.lock_owned_preorder(p_preorder_id, p_expected_version)).status <> 'published' then
    raise exception 'PREORDER_NOT_PUBLISHED';
  end if;

  if exists (select 1 from public.orders as customer_order where customer_order.preorder_id = p_preorder_id) then
    raise exception 'PREORDER_HAS_ORDERS';
  end if;

  update public.preorders set status = 'cancelled' where id = p_preorder_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_jobs(p_job_types text[], p_limit integer, p_lease_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_max_attempts constant integer := 5;
  v_claimed jsonb;
begin
  if coalesce(cardinality(p_job_types), 0) = 0 or p_limit is null or p_limit not between 1 and 100
     or p_lease_seconds is null or p_lease_seconds not between 1 and 3600 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Worker mati berkali-kali tidak boleh mengulang tanpa batas.
  update public.job_runs
  set status = 'dead', finished_at = now(), locked_until = null, last_error_code = coalesce(last_error_code, 'LEASE_EXPIRED')
  where job_type = any (p_job_types) and status = 'running' and locked_until < now() and attempt_count >= v_max_attempts;

  with ready as (
    select job.id
    from public.job_runs as job
    where job.job_type = any (p_job_types)
      and (
        (job.status in ('queued', 'retryable_failed') and job.next_run_at <= now())
        or (job.status = 'running' and job.locked_until < now())
      )
    order by job.next_run_at, job.created_at
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.job_runs as job
    set status = 'running', attempt_count = job.attempt_count + 1, locked_until = now() + make_interval(secs => p_lease_seconds)
    from ready
    where job.id = ready.id
    returning job.id, job.job_type, job.entity_id, job.business_id, job.attempt_count
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into v_claimed from claimed;

  return v_claimed;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_payment_attempt(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders;
  v_payment public.payments;
begin
  select * into v_order from public.orders as customer_order where customer_order.private_token_hash = p_token_hash for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.order_status <> 'pending_payment' or v_order.payment_due_at is null or v_order.payment_due_at <= now() then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  select * into v_payment from public.payments as payment where payment.order_id = v_order.id and payment.is_active_attempt for update;
  if found then
    if v_payment.qr_content is not null then
      return private.payment_attempt_result(v_payment, 'reuse_qr');
    end if;
    if v_payment.updated_at > now() - interval '60 seconds' then
      return private.payment_attempt_result(v_payment, 'wait');
    end if;
    update public.payments set updated_at = now() where id = v_payment.id returning * into v_payment;
    return private.payment_attempt_result(v_payment, 'reconcile');
  end if;

  insert into public.payments (business_id, order_id, provider_order_id, attempt_number, amount_idr, status, is_active_attempt)
  select v_order.business_id, v_order.id, v_order.public_order_number || '-' || next_attempt.number, next_attempt.number, v_order.total_idr, 'initiating', true
  from (select coalesce(max(payment.attempt_number), 0) + 1 as number from public.payments as payment where payment.order_id = v_order.id) as next_attempt
  returning * into v_payment;

  return private.payment_attempt_result(v_payment, 'create_charge');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.close_preorder(p_preorder_id uuid, p_expected_version integer, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_preorder public.preorders := private.lock_owned_preorder(p_preorder_id, p_expected_version);
begin
  if v_preorder.status <> 'published' then
    raise exception 'PREORDER_NOT_PUBLISHED';
  end if;
  if btrim(coalesce(p_reason, '')) = '' or char_length(p_reason) > 500 then
    raise exception 'PREORDER_INPUT_INVALID';
  end if;

  update public.preorders set status = 'closed', closed_at = now() where id = p_preorder_id;

  insert into public.domain_events (business_id, entity_type, entity_id, event_type, actor_type, actor_user_id, safe_details_json, occurred_at)
  values (v_preorder.business_id, 'preorder', p_preorder_id, 'preorder_closed', 'owner', auth.uid(), jsonb_build_object('reason', btrim(p_reason)), now());
end;
$function$
;
CREATE OR REPLACE FUNCTION public.complete_job(p_job_id uuid, p_attempt integer, p_provider_reference text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.job_runs
  set status = 'succeeded', finished_at = now(), locked_until = null, last_error_code = null,
      provider_reference = coalesce(p_provider_reference, provider_reference)
  where id = p_job_id and status = 'running' and attempt_count = p_attempt;
  return found;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.complete_preorder(p_preorder_id uuid, p_expected_version integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (private.lock_owned_preorder(p_preorder_id, p_expected_version)).status <> 'closed' then
    raise exception 'PREORDER_NOT_CLOSED';
  end if;

  if exists (
    select 1
    from public.orders as customer_order
    where customer_order.preorder_id = p_preorder_id
      and (
        customer_order.order_status in ('pending_payment', 'awaiting_confirmation', 'requires_review')
        or (customer_order.order_status = 'active' and customer_order.fulfillment_status not in ('fulfilled', 'cancelled'))
      )
  ) then
    raise exception 'PREORDER_ORDERS_UNRESOLVED';
  end if;

  update public.preorders set status = 'completed', completed_at = now() where id = p_preorder_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_business_with_owner(p_name text, p_slug text, p_categories text[], p_description text, p_public_contact text, p_pickup_instructions text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_business_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  insert into public.businesses (name, slug, categories, description, public_contact, pickup_instructions)
  values (p_name, p_slug, p_categories, p_description, p_public_contact, p_pickup_instructions)
  returning id into v_business_id;

  insert into public.business_members (business_id, user_id, role)
  values (v_business_id, v_user_id, 'owner');

  return v_business_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_manual_order(p_preorder_id uuid, p_quantity integer, p_customer_name text, p_customer_email text, p_customer_contact text, p_is_paid boolean, p_idempotency_key text, p_request_hash text)
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
    0, null, null
  );
  return private.order_result(v_order, false);
end;
$function$
;
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
$function$
;
CREATE OR REPLACE FUNCTION public.create_standalone_manual_order(p_capacity_id uuid, p_quantity integer, p_customer_name text, p_customer_email text, p_customer_contact text, p_is_paid boolean, p_idempotency_key text, p_request_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.decline_late_payment(p_order_id uuid, p_expected_version integer, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders := private.lock_order(p_order_id, p_expected_version, private.current_owner_business());
  v_next_status text := case when v_order.cancelled_at is not null then 'cancelled' else 'expired' end;
begin
  if btrim(coalesce(p_note, '')) = '' or char_length(p_note) > 500 then
    raise exception 'VALIDATION_ERROR';
  end if;
  if v_order.order_status <> 'requires_review' then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  update public.orders set order_status = v_next_status, review_reason = btrim(p_note) where id = p_order_id;
  perform private.record_order_event(v_order.business_id, p_order_id, 'late_payment_declined', 'requires_review', v_next_status, null);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_expire_jobs(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'VALIDATION_ERROR';
  end if;

  insert into public.job_runs (job_type, entity_id, business_id, dedupe_key)
  select 'expire', customer_order.id, customer_order.business_id, 'expire:' || customer_order.id
  from public.orders as customer_order
  where customer_order.order_status = 'pending_payment' and customer_order.payment_due_at <= now()
  order by customer_order.payment_due_at
  limit p_limit
  on conflict (job_type, dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.expire_or_cancel_order(p_order_id uuid, p_expected_version integer, p_action text, p_reason text, p_refund_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.fail_job(p_job_id uuid, p_attempt integer, p_error_code text, p_provider_reference text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_max_attempts constant integer := 5;
  v_status text;
begin
  if coalesce(p_error_code, '') !~ '^[A-Z0-9_]{1,64}$' then
    raise exception 'VALIDATION_ERROR';
  end if;

  update public.job_runs
  set status = case when attempt_count >= v_max_attempts then 'dead' else 'retryable_failed' end,
      finished_at = case when attempt_count >= v_max_attempts then now() end,
      next_run_at = case when attempt_count >= v_max_attempts then next_run_at else now() + private.job_backoff(attempt_count) end,
      locked_until = null,
      last_error_code = p_error_code,
      provider_reference = coalesce(p_provider_reference, provider_reference)
  where id = p_job_id and status = 'running' and attempt_count = p_attempt
  returning status into v_status;
  return v_status;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.publish_preorder(p_preorder_id uuid, p_expected_version integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_preorder public.preorders := private.lock_owned_preorder(p_preorder_id, p_expected_version);
  v_item public.preorder_items;
  v_capacity public.production_capacity;
  v_product public.products;
  v_business public.businesses;
  v_committed_units bigint;
begin
  if v_preorder.status <> 'draft' then
    raise exception 'PREORDER_NOT_DRAFT';
  end if;

  select * into v_item from public.preorder_items as item where item.preorder_id = p_preorder_id for update;
  select * into v_capacity from public.production_capacity as capacity where capacity.id = v_item.capacity_id for update;
  select * into v_product from public.products as product where product.id = v_item.product_id;
  select * into v_business from public.businesses as business where business.id = v_preorder.business_id;

  if not v_product.is_active then
    raise exception 'PREORDER_PRODUCT_INACTIVE';
  end if;

  -- Jadwal kapasitas bisa berubah selama masih draf, jadi diperiksa ulang di sini.
  if v_preorder.starts_at >= v_preorder.ends_at
     or v_preorder.ends_at > v_capacity.intake_cutoff_at
     or v_capacity.intake_cutoff_at >= v_capacity.fulfillment_window_end_at
     or v_preorder.ends_at <= now() then
    raise exception 'PREORDER_SCHEDULE_INVALID';
  end if;

  select coalesce(sum(reservation.quantity), 0) into v_committed_units
  from public.capacity_reservations as reservation
  where reservation.capacity_id = v_capacity.id
    and (reservation.state = 'allocated' or (reservation.state = 'held' and reservation.expires_at > now()));

  if v_item.quota_units > v_capacity.total_units - v_committed_units then
    raise exception 'PREORDER_QUOTA_OVER_CAPACITY';
  end if;

  update public.preorder_items
  set base_price_snapshot_idr = v_product.base_price_idr,
      product_name_snapshot = v_product.name,
      sku_snapshot = v_product.sku
  where id = v_item.id;

  begin
    update public.preorders
    set status = 'published',
        published_at = now(),
        pickup_terms_snapshot = jsonb_build_object(
          'pickup_instructions', v_business.pickup_instructions,
          'public_contact', v_business.public_contact,
          'intake_cutoff_at', v_capacity.intake_cutoff_at,
          'fulfillment_window_end_at', v_capacity.fulfillment_window_end_at
        )
    where id = p_preorder_id;
  exception
    when unique_violation then
      raise exception 'PREORDER_DATE_TAKEN';
  end;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.read_preorder_offer(p_preorder_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'discount_bps', offer.discount_bps,
    'pricing_campaign_id', offer.pricing_campaign_id,
    'final_unit_price_idr', item.base_price_snapshot_idr - private.discount_per_unit(item.base_price_snapshot_idr, offer.discount_bps)
  )
  from public.preorder_items as item
  cross join lateral private.current_order_offer(item.preorder_id) as offer
  where item.preorder_id = p_preorder_id;
$function$
;
CREATE OR REPLACE FUNCTION public.record_payment_charge(p_payment_id uuid, p_provider_transaction_id text, p_qr_content text, p_qr_expires_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.payments
  set status = 'pending',
      provider_transaction_id = coalesce(provider_transaction_id, p_provider_transaction_id),
      qr_content = p_qr_content,
      qr_expires_at = p_qr_expires_at
  where id = p_payment_id and is_active_attempt and status in ('initiating', 'pending');
  return found;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_production_cost(p_order_id uuid, p_expected_version integer, p_cost_per_unit_idr bigint, p_quality text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.save_preorder_draft(p_preorder_id uuid, p_expected_version integer, p_slug text, p_name text, p_capacity_id uuid, p_target_units integer, p_quota_units integer, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_business_id uuid := private.current_owner_business();
  v_preorder_id uuid := p_preorder_id;
  v_capacity public.production_capacity;
  v_product public.products;
begin
  if btrim(coalesce(p_name, '')) = ''
     or p_target_units is null or p_target_units <= 0
     or p_quota_units is null or p_quota_units < p_target_units then
    raise exception 'PREORDER_INPUT_INVALID';
  end if;

  select * into v_capacity
  from public.production_capacity as capacity
  where capacity.id = p_capacity_id and capacity.business_id = v_business_id;
  if not found then
    raise exception 'PREORDER_CAPACITY_NOT_FOUND';
  end if;

  select * into v_product
  from public.products as product
  where product.id = v_capacity.product_id and product.business_id = v_business_id;
  if not v_product.is_active then
    raise exception 'PREORDER_PRODUCT_INACTIVE';
  end if;

  if p_starts_at >= p_ends_at or p_ends_at > v_capacity.intake_cutoff_at then
    raise exception 'PREORDER_SCHEDULE_INVALID';
  end if;

  if v_preorder_id is null then
    insert into public.preorders (business_id, name, slug, fulfillment_date, starts_at, ends_at)
    values (v_business_id, p_name, p_slug, v_capacity.fulfillment_date, p_starts_at, p_ends_at)
    returning id into v_preorder_id;

    insert into public.preorder_items (
      business_id, preorder_id, product_id, capacity_id, target_units, quota_units,
      base_price_snapshot_idr, product_name_snapshot, sku_snapshot
    ) values (
      v_business_id, v_preorder_id, v_product.id, v_capacity.id, p_target_units, p_quota_units,
      v_product.base_price_idr, v_product.name, v_product.sku
    );
    return v_preorder_id;
  end if;

  if (private.lock_owned_preorder(v_preorder_id, p_expected_version)).status <> 'draft' then
    raise exception 'PREORDER_NOT_DRAFT';
  end if;

  update public.preorders
  set name = p_name, fulfillment_date = v_capacity.fulfillment_date, starts_at = p_starts_at, ends_at = p_ends_at
  where id = v_preorder_id;

  update public.preorder_items
  set product_id = v_product.id,
      capacity_id = v_capacity.id,
      target_units = p_target_units,
      quota_units = p_quota_units,
      base_price_snapshot_idr = v_product.base_price_idr,
      product_name_snapshot = v_product.name,
      sku_snapshot = v_product.sku
  where preorder_id = v_preorder_id;

  return v_preorder_id;
end;
$function$
;

-- Hak akses fungsi
revoke all on function accept_late_payment(uuid,integer,uuid) from public, anon, authenticated, service_role; grant execute on function accept_late_payment(uuid,integer,uuid) to authenticated;
revoke all on function advance_fulfillment(uuid,integer,text) from public, anon, authenticated, service_role; grant execute on function advance_fulfillment(uuid,integer,text) to authenticated;
revoke all on function apply_verified_payment(text,text,text,text,text,bigint,timestamp with time zone) from public, anon, authenticated, service_role; grant execute on function apply_verified_payment(text,text,text,text,text,bigint,timestamp with time zone) to service_role;
revoke all on function cancel_preorder_draft(uuid,integer) from public, anon, authenticated, service_role; grant execute on function cancel_preorder_draft(uuid,integer) to authenticated;
revoke all on function cancel_published_preorder(uuid,integer) from public, anon, authenticated, service_role; grant execute on function cancel_published_preorder(uuid,integer) to authenticated;
revoke all on function claim_jobs(text[],integer,integer) from public, anon, authenticated, service_role; grant execute on function claim_jobs(text[],integer,integer) to service_role;
revoke all on function claim_payment_attempt(text) from public, anon, authenticated, service_role; grant execute on function claim_payment_attempt(text) to service_role;
revoke all on function close_preorder(uuid,integer,text) from public, anon, authenticated, service_role; grant execute on function close_preorder(uuid,integer,text) to authenticated;
revoke all on function complete_job(uuid,integer,text) from public, anon, authenticated, service_role; grant execute on function complete_job(uuid,integer,text) to service_role;
revoke all on function complete_preorder(uuid,integer) from public, anon, authenticated, service_role; grant execute on function complete_preorder(uuid,integer) to authenticated;
revoke all on function create_business_with_owner(text,text,text[],text,text,text) from public, anon, authenticated, service_role; grant execute on function create_business_with_owner(text,text,text[],text,text,text) to authenticated;
revoke all on function create_manual_order(uuid,integer,text,text,text,boolean,text,text) from public, anon, authenticated, service_role; grant execute on function create_manual_order(uuid,integer,text,text,text,boolean,text,text) to authenticated;
revoke all on function create_preorder_order(text,integer,text,text,text,text,text,text,bigint,integer,text) from public, anon, authenticated, service_role; grant execute on function create_preorder_order(text,integer,text,text,text,text,text,text,bigint,integer,text) to service_role;
revoke all on function create_standalone_manual_order(uuid,integer,text,text,text,boolean,text,text) from public, anon, authenticated, service_role; grant execute on function create_standalone_manual_order(uuid,integer,text,text,text,boolean,text,text) to authenticated;
revoke all on function decline_late_payment(uuid,integer,text) from public, anon, authenticated, service_role; grant execute on function decline_late_payment(uuid,integer,text) to authenticated;
revoke all on function enqueue_expire_jobs(integer) from public, anon, authenticated, service_role; grant execute on function enqueue_expire_jobs(integer) to service_role;
revoke all on function expire_or_cancel_order(uuid,integer,text,text,text) from public, anon, authenticated, service_role; grant execute on function expire_or_cancel_order(uuid,integer,text,text,text) to authenticated, service_role;
revoke all on function fail_job(uuid,integer,text,text) from public, anon, authenticated, service_role; grant execute on function fail_job(uuid,integer,text,text) to service_role;
revoke all on function private.are_valid_business_categories(text[]) from public, anon, authenticated, service_role; grant execute on function private.are_valid_business_categories(text[]) to authenticated, service_role;
revoke all on function private.assert_orderable(production_capacity,preorder_items,integer) from public, anon, authenticated, service_role;
revoke all on function private.close_active_payment_attempts(orders,text) from public, anon, authenticated, service_role;
revoke all on function private.committed_units(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function private.current_order_offer(uuid) from public, anon, authenticated, service_role;
revoke all on function private.current_owner_business() from public, anon, authenticated, service_role;
revoke all on function private.discount_per_unit(bigint,integer) from public, anon, authenticated, service_role;
revoke all on function private.enqueue_paid_email(orders) from public, anon, authenticated, service_role;
revoke all on function private.guard_capacity_update() from public, anon, authenticated, service_role;
revoke all on function private.insert_order(preorders,preorder_items,text,text,text,text,text,text,text,integer,text,text,text,text,timestamp with time zone,integer,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function private.is_business_owner(uuid) from public, anon, authenticated, service_role; grant execute on function private.is_business_owner(uuid) to authenticated;
revoke all on function private.job_backoff(integer) from public, anon, authenticated, service_role;
revoke all on function private.lock_order(uuid,integer,uuid) from public, anon, authenticated, service_role;
revoke all on function private.lock_owned_preorder(uuid,integer) from public, anon, authenticated, service_role;
revoke all on function private.new_order_number() from public, anon, authenticated, service_role;
revoke all on function private.order_result(orders,boolean) from public, anon, authenticated, service_role;
revoke all on function private.owns_product_photo(text) from public, anon, authenticated, service_role; grant execute on function private.owns_product_photo(text) to authenticated;
revoke all on function private.payment_attempt_result(payments,text) from public, anon, authenticated, service_role;
revoke all on function private.record_order_event(uuid,uuid,text,text,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.resolve_attribution(uuid,text) from public, anon, authenticated, service_role;
revoke all on function publish_preorder(uuid,integer) from public, anon, authenticated, service_role; grant execute on function publish_preorder(uuid,integer) to authenticated;
revoke all on function read_preorder_offer(uuid) from public, anon, authenticated, service_role; grant execute on function read_preorder_offer(uuid) to service_role;
revoke all on function record_payment_charge(uuid,text,text,timestamp with time zone) from public, anon, authenticated, service_role; grant execute on function record_payment_charge(uuid,text,text,timestamp with time zone) to service_role;
revoke all on function resolve_production_cost(uuid,integer,bigint,text,text) from public, anon, authenticated, service_role; grant execute on function resolve_production_cost(uuid,integer,bigint,text,text) to authenticated;
revoke all on function save_preorder_draft(uuid,integer,text,text,uuid,integer,integer,timestamp with time zone,timestamp with time zone) from public, anon, authenticated, service_role; grant execute on function save_preorder_draft(uuid,integer,text,text,uuid,integer,integer,timestamp with time zone,timestamp with time zone) to authenticated;

-- Kategori usaha: aplikasi menyimpan 1 sampai 3 kategori. Kolom category milik baseline diisi kategori pertama
-- agar konteks AI tetap membaca satu kategori.
alter table public.businesses add column categories text[];
update public.businesses set categories = array[category::text] where categories is null;
alter table public.businesses
  alter column categories set not null,
  add constraint businesses_categories_valid check (private.are_valid_business_categories(categories));

create function private.sync_business_category() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.categories is null then
    new.categories := array[new.category::text];
  end if;
  new.category := left(new.categories[1], 80);
  return new;
end;
$$;
revoke all on function private.sync_business_category() from public, anon, authenticated, service_role;
create trigger business_category_sync before insert or update on public.businesses
  for each row execute function private.sync_business_category();

-- Penjaga kapasitas Rafi memberi kode galat yang dipetakan form. Nama dipilih agar jalan sebelum capacity_guard Steven.
create trigger capacity_commitment_guard before update on public.production_capacity
  for each row execute function private.guard_capacity_update();

-- Policy tulis pemilik. Baseline hanya punya policy baca.
create policy businesses_owner_update on public.businesses for update to authenticated
  using (public.is_business_owner(id)) with check (public.is_business_owner(id));
create policy products_owner_insert on public.products for insert to authenticated
  with check (public.is_business_owner(business_id));
create policy products_owner_update on public.products for update to authenticated
  using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));
create policy production_capacity_owner_insert on public.production_capacity for insert to authenticated
  with check (public.is_business_owner(business_id));
create policy production_capacity_owner_update on public.production_capacity for update to authenticated
  using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));

-- Foto produk: bucket publik, unggah dan hapus hanya di folder business_id milik sendiri.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy product_photos_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'product-photos' and private.owns_product_photo(name));
create policy product_photos_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and private.owns_product_photo(name));
create policy product_photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and private.owns_product_photo(name));

-- Slug preorder dipakai di URL pembeli /p/[slug], jadi harus unik.
create unique index preorders_slug_key on public.preorders (slug);

-- Index baca untuk daftar pesanan, kapasitas, dan catatan alasan tutup.
create index preorder_items_capacity_idx on public.preorder_items (capacity_id);
create index orders_business_status_created_idx on public.orders (business_id, order_status, created_at);
create index orders_preorder_idx on public.orders (preorder_id);
create index order_items_order_idx on public.order_items (order_id);
create index capacity_reservations_order_idx on public.capacity_reservations (order_id);
create index domain_events_entity_idx on public.domain_events (business_id, entity_type, entity_id, occurred_at);

-- Nilai bawaan yang diandalkan fungsi di atas. Baseline selalu mengisi kolom ini secara eksplisit, jadi tidak terpengaruh.
alter table public.preorders alter column status set default 'draft';
alter table public.payments alter column provider set default 'midtrans_sandbox';
alter table public.job_runs
  alter column status set default 'queued',
  alter column attempt_count set default 0,
  alter column next_run_at set default now();
alter table public.domain_events alter column occurred_at set default now();

-- Halaman preorder membaca status pesanan dari reservasi. Baseline hanya menautkan reservasi ke order_items.
alter table public.capacity_reservations
  add constraint capacity_reservations_order_id_business_id_fkey
  foreign key (order_id, business_id) references public.orders (id, business_id) on delete restrict;

-- Hak tulis pemilik per kolom, pasangan policy tulis di atas. Kolom lain (id, version, status) hanya lewat fungsi.
grant update (name, categories, description, public_contact, pickup_instructions) on table public.businesses to authenticated;
grant insert (business_id, name, sku, description, photo_path, base_price_idr, variable_cost_idr, cost_quality, is_active)
  on table public.products to authenticated;
grant update (name, sku, description, photo_path, base_price_idr, variable_cost_idr, cost_quality, is_active)
  on table public.products to authenticated;
grant insert (business_id, product_id, fulfillment_date, total_units, intake_cutoff_at, fulfillment_window_end_at)
  on table public.production_capacity to authenticated;
grant update (total_units, intake_cutoff_at, fulfillment_window_end_at) on table public.production_capacity to authenticated;
