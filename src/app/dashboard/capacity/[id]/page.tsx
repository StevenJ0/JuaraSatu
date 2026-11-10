import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { site } from "@/config/site";
import { BackLink } from "@/components/owner/back-link";
import { Card } from "@/components/owner/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateOnly, toWibDateTimeInput } from "@/lib/wib-time";
import { requireBusinessOwner } from "@/features/business/guard";
import { updateCapacityAction } from "@/features/capacity/actions";
import { CapacityForm } from "@/features/capacity/components/capacity-form";
import { findCapacity } from "@/features/capacity/repository";

export const metadata: Metadata = { title: `Ubah Kapasitas | ${site.name}` };

export default async function EditCapacityPage({ params }: PageProps<"/dashboard/capacity/[id]">) {
  const { id } = await params;
  const capacityId = z.uuid().safeParse(id);
  if (!capacityId.success) notFound();

  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const capacity = await findCapacity(supabase, businessId, capacityId.data);
  if (!capacity) notFound();

  const committedUnits = capacity.availability.allocated + capacity.availability.effectiveHeld;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <BackLink href="/dashboard/capacity" label="Kapasitas" />
      <div>
        <h1 className="text-2xl font-bold text-ink">Ubah kapasitas</h1>
        <p className="mt-1 text-base text-muted">
          {capacity.productName} · {formatDateOnly(capacity.fulfillmentDate)}
        </p>
      </div>
      <Card>
        <CapacityForm
          action={updateCapacityAction}
          submitLabel="Simpan perubahan"
          totalUnitsHint={
            committedUnits > 0
              ? `Sudah dipesan ${committedUnits} unit, jadi tidak bisa lebih kecil dari itu.`
              : "Belum ada pesanan. Isi 0 bila tidak berproduksi pada tanggal ini."
          }
          existing={{ capacityId: capacity.id, version: capacity.version, fulfillmentDate: capacity.fulfillmentDate }}
          initialValues={{
            totalUnits: String(capacity.totalUnits),
            intakeCutoff: toWibDateTimeInput(capacity.intakeCutoffAt),
            fulfillmentWindowEndTime: toWibDateTimeInput(capacity.fulfillmentWindowEndAt).slice(11),
          }}
        />
      </Card>
    </div>
  );
}
