"use client";

import Image from "next/image";
import { Minus, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/form-message";
import {
  CROP_MAX_ZOOM,
  LOW_RESOLUTION_SIDE_PX,
  clampCrop,
  cropImageBox,
  cropOutputSide,
  cropSourceRect,
  initialCrop,
  panCrop,
  type CropState,
  type ImageSize,
} from "@/features/products/photo-crop";

type LoadedImage = { url: string; size: ImageSize; element: HTMLImageElement };
type PhotoCropDialogProps = {
  file: File;
  /** Jumlah foto yang masih menunggu dipotong setelah foto ini. */
  waiting: number;
  onApply: (file: File) => void;
  onSkip: () => void;
};

const KEY_PAN_PX = 12;
const ZOOM_STEP = 0.25;
const OUTPUT_QUALITY = 0.9;

function croppedFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "foto-produk";
  return `${base}.jpg`;
}

/** Latar putih dulu agar bagian transparan PNG tidak menjadi hitam saat disimpan sebagai JPEG. */
async function renderCrop(image: LoadedImage, crop: CropState, name: string): Promise<File | null> {
  const rect = cropSourceRect(image.size, crop);
  const side = cropOutputSide(image.size, crop);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, side, side);
  context.imageSmoothingQuality = "high";
  context.drawImage(image.element, rect.x, rect.y, rect.side, rect.side, 0, 0, side, side);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", OUTPUT_QUALITY));
  return blob ? new File([blob], croppedFileName(name), { type: "image/jpeg" }) : null;
}

/**
 * Pemilik memilih area persegi yang tampil ke pembeli sebelum foto ditambahkan. Pemotongan dilakukan di browser,
 * sehingga yang diunggah hanya area terpilih; server tetap memeriksa dan mengolah ulang file tersebut.
 * Tidak menutup saat klik di luar kotak, karena seretan yang berakhir di luar kotak bisa terbaca sebagai klik.
 */
