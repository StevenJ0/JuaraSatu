-- Usaha boleh memiliki 1 sampai 3 kategori, karena UMKM bisa menjual lebih dari satu jenis produk.
-- Isinya tetap teks bebas karena form punya pilihan "Lainnya"; daftar kategori hanya ada di aplikasi.

-- CHECK constraint tidak boleh memuat subquery, jadi aturannya ditaruh di fungsi.
create function private.are_valid_business_categories(p_categories text[]) returns boolean
language sql
immutable
set search_path = ''
as $$
  select array_ndims(p_categories) = 1
    and cardinality(p_categories) between 1 and 3
    and not exists (
      select 1 from unnest(p_categories) as category
      where category is null or char_length(btrim(category)) not between 1 and 80
    )
    and (
      select count(distinct lower(btrim(category))) from unnest(p_categories) as category
    ) = cardinality(p_categories);
$$;

revoke all on function private.are_valid_business_categories(text[]) from public;
grant execute on function private.are_valid_business_categories(text[]) to authenticated, service_role;

-- Data lama menjadi daftar berisi satu kategori. Hak UPDATE per kolom ikut terbawa saat tipe dan nama kolom berubah.
alter table public.businesses
  alter column category type text[] using array[category::text];
alter table public.businesses
  rename column category to categories;
alter table public.businesses
  add constraint businesses_categories_valid check (private.are_valid_business_categories(categories));

drop function public.create_business_with_owner(text, text, text, text, text, text);

-- Bisnis dan keanggotaan owner dibuat dalam satu transaksi. Owner selalu auth.uid(), bukan input browser.
-- Slug bentrok atau user sudah punya bisnis menghasilkan 23505, yang ditangani service onboarding.
create function public.create_business_with_owner(
  p_name text,
  p_slug text,
  p_categories text[],
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

  insert into public.businesses (name, slug, categories, description, public_contact, pickup_instructions)
  values (p_name, p_slug, p_categories, p_description, p_public_contact, p_pickup_instructions)
  returning id into v_business_id;

  insert into public.business_members (business_id, user_id, role)
  values (v_business_id, v_user_id, 'owner');

  return v_business_id;
end;
$$;

revoke all on function public.create_business_with_owner(text, text, text[], text, text, text) from public, anon, service_role;
grant execute on function public.create_business_with_owner(text, text, text[], text, text, text) to authenticated;
