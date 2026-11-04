import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { site } from "@/config/site";
import { PRIMARY_BUTTON_CLASS, ROW_ACTION_CLASS } from "@/components/form-message";
import { Badge } from "@/components/owner/badge";
import { Card } from "@/components/owner/card";
import { SavedToast } from "@/components/owner/saved-toast";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateOnly, formatWibDateTime } from "@/lib/wib-time";
import { requireBusinessOwner } from "@/features/business/guard";
import { CapacityUsage } from "@/features/capacity/components/capacity-usage";
import { listCapacities, type Capacity } from "@/features/capacity/repository";

export const metadata: Metadata = { title: `Kapasitas Produksi | ${site.name}` };

const SAVED_NOTICES = new Map<unknown, string>([
  ["created", "Kapasitas ditambahkan."],
  ["updated", "Perubahan kapasitas tersimpan."],
]);

function CapacityRow({ capacity, now }: { capacity: Capacity; now: Date }) {
  const isClosed = Date.parse(capacity.intakeCutoffAt) <= now.getTime();

  return (
    <li className="flex flex-col gap-3 p-4 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold break-words text-ink">
            {capacity.productName}
            {isClosed && <Badge tone="neutral">Batas pesan lewat</Badge>}
          </p>
          <p className="text-base text-ink">{formatDateOnly(capacity.fulfillmentDate)}</p>
        </div>
        <Link href={`/dashboard/capacity/${capacity.id}`} className={`shrink-0 ${ROW_ACTION_CLASS}`}>
          Ubah
        </Link>
      </div>
      <CapacityUsage totalUnits={capacity.totalUnits} availability={capacity.availability} />
      <div className="text-sm text-muted">
        <p>Batas pesan: {formatWibDateTime(capacity.intakeCutoffAt)}</p>
        <p>Batas pengambilan: {formatWibDateTime(capacity.fulfillmentWindowEndAt)}</p>
      </div>
    </li>
  );
}

export default async function CapacityPage({ searchParams }: PageProps<"/dashboard/capacity">) {
  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const [capacities, { saved }] = await Promise.all([listCapacities(supabase, businessId), searchParams]);
  const savedMessage = SAVED_NOTICES.get(saved);
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      {savedMessage && <SavedToast message={savedMessage} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[65ch]">
          <h1 className="text-2xl font-bold text-ink">Kapasitas produksi</h1>
          <p className="mt-1 text-base text-muted">
            Jumlah yang sanggup dibuat per produk dan tanggal. Ini bukan jumlah penjualan.
          </p>
        </div>
        <Link href="/dashboard/capacity/new" className={`gap-2 ${PRIMARY_BUTTON_CLASS}`}>
          <Plus aria-hidden size={18} strokeWidth={1.5} />
          Tambah kapasitas
        </Link>
      </div>

      {capacities.length === 0 ? (
        <Card>
          <p className="text-base text-muted">
            Belum ada kapasitas. Tentukan berapa unit yang sanggup dibuat pada tanggal tertentu.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {capacities.map((capacity) => (
              <CapacityRow key={capacity.id} capacity={capacity} now={now} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
