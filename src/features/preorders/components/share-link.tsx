"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { PRIMARY_BUTTON_CLASS } from "@/components/form-message";

const COPIED_NOTICE_MS = 2500;
const subscribeNever = () => () => {};

/**
 * Tautan halaman pembeli siap disalin. Alamat lengkap memakai domain yang sedang dibuka penjual, sehingga sama dengan yang
 * diterima pembeli setelah aplikasi di-deploy; saat render server hanya path yang tampil.
 * Bila clipboard tidak tersedia (misalnya bukan HTTPS), teksnya dipilih agar penjual bisa menyalin manual.
 */
export function ShareLink({ path }: { path: string }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const origin = useSyncExternalStore(subscribeNever, () => window.location.origin, () => "");
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const url = `${origin}${path}`;

  useEffect(() => {
    if (status !== "copied") return;
    const timer = window.setTimeout(() => setStatus("idle"), COPIED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      inputRef.current?.select();
      setStatus("manual");
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">Tautan untuk dibagikan</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          id={inputId}
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-12 w-full min-w-0 rounded-[10px] border border-line bg-subtle px-3 text-base text-ink"
        />
        <button type="button" onClick={copy} className={`shrink-0 gap-2 ${PRIMARY_BUTTON_CLASS}`}>
          {status === "copied" ? <Check aria-hidden size={18} /> : <Copy aria-hidden size={18} />}
          {status === "copied" ? "Tersalin" : "Salin tautan"}
        </button>
      </div>
      <p role="status" className="text-sm text-muted">
        {status === "copied" && "Tautan tersalin. Tempel di WhatsApp, Instagram, atau grup pelanggan."}
        {status === "manual" && "Tautan sudah dipilih. Salin manual dengan Ctrl+C, atau tekan lama di HP."}
        {status === "idle" && "Bagikan tautan ini ke pelanggan. Pembeli bisa memesan tanpa membuat akun."}
      </p>
    </div>
  );
}
