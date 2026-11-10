"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  MAX_PHOTO_BYTES,
  MAX_PRODUCT_PHOTOS,
  PHOTO_ACCEPT,
  PHOTO_LIMIT_MESSAGE,
  PHOTO_TOO_LARGE_MESSAGE,
} from "@/features/products/photo";

export type ExistingPhoto = { path: string; thumbnailUrl: string };
type AddedPhoto = { file: File; previewUrl: string };

type ProductPhotoPickerProps = {
  existingPhotos: readonly ExistingPhoto[];
  /** Pesan dari server; disembunyikan setelah pilihan foto berubah sampai server memberi hasil berikutnya. */
  serverErrors?: string[];
};

/**
 * Foto lama yang dipertahankan dikirim sebagai `keepPhoto`, foto baru sebagai `photo` (berurutan, foto pertama jadi foto utama).
 * Input pemilih tidak bernama dan dikosongkan setiap kali dipakai, sehingga pemilik bisa menambah foto sedikit demi sedikit;
 * daftar yang dikirim disalin ke input tersembunyi lewat DataTransfer.
 */
export function ProductPhotoPicker({ existingPhotos, serverErrors }: ProductPhotoPickerProps) {
  const [kept, setKept] = useState(existingPhotos);
  const [added, setAdded] = useState<AddedPhoto[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);
  const [dismissedServerErrors, setDismissedServerErrors] = useState<string[]>();
  const submittedInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!submittedInput.current) return;
    const transfer = new DataTransfer();
    for (const photo of added) transfer.items.add(photo.file);
    submittedInput.current.files = transfer.files;
  }, [added]);

  // URL pratinjau dibebaskan saat komponen ditutup; yang dihapus satu per satu dibebaskan di removeAdded.
  const addedRef = useRef(added);
  useEffect(() => {
    addedRef.current = added;
  }, [added]);
  useEffect(() => () => addedRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl)), []);

  const total = kept.length + added.length;
  const isFull = total >= MAX_PRODUCT_PHOTOS;

  function changed() {
    setDismissedServerErrors(serverErrors);
  }

  // Dicek sebelum dikirim: file di atas batas body Server Action akan gagal sebelum sempat divalidasi server.
  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0) return;
    changed();
    if (picked.some((file) => file.size > MAX_PHOTO_BYTES)) return setClientError(PHOTO_TOO_LARGE_MESSAGE);
    if (total + picked.length > MAX_PRODUCT_PHOTOS) return setClientError(PHOTO_LIMIT_MESSAGE);
    setClientError(null);
    setAdded((current) => [...current, ...picked.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  }

  function removeKept(path: string) {
    changed();
    setClientError(null);
    setKept((current) => current.filter((photo) => photo.path !== path));
  }

  function removeAdded(previewUrl: string) {
    changed();
    setClientError(null);
    URL.revokeObjectURL(previewUrl);
    setAdded((current) => current.filter((photo) => photo.previewUrl !== previewUrl));
  }

  const visibleServerErrors = serverErrors === dismissedServerErrors ? undefined : serverErrors;
  const errors = clientError ? [clientError] : visibleServerErrors;
  const tiles = [
    ...kept.map((photo) => ({ key: photo.path, src: photo.thumbnailUrl, onRemove: () => removeKept(photo.path) })),
    ...added.map((photo) => ({ key: photo.previewUrl, src: photo.previewUrl, onRemove: () => removeAdded(photo.previewUrl) })),
  ];

  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby="photo-hint">
      <legend className="mb-1.5 text-sm font-medium text-ink">Foto produk</legend>
      {kept.map((photo) => (
        <input key={photo.path} type="hidden" name="keepPhoto" value={photo.path} />
      ))}
      <input ref={submittedInput} type="file" name="photo" multiple hidden tabIndex={-1} aria-hidden />

      <ul className="flex flex-wrap gap-2">
        {tiles.map((tile, index) => (
          <li key={tile.key} className="relative">
            <Image
              src={tile.src}
              alt={`Foto ${index + 1}`}
              width={80}
              height={80}
              unoptimized
              className="size-20 rounded-[10px] border border-line object-cover"
            />
            {index === 0 && (
              <span className="absolute bottom-1 left-1 rounded-md bg-ink/75 px-1.5 py-0.5 text-xs font-medium text-surface">
                Utama
              </span>
            )}
            <button
              type="button"
              onClick={tile.onRemove}
              aria-label={`Hapus foto ${index + 1}`}
              className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full border border-line bg-surface text-sm! text-ink shadow-sm hover:bg-subtle"
            >
              ×
            </button>
          </li>
        ))}
        {!isFull && (
          <li>
            <label
              htmlFor="photo-picker"
              className="grid size-20 cursor-pointer place-items-center rounded-[10px] border border-dashed border-line text-center text-xs font-medium text-muted transition-colors hover:bg-subtle has-focus-visible:outline-2 has-focus-visible:outline-brand"
            >
              + Tambah foto
              <input
                id="photo-picker"
                type="file"
                accept={PHOTO_ACCEPT}
                multiple
                className="sr-only"
                aria-invalid={errors?.length ? true : undefined}
                aria-describedby={errors?.length ? "photo-hint photo-error" : "photo-hint"}
                onChange={handlePick}
              />
            </label>
          </li>
        )}
      </ul>

      <p id="photo-hint" className="text-sm text-muted">
        {total}/{MAX_PRODUCT_PHOTOS} foto. Minimal 1 foto; foto pertama menjadi foto utama. JPG, PNG, atau
        WebP, maksimal 10MB per foto. Foto tampil ke pembeli.
      </p>
      {errors && errors.length > 0 && (
        <p id="photo-error" className="text-sm text-[color:var(--owner-danger-fg)]">
          {errors.join(" ")}
        </p>
      )}
    </fieldset>
  );
}
