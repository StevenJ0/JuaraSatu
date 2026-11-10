import type { OwnerIntake, PromotionPlatform, StrategyProposal } from "../contracts";
import type { DiscussionView } from "../persistence-contracts";

export const EMPTY_INTAKE: OwnerIntake = { assets: [], assetNotes: "", targetBuyer: "", productStrength: "", suspectedCause: null, causeNotes: "", dailyTime: null };
export const platformLabel: Record<PromotionPlatform, string> = { whatsapp: "Kontak WhatsApp", instagram: "Instagram", tiktok: "TikTok", x: "X",
  facebook: "Facebook", community: "Grup atau komunitas", offline_store: "Toko atau lapak fisik", past_buyers: "Pembeli lama" };
/** Shorter names for tactics on proposal cards. */
export const platformName: Record<PromotionPlatform, string> = { whatsapp: "WhatsApp", instagram: "Instagram", tiktok: "TikTok", x: "X",
  facebook: "Facebook", community: "Komunitas", offline_store: "Toko fisik", past_buyers: "Pembeli lama" };
export const causeLabel: Record<NonNullable<OwnerIntake["suspectedCause"]>, string> = { unaware: "Belum banyak yang tahu",
  hesitant: "Sudah tahu tapi masih ragu", price: "Harga dirasa mahal", unknown: "Belum tahu" };
export const dailyTimeLabel: Record<NonNullable<OwnerIntake["dailyTime"]>, string> = { under_30m: "Kurang dari 30 menit",
  "30_60m": "30 sampai 60 menit", over_1h: "Lebih dari 1 jam" };
export const leverLabel: Record<string, string> = { reach: "Perluas jangkauan", trust: "Bangun kepercayaan", urgency: "Tekankan tenggat", price: "Potongan harga" };
export const BUDGET_PRESETS = [0, 100_000, 250_000, 500_000];
const MAX_BUDGET_IDR = 1_000_000_000;
/** Digits typed in the budget field, without leading zeros ("0777" becomes "777") and capped at the server's limit. */
export function budgetDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  return digits === "" ? "" : String(Math.min(Number(digits), MAX_BUDGET_IDR));
}
/** Sent by "Minta usulan lain". The owner's wish steers it; the server also gives the AI a summary of every earlier proposal. */
export function anotherProposalMessage(wish: string): string {
  const request = wish.trim();
  return request ? `Usulan sebelumnya kurang cocok. Beri satu usulan lain.\nYang saya inginkan: ${request}`
    : "Usulan sebelumnya kurang cocok. Beri satu usulan lain dengan pendekatan atau platform yang berbeda.";
}

const rupiah = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);

/** Readable owner message stored in the chat; the same answers also travel as structured preferences. */
export function intakeMessage(intake: OwnerIntake, budgetIdr: number, allowDiscount: boolean, notes: string): string {
  const lines = ["Tolong susun strategi promosi supaya target preorder tercapai.",
    `Anggaran promosi: ${budgetIdr > 0 ? rupiah(budgetIdr) : "belum ada (Rp0)"}.`,
    `Audiens yang sudah saya punya: ${intake.assets.length ? intake.assets.map((asset) => platformLabel[asset]).join(", ") : "belum ada"}.`];
  if (intake.assetNotes) lines.push(`Detail audiens: ${intake.assetNotes}`);
  if (intake.targetBuyer) lines.push(`Pembeli yang saya incar: ${intake.targetBuyer}`);
  if (intake.productStrength) lines.push(`Keunggulan produk: ${intake.productStrength}`);
  if (intake.suspectedCause) lines.push(`Dugaan kenapa belum banyak yang pesan: ${causeLabel[intake.suspectedCause]}.`);
  if (intake.causeNotes) lines.push(`Penjelasan saya: ${intake.causeNotes}`);
  if (intake.dailyTime) lines.push(`Waktu promosi per hari: ${dailyTimeLabel[intake.dailyTime]}.`);
  lines.push(`Diskon: ${allowDiscount ? "boleh" : "tidak"}.`);
  if (notes.trim()) lines.push(`Catatan: ${notes.trim()}`);
  return lines.join("\n");
}

/** Latest preferences that carried intake answers in a session, newest first. */
export function rememberedPreferences(view: DiscussionView): StrategyProposal["preferences"] | null {
  for (const message of [...view.messages].reverse()) if (message.proposal?.preferences.intake) return message.proposal.preferences;
  return null;
}
