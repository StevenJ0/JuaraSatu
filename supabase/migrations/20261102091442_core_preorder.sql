-- Core preorder (Anggota 1), mengikuti schema v2.1: bisnis, katalog, kapasitas, preorder, order, reservasi.
--
-- Prinsip akses:
-- * Browser tidak menulis langsung ke tabel transaksi. Owner hanya boleh menulis profil bisnis, produk, dan
--   kapasitas; preorder, order, dan reservasi berubah lewat RPC/server yang memvalidasi aturan bisnis.
-- * Pembeli guest tidak punya akses tabel. Halaman publik dilayani server, bukan policy `anon`.
-- * Tenant dijaga composite FK (kolom induk + business_id), sehingga baris anak tidak bisa menunjuk data bisnis lain.
--
-- Tidak termasuk (migration terpisah): tabel campaign dan payment (milik Anggota 2/3), serta RPC per slice
-- (publish_preorder, create_preorder_order, create_manual_order, advance_fulfillment, dst).

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fungsi trigger
-- ---------------------------------------------------------------------------

create function private.touch_row() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Dasar optimistic concurrency (schema §3.6): writer memfilter `version = expectedVersion`, trigger yang menaikkan.
create function private.touch_versioned_row() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create function private.reject_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'APPEND_ONLY: % tidak boleh diubah atau dihapus', tg_table_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bisnis
-- ---------------------------------------------------------------------------

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  slug varchar(140) not null unique,
  category varchar(80) not null,
  description text,
  public_contact varchar(120),
  pickup_instructions text not null,
  timezone varchar(64) not null default 'Asia/Jakarta',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete restrict,
  user_id uuid not null unique references auth.users (id) on delete restrict,
  role text not null default 'owner' check (role = 'owner'),
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER agar policy tidak memicu RLS `business_members` secara rekursif. Ditaruh di schema `private`
-- supaya tidak terekspos sebagai endpoint RPC.
create function private.is_business_owner(p_business_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members
    where business_id = p_business_id
      and user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Produk dan kapasitas
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  name varchar(160) not null,
  sku varchar(80) not null,
  description text,
  photo_path text,
  base_price_idr bigint not null check (base_price_idr > 0),
  variable_cost_idr bigint check (variable_cost_idr >= 0),
  cost_quality text not null check (cost_quality in ('unknown', 'estimated', 'verified')),
  is_active boolean not null default true,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, sku),
  unique (id, business_id),
  -- NULL berarti biaya belum diketahui, bukan Rp0 (PRD §11.2).
  check ((cost_quality = 'unknown') = (variable_cost_idr is null))
);

create table public.production_capacity (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  product_id uuid not null,
  fulfillment_date date not null,
  total_units integer not null check (total_units >= 0),
  intake_cutoff_at timestamptz not null,
  fulfillment_window_end_at timestamptz not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Sengaja tanpa unique (business_id, fulfillment_date): batas satu preorder published per tanggal ada di `preorders`.
  unique (business_id, product_id, fulfillment_date),
  unique (id, business_id),
  unique (id, business_id, product_id),
  check (intake_cutoff_at < fulfillment_window_end_at),
  foreign key (product_id, business_id) references public.products (id, business_id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- Preorder
-- ---------------------------------------------------------------------------

create table public.preorders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  name varchar(160) not null,
  slug varchar(160) not null unique,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'closed', 'completed', 'cancelled')),
  fulfillment_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  published_at timestamptz,
  closed_at timestamptz,
  completed_at timestamptz,
  pickup_terms_snapshot jsonb,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  check (starts_at < ends_at)
);

-- Pengaman akhir untuk publish bersamaan; publish_preorder tetap memberi pesan error yang jelas.
create unique index preorders_one_published_per_business_date
  on public.preorders (business_id, fulfillment_date)
  where status = 'published';

create index preorders_business_status_created_idx on public.preorders (business_id, status, created_at);

create table public.preorder_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  preorder_id uuid not null unique,
  product_id uuid not null,
  capacity_id uuid not null,
  target_units integer not null check (target_units > 0),
  quota_units integer not null check (quota_units > 0),
  base_price_snapshot_idr bigint not null check (base_price_snapshot_idr > 0),
  product_name_snapshot varchar(160) not null,
  sku_snapshot varchar(80) not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  check (quota_units >= target_units),
  foreign key (preorder_id, business_id) references public.preorders (id, business_id) on delete restrict,
  foreign key (product_id, business_id) references public.products (id, business_id) on delete restrict,
  -- Kapasitas harus milik bisnis dan produk yang sama dengan item.
  foreign key (capacity_id, business_id, product_id)
    references public.production_capacity (id, business_id, product_id) on delete restrict
);

