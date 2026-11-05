-- Pembayaran Midtrans Sandbox sisi database: tabel `payments` dan `payment_events` (schema §10) serta satu jalur penerapan pembayaran.
--
-- Fungsi di sini tidak memanggil Midtrans. Adapter memverifikasi signature, lalu mengirim fakta yang sudah terverifikasi ke
-- `apply_verified_payment`. Hanya fungsi ini yang menulis status pembayaran, agar tidak ada dua penulis untuk status yang sama.
-- Urutan kunci: preorder, kapasitas, pesanan, lalu pembayaran dan reservasi (schema §19.1).

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  order_id uuid not null,
  provider text not null default 'midtrans_sandbox' check (provider = 'midtrans_sandbox'),
  provider_order_id text not null unique,
  provider_transaction_id text unique,
  attempt_number integer not null check (attempt_number >= 1),
  amount_idr bigint not null check (amount_idr >= 0),
  status text not null check (status in ('initiating', 'pending', 'paid_sandbox', 'expired', 'failed', 'cancelled')),
  is_active_attempt boolean not null,
  qr_content text,
  qr_expires_at timestamptz,
  provider_paid_at timestamptz,
  verified_at timestamptz,
  applied_at timestamptz,
  review_reason text,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  unique (order_id, attempt_number),
  foreign key (order_id, business_id) references public.orders (id, business_id) on delete restrict,
  check (applied_at is null or status = 'paid_sandbox')
);

create unique index payments_one_active_per_order on public.payments (order_id) where is_active_attempt;
create unique index payments_one_applied_per_order on public.payments (order_id) where applied_at is not null;

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  payment_id uuid not null,
  provider_event_key text not null,
  payload_hash text not null,
  provider_status text not null,
  signature_valid boolean not null,
  verified_at timestamptz not null,
  processed_at timestamptz,
  outcome text not null check (outcome in ('applied', 'review', 'recorded', 'ignored', 'amount_mismatch')),
  created_at timestamptz not null default now(),
  unique (payment_id, provider_event_key),
  foreign key (payment_id, business_id) references public.payments (id, business_id) on delete restrict
);

create trigger payments_touch before update on public.payments
  for each row execute function private.touch_versioned_row();
create trigger payment_events_append_only before update or delete on public.payment_events
  for each row execute function private.reject_mutation();

revoke all on table public.payments, public.payment_events from anon, authenticated, service_role;
grant select on table public.payments to authenticated;
grant select, insert, update on table public.payments to service_role;
grant select, insert on table public.payment_events to service_role;

alter table public.payments enable row level security;
alter table public.payment_events enable row level security;

create policy payments_owner_select on public.payments for select to authenticated
  using (private.is_business_owner(business_id));

create function private.payment_attempt_result(p_payment public.payments, p_reused boolean) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'payment_id', p_payment.id,
    'provider_order_id', p_payment.provider_order_id,
    'attempt_number', p_payment.attempt_number,
    'amount_idr', p_payment.amount_idr,
    'status', p_payment.status,
    'qr_content', p_payment.qr_content,
    'qr_expires_at', p_payment.qr_expires_at,
    'reused', p_reused
  );
$$;

-- Satu percobaan aktif per pesanan, jadi dua tab tidak membuat dua tagihan. Referensi tersimpan sebelum Midtrans dipanggil,
-- supaya webhook yang datang lebih dulu sudah punya pasangannya.
create function public.claim_payment_attempt(p_token_hash text) returns jsonb
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

  select * into v_payment from public.payments as payment where payment.order_id = v_order.id and payment.is_active_attempt;
  if found then
    return private.payment_attempt_result(v_payment, true);
  end if;

  insert into public.payments (business_id, order_id, provider_order_id, attempt_number, amount_idr, status, is_active_attempt)
  select v_order.business_id, v_order.id, v_order.public_order_number || '-' || next_attempt.number, next_attempt.number, v_order.total_idr, 'initiating', true
  from (select coalesce(max(payment.attempt_number), 0) + 1 as number from public.payments as payment where payment.order_id = v_order.id) as next_attempt
  returning * into v_payment;

  return private.payment_attempt_result(v_payment, false);
end;
$$;

