"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { PhotoCropDialog } from "@/features/products/components/photo-crop-dialog";
import {
  MAX_PHOTO_BYTES,
  MAX_PRODUCT_PHOTOS,
  PHOTO_ACCEPT,
  PHOTO_LIMIT_MESSAGE,
  PHOTO_TOO_LARGE_MESSAGE,
} from "@/features/products/photo";

export type ExistingPhoto = { path: string; thumbnailUrl: string };
type AddedPhoto = { file: File; previewUrl: string };
/** Foto yang sudah dipilih tetapi belum dipotong; `id` membedakan file bernama sama di antrean. */
type QueuedPhoto = { id: number; file: File };
type Tile = { key: string; src: string; formValue: string; onRemove: () => void };

type ProductPhotoPickerProps = {
  existingPhotos: readonly ExistingPhoto[];
  /** Pesan dari server; disembunyikan setelah pilihan foto berubah sampai server memberi hasil berikutnya. */
  serverErrors?: string[];
};

/**
 * Foto lama yang dipertahankan dikirim sebagai `keepPhoto`, foto baru sebagai `photo`, dan pilihan foto utama sebagai
 * `primaryPhoto` (`keep:<path>` atau `new:<urutan>`); server memindah foto utama ke depan.
 * Setiap foto baru dipotong persegi dulu di {@link PhotoCropDialog}, satu per satu bila dipilih sekaligus.
 * Input pemilih tidak bernama dan dikosongkan setiap kali dipakai, sehingga pemilik bisa menambah foto sedikit demi sedikit;
 * daftar yang dikirim disalin ke input tersembunyi lewat DataTransfer.
 */
export function ProductPhotoPicker({ existingPhotos, serverErrors }: ProductPhotoPickerProps) {
  const [kept, setKept] = useState(existingPhotos);
  const [added, setAdded] = useState<AddedPhoto[]>([]);
  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const [primaryKey, setPrimaryKey] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [dismissedServerErrors, setDismissedServerErrors] = useState<string[]>();
  const submittedInput = useRef<HTMLInputElement>(null);
  const nextQueueId = useRef(0);

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
  const isFull = total + queue.length >= MAX_PRODUCT_PHOTOS;

  function changed() {
    setDismissedServerErrors(serverErrors);
  }

  // Dicek sebelum dipotong: file di atas batas tidak perlu dibuka sama sekali.
  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0) return;
    changed();
    if (picked.some((file) => file.size > MAX_PHOTO_BYTES)) return setClientError(PHOTO_TOO_LARGE_MESSAGE);
    if (total + queue.length + picked.length > MAX_PRODUCT_PHOTOS) return setClientError(PHOTO_LIMIT_MESSAGE);
    setClientError(null);
    setQueue((current) => [...current, ...picked.map((file) => ({ id: nextQueueId.current++, file }))]);
  }

  function applyCrop(file: File) {
    changed();
    setAdded((current) => [...current, { file, previewUrl: URL.createObjectURL(file) }]);
    setQueue((current) => current.slice(1));
  }

  function skipCrop() {
    setQueue((current) => current.slice(1));
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

  function choosePrimary(key: string) {
    changed();
    setPrimaryKey(key);
  }

  const visibleServerErrors = serverErrors === dismissedServerErrors ? undefined : serverErrors;
  const errors = clientError ? [clientError] : visibleServerErrors;
  const naturalTiles: Tile[] = [
    ...kept.map((photo) => ({ key: photo.path, src: photo.thumbnailUrl, formValue: `keep:${photo.path}`, onRemove: () => removeKept(photo.path) })),
    ...added.map((photo, index) => ({ key: photo.previewUrl, src: photo.previewUrl, formValue: `new:${index}`, onRemove: () => removeAdded(photo.previewUrl) })),
  ];
  // Foto utama yang dihapus otomatis digantikan foto pertama yang tersisa.
  const primary = naturalTiles.find((tile) => tile.key === primaryKey) ?? naturalTiles[0];
  const tiles = primary ? [primary, ...naturalTiles.filter((tile) => tile !== primary)] : [];

  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby="photo-hint">
      <legend className="mb-1.5 text-sm font-medium text-ink">Foto produk</legend>
      {kept.map((photo) => (
        <input key={photo.path} type="hidden" name="keepPhoto" value={photo.path} />
      ))}
      {primary && <input type="hidden" name="primaryPhoto" value={primary.formValue} />}
      <input ref={submittedInput} type="file" name="photo" multiple hidden tabIndex={-1} aria-hidden />

      <ul className="flex flex-wrap gap-3">
        {tiles.map((tile, index) => {
          const isPrimary = tile === primary;
          return (
            <li key={tile.key} className="relative">
              <Image
                src={tile.src}
                alt={isPrimary ? "Foto utama" : `Foto ${index + 1}`}
                width={96}
                height={96}
                unoptimized
                className={`size-24 rounded-[10px] border object-cover ${isPrimary ? "border-brand ring-2 ring-brand" : "border-line"}`}
              />
              {isPrimary ? (
                <span className="absolute inset-x-0 bottom-0 rounded-b-[10px] bg-brand px-1.5 py-1 text-center text-xs font-semibold text-on-brand">
                  Foto utama
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => choosePrimary(tile.key)}
                  aria-label={`Jadikan foto ${index + 1} foto utama`}
                  className="absolute inset-x-0 bottom-0 rounded-b-[10px] bg-ink/75 px-1.5 py-1 text-center text-xs! font-medium! text-surface transition-colors hover:bg-ink"
                >
                  Jadikan utama
                </button>
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
          );
        })}
        {!isFull && (
          <li>
            <label
              htmlFor="photo-picker"
              className="grid size-24 cursor-pointer place-items-center rounded-[10px] border border-dashed border-line text-center text-xs font-medium text-muted transition-colors hover:bg-subtle has-focus-visible:outline-2 has-focus-visible:outline-brand"
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
        {total}/{MAX_PRODUCT_PHOTOS} foto. Minimal 1 foto. Setiap foto dipotong persegi (1:1), sama seperti tampilannya di
        halaman pembeli. Pilih &ldquo;Jadikan utama&rdquo; untuk foto yang tampil pertama. JPG, PNG, atau WebP, maksimal 10MB per foto.
      </p>
      {errors && errors.length > 0 && (
        <p id="photo-error" className="text-sm text-[color:var(--owner-danger-fg)]">
          {errors.join(" ")}
        </p>
      )}

      {queue[0] && (
        <PhotoCropDialog key={queue[0].id} file={queue[0].file} waiting={queue.length - 1} onApply={applyCrop} onSkip={skipCrop} />
      )}
    </fieldset>
  );
}