create index preorder_items_capacity_idx on public.preorder_items (capacity_id);

-- ---------------------------------------------------------------------------
-- Order
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  preorder_id uuid,
  -- FK ke `campaigns` ditambahkan oleh migration campaign (tabelnya belum ada di migration ini).
  attribution_campaign_id uuid,
  pricing_campaign_id uuid,
  public_order_number text not null unique,
  private_token_hash text unique,
  idempotency_key text,
  request_hash text,
  source text not null check (source in ('public', 'manual')),
  customer_name text not null,
  customer_email text,
  customer_contact text,
  fulfillment_date date not null,
  payment_mode text not null check (payment_mode in ('midtrans_sandbox', 'external_manual')),
  external_payment_status text check (external_payment_status in ('unpaid', 'confirmed', 'voided')),
  external_payment_confirmed_at timestamptz,
  order_status text not null check (order_status in (
    'pending_payment', 'awaiting_confirmation', 'active', 'expired', 'cancelled', 'requires_review'
  )),
  fulfillment_status text not null check (fulfillment_status in (
    'pending_confirmation', 'confirmed', 'in_production', 'ready', 'fulfilled', 'cancelled'
  )),
  subtotal_idr bigint not null check (subtotal_idr >= 0),
  discount_total_idr bigint not null check (discount_total_idr >= 0),
  total_idr bigint not null check (total_idr >= 0),
  payment_due_at timestamptz,
  confirmed_at timestamptz,
  production_started_at timestamptz,
  ready_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  review_reason text,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  unique (business_id, idempotency_key),
  foreign key (preorder_id, business_id) references public.preorders (id, business_id) on delete restrict,
  check (total_idr = subtotal_idr - discount_total_idr),
  -- Order manual tidak boleh terlihat seperti pembayaran Midtrans (D-16).
  check (
    (source = 'public' and payment_mode = 'midtrans_sandbox')
    or (source = 'manual' and payment_mode = 'external_manual')
  ),
  check ((payment_mode = 'external_manual') = (external_payment_status is not null)),
  -- Checkout guest wajib preorder, email, token privat, dan idempotency (schema §9.1).
  check (
    source <> 'public'
    or (
      preorder_id is not null
      and customer_email is not null
      and private_token_hash is not null
      and idempotency_key is not null
      and request_hash is not null
    )
  )
);

create index orders_business_status_created_idx on public.orders (business_id, order_status, created_at);
create index orders_preorder_idx on public.orders (preorder_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  preorder_item_id uuid,
  product_id uuid not null,
  product_name_snapshot text not null,
  sku_snapshot text not null,
  quantity integer not null check (quantity > 0),
  base_unit_price_idr bigint not null check (base_unit_price_idr > 0),
  discount_bps_snapshot integer not null check (discount_bps_snapshot between 0 and 9999),
  discount_per_unit_idr bigint not null check (discount_per_unit_idr >= 0),
  final_unit_price_idr bigint not null check (final_unit_price_idr > 0),
  variable_cost_per_unit_idr bigint check (variable_cost_per_unit_idr >= 0),
  cost_quality_snapshot text not null check (cost_quality_snapshot in ('unknown', 'estimated', 'verified')),
  line_total_idr bigint not null,
  -- FK ke `campaigns` ditambahkan oleh migration campaign.
  pricing_campaign_id uuid,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (order_id, business_id) references public.orders (id, business_id) on delete restrict,
  foreign key (preorder_item_id, business_id) references public.preorder_items (id, business_id) on delete restrict,
  foreign key (product_id, business_id) references public.products (id, business_id) on delete restrict,
  check (final_unit_price_idr = base_unit_price_idr - discount_per_unit_idr),
  check (line_total_idr = quantity * final_unit_price_idr)
);

create index order_items_order_idx on public.order_items (order_id);

create table public.capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  order_item_id uuid not null unique,
  preorder_item_id uuid,
  capacity_id uuid not null,
  quantity integer not null check (quantity > 0),
  state text not null check (state in ('held', 'allocated', 'released')),
  expires_at timestamptz,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, business_id) references public.orders (id, business_id) on delete restrict,
  foreign key (order_item_id, business_id) references public.order_items (id, business_id) on delete restrict,
  foreign key (preorder_item_id, business_id) references public.preorder_items (id, business_id) on delete restrict,
  foreign key (capacity_id, business_id) references public.production_capacity (id, business_id) on delete restrict,
  check (state <> 'held' or expires_at is not null),
  check (state <> 'released' or released_at is not null)
);

