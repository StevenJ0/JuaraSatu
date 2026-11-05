-- Membatalkan draf yang tidak jadi dipakai. Hanya menambah fungsi; tabel tidak berubah.
--
-- Baris tetap ada dengan status `cancelled`, karena tidak ada DELETE untuk siapa pun (schema §3.7). Hanya draf yang bisa
-- dibatalkan: pesanan hanya bisa dibuat setelah terbit, jadi draf pasti belum punya pesanan, sedangkan preorder yang sudah
-- terbit memakai tutup. Kunci dan cek versi yang sama dengan publish_preorder, sehingga keduanya tidak bisa sama-sama berhasil.

create function public.cancel_preorder_draft(p_preorder_id uuid, p_expected_version integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (private.lock_owned_preorder(p_preorder_id, p_expected_version)).status <> 'draft' then
    raise exception 'PREORDER_NOT_DRAFT';
  end if;

  update public.preorders set status = 'cancelled' where id = p_preorder_id;
end;
$$;

revoke all on function public.cancel_preorder_draft(uuid, integer) from public, anon, service_role;
grant execute on function public.cancel_preorder_draft(uuid, integer) to authenticated;