export function PhotoCropDialog({ file, waiting, onApply, onSkip }: PhotoCropDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const hintId = useId();
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [crop, setCrop] = useState<CropState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; viewport: number } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const element = new window.Image();
    let active = true;
    element.onload = () => {
      if (!active) return;
      const size = { width: element.naturalWidth, height: element.naturalHeight };
      setImage({ url, size, element });
      setCrop(initialCrop(size));
    };
    element.onerror = () => {
      if (active) setLoadFailed(true);
    };
    element.src = url;
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  function update(next: (current: CropState, size: ImageSize) => CropState) {
    if (!image) return;
    setCrop((current) => (current ? next(current, image.size) : current));
  }

  function setZoom(zoom: number) {
    update((current, size) => clampCrop(size, { ...current, zoom }));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, viewport: event.currentTarget.getBoundingClientRect().width };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    drag.current = { ...start, x: event.clientX, y: event.clientY };
    update((current, size) => panCrop(size, current, deltaX, deltaY, start.viewport));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [KEY_PAN_PX, 0],
      ArrowRight: [-KEY_PAN_PX, 0],
      ArrowUp: [0, KEY_PAN_PX],
      ArrowDown: [0, -KEY_PAN_PX],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const viewport = event.currentTarget.getBoundingClientRect().width;
    update((current, size) => panCrop(size, current, move[0], move[1], viewport));
  }

  async function apply() {
    if (!image || !crop || isSaving) return;
    setIsSaving(true);
    setSaveFailed(false);
    const cropped = await renderCrop(image, crop, file.name);
    setIsSaving(false);
    if (!cropped) return setSaveFailed(true);
    onApply(cropped);
  }

  const outputSide = image && crop ? cropOutputSide(image.size, crop) : 0;
  const box = image && crop ? cropImageBox(image.size, crop) : null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onSkip();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(480px,calc(100vw-32px))] rounded-[16px] border border-line bg-surface p-0 text-ink shadow-[0_24px_48px_-24px_rgba(15,23,42,.45)] backdrop:bg-ink/45"
    >
      <div className="flex max-h-[calc(100dvh-32px)] flex-col">
        <div className="border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-ink">Atur tampilan foto</h2>
          <p id={hintId} className="mt-1 text-sm text-muted">
            Kotak ini sama dengan foto yang tampil di halaman pembeli: persegi 1:1. Seret foto untuk memilih bagian yang
            tampil, lalu perbesar bila perlu.
          </p>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          {loadFailed ? (
            <p role="alert" className="text-sm text-[color:var(--owner-danger-fg)]">
              Foto ini tidak bisa dibuka. Coba foto lain berformat JPG, PNG, atau WebP.
            </p>
          ) : (
            <div
              role="group"
              aria-label="Area foto yang tampil. Seret atau gunakan tombol panah untuk menggeser."
              aria-describedby={hintId}
              tabIndex={0}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onKeyDown={handleKeyDown}
              className="relative mx-auto aspect-square w-full max-w-[400px] cursor-grab touch-none overflow-hidden rounded-[12px] bg-subtle select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:cursor-grabbing"
            >
              {image && box && (
                <Image
                  src={image.url}
                  alt=""
                  width={image.size.width}
                  height={image.size.height}
                  unoptimized
                  draggable={false}
                  className="pointer-events-none absolute max-w-none"
                  style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
                />
              )}
              {/* Garis sepertiga membantu menaruh produk di tengah. */}
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }, (_, index) => (
                  <span key={index} className="border-[0.5px] border-white/40" />
                ))}
              </span>
              {!image && <span className="absolute inset-0 grid place-items-center text-sm text-muted">Membuka foto…</span>}
            </div>
          )}

          {image && crop && (
            <>
              <div className="flex items-center gap-3">
                <button type="button" aria-label="Perkecil" onClick={() => setZoom(crop.zoom - ZOOM_STEP)} disabled={crop.zoom <= 1}
                  className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-line text-ink hover:bg-subtle disabled:opacity-40">
                  <Minus aria-hidden size={18} />
                </button>
                <input
                  type="range"
                  min={1}
                  max={CROP_MAX_ZOOM}
                  step={0.01}
                  value={crop.zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  aria-label="Perbesar foto"
                  className="min-w-0 flex-1 accent-[var(--ui-brand)]"
                />
                <button type="button" aria-label="Perbesar" onClick={() => setZoom(crop.zoom + ZOOM_STEP)} disabled={crop.zoom >= CROP_MAX_ZOOM}
                  className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-line text-ink hover:bg-subtle disabled:opacity-40">
                  <Plus aria-hidden size={18} />
                </button>
              </div>
              <dl className="grid grid-cols-2 gap-3 rounded-[10px] bg-subtle px-4 py-3 text-sm">
                <div><dt className="text-xs text-muted">Foto asli</dt><dd className="font-semibold tabular-nums">{image.size.width} × {image.size.height} px</dd></div>
                <div><dt className="text-xs text-muted">Hasil yang tampil</dt><dd className="font-semibold tabular-nums">{outputSide} × {outputSide} px</dd></div>
              </dl>
              {outputSide < LOW_RESOLUTION_SIDE_PX && (
                <p className="text-sm text-[color:var(--owner-danger-fg)]">
                  Area yang dipilih kecil, foto bisa terlihat buram di halaman pembeli. Perkecil zoom atau pakai foto yang lebih besar.
                </p>
              )}
              {saveFailed && (
                <p role="alert" className="text-sm text-[color:var(--owner-danger-fg)]">Foto gagal dipotong. Coba lagi.</p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-line px-5 py-4 sm:flex-row-reverse sm:items-center">
          <div className="sm:w-fit">
            <button type="button" className={`${PRIMARY_BUTTON_CLASS} w-full`} onClick={apply} disabled={!image || isSaving}>
              {isSaving ? "Menyiapkan foto…" : "Pakai foto ini"}
            </button>
          </div>
          <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={onSkip} disabled={isSaving}>
            {waiting > 0 ? "Lewati foto ini" : "Batal"}
          </button>
          {waiting > 0 && <p className="text-sm text-muted sm:mr-auto">{waiting} foto lagi menunggu</p>}
        </div>
      </div>
    </dialog>
  );
}
