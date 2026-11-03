import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentBusinessProfile } from "@/features/business/guard";
import { countUsableCapacities } from "@/features/capacity/repository";
import { countActiveProducts } from "@/features/products/repository";

type SetupStep = { label: string; done: boolean; href?: string; note?: string };

export default async function DashboardOverviewPage() {
  const business = await getCurrentBusinessProfile();
  const supabase = await createSupabaseServerClient();
  const [activeProductCount, usableCapacityCount] = await Promise.all([
    countActiveProducts(supabase, business.id),
    countUsableCapacities(supabase, business.id),
  ]);

  const setupSteps: SetupStep[] = [
    { label: "Profil usaha", done: true, href: "/dashboard/business" },
    { label: "Produk, harga, dan biaya variabel", done: activeProductCount > 0, href: "/dashboard/products" },
    { label: "Kapasitas produksi per tanggal", done: usableCapacityCount > 0, href: "/dashboard/capacity" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Ringkasan</h1>
        <p className="mt-1 text-sm text-muted">
          {business.name} · {business.categories.join(", ")}
        </p>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="font-semibold text-ink">Persiapan usaha</h2>
        <p className="mt-1 text-sm text-muted">
          Lengkapi langkah berikut sebelum merencanakan kampanye.
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {setupSteps.map((step) => (
            <li key={step.label} className="flex items-start gap-3">
              <span
                aria-hidden
                className={
                  step.done
                    ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-xs text-on-brand"
                    : "mt-0.5 size-5 shrink-0 rounded-full border-2 border-line"
                }
              >
                {step.done ? "✓" : null}
              </span>
              <div>
                <p className="text-sm font-medium text-ink">
                  {step.href ? (
                    <Link href={step.href} className="hover:underline">
                      {step.label}
                    </Link>
                  ) : (
                    step.label
                  )}
                  <span className="sr-only">{step.done ? " (selesai)" : " (belum)"}</span>
                </p>
                {step.note && <p className="text-xs text-muted">{step.note}</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
