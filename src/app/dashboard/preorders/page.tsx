import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { site } from "@/config/site";
import { PRIMARY_BUTTON_CLASS, ROW_ACTION_CLASS } from "@/components/form-message";
import { Card } from "@/components/owner/card";
import { formatIdr } from "@/lib/format-idr";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateOnly } from "@/lib/wib-time";
import { requireBusinessOwner } from "@/features/business/guard";
import { CapacityUsage } from "@/features/capacity/components/capacity-usage";
import { PreorderStatusBadge } from "@/features/preorders/components/preorder-status-badge";
import { listPreorders, type Preorder } from "@/features/preorders/repository";

export const metadata: Metadata = { title: `Preorder | ${site.name}` };

function PreorderRow({ preorder }: { preorder: Preorder }) {
  return (
    <li className="flex flex-col gap-3 p-4 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold break-words text-ink">
            {preorder.name}
            <PreorderStatusBadge status={preorder.status} />
          </p>
          <p className="text-base text-ink">
            {preorder.productName} · {formatIdr(preorder.basePriceIdr)}
          </p>
          <p className="text-sm text-muted">
            Pengambilan {formatDateOnly(preorder.fulfillmentDate)} · target {preorder.targetUnits} unit
          </p>
        </div>
        <Link href={`/dashboard/preorders/${preorder.id}`} className={`shrink-0 ${ROW_ACTION_CLASS}`}>
          Lihat
        </Link>
      </div>
      {preorder.status !== "draft" && preorder.status !== "cancelled" && (
        <CapacityUsage totalUnits={preorder.quotaUnits} availability={preorder.metrics.quotaUsage} />
      )}
    </li>
  );
}

export default async function PreordersPage() {
  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const preorders = await listPreorders(supabase, businessId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[65ch]">
          <h1 className="text-2xl font-bold text-ink">Preorder</h1>
          <p className="mt-1 text-base text-muted">Buka pesanan untuk satu produk dan satu tanggal pengambilan.</p>
        </div>
        <Link href="/dashboard/preorders/new" className={`gap-2 ${PRIMARY_BUTTON_CLASS}`}>
          <Plus aria-hidden size={18} strokeWidth={1.5} />
          Buat preorder
        </Link>
      </div>

      {preorders.length === 0 ? (
        <Card>
          <p className="text-base text-muted">Belum ada preorder. Mulai dari draf; pembeli belum melihatnya sampai diterbitkan.</p>
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {preorders.map((preorder) => (
              <PreorderRow key={preorder.id} preorder={preorder} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
