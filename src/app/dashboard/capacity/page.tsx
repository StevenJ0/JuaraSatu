import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/config/site";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateOnly, formatWibDateTime } from "@/lib/wib-time";
import { requireBusinessOwner } from "@/features/business/guard";
import { listCapacities, type Capacity } from "@/features/capacity/repository";

export const metadata: Metadata = { title: `Kapasitas Produksi — ${site.name}` };

const ADD_LINK_CLASS =
  "inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-hover";
const EDIT_LINK_CLASS =
  "rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-subtle";

function CapacityRow({ capacity }: { capacity: Capacity }) {
  const { allocated, effectiveHeld, available } = capacity.availability;

  return (
    <li className="flex flex-wrap items-center gap-4 p-4">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-semibold break-words text-ink">{capacity.productName}</p>
        <p className="text-sm text-ink">{formatDateOnly(capacity.fulfillmentDate)}</p>
        <p className="mt-1 text-xs text-muted">Batas pesan: {formatWibDateTime(capacity.intakeCutoffAt)}</p>
        <p className="text-xs text-muted">Batas pengambilan: {formatWibDateTime(capacity.fulfillmentWindowEndAt)}</p>
      </div>
      <dl className="flex gap-5 text-center">
        <div>
          <dt className="text-xs text-muted">Total</dt>
          <dd className="text-sm font-semibold text-ink">{capacity.totalUnits}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Terpakai</dt>
          <dd className="text-sm font-semibold text-ink">{allocated + effectiveHeld}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Sisa</dt>
          <dd className="text-sm font-semibold text-ink">{available}</dd>
        </div>
      </dl>
      <Link href={`/dashboard/capacity/${capacity.id}`} className={EDIT_LINK_CLASS}>
        Ubah
      </Link>
    </li>
  );
}

export default async function CapacityPage() {
  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const capacities = await listCapacities(supabase, businessId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Kapasitas produksi</h1>
          <p className="mt-1 text-sm text-muted">
            Jumlah yang sanggup dibuat per produk dan tanggal. Ini bukan jumlah penjualan.
          </p>
        </div>
        <Link href="/dashboard/capacity/new" className={ADD_LINK_CLASS}>
          Tambah kapasitas
        </Link>
      </div>

      {capacities.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
          Belum ada kapasitas. Tentukan berapa unit yang sanggup dibuat pada tanggal tertentu.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {capacities.map((capacity) => (
            <CapacityRow key={capacity.id} capacity={capacity} />
          ))}
        </ul>
      )}
    </div>
  );
}
