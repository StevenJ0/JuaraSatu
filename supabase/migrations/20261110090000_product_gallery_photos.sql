-- Foto tambahan produk (galeri). Foto utama tetap di photo_path karena dibaca banyak alur (halaman publik, preorder,
-- daftar produk). Maksimal 4 foto tambahan, sehingga satu produk punya paling banyak 5 foto.
ALTER TABLE public.products ADD COLUMN gallery_photo_paths text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.products ADD CONSTRAINT products_gallery_photo_paths_max
  CHECK (cardinality(gallery_photo_paths) <= 4);

-- Galeri hanya bermakna bila ada foto utama.
ALTER TABLE public.products ADD CONSTRAINT products_gallery_requires_primary
  CHECK (cardinality(gallery_photo_paths) = 0 OR photo_path IS NOT NULL);

-- Hak tulis pemilik per kolom mengikuti photo_path (20261106160000_core_preorder_on_v21); RLS products tidak berubah.
GRANT INSERT (gallery_photo_paths), UPDATE (gallery_photo_paths) ON TABLE public.products TO authenticated;
