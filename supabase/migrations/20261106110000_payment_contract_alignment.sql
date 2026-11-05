-- Menyamakan fungsi pembayaran dengan kontrak C5 (docs/api/payment-integration.md). Tabel tidak berubah.
--
-- Keputusan urutan kunci: preorder, kapasitas, pesanan, lalu pembayaran dan reservasi, sama dengan R4. Schema §19.1 menulis
-- kapasitas lebih dulu, tapi semua fungsi yang sudah ada memakai urutan ini, dan satu urutan yang sama yang mencegah deadlock.

drop function private.payment_attempt_result(public.payments, boolean);

create function private.payment_attempt_result(p_payment public.payments, p_action text) returns jsonb
language sql
stable
set search_path = ''
as $$
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
$$;

-- `action` memberi tahu pemanggil apa yang boleh dilakukan, agar dua tab tidak sama-sama membuat tagihan:
-- `create_charge` percobaan baru dibuat dan pemanggil ini yang menagih. `reuse_qr` pakai QR yang sudah ada.
-- `wait` pemanggil lain sedang menagih. `reconcile` penagih sebelumnya tidak selesai, jadi cek status memakai referensi yang sama.
-- `updated_at` menjadi tanda waktu: hanya satu pemanggil per 60 detik yang mendapat `reconcile`, tanpa perlu kolom baru.
create or replace function public.claim_payment_attempt(p_token_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- `p_provider_status` adalah nilai mentah Midtrans. Hanya `settlement` yang berarti lunas untuk QRIS; status tak dikenal diabaikan.
-- Hasilnya `applied`, `duplicate`, `conflict`, `review`, `recorded`, `ignored`, atau `amount_mismatch`.
-- Kunci sama dengan hash berbeda belum tentu masalah (format notifikasi bisa berubah), jadi yang dibandingkan adalah faktanya.
create or replace function public.apply_verified_payment(
  p_provider_order_id text,
  p_provider_event_key text,
  p_payload_hash text,
  p_provider_status text,
  p_provider_transaction_id text,
  p_amount_idr bigint,
  p_provider_paid_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function private.payment_attempt_result(public.payments, text) from public;
