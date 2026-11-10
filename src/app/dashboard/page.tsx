import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ArrowRight, Circle, CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { site } from "@/config/site";
import { PRIMARY_BUTTON_CLASS, ROW_ACTION_CLASS } from "@/components/form-message";
import { Badge, type BadgeTone } from "@/components/owner/badge";
import { Card } from "@/components/owner/card";
import { InfoTip } from "@/components/owner/info-tip";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatIdr } from "@/lib/format-idr";
import { formatWibDateTime } from "@/lib/wib-time";
import { getCurrentBusinessProfile } from "@/features/business/guard";
import { summarizeOpenCapacities } from "@/features/capacity/availability";
import { listCapacities } from "@/features/capacity/repository";
import { summarizeOrders } from "@/features/orders/recap";
import { listBusinessOrders } from "@/features/orders/repository";
import { sumAppliedSandboxPayments } from "@/features/payments/repository";
import { listPreorders } from "@/features/preorders/repository";
import { summarizeRunningPreorders, type RunningPreorder } from "@/features/preorders/running";
import { countActiveProducts } from "@/features/products/repository";

export const metadata: Metadata = { title: `Ringkasan | ${site.name}` };

type SetupStep = { label: string; done: boolean; href: string; nextAction?: string };

const LINK_CLASS = "inline-flex items-center gap-1 text-sm font-medium text-brand underline-offset-4 hover:underline";

function logSectionFailure(section: string, error: unknown): null {
  console.error(`[dashboard] ${section} gagal dibaca`, { name: error instanceof Error ? error.name : "unknown" });
  return null;
}

function paceBadge(preorder: RunningPreorder): { label: string; tone: BadgeTone } {
  if (preorder.phase === "not_started") return { label: "Belum dibuka", tone: "neutral" };
  if (preorder.pace === "target_met") return { label: "Target tercapai", tone: "success" };
  if (preorder.phase === "past_end") return { label: "Waktu pesan habis", tone: "neutral" };
  if (preorder.pace === "on_track") return { label: "Sesuai laju", tone: "success" };
  if (preorder.pace === "behind") return { label: "Di bawah laju", tone: "warning" };
  return { label: "Jauh di bawah laju", tone: "danger" };
}

/** Satu sel strip angka. `children` untuk keterangan kecil di bawah angka. */
function Stat({ label, value, tip, children }: { label: string; value: string; tip?: string; children?: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-5 sm:py-4">
      <p className="flex items-center gap-1 text-sm text-muted">
        {label}
        {tip && <InfoTip label={label}>{tip}</InfoTip>}
      </p>
      <p className="mt-0.5 truncate text-2xl font-bold text-ink tabular-nums">{value}</p>
      {children}
    </div>
  );
}

function RunningPreorderRow({ preorder }: { preorder: RunningPreorder }) {
  const badge = paceBadge(preorder);
  const timing =
    preorder.phase === "not_started" ? `Dibuka ${formatWibDateTime(preorder.startsAt)}` : `Tutup ${formatWibDateTime(preorder.endsAt)}`;

  // Kolom tetap di layar lebar agar progres semua baris sejajar; di HP badge pindah ke baris progres supaya tidak terpotong.
  return (
    <li className="grid gap-x-6 gap-y-2 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(0,1fr)_14rem_18rem] lg:items-center">
      <div className="min-w-0">
        <Link href={`/dashboard/preorders/${preorder.id}`} className="block text-base font-semibold break-words text-ink hover:underline lg:truncate">
          {preorder.name}
        </Link>
        <p className="text-sm text-muted lg:truncate">
          {preorder.productName} · {timing}
        </p>
      </div>
      <div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="lg:hidden">
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </span>
          <span className="hidden text-muted lg:inline">Dibayar</span>
          <span className="text-ink tabular-nums">
            <span className="font-semibold">{preorder.paidUnits}</span>/{preorder.targetUnits} unit<span className="text-muted lg:hidden"> dibayar</span>
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`Unit dibayar dari target ${preorder.name}`}
          aria-valuemin={0}
          aria-valuemax={preorder.targetUnits}
          aria-valuenow={Math.min(preorder.paidUnits, preorder.targetUnits)}
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle"
        >
          <div className="h-full rounded-full bg-brand" style={{ width: `${preorder.targetPercent}%` }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <span className="hidden lg:inline-flex">
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </span>
        {preorder.needsStrategy && (
          <Link href={`/dashboard/campaigns?preorder=${preorder.id}`} className={`w-full sm:w-auto ${ROW_ACTION_CLASS}`}>
            Minta strategi AI
          </Link>
        )}
      </div>
    </li>
  );
}