create index capacity_reservations_capacity_idx on public.capacity_reservations (capacity_id, state, expires_at);
create index capacity_reservations_preorder_item_idx on public.capacity_reservations (preorder_item_id, state, expires_at);
create index capacity_reservations_order_idx on public.capacity_reservations (order_id);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  command_key text,
  event_type text not null,
  from_state text,
  to_state text,
  actor_type text not null check (actor_type in ('owner', 'system', 'provider')),
  actor_user_id uuid references auth.users (id) on delete restrict,
  details_json jsonb,
  occurred_at timestamptz not null default now(),
  -- Retry perintah yang sama tidak boleh mencatat event dua kali (PRD §11.4).
  unique (business_id, command_key),
  foreign key (order_id, business_id) references public.orders (id, business_id) on delete restrict
);

create index order_events_order_idx on public.order_events (order_id, occurred_at);

create table public.order_production_costs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_item_id uuid not null,
  cost_kind text not null check (cost_kind = 'variable_production'),
  quantity integer not null check (quantity > 0),
  cost_per_unit_idr bigint check (cost_per_unit_idr >= 0),
  amount_idr bigint check (amount_idr >= 0),
  quality text not null check (quality in ('unknown', 'estimated', 'verified')),
  incurred_at timestamptz not null,
  resolved_by_user_id uuid references auth.users (id) on delete restrict,
  resolution_note text,
  created_at timestamptz not null default now(),
  unique (order_item_id, cost_kind),
  foreign key (order_item_id, business_id) references public.order_items (id, business_id) on delete restrict,
  check ((quality = 'unknown') = (amount_idr is null))
);

-- Antrean persisten untuk expiry, rekonsiliasi, embedding, dan email paid. Hanya diakses server.
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('expire', 'reconcile', 'embed_memory', 'send_paid_email')),
  entity_id uuid,
  business_id uuid references public.businesses (id) on delete restrict,
  dedupe_key text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'retryable_failed', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_run_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error_code text,
  provider_reference text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (job_type, dedupe_key)
);

create index job_runs_claim_idx on public.job_runs (status, next_run_at);

-- ---------------------------------------------------------------------------
-- Penjaga kapasitas
-- ---------------------------------------------------------------------------

-- Dipasang sebagai trigger, bukan cek di aplikasi: UPDATE sudah mengunci baris kapasitas, sehingga tidak bisa
-- berselisih dengan checkout yang mengunci baris yang sama. SECURITY DEFINER agar menghitung semua reservasi.
create function private.guard_capacity_update() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create trigger production_capacity_guard
  before update on public.production_capacity
  for each row execute function private.guard_capacity_update();

-- ---------------------------------------------------------------------------
-- Trigger updated_at, version, append-only
-- ---------------------------------------------------------------------------

create trigger businesses_touch before update on public.businesses
  for each row execute function private.touch_row();
create trigger capacity_reservations_touch before update on public.capacity_reservations
  for each row execute function private.touch_row();

create trigger products_touch before update on public.products
  for each row execute function private.touch_versioned_row();
create trigger production_capacity_touch before update on public.production_capacity
  for each row execute function private.touch_versioned_row();
create trigger preorders_touch before update on public.preorders
  for each row execute function private.touch_versioned_row();
create trigger preorder_items_touch before update on public.preorder_items
  for each row execute function private.touch_versioned_row();
create trigger orders_touch before update on public.orders
  for each row execute function private.touch_versioned_row();

create trigger order_events_append_only before update or delete on public.order_events
  for each row execute function private.reject_mutation();

-- ---------------------------------------------------------------------------
-- RPC onboarding
-- ---------------------------------------------------------------------------

