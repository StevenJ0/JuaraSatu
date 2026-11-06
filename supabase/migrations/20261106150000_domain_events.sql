-- Tabel audit `domain_events` sesuai schema v2.1 §16.3, dipakai pertama untuk alasan menutup preorder (PRD §13, close reason+version).
-- Dibuat atas izin eksplisit pengguna (6 November 2026). Append-only dan tanpa PII. Hanya ditulis lewat fungsi database.

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  command_key text,
  event_type text not null,
  actor_type text not null check (actor_type in ('owner', 'system', 'provider')),
  actor_user_id uuid references auth.users (id) on delete restrict,
  safe_details_json jsonb,
  occurred_at timestamptz not null default now()
);

-- PRD §11.5: satu command key per entitas, agar perintah yang diulang tidak tercatat dua kali.
create unique index domain_events_command_key on public.domain_events (entity_type, entity_id, command_key) where command_key is not null;
create index domain_events_entity_idx on public.domain_events (business_id, entity_type, entity_id, occurred_at);

create trigger domain_events_append_only before update or delete on public.domain_events
  for each row execute function private.reject_mutation();

revoke all on table public.domain_events from anon, authenticated, service_role;
grant select on table public.domain_events to authenticated;
grant select, insert on table public.domain_events to service_role;

alter table public.domain_events enable row level security;

create policy domain_events_owner_select on public.domain_events for select to authenticated
  using (business_id is not null and private.is_business_owner(business_id));

drop function public.close_preorder(uuid, integer);

-- Alasan wajib, dicek setelah kepemilikan, versi, dan status agar pesan galat yang sudah ada tidak berubah.
-- Status dan catatan audit berubah dalam satu transaksi.
create function public.close_preorder(p_preorder_id uuid, p_expected_version integer, p_reason text default null) returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  insert into public.domain_events (business_id, entity_type, entity_id, event_type, actor_type, actor_user_id, safe_details_json)
  values (v_preorder.business_id, 'preorder', p_preorder_id, 'preorder_closed', 'owner', auth.uid(), jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

revoke all on function public.close_preorder(uuid, integer, text) from public, anon, service_role;
grant execute on function public.close_preorder(uuid, integer, text) to authenticated;
