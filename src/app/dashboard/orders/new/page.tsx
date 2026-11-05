import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { site } from "@/config/site";
import { PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { BackLink } from "@/components/owner/back-link";
import { Card } from "@/components/owner/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBusinessOwner } from "@/features/business/guard";
import { listManualOrderCapacityOptions } from "@/features/orders/capacity-options";
import { ManualOrderForm } from "@/features/orders/components/manual-order-form";

export const metadata: Metadata = { title: `Catat Pesanan Manual | ${site.name}` };

export default async function NewStandaloneOrderPage() {
  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const options = await listManualOrderCapacityOptions(supabase, businessId);

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <BackLink href="/dashboard/orders" label="Pesanan" />
      <div>
        <h1 className="text-2xl font-bold text-ink">Catat pesanan manual</h1>
        <p className="mt-1 text-base text-muted">Untuk pesanan di luar preorder, misalnya dari WhatsApp. Memakai kapasitas jadwal yang dipilih.</p>
      </div>
      <Card>
        {options.length === 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-base text-muted">Belum ada jadwal produksi dengan sisa kapasitas. Tambah kapasitas dulu.</p>
            <Link href="/dashboard/capacity/new" className={`w-full sm:w-fit ${PRIMARY_BUTTON_CLASS}`}>
              Tambah kapasitas
            </Link>
          </div>
        ) : (
          <ManualOrderForm
            target={{ kind: "capacity", options }}
            idempotencyKey={randomUUID()}
            quantityHint="Memakai kapasitas yang sama dengan pesanan pembeli di jadwal itu."
          />
        )}
      </Card>
    </div>
  );
}
