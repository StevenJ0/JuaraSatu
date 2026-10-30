"use client";

import Link from "next/link";
import { PRIMARY_BUTTON_CLASS } from "@/components/form-message";

function readDigest(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("digest" in error)) return undefined;
  return typeof error.digest === "string" ? error.digest : undefined;
}

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = readDigest(error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16 font-sans">
      <div className="flex max-w-md flex-col gap-4 text-center">
        <h1 className="text-xl font-semibold text-ink">Data gagal dimuat</h1>
        <p className="text-sm text-muted">
          Terjadi kesalahan saat memuat halaman. Coba lagi beberapa saat lagi.
          {digest && <span className="mt-2 block font-mono text-xs">Kode: {digest}</span>}
        </p>
        <div className="flex justify-center gap-3">
          <button type="button" onClick={retry} className={PRIMARY_BUTTON_CLASS}>
            Coba lagi
          </button>
          <Link href="/" className="rounded-lg px-4 py-2 text-sm font-medium text-ink">
            Beranda
          </Link>
        </div>
      </div>
    </main>
  );
}
