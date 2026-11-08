import type { Metadata } from "next";
import { Package } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { site } from "@/config/site";
import { SECONDARY_BUTTON_CLASS } from "@/components/form-message";
import { BackLink } from "@/components/owner/back-link";
import { Card } from "@/components/owner/card";
import { KpiCard } from "@/components/owner/kpi-card";
import { SavedToast } from "@/components/owner/saved-toast";
import { formatIdr } from "@/lib/format-idr";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateOnly, formatWibDateTime } from "@/lib/wib-time";
import { getCurrentBusinessProfile } from "@/features/business/guard";
import { CampaignResults } from "@/features/campaign-results/components/campaign-results";
import { listPreorderCampaignResults } from "@/features/campaign-results/repository";
import { CapacityUsage } from "@/features/capacity/components/capacity-usage";
import { listPreorderOrders } from "@/features/orders/repository";
import { cancelPreorderDraftAction, cancelPublishedPreorderAction, completePreorderAction, publishPreorderAction } from "@/features/preorders/actions";
import { ClosePreorderForm } from "@/features/preorders/components/close-preorder-form";
import { PreorderStatusBadge } from "@/features/preorders/components/preorder-status-badge";
import { PreorderTransition } from "@/features/preorders/components/preorder-transition";
import { findPreorder, findPreorderCloseNote, type Preorder, type PreorderCloseNote } from "@/features/preorders/repository";
import { findProduct, type Product } from "@/features/products/repository";

export const metadata: Metadata = { title: `Detail Preorder | ${site.name}` };

const SAVED_NOTICES = new Map<unknown, string>([
  ["created", "Draf preorder tersimpan."],
  ["updated", "Perubahan draf tersimpan."],
  ["published", "Preorder diterbitkan."],
  ["closed", "Preorder ditutup."],
  ["completed", "Preorder selesai."],
  ["cancelled", "Draf preorder dibatalkan."],
  ["cancelled_published", "Preorder dibatalkan."],
]);

function PreorderActions({ preorder, hasOrders, closeNote }: { preorder: Preorder; hasOrders: boolean; closeNote: PreorderCloseNote | null }) {
  const shared = { preorderId: preorder.id, version: preorder.version };

  if (preorder.status === "draft") {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">Siap diterbitkan?</h2>
        <p className="mt-1 max-w-[65ch] text-base text-muted">Pembeli belum melihat preorder ini selama masih draf.</p>
        <div className="mt-4 flex flex-col gap-3">
          <PreorderTransition
            {...shared}
            action={publishPreorderAction}
            label="Terbitkan preorder"
            warning="Setelah terbit, produk, harga, target, kuota, tanggal, dan ketentuan pengambilan tidak bisa diubah lagi."
          />
          <Link href={`/dashboard/preorders/${preorder.id}/edit`} className={`w-full sm:w-fit ${SECONDARY_BUTTON_CLASS}`}>
            Ubah draf
          </Link>
          <PreorderTransition
            {...shared}
            action={cancelPreorderDraftAction}
            label="Batalkan draf"
            warning="Draf yang dibatalkan tidak bisa dipakai lagi, tapi tetap tercatat di daftar preorder. Bila perlu, buat preorder baru."
            isDanger
          />
        </div>
      </Card>
    );
  }
  if (preorder.status === "cancelled") {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">{preorder.frozenTerms ? "Preorder dibatalkan" : "Draf dibatalkan"}</h2>
        <p className="mt-1 max-w-[65ch] text-base text-muted">
          {preorder.frozenTerms
            ? "Dibatalkan sebelum ada pesanan. Tautan pembeli tidak lagi bisa dibuka, dan kapasitas produksi tidak terpakai."
            : "Pembeli tidak pernah melihat preorder ini, dan kapasitas produksi tidak terpakai."}
        </p>
        <Link href="/dashboard/preorders/new" className={`mt-4 w-full sm:w-fit ${SECONDARY_BUTTON_CLASS}`}>
          Buat preorder baru
        </Link>
      </Card>
    );
  }
  if (preorder.status === "published") {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">Preorder sedang dibuka</h2>
        <p className="mt-1 max-w-[65ch] text-base text-muted">
          Tutup bila ingin berhenti menerima pesanan baru. Pesanan yang sudah masuk tetap berjalan.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <ClosePreorderForm preorderId={preorder.id} version={preorder.version} />
          {!hasOrders && (
            <PreorderTransition
              {...shared}
              action={cancelPublishedPreorderAction}
              label="Batalkan preorder"
              warning="Belum ada pesanan, jadi preorder bisa dibatalkan. Tautan pembeli tidak lagi bisa dibuka, dan tidak bisa diterbitkan ulang."
              isDanger
            />
          )}
        </div>
      </Card>
    );
  }
  const closeReason = closeNote && (
    <p className="mt-2 max-w-[65ch] text-base break-words text-ink">
      Alasan ditutup: {closeNote.reason} <span className="text-sm text-muted">({formatWibDateTime(closeNote.closedAt)})</span>
    </p>
  );
  if (preorder.status === "closed") {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">Preorder ditutup</h2>
        <p className="mt-1 max-w-[65ch] text-base text-muted">Selesaikan setelah semua pesanan diambil atau dibatalkan.</p>
        {closeReason}
        <div className="mt-4">
          <PreorderTransition
            {...shared}
            action={completePreorderAction}
            label="Selesaikan preorder"
            warning="Preorder yang selesai masuk ke riwayat dan tidak bisa diubah lagi."
          />
        </div>
      </Card>
    );
  }
  if (preorder.status === "completed" && closeReason) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">Preorder selesai</h2>
        {closeReason}
      </Card>
    );
  }
  return null;
}

