-- Foto produk (PRD §11.5). Bucket publik karena foto tampil di katalog tanpa login; penulisan hanya oleh owner,
-- pada folder `business_id/...`. Batas ukuran dan tipe di sini lapisan kedua setelah cek isi file di server.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

-- CASE, bukan AND: Postgres tidak menjamin urutan evaluasi AND, dan cast nama folder non-uuid akan error.
create function private.owns_product_photo(p_object_name text) returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when split_part(p_object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_business_owner(split_part(p_object_name, '/', 1)::uuid)
    else false
  end;
$$;

revoke all on function private.owns_product_photo(text) from public;
grant execute on function private.owns_product_photo(text) to authenticated;

-- Tanpa policy UPDATE: mengganti foto selalu memakai nama file baru, lalu file lama dihapus.
create policy product_photos_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'product-photos' and private.owns_product_photo(name));
create policy product_photos_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and private.owns_product_photo(name));
create policy product_photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and private.owns_product_photo(name));
