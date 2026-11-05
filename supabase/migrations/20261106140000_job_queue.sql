-- Antrean job bersama (PRD §12.6): pengambilan atomik, sewa waktu, ulang terbatas. Tabel `job_runs` tidak berubah.
--
-- Semua fungsi hanya untuk server. Handler dan scheduler berada di luar database. `attempt_count` menjadi tanda giliran:
-- worker yang sewanya sudah lewat tidak bisa menyelesaikan job yang sudah diambil worker lain.

create function private.job_backoff(p_attempt integer) returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_attempt when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '15 minutes' else interval '60 minutes' end;
$$;

create function public.claim_jobs(p_job_types text[], p_limit integer, p_lease_seconds integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Hasil false berarti sewa sudah lepas dan job dipegang worker lain, jadi hasil worker ini diabaikan.
create function public.complete_job(p_job_id uuid, p_attempt integer, p_provider_reference text default null) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.job_runs
  set status = 'succeeded', finished_at = now(), locked_until = null, last_error_code = null,
      provider_reference = coalesce(p_provider_reference, provider_reference)
  where id = p_job_id and status = 'running' and attempt_count = p_attempt;
  return found;
end;
$$;

-- `p_error_code` hanya kode, jangan isi data pelanggan atau pesan dari provider. Hasilnya status baru, atau null bila sewa sudah lepas.
create function public.fail_job(p_job_id uuid, p_attempt integer, p_error_code text, p_provider_reference text default null) returns text
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Mengulang aman karena dedupe per pesanan. Pesanan yang tetap menunggu bayar setelah job selesai tidak terjadi,
-- karena hanya pesanan yang tenggatnya lewat yang masuk.
create function public.enqueue_expire_jobs(p_limit integer) returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function private.job_backoff(integer) from public;
revoke all on function public.claim_jobs(text[], integer, integer) from public, anon, authenticated;
revoke all on function public.complete_job(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.fail_job(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.enqueue_expire_jobs(integer) from public, anon, authenticated;

grant execute on function public.claim_jobs(text[], integer, integer) to service_role;
grant execute on function public.complete_job(uuid, integer, text) to service_role;
grant execute on function public.fail_job(uuid, integer, text, text) to service_role;
grant execute on function public.enqueue_expire_jobs(integer) to service_role;
