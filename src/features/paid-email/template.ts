import { formatIdr } from "@/lib/format-idr";
import { formatDateOnly, formatWibDateTime } from "@/lib/wib-time";

/**
 * Isi email konfirmasi lunas (FR-EMAIL-01). Semua dari snapshot pesanan dan ketentuan yang dibekukan saat preorder terbit.
 * Tanpa tautan privat atau token (PRD §942): email awal cukup berisi rincian pesanan.
 */
export type PaidEmailFacts = {
  orderId: string;
  publicOrderNumber: string;
  customerName: string;
  customerEmail: string;
  businessName: string;
  preorderName: string;
  productName: string;
  sku: string;
  quantity: number;
  baseUnitPriceIdr: number;
  discountPerUnitIdr: number;
  finalUnitPriceIdr: number;
  subtotalIdr: number;
  discountTotalIdr: number;
  totalIdr: number;
  fulfillmentDate: string;
  fulfillmentWindowEndAt: string;
  pickupInstructions: string;
  publicContact: string | null;
};

export type EmailMessage = { to: string; subject: string; text: string; html: string };

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

// Teks dari pemilik atau pembeli bisa berisi baris baru. Satu baris email tidak boleh berisi pemisah header.
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function buildPaidEmail(facts: PaidEmailFacts): EmailMessage {
  const rows: [string, string][] = [
    ["Nomor pesanan", facts.publicOrderNumber],
    ["Usaha", facts.businessName],
    ["Preorder", facts.preorderName],
    ["Produk", `${facts.productName} (SKU ${facts.sku})`],
    ["Jumlah", `${facts.quantity} unit`],
    ["Harga normal per unit", formatIdr(facts.baseUnitPriceIdr)],
    ...(facts.discountPerUnitIdr > 0
      ? ([["Diskon per unit", formatIdr(facts.discountPerUnitIdr)], ["Harga setelah diskon", formatIdr(facts.finalUnitPriceIdr)]] satisfies [string, string][])
      : []),
    ["Subtotal", formatIdr(facts.subtotalIdr)],
    ...(facts.discountTotalIdr > 0 ? ([["Total diskon", formatIdr(facts.discountTotalIdr)]] satisfies [string, string][]) : []),
    ["Total dibayar", formatIdr(facts.totalIdr)],
    ["Tanggal pengambilan", formatDateOnly(facts.fulfillmentDate)],
    ["Batas pengambilan", formatWibDateTime(facts.fulfillmentWindowEndAt)],
    ["Petunjuk pengambilan", facts.pickupInstructions],
    ...(facts.publicContact ? ([["Kontak usaha", facts.publicContact]] satisfies [string, string][]) : []),
  ];
  const greeting = `Halo ${oneLine(facts.customerName)},`;
  const intro = `Pembayaran untuk pesananmu di ${oneLine(facts.businessName)} sudah terverifikasi. Usaha akan mengonfirmasi pesananmu.`;
  const notice = "Ini simulasi pembayaran Midtrans Sandbox untuk demo. Tidak ada uang sungguhan yang berpindah.";

  const text = [greeting, "", intro, "", ...rows.map(([label, value]) => `${label}: ${value}`), "", notice].join("\n");
  const html = `<!doctype html><html lang="id"><body style="font-family:Arial,Helvetica,sans-serif;color:#24392f;line-height:1.5">
<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(intro)}</p>
<table cellpadding="6" style="border-collapse:collapse">${rows
    .map(([label, value]) => `<tr><td style="color:#59665d;vertical-align:top">${escapeHtml(label)}</td><td style="white-space:pre-line">${escapeHtml(value)}</td></tr>`)
    .join("")}</table>
<p style="color:#654526;background:#fcf1e3;padding:10px;border-radius:6px">${escapeHtml(notice)}</p>
</body></html>`;

  return {
    to: facts.customerEmail,
    subject: oneLine(`Pembayaran pesanan ${facts.publicOrderNumber} terverifikasi (simulasi Sandbox)`),
    text,
    html,
  };
}
