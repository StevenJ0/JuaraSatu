import { formatIdr } from "@/lib/format-idr";
import { formatDateOnly, formatWibDateTime } from "@/lib/wib-time";
import { oneLine, renderEmailHtml, renderEmailText, type EmailContent, type EmailRow } from "@/features/paid-email/layout";

/**
 * Fakta satu pesanan untuk email, dari snapshot pesanan dan ketentuan yang dibekukan saat preorder terbit.
 * Tautan halaman pesanan hanya disisipkan bila pengirim memegang token di memori (saat checkout atau cek status);
 * token mentah tidak pernah disimpan di database maupun antrean email.
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
/** Fakta tambahan untuk email menunggu pembayaran dan notifikasi penjual. */
export type OrderEmailFacts = PaidEmailFacts & { customerContact: string | null; paymentDueAt: string | null };
export type EmailLinks = { orderUrl?: string | null; logoUrl?: string | null };
export type EmailMessage = { to: string; subject: string; text: string; html: string };

const SANDBOX_NOTE = "Ini simulasi pembayaran Midtrans Sandbox untuk demo. Tidak ada uang sungguhan yang berpindah.";
const PRIVATE_LINK_NOTE = "Tautan di email ini khusus untukmu. Jangan dibagikan, karena siapa pun yang memegangnya bisa melihat pesananmu.";

function message(to: string, subject: string, content: EmailContent): EmailMessage {
  return { to, subject: oneLine(subject), text: renderEmailText(content), html: renderEmailHtml(content) };
}
function itemRows(facts: PaidEmailFacts): EmailRow[] {
  return [
    ["Nomor pesanan", facts.publicOrderNumber],
    ["Produk", `${facts.productName} (SKU ${facts.sku})`],
    ["Jumlah", `${facts.quantity} unit`],
  ];
}
function priceRows(facts: PaidEmailFacts): EmailRow[] {
  return [
    ["Harga normal per unit", formatIdr(facts.baseUnitPriceIdr)],
    ...(facts.discountPerUnitIdr > 0
      ? ([["Diskon per unit", formatIdr(facts.discountPerUnitIdr)], ["Harga setelah diskon", formatIdr(facts.finalUnitPriceIdr)]] satisfies EmailRow[])
      : []),
    ["Subtotal", formatIdr(facts.subtotalIdr)],
    ...(facts.discountTotalIdr > 0 ? ([["Total diskon", formatIdr(facts.discountTotalIdr)]] satisfies EmailRow[]) : []),
  ];
}
function pickupRows(facts: PaidEmailFacts): EmailRow[] {
  return [
    ["Tanggal", formatDateOnly(facts.fulfillmentDate)],
    ["Paling lambat", formatWibDateTime(facts.fulfillmentWindowEndAt)],
    ["Petunjuk", facts.pickupInstructions],
    ...(facts.publicContact ? ([["Kontak usaha", facts.publicContact]] satisfies EmailRow[]) : []),
  ];
}
const buyerFooter = (businessName: string) => `Email ini dikirim otomatis oleh juarasatu untuk pesananmu di ${oneLine(businessName)}.`;

/** Email pertama ke pembeli: pesanan tercatat, slot ditahan, ajakan membayar lewat halaman pesanannya. */
export function buildPendingPaymentEmail(facts: OrderEmailFacts, links: EmailLinks = {}): EmailMessage {
  const name = oneLine(facts.customerName);
  const due = facts.paymentDueAt ? formatWibDateTime(facts.paymentDueAt) : null;
  return message(facts.customerEmail, `Satu langkah lagi: bayar pesanan ${facts.publicOrderNumber} di ${facts.businessName}`, {
    preheader: due ? `Selesaikan pembayaran sebelum ${due} agar slotmu tetap aman.` : "Selesaikan pembayaran agar slotmu tetap aman.",
    eyebrow: "Menunggu pembayaran",
    title: `Hai ${name}, pesananmu sudah tercatat!`,
    paragraphs: [
      `${oneLine(facts.productName)} dari ${oneLine(facts.businessName)} sudah kami simpan untukmu.`,
      due ? `Slotmu ditahan sampai ${due}. Lewat dari itu, slot dilepas untuk pembeli lain, jadi bayar sekarang ya.` : "Bayar sekarang agar slotmu tidak dilepas untuk pembeli lain.",
    ],
    rows: [...itemRows(facts), ...(due ? ([["Bayar sebelum", due]] satisfies EmailRow[]) : []), ["Tanggal ambil", formatDateOnly(facts.fulfillmentDate)]],
    total: ["Total bayar", formatIdr(facts.totalIdr)],
    button: links.orderUrl ? { label: "Bayar sekarang", url: links.orderUrl } : null,
    notes: [
      "Pembayaran memakai QRIS Midtrans Sandbox (simulasi). Jangan membayar dengan aplikasi bank atau dompet digital sungguhan.",
      links.orderUrl ? PRIVATE_LINK_NOTE : "Buka kembali halaman pesanan dari perangkat tempat kamu memesan untuk membayar.",
    ],
    footer: buyerFooter(facts.businessName),
    logoUrl: links.logoUrl ?? null,
  });
}

