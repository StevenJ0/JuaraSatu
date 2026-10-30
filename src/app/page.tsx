import Link from "next/link";
import { PRIMARY_BUTTON_CLASS } from "@/components/form-message";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 font-sans dark:bg-zinc-950">
      <div className="flex w-full max-w-xl flex-col gap-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-500">
          GTNIC 2026 · Prototipe
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
          Kelola usaha, kapasitas produksi, dan preorder dalam satu tempat
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Untuk pemilik UMKM makanan berbasis preorder. Pembayaran pada aplikasi ini menggunakan Midtrans Sandbox
          (simulasi, tanpa uang nyata).
        </p>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/login" className={PRIMARY_BUTTON_CLASS}>
            Masuk
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Daftar sebagai pemilik usaha
          </Link>
        </div>
      </div>
    </main>
  );
}
