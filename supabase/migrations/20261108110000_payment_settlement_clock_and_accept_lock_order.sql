-- P2-2: integritas settlement pembayaran sebelum adapter Midtrans (Indro) disambungkan.
--
-- R1 (A6-09): apply_verified_payment memeriksa hold memakai clock_timestamp() setelah kunci pesanan, bukan now().
--   Terbukti: settlement yang mulai sebelum tenggat lalu tertahan kunci pesanan sampai lewat tenggat tetap dialokasikan,
--   dan bila slotnya sudah diambil pembeli lain, settlement gagal CAPACITY_EXCEEDED alih-alih masuk tinjauan.
-- R2 (U01): accept_late_payment mengunci pesanan sebelum preorder dan kapasitas. Semua fungsi yang mengubah pesanan yang
--   sudah ada (settlement, expire_or_cancel_order, accept) kini mengunci pesanan lebih dulu.
--   Terbukti: deadlock 40P01 antara accept_late_payment dan settlement pada pesanan yang sama.
--   Mengubah settlement agar mengunci kapasitas lebih dulu juga dicoba, tetapi terbukti deadlock dengan expire_or_cancel_order.
-- Isi fungsi lain tidak berubah. Kontrak hasil (applied, review, duplicate, conflict, dan seterusnya) tetap sama.

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
        -- Waktu nyata setelah kunci pesanan didapat. now() adalah waktu mulai transaksi, jadi settlement yang tertahan kunci
        -- sampai lewat tenggat sebelumnya tetap menerapkan hold yang sudah kedaluwarsa.
        where reservation.order_id = v_order.id and reservation.state = 'held' and reservation.expires_at > clock_timestamp()
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
$function$;

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

  -- Pesanan dikunci sebelum preorder dan kapasitas, sama dengan settlement dan expire_or_cancel_order.
  -- Urutan sebelumnya (kapasitas lalu pesanan) terbukti deadlock (40P01) dengan settlement pesanan yang sama.
  v_order := private.lock_order(p_order_id, p_expected_version, v_business_id);

  perform 1 from public.preorders as preorder
  where preorder.id = (select item.preorder_id from public.preorder_items as item where item.id = v_order_item.preorder_item_id)
  for share;
  select * into v_item from public.preorder_items as item where item.id = v_order_item.preorder_item_id;
  select * into v_capacity from public.production_capacity as capacity where capacity.id = v_item.capacity_id for update;

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
$function$;
