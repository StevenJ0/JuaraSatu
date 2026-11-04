-- R3: siklus preorder draft -> published -> closed -> completed. Hanya menambah fungsi; tabel tidak berubah.
--
-- Browser hanya bisa membaca `preorders` dan `preorder_items`, jadi semua perubahan lewat RPC di sini. Business selalu
-- dari auth.uid(), bukan input browser. Pelanggaran dikirim sebagai kode `PREORDER_*` agar aplikasi bisa memberi pesan
-- yang jelas. Baris milik bisnis lain dilaporkan NOT_FOUND supaya keberadaannya tidak terungkap.

create function private.current_owner_business() returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

-- Versi diperiksa lebih dulu: tab lama yang tertinggal mendapat pesan "sudah berubah", bukan pesan status.
create function private.lock_owned_preorder(p_preorder_id uuid, p_expected_version integer)
returns public.preorders
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Membuat draf baru bila p_preorder_id null, selain itu mengubah draf yang ada. Produk dan tanggal mengikuti kapasitas.
create function public.save_preorder_draft(
  p_preorder_id uuid,
  p_expected_version integer,
  p_slug text,
  p_name text,
  p_capacity_id uuid,
  p_target_units integer,
  p_quota_units integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Kunci baris kapasitas wajib: order, perubahan kapasitas, dan publish harus melihat angka yang sama.
create function public.publish_preorder(p_preorder_id uuid, p_expected_version integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create function public.close_preorder(p_preorder_id uuid, p_expected_version integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (private.lock_owned_preorder(p_preorder_id, p_expected_version)).status <> 'published' then
    raise exception 'PREORDER_NOT_PUBLISHED';
  end if;

  update public.preorders set status = 'closed', closed_at = now() where id = p_preorder_id;
end;
$$;

-- Selesai berarti tidak ada lagi pesanan yang menunggu pembayaran, konfirmasi, tinjauan, atau pengambilan.
create function public.complete_preorder(p_preorder_id uuid, p_expected_version integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function private.current_owner_business() from public;
revoke all on function private.lock_owned_preorder(uuid, integer) from public;

revoke all on function public.save_preorder_draft(uuid, integer, text, text, uuid, integer, integer, timestamptz, timestamptz) from public, anon, service_role;
revoke all on function public.publish_preorder(uuid, integer) from public, anon, service_role;
revoke all on function public.close_preorder(uuid, integer) from public, anon, service_role;
revoke all on function public.complete_preorder(uuid, integer) from public, anon, service_role;

grant execute on function public.save_preorder_draft(uuid, integer, text, text, uuid, integer, integer, timestamptz, timestamptz) to authenticated;
grant execute on function public.publish_preorder(uuid, integer) to authenticated;
grant execute on function public.close_preorder(uuid, integer) to authenticated;
grant execute on function public.complete_preorder(uuid, integer) to authenticated;
