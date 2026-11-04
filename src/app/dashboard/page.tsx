import { Circle, CircleCheck } from "lucide-react";
import Link from "next/link";
import { PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { Badge } from "@/components/owner/badge";
import { Card } from "@/components/owner/card";
import { KpiCard } from "@/components/owner/kpi-card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentBusinessProfile } from "@/features/business/guard";
import { summarizeOpenCapacities } from "@/features/capacity/availability";
import { listCapacities } from "@/features/capacity/repository";
import { countActiveProducts } from "@/features/products/repository";

type SetupStep = { label: string; done: boolean; href: string; nextAction?: string };

export default async function DashboardOverviewPage() {
  const business = await getCurrentBusinessProfile();
  const supabase = await createSupabaseServerClient();
  const [activeProductCount, capacities] = await Promise.all([
    countActiveProducts(supabase, business.id),
    listCapacities(supabase, business.id),
  ]);
  const openCapacity = summarizeOpenCapacities(capacities, new Date());

  const setupSteps: SetupStep[] = [
    { label: "Profil usaha", done: true, href: "/dashboard/business" },
    {
      label: "Produk, harga, dan biaya variabel",
      done: activeProductCount > 0,
      href: "/dashboard/products",
      nextAction: "Tambah produk",
    },
    {
      label: "Kapasitas produksi per tanggal",
      done: capacities.some((capacity) => capacity.totalUnits > 0),
      href: "/dashboard/capacity",
      nextAction: "Tambah kapasitas",
    },
  ];
  const nextStep = setupSteps.find((step) => !step.done);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Ringkasan</h1>
        <p className="mt-1 text-base text-muted">
          {business.name} · {business.categories.join(", ")}
        </p>
      </div>

      <section aria-label="Angka usaha" className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6">
        <KpiCard label="Produk aktif" value={String(activeProductCount)} note="Bisa dipakai untuk preorder" />
        <KpiCard label="Jadwal terbuka" value={String(openCapacity.scheduleCount)} note="Batas pesannya belum lewat" />
        <KpiCard
          label="Sisa kapasitas"
          value={`${openCapacity.availableUnits} unit`}
          note="Total dari jadwal terbuka"
          className="col-span-2 sm:col-span-1"
        />
      </section>

      <Card>
        <h2 className="text-lg font-semibold text-ink">Persiapan usaha</h2>
        <p className="mt-1 text-base text-muted">
          {nextStep
            ? "Lengkapi langkah berikut sebelum membuka preorder."
            : "Persiapan selesai. Anda sudah bisa membuka preorder."}
        </p>
        <ul className="mt-4 flex flex-col divide-y divide-line">
          {setupSteps.map((step) => (
            <li key={step.label} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              {step.done ? (
                <CircleCheck aria-hidden size={20} strokeWidth={1.5} className="shrink-0 text-[color:var(--owner-success-fg)]" />
              ) : (
                <Circle aria-hidden size={20} strokeWidth={1.5} className="shrink-0 text-muted" />
              )}
              <Link href={step.href} className="min-w-0 flex-1 text-base font-medium text-ink hover:underline">
                {step.label}
              </Link>
              <Badge tone={step.done ? "success" : "neutral"}>{step.done ? "Selesai" : "Belum"}</Badge>
            </li>
          ))}
        </ul>
        <Link
          href={nextStep ? `${nextStep.href}/new` : "/dashboard/preorders/new"}
          className={`mt-4 w-full sm:w-auto ${PRIMARY_BUTTON_CLASS}`}
        >
          {nextStep?.nextAction ?? "Buat preorder"}
        </Link>
      </Card>
    </div>
  );
}