/** Email kedua ke pembeli setelah pembayaran Sandbox terverifikasi (FR-EMAIL-01). */
export function buildPaidEmail(facts: PaidEmailFacts, links: EmailLinks = {}): EmailMessage {
  const name = oneLine(facts.customerName);
  return message(facts.customerEmail, `Pembayaran diterima! Pesanan ${facts.publicOrderNumber} siap diproses (simulasi Sandbox)`, {
    preheader: `Terima kasih, ${name}. Sampai jumpa ${formatDateOnly(facts.fulfillmentDate)}.`,
    eyebrow: "Pembayaran berhasil",
    title: `Terima kasih, ${name}! Pembayaranmu sudah kami terima`,
    paragraphs: [
      `${oneLine(facts.businessName)} akan menyiapkan ${oneLine(facts.productName)} untukmu. Simpan email ini sebagai bukti pesanan.`,
    ],
    highlight: { heading: "Ambil pesananmu", rows: pickupRows(facts) },
    rows: [...itemRows(facts), ["Preorder", facts.preorderName], ...priceRows(facts)],
    total: ["Total dibayar", formatIdr(facts.totalIdr)],
    button: links.orderUrl ? { label: "Lihat status pesanan", url: links.orderUrl } : null,
    notes: [SANDBOX_NOTE, ...(links.orderUrl ? [PRIVATE_LINK_NOTE] : [])],
    footer: buyerFooter(facts.businessName),
    logoUrl: links.logoUrl ?? null,
  });
}

/** Notifikasi ke penjual saat order lunas: siapa membeli, apa, berapa, dan kapan diambil. */
export function buildOwnerPaidOrderEmail(facts: OrderEmailFacts, ownerEmail: string, links: { dashboardUrl?: string | null; logoUrl?: string | null } = {}): EmailMessage {
  const buyer = oneLine(facts.customerName);
  const pickup = formatDateOnly(facts.fulfillmentDate);
  return message(ownerEmail, `Order baru lunas: ${facts.publicOrderNumber}, ${facts.productName} x${facts.quantity}`, {
    preheader: `${buyer} membayar ${formatIdr(facts.totalIdr)}. Siapkan pesanan untuk ${pickup}.`,
    eyebrow: "Order masuk",
    title: "Ada order baru yang sudah lunas",
    paragraphs: [`${buyer} memesan ${facts.quantity} unit ${oneLine(facts.productName)} untuk diambil ${pickup}. Pembayarannya sudah terverifikasi.`],
    rows: [
      ...itemRows(facts),
      ["Pembeli", facts.customerName],
      ...(facts.customerContact ? ([["Kontak pembeli", facts.customerContact]] satisfies EmailRow[]) : []),
      ["Email pembeli", facts.customerEmail],
      ["Preorder", facts.preorderName],
      ["Tanggal ambil", `${pickup}, paling lambat ${formatWibDateTime(facts.fulfillmentWindowEndAt)}`],
    ],
    total: ["Total diterima", formatIdr(facts.totalIdr)],
    button: links.dashboardUrl ? { label: "Buka pesanan di dashboard", url: links.dashboardUrl } : null,
    notes: ["Langkah berikutnya: konfirmasi pesanan, lalu tandai produksi dan siap diambil di dashboard.", SANDBOX_NOTE],
    footer: `Notifikasi otomatis juarasatu untuk ${oneLine(facts.businessName)}.`,
    logoUrl: links.logoUrl ?? null,
  });
}
