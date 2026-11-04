import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { site } from "@/config/site";
import { BackLink } from "@/components/owner/back-link";
import { Card } from "@/components/owner/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toWibDateTimeInput } from "@/lib/wib-time";
import { requireBusinessOwner } from "@/features/business/guard";
import { updatePreorderAction } from "@/features/preorders/actions";
import { listPreorderCapacityOptions } from "@/features/preorders/capacity-options";
import { PreorderForm } from "@/features/preorders/components/preorder-form";
import { findPreorder } from "@/features/preorders/repository";

export const metadata: Metadata = { title: `Ubah Preorder | ${site.name}` };

export default async function EditPreorderPage({ params }: PageProps<"/dashboard/preorders/[id]/edit">) {
  const { id } = await params;
  const preorderId = z.uuid().safeParse(id);
  if (!preorderId.success) notFound();

  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const preorder = await findPreorder(supabase, businessId, preorderId.data);
  if (!preorder) notFound();
  const detailPath = `/dashboard/preorders/${preorder.id}`;
  if (preorder.status !== "draft") redirect(detailPath);

  const capacityOptions = await listPreorderCapacityOptions(supabase, businessId, preorder.capacityId);

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <BackLink href={detailPath} label={preorder.name} />
      <h1 className="text-2xl font-bold text-ink">Ubah draf</h1>
      <Card>
        <PreorderForm
          action={updatePreorderAction}
          submitLabel="Simpan perubahan"
          capacityOptions={capacityOptions}
          existing={{ preorderId: preorder.id, version: preorder.version }}
          initialValues={{
            name: preorder.name,
            capacityId: preorder.capacityId,
            targetUnits: String(preorder.targetUnits),
            quotaUnits: String(preorder.quotaUnits),
            startsAt: toWibDateTimeInput(preorder.startsAt),
            endsAt: toWibDateTimeInput(preorder.endsAt),
          }}
        />
      </Card>
    </div>
  );
}