export default async function DashboardOverviewPage() {
  const business = await getCurrentBusinessProfile();
  const supabase = await createSupabaseServerClient();
  // Preorder dan pembayaran hanya pelengkap: bila gagal dibaca, bagiannya memberi tahu tanpa menjatuhkan seluruh Ringkasan.
  const [activeProductCount, capacities, orders, preorders, sandboxPayments] = await Promise.all([
    countActiveProducts(supabase, business.id),
    listCapacities(supabase, business.id),
    listBusinessOrders(supabase, business.id),
    listPreorders(supabase, business.id).catch((error: unknown) => logSectionFailure("preorder", error)),
    sumAppliedSandboxPayments(supabase, business.id).catch((error: unknown) => logSectionFailure("pembayaran sandbox", error)),
  ]);
  const now = new Date();
  const openCapacity = summarizeOpenCapacities(capacities, now);
  const orderRecap = summarizeOrders(orders, now);
  const running = preorders && summarizeRunningPreorders(preorders, now);

  const setupSteps: SetupStep[] = [
    { label: "Profil usaha", done: true, href: "/dashboard/business" },
    { label: "Produk, harga, dan modal", done: activeProductCount > 0, href: "/dashboard/products", nextAction: "Tambah produk" },
    {
      label: "Kapasitas produksi per tanggal",
      done: capacities.some((capacity) => capacity.totalUnits > 0),
      href: "/dashboard/capacity",
      nextAction: "Tambah kapasitas",
    },
  ];
  const nextStep = setupSteps.find((step) => !step.done);

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">Ringkasan</h1>
          <p className="text-sm text-muted">
            {business.name} · {business.categories.join(", ")}
          </p>
        </div>
        {!nextStep && (
          <Link href="/dashboard/preorders/new" className={`w-full sm:w-auto ${PRIMARY_BUTTON_CLASS}`}>
            Buat preorder
          </Link>
        )}
      </div>

      {(orderRecap.ordersNeedingAction > 0 || orderRecap.unitsReady > 0) && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] border border-[var(--owner-warning-fg)]/25 bg-[var(--owner-warning-bg)] px-4 py-3"
        >
          <CircleAlert aria-hidden size={20} strokeWidth={1.75} className="shrink-0 text-[color:var(--owner-warning-fg)]" />
          <p className="min-w-0 flex-1 text-base text-ink">
            {[
              orderRecap.ordersNeedingAction > 0 && `${orderRecap.ordersNeedingAction} pesanan perlu tindakan`,
              orderRecap.unitsReady > 0 && `${orderRecap.unitsReady} unit siap diambil`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <Link
            href={orderRecap.ordersNeedingAction > 0 ? "/dashboard/orders?filter=attention" : "/dashboard/orders"}
            className={`w-full sm:w-auto ${ROW_ACTION_CLASS}`}
          >
            Tangani sekarang
          </Link>
        </div>
      )}

      {/* Hanya untuk usaha yang belum siap; muncul lagi bila ada langkah yang kembali belum terpenuhi. */}
      {nextStep && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Persiapan usaha</h2>
              <p className="text-sm text-muted">Lengkapi sebelum membuka preorder.</p>
            </div>
            <Link href={`${nextStep.href}/new`} className={`w-full sm:w-auto ${PRIMARY_BUTTON_CLASS}`}>
              {nextStep.nextAction}
            </Link>
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {setupSteps.map((step) => (
              <li key={step.label} className="flex items-center gap-2 text-base">
                {step.done ? (
                  <CircleCheck aria-hidden size={18} strokeWidth={1.75} className="shrink-0 text-[color:var(--owner-success-fg)]" />
                ) : (
                  <Circle aria-hidden size={18} strokeWidth={1.75} className="shrink-0 text-muted" />
                )}
                <Link href={step.href} className={step.done ? "text-muted hover:underline" : "font-medium text-ink hover:underline"}>
                  {step.label}
                </Link>
                <span className="sr-only">{step.done ? "selesai" : "belum"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* gap-px di atas latar garis menjadi pemisah antarsel, baik 2 kolom (HP) maupun 4 kolom (layar lebar). */}
      <Card padded={false} className="overflow-hidden">
        <section aria-label="Angka usaha" className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4 [&>*]:bg-surface">
          <Stat
            label="Pembayaran masuk"
            value={sandboxPayments ? formatIdr(sandboxPayments.totalIdr) : "-"}
            tip="Pembayaran QRIS Midtrans Sandbox yang sudah terverifikasi. Simulasi, bukan uang sungguhan. Pesanan lunas manual tidak termasuk."
          >
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
              <span className="rounded border border-dashed border-[var(--owner-sim-border)] bg-[var(--owner-sim-bg)] px-1.5 text-xs font-medium text-[color:var(--owner-sim-fg)]">
                Simulasi
              </span>
              {sandboxPayments ? `${sandboxPayments.paymentCount} pembayaran` : "Belum dapat dimuat"}
            </p>
          </Stat>
          <Stat label="Perlu dibuat" value={`${orderRecap.unitsToProduce} unit`} tip="Unit dari pesanan berjalan yang belum siap diambil." />
          <Stat label="Siap diambil" value={`${orderRecap.unitsReady} unit`} />
          <Stat label="Sudah diambil" value={`${orderRecap.unitsFulfilled} unit`} />
        </section>
      </Card>

      <Card padded={false}>
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-lg font-semibold text-ink">
            Preorder berjalan{running && running.length > 0 && <span className="ml-1.5 text-base font-normal text-muted">({running.length})</span>}
          </h2>
          <Link href="/dashboard/preorders" className={LINK_CLASS}>
            Semua preorder <ArrowRight aria-hidden size={14} />
          </Link>
        </div>
        {running === null ? (
          <p className="px-4 py-4 text-base text-muted sm:px-5">Preorder belum dapat dimuat. Muat ulang halaman beberapa saat lagi.</p>
        ) : running.length === 0 ? (
          <p className="px-4 py-4 text-base text-muted sm:px-5">
            Belum ada preorder yang terbit. Setelah terbit, progres targetnya tampil di sini.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {running.map((preorder) => (
              <RunningPreorderRow key={preorder.id} preorder={preorder} />
            ))}
          </ul>
        )}
      </Card>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <Link href="/dashboard/products" className="hover:text-ink hover:underline">
          {activeProductCount} produk aktif
        </Link>
        <Link href="/dashboard/capacity" className="hover:text-ink hover:underline">
          {openCapacity.scheduleCount} jadwal terbuka · sisa {openCapacity.availableUnits} unit
        </Link>
      </p>
    </div>
  );
}