function BuyerPreview({
  preorder,
  product,
  businessName,
  pickupInstructions,
  publicContact,
}: {
  preorder: Preorder;
  product: Product | null;
  businessName: string;
  pickupInstructions: string;
  publicContact: string | null;
}) {
  const isDraft = preorder.status === "draft";
  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">Tampilan untuk pembeli</h2>
      <p className="mt-1 max-w-[65ch] text-sm text-muted">
        {isDraft
          ? "Pratinjau untuk Anda saja. Harga dan ketentuan mengikuti data terbaru dan dikunci saat diterbitkan."
          : "Ketentuan sudah dikunci. Buka halaman pembeli untuk memeriksa informasi sebelum membagikan tautannya."}
      </p>
      {!isDraft && (
        <Link href={`/p/${preorder.slug}`} target="_blank" rel="noopener noreferrer" className={`mt-4 w-full sm:w-fit ${SECONDARY_BUTTON_CLASS}`}>
          Buka halaman pembeli
        </Link>
      )}
      <div className="mt-4 flex items-start gap-4">
        {product?.thumbnailUrl ? (
          <Image src={product.thumbnailUrl} alt="" width={80} height={80} unoptimized className="size-20 shrink-0 rounded-[10px] border border-line object-cover" />
        ) : (
          <div aria-hidden className="flex size-20 shrink-0 items-center justify-center rounded-[10px] bg-subtle text-muted">
            <Package size={20} strokeWidth={1.5} />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm break-words text-muted">{businessName}</p>
          <p className="text-base font-semibold break-words text-ink">{isDraft && product ? product.name : preorder.productName}</p>
          <p className="text-lg font-semibold text-ink">{formatIdr(isDraft && product ? product.basePriceIdr : preorder.basePriceIdr)}</p>
          {product?.description && <p className="mt-1 text-base break-words whitespace-pre-line text-muted">{product.description}</p>}
        </div>
      </div>
      <dl className="mt-4 grid gap-3 text-base sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">Dibuka</dt>
          <dd className="text-ink">{formatWibDateTime(preorder.startsAt)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Ditutup</dt>
          <dd className="text-ink">{formatWibDateTime(preorder.endsAt)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Tanggal pengambilan</dt>
          <dd className="text-ink">{formatDateOnly(preorder.fulfillmentDate)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Batas pengambilan</dt>
          <dd className="text-ink">{formatWibDateTime(preorder.fulfillmentWindowEndAt)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-sm text-muted">Petunjuk pengambilan</dt>
          <dd className="break-words whitespace-pre-line text-ink">{pickupInstructions}</dd>
        </div>
        {publicContact && (
          <div className="sm:col-span-2">
            <dt className="text-sm text-muted">Kontak</dt>
            <dd className="break-words text-ink">{publicContact}</dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

export default async function PreorderDetailPage({ params, searchParams }: PageProps<"/dashboard/preorders/[id]">) {
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  const preorderId = z.uuid().safeParse(id);
  if (!preorderId.success) notFound();

  const business = await getCurrentBusinessProfile();
  const supabase = await createSupabaseServerClient();
  const preorder = await findPreorder(supabase, business.id, preorderId.data);
  if (!preorder) notFound();
  const [product, orders, closeNote, campaignResults] = await Promise.all([
    findProduct(supabase, business.id, preorder.productId),
    listPreorderOrders(supabase, business.id, preorder.id),
    preorder.status === "closed" || preorder.status === "completed" ? findPreorderCloseNote(supabase, business.id, preorder.id) : null,
    // Hasil kampanye hanya pelengkap. Bila gagal dibaca, halaman preorder tetap tampil dengan pemberitahuan.
    preorder.status === "draft" ? [] : listPreorderCampaignResults(supabase, business.id, preorder.id).catch(() => null),
  ]);

  const savedMessage = SAVED_NOTICES.get(saved);
  const { paidUnits, awaitingPaymentUnits, paidTargetGap, orderableUnits, quotaUsage } = preorder.metrics;

  // Draf yang dibatalkan tidak pernah dijual, jadi angka dan tampilan pembeli hanya akan menyesatkan.
  const isCancelled = preorder.status === "cancelled";

  return (
    <div className="flex flex-col gap-6">
      {savedMessage && <SavedToast key={String(saved)} message={savedMessage} />}
      <div className="flex flex-col gap-2">
        <BackLink href="/dashboard/preorders" label="Preorder" />
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold break-words text-ink">
          {preorder.name}
          <PreorderStatusBadge status={preorder.status} />
        </h1>
        <p className="text-base text-muted">
          {preorder.status === "draft" && product ? product.name : preorder.productName} · pengambilan {formatDateOnly(preorder.fulfillmentDate)}
        </p>
      </div>

      {!isCancelled && (
        <>
          <section aria-label="Angka preorder" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Sudah dibayar" value={`${paidUnits} unit`} note={`Target ${preorder.targetUnits} unit`} />
            <KpiCard label="Kurang dari target" value={`${paidTargetGap} unit`} note="Bukan jumlah yang bisa dijual" />
            <KpiCard label="Menunggu bayar" value={`${awaitingPaymentUnits} unit`} note="Slot terpakai, belum lunas" />
            <KpiCard label="Bisa dipesan" value={`${orderableUnits} unit`} note={`Dari kuota ${preorder.quotaUnits} unit`} />
          </section>

          <Card>
            <h2 className="mb-3 text-lg font-semibold text-ink">Pemakaian kuota</h2>
            <CapacityUsage totalUnits={preorder.quotaUnits} availability={quotaUsage} />
            {preorder.status !== "draft" && (
              <Link href={`/dashboard/preorders/${preorder.id}/orders`} className={`mt-4 w-full sm:w-fit ${SECONDARY_BUTTON_CLASS}`}>
                Lihat pesanan
              </Link>
            )}
          </Card>
        </>
      )}

      {campaignResults === null ? (
        <Card>
          <p className="text-base text-muted">Hasil kampanye belum dapat dimuat. Muat ulang halaman beberapa saat lagi.</p>
        </Card>
      ) : (
        <CampaignResults results={campaignResults} preorderSlug={preorder.slug} />
      )}

      <PreorderActions preorder={preorder} hasOrders={orders.length > 0} closeNote={closeNote} />

      {!isCancelled && (
        <BuyerPreview
          preorder={preorder}
          product={product}
          businessName={business.name}
          pickupInstructions={preorder.frozenTerms?.pickupInstructions ?? business.pickupInstructions}
          publicContact={preorder.frozenTerms ? preorder.frozenTerms.publicContact : business.publicContact}
        />
      )}
    </div>
  );
}