-- Bisnis dan keanggotaan owner dibuat dalam satu transaksi. Owner selalu auth.uid(), bukan input browser.
-- Slug bentrok atau user sudah punya bisnis menghasilkan 23505, yang ditangani service onboarding.
create function public.create_business_with_owner(
  p_name text,
  p_slug text,
  p_category text,
  p_description text,
  p_public_contact text,
  p_pickup_instructions text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_business_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  insert into public.businesses (name, slug, category, description, public_contact, pickup_instructions)
  values (p_name, p_slug, p_category, p_description, p_public_contact, p_pickup_instructions)
  returning id into v_business_id;

  insert into public.business_members (business_id, user_id, role)
  values (v_business_id, v_user_id, 'owner');

  return v_business_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak akses
-- ---------------------------------------------------------------------------

-- Supabase memberi hak penuh bawaan ke anon/authenticated pada tabel baru, jadi semuanya dicabut lalu diberi seperlunya.
revoke all on table
  public.businesses, public.business_members, public.products, public.production_capacity,
  public.preorders, public.preorder_items, public.orders, public.order_items,
  public.capacity_reservations, public.order_events, public.order_production_costs, public.job_runs
from anon, authenticated, service_role;

grant select on table
  public.businesses, public.business_members, public.products, public.production_capacity,
  public.preorders, public.preorder_items, public.orders, public.order_items,
  public.capacity_reservations, public.order_events, public.order_production_costs
to authenticated;

-- Slug, zona waktu, dan is_demo ditentukan server. Product/tanggal kapasitas tidak bisa dipindah setelah dibuat.
grant update (name, category, description, public_contact, pickup_instructions) on table public.businesses to authenticated;
grant insert (business_id, name, sku, description, photo_path, base_price_idr, variable_cost_idr, cost_quality, is_active)
  on table public.products to authenticated;
grant update (name, sku, description, photo_path, base_price_idr, variable_cost_idr, cost_quality, is_active)
  on table public.products to authenticated;
grant insert (business_id, product_id, fulfillment_date, total_units, intake_cutoff_at, fulfillment_window_end_at)
  on table public.production_capacity to authenticated;
grant update (total_units, intake_cutoff_at, fulfillment_window_end_at) on table public.production_capacity to authenticated;

-- Tanpa DELETE untuk siapa pun: histori transaksi tidak dihapus permanen (schema §3.7).
grant select, insert, update on table
  public.businesses, public.business_members, public.products, public.production_capacity,
  public.preorders, public.preorder_items, public.orders, public.order_items,
  public.capacity_reservations, public.order_production_costs, public.job_runs
to service_role;
grant select, insert on table public.order_events to service_role;

revoke all on function private.touch_row() from public;
revoke all on function private.touch_versioned_row() from public;
revoke all on function private.reject_mutation() from public;
revoke all on function private.guard_capacity_update() from public;
revoke all on function private.is_business_owner(uuid) from public;
grant execute on function private.is_business_owner(uuid) to authenticated;

revoke all on function public.create_business_with_owner(text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.create_business_with_owner(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.products enable row level security;
alter table public.production_capacity enable row level security;
alter table public.preorders enable row level security;
alter table public.preorder_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.capacity_reservations enable row level security;
alter table public.order_events enable row level security;
alter table public.order_production_costs enable row level security;
-- Tanpa policy: tertutup untuk browser, hanya service_role.
alter table public.job_runs enable row level security;

create policy businesses_owner_select on public.businesses for select to authenticated
  using (private.is_business_owner(id));
create policy businesses_owner_update on public.businesses for update to authenticated
  using (private.is_business_owner(id))
  with check (private.is_business_owner(id));

create policy business_members_self_select on public.business_members for select to authenticated
  using (user_id = (select auth.uid()));

create policy products_owner_select on public.products for select to authenticated
  using (private.is_business_owner(business_id));
create policy products_owner_insert on public.products for insert to authenticated
  with check (private.is_business_owner(business_id));
create policy products_owner_update on public.products for update to authenticated
  using (private.is_business_owner(business_id))
  with check (private.is_business_owner(business_id));

create policy production_capacity_owner_select on public.production_capacity for select to authenticated
  using (private.is_business_owner(business_id));
create policy production_capacity_owner_insert on public.production_capacity for insert to authenticated
  with check (private.is_business_owner(business_id));
create policy production_capacity_owner_update on public.production_capacity for update to authenticated
  using (private.is_business_owner(business_id))
  with check (private.is_business_owner(business_id));

create policy preorders_owner_select on public.preorders for select to authenticated
  using (private.is_business_owner(business_id));
create policy preorder_items_owner_select on public.preorder_items for select to authenticated
  using (private.is_business_owner(business_id));
create policy orders_owner_select on public.orders for select to authenticated
  using (private.is_business_owner(business_id));
create policy order_items_owner_select on public.order_items for select to authenticated
  using (private.is_business_owner(business_id));
create policy capacity_reservations_owner_select on public.capacity_reservations for select to authenticated
  using (private.is_business_owner(business_id));
create policy order_events_owner_select on public.order_events for select to authenticated
  using (private.is_business_owner(business_id));
create policy order_production_costs_owner_select on public.order_production_costs for select to authenticated
  using (private.is_business_owner(business_id));
