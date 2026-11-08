import { Badge, type BadgeTone } from "@/components/owner/badge";
import { Card } from "@/components/owner/card";
import { KpiCard } from "@/components/owner/kpi-card";
import { formatIdr } from "@/lib/format-idr";
import { formatWibDateTime } from "@/lib/wib-time";
import type { CampaignPhase, CampaignResult } from "@/features/campaign-results/metrics";

const PHASES: Record<CampaignPhase, { label: string; tone: BadgeTone }> = {
  scheduled: { label: "Belum mulai", tone: "neutral" },
  running: { label: "Berjalan", tone: "success" },
  ended: { label: "Selesai", tone: "neutral" },
};

function CampaignResultCard({ result, preorderSlug }: { result: CampaignResult; preorderSlug: string }) {
  const { campaign, verified, attributed, discounted, manual } = result;
  const phase = PHASES[result.phase];
  const link = `/p/${preorderSlug}?ref=${campaign.slug}`;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold break-words text-ink">{campaign.name}</h3>
        <Badge tone={phase.tone}>{phase.label}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">
        Periode {formatWibDateTime(result.window.start)} sampai {formatWibDateTime(result.window.end)}
        {campaign.offerType === "percent_discount" ? ` · diskon ${campaign.discountBps / 100}%` : " · harga normal"}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Pesanan lunas" value={`${verified.orders}`} note="Terverifikasi di periode ini" />
        <KpiCard label="Nilai pesanan" value={formatIdr(verified.valueIdr)} note="Simulasi Sandbox" />
        <KpiCard label="Unit terbayar" value={`${verified.units} unit`} note={`Target kampanye ${campaign.targetAdditionalUnits} unit`} />
        <KpiCard label="Lewat tautan kampanye" value={`${attributed.orders}`} note={`${attributed.units} unit, ${formatIdr(attributed.valueIdr)}`} />
      </div>
      <ul className="mt-4 flex flex-col gap-1 text-sm text-muted">
        {campaign.offerType === "percent_discount" && (
          <li>Mendapat harga promo: {discounted.orders} pesanan, total potongan {formatIdr(discounted.discountGivenIdr)}.</li>
        )}
        {manual.orders > 0 && <li>Lunas di luar aplikasi pada periode yang sama: {manual.orders} pesanan, {manual.units} unit. Tidak termasuk angka di atas.</li>}
        {result.cancelledAfterPayment > 0 && <li>Dibatalkan setelah dibayar: {result.cancelledAfterPayment} pesanan. Tidak termasuk angka di atas.</li>}
      </ul>
      <div className="mt-4">
        <p className="text-sm font-medium text-ink">Tautan kampanye</p>
        <p className="mt-1 text-sm break-all text-muted">{link}</p>
        <p className="mt-1 text-sm text-muted">Pesanan lewat tautan ini tercatat sebagai asal kampanye. Harga tetap sama untuk semua pembeli.</p>
      </div>
    </Card>
  );
}

/** Hasil kampanye per preorder (P3-1). Angka dari pembayaran Sandbox terverifikasi, bukan uang sungguhan dan bukan bukti sebab-akibat. */
export function CampaignResults({ results, preorderSlug }: { results: CampaignResult[]; preorderSlug: string }) {
  if (results.length === 0) return null;
  return (
    <section aria-labelledby="hasil-kampanye" className="flex flex-col gap-4">
      <div>
        <h2 id="hasil-kampanye" className="text-lg font-semibold text-ink">Hasil kampanye</h2>
        <p className="mt-1 max-w-[70ch] text-sm text-muted">
          Dihitung dari pembayaran Midtrans Sandbox yang terverifikasi selama periode kampanye. Ini simulasi, bukan uang sungguhan. Pesanan yang masuk saat kampanye berjalan belum tentu karena kampanye.
        </p>
      </div>
      {results.map((result) => (
        <CampaignResultCard key={result.campaign.id} result={result} preorderSlug={preorderSlug} />
      ))}
    </section>
  );
}