-- Hanya berlaku selama percobaan masih aktif, jadi respons Midtrans yang terlambat tidak menimpa pembayaran yang sudah lunas.
create function public.record_payment_charge(
  p_payment_id uuid,
  p_provider_transaction_id text,
  p_qr_content text,
  p_qr_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments
  set status = 'pending',
      provider_transaction_id = coalesce(provider_transaction_id, p_provider_transaction_id),
      qr_content = p_qr_content,
      qr_expires_at = p_qr_expires_at
  where id = p_payment_id and is_active_attempt and status in ('initiating', 'pending');
  return found;
end;
$$;

-- Dedupe mengikuti `order_id:template_version` (schema §11.3). Isi email dibaca worker dari pesanan, bukan disimpan di job.
create function private.enqueue_paid_email(p_order public.orders) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.job_runs (job_type, entity_id, business_id, dedupe_key)
  values ('send_paid_email', p_order.id, p_order.business_id, p_order.id || ':paid-v1')
  on conflict (job_type, dedupe_key) do nothing;
$$;

-- `p_provider_status` adalah nilai mentah Midtrans. Hanya `settlement` yang berarti lunas untuk QRIS; status tak dikenal diabaikan.
-- Hasilnya `applied`, `duplicate`, `review`, `recorded`, `ignored`, atau `amount_mismatch`.
create function public.apply_verified_payment(
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

  if exists (select 1 from public.payment_events as event where event.payment_id = v_payment.id and event.provider_event_key = p_provider_event_key) then
    return jsonb_build_object('outcome', 'duplicate', 'payment_id', v_payment.id, 'order_id', v_order.id, 'order_status', v_order.order_status);
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
  return jsonb_build_object('outcome', v_outcome, 'payment_id', v_payment.id, 'order_id', v_order.id, 'order_status', v_order.order_status);
end;
$$;

-- Satu-satunya jalan menerima pembayaran terlambat: kapasitas dan kuota dicek ulang, bukan sekadar mengganti status.
create function public.accept_late_payment(p_order_id uuid, p_expected_version integer, p_payment_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Pesanan kembali ke status semula. Fakta pembayaran tetap tersimpan dan tidak bisa diubah pemilik.
create function public.decline_late_payment(p_order_id uuid, p_expected_version integer, p_note text) returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Tagihan di Midtrans belum tentu berhenti, jadi percobaan ditutup di sini dan pengecekannya diantrekan untuk job `reconcile`.
create function private.close_active_payment_attempts(p_order public.orders, p_status text) returns void
language sql
security definer
set search_path = ''
as $$
  with closed as (
    update public.payments
    set status = p_status, is_active_attempt = false
    where order_id = p_order.id and is_active_attempt
    returning id
  )
  insert into public.job_runs (job_type, entity_id, business_id, dedupe_key)
  select 'reconcile', closed.id, p_order.business_id, 'payment:' || closed.id from closed
  on conflict (job_type, dedupe_key) do nothing;
$$;

-- `expire` melepas slot yang tenggat bayarnya sudah lewat; server (job) atau pemilik boleh memanggilnya, dan mengulang tidak berefek.
-- `cancel` hanya untuk pemilik. Sebelum produksi slot dilepas. Setelah produksi alokasi dan biaya tetap ada, sesuai aturan PRD.
create or replace function public.expire_or_cancel_order(p_order_id uuid, p_expected_version integer, p_action text, p_reason text) returns void
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
    perform private.close_active_payment_attempts(v_order, 'expired');
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

  perform private.close_active_payment_attempts(v_order, 'cancelled');
  perform private.record_order_event(
    v_order.business_id, p_order_id, 'order_cancelled', v_order.order_status, 'cancelled',
    jsonb_build_object('slot_released', v_before_production)
  );
end;
$$;

revoke all on function private.payment_attempt_result(public.payments, boolean) from public;
revoke all on function private.enqueue_paid_email(public.orders) from public;
revoke all on function private.close_active_payment_attempts(public.orders, text) from public;

revoke all on function public.claim_payment_attempt(text) from public, anon, authenticated;
revoke all on function public.record_payment_charge(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.apply_verified_payment(text, text, text, text, text, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.accept_late_payment(uuid, integer, uuid) from public, anon, service_role;
revoke all on function public.decline_late_payment(uuid, integer, text) from public, anon, service_role;

grant execute on function public.claim_payment_attempt(text) to service_role;
grant execute on function public.record_payment_charge(uuid, text, text, timestamptz) to service_role;
grant execute on function public.apply_verified_payment(text, text, text, text, text, bigint, timestamptz) to service_role;
grant execute on function public.accept_late_payment(uuid, integer, uuid) to authenticated;
grant execute on function public.decline_late_payment(uuid, integer, text) to authenticated;
