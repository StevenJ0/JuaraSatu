import Link from "next/link";
import { getCurrentBusinessProfile } from "@/features/business/guard";

type SetupStep = { label: string; done: boolean; href?: string; note?: string };

export default async function DashboardOverviewPage() {
  const business = await getCurrentBusinessProfile();

  // Status produk & kapasitas menyusul setelah modul masing-masing tersedia; jangan tampilkan angka fiktif.
  const setupSteps: SetupStep[] = [
    { label: "Profil usaha", done: true, href: "/dashboard/business" },
    { label: "Produk, harga, dan biaya variabel", done: false, note: "Modul produk segera tersedia" },
    { label: "Kapasitas produksi per tanggal", done: false, note: "Modul kapasitas segera tersedia" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Ringkasan</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {business.name} · {business.category}
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">Persiapan usaha</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Lengkapi langkah berikut sebelum merencanakan kampanye.
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {setupSteps.map((step) => (
            <li key={step.label} className="flex items-start gap-3">
              <span
                aria-hidden
                className={
                  step.done
                    ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs text-white"
                    : "mt-0.5 size-5 shrink-0 rounded-full border-2 border-zinc-300 dark:border-zinc-600"
                }
              >
                {step.done ? "✓" : null}
              </span>
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {step.href ? (
                    <Link href={step.href} className="hover:underline">
                      {step.label}
                    </Link>
                  ) : (
                    step.label
                  )}
                  <span className="sr-only">{step.done ? " (selesai)" : " (belum)"}</span>
                </p>
                {step.note && <p className="text-xs text-zinc-500 dark:text-zinc-400">{step.note}</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
