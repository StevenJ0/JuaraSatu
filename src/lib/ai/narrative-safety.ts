export type NarrativeFacts = {
  targetUnits?: readonly number[];
  promotionBudgetIdr?: readonly number[];
  unitPriceIdr?: readonly number[];
  observedUnits?: readonly number[];
  discountBps?: readonly number[];
  /** Quota, capacity and orderable units from the same server snapshot. */
  capacityUnits?: readonly number[];
};
export type NarrativeRejection = "numeric_claim" | "guaranteed_outcome" | "causal_claim" | "real_revenue_claim" | "execution_claim";

export function normalizeNarrative(text: string) {
  return text.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase();
}

// Nouns that may sit between a negation and the claim word, e.g. "bukan prediksi permintaan pasti" or "bukan perkiraan yang dijamin".
const NEGATED_NOUN_GAP = "(?:\\s+(?:prediksi|perkiraan|ramalan|proyeksi|janji|jaminan|permintaan|penjualan|hasil|angka|yang|bersifat|merupakan|suatu|sesuatu))*";

export function hasAffirmativeClaim(text: string, pattern: RegExp, allowUncertainSuffix = false, allowNegatedNounGap = false) {
  const negationPattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:(?:tidak|belum|bukan|tanpa)(?:\\s+(?:ada|dapat|bisa))?${allowNegatedNounGap ? NEGATED_NOUN_GAP : ""}|bukan prediksi atau)\\s+$`, "u");
  for (const claim of text.matchAll(pattern)) {
    const prefix = text.slice(0, claim.index);
    const negation = negationPattern.exec(prefix);
    const doubleNegation = negation && /\b(?:bukan(?:nya)?|tidak|belum)(?:\s+(?:mungkin|dapat|bisa))?\s+$/u.test(prefix.slice(0, negation.index));
    const uncertainSuffix = allowUncertainSuffix && /^\s+(?:tidak|belum)(?:\s+(?:dapat|bisa))?\s+dipastikan\b/u.test(text.slice(claim.index + claim[0].length));
    if ((!negation || doubleNegation) && !uncertainSuffix) return true;
  }
  return false;
}

const MONTHS = "januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|jun|jul|agu|agt|ags|sep|sept|okt|nov|des";
// Calendar and schedule expressions are not sales, price or capacity claims, so they need no matching fact.
const NEUTRAL_NUMBERS = [
  new RegExp(`\\b[0-9]{1,2}\\s+(?:${MONTHS})\\b(?:\\s+[0-9]{4})?`, "gu"),
  // A dash needs the year so ranges such as "10-20 unit" stay numeric claims.
  /\b[0-9]{1,2}\/[0-9]{1,2}(?:\/[0-9]{2,4})?\b/gu,
  /\b[0-9]{1,2}-[0-9]{1,2}-[0-9]{2,4}\b/gu,
  /\b(?:tahun\s+)[0-9]{4}\b/gu,
  /\bh\s?-\s?[0-9]{1,2}\b/gu,
  /\b(?:pukul|jam)\s*[0-9]{1,2}(?:[.:][0-9]{2})?(?:\s*(?:wib|wita|wit))?\b/gu,
  /\b[0-9]{1,2}[.:][0-9]{2}\s*(?:wib|wita|wit)\b/gu,
  /\b[0-9]{1,3}\s*(?:hari|jam|minggu|pekan|menit|bulan)\b/gu,
  /\b[1-3]\s+(?:opsi|alternatif|pilihan|strategi)\b/gu,
];

function numericClaim(text: string, facts: NarrativeFacts) {
  // Only labelled, source-matched values are allowed; matching an unrelated number is insufficient.
  const amount = "(?:rp|idr)\\s*([0-9]+(?:[.,][0-9]+)*)";
  const grounded = [
    { pattern: /\btarget(?:\s+(?:kampanye|campaign|preorder|penjualan|tambahan|adalah|sebesar|gap|kekurangan(?:nya)?|sisa|yang|masih))*\s+([0-9]+)\s*(?:unit|porsi|pesanan)\b/gu, values: facts.targetUnits },
    // Gemini also writes the unit first: "target unit 4", "target pesanan tambahan 4".
    { pattern: /\btarget\s+(?:unit|pesanan|penjualan)(?:\s+(?:tambahan|sebanyak|sebesar|adalah))*\s+([0-9]+)\b/gu, values: facts.targetUnits },
    { pattern: new RegExp(`\\b(?:estimasi|asumsi|budget|anggaran|batas)(?:\\s+(?:biaya|promosi|belanja|kampanye|campaign|adalah|sebesar|maksimal))*\\s+${amount}`, "gu"), values: facts.promotionBudgetIdr },
    { pattern: new RegExp(`\\bharga(?:\\s+(?:preorder|per|unit|frozen|adalah|sebesar|dasar|normal|promo|diskon|setelah|jual|awal|asli|khusus|spesial|menjadi|hanya|cukup|kaos|produk))*\\s+${amount}`, "gu"), values: facts.unitPriceIdr },
    { pattern: new RegExp(`\\b(?:dari|semula|sebelumnya|normalnya|hanya)\\s+${amount}`, "gu"), values: facts.unitPriceIdr },
    { pattern: /\bpengamatan(?:\s+(?:simulasi|mencatat|menunjukkan|sebanyak))*\s+([0-9]+)\s*(?:unit|porsi|pesanan)\b/gu, values: facts.observedUnits },
    { pattern: /\b(?:kuota|kapasitas|slot|stok)(?:\s+(?:preorder|produksi|yang|tersedia|tersisa|sisa|total|maksimal|sebanyak|sebesar|adalah|dapat|bisa|dipesan))*\s+([0-9]+)\s*(?:unit|slot|porsi|pesanan)\b/gu, values: facts.capacityUnits },
    { pattern: /\b(?:diskon|potongan(?:\s+harga)?|hemat)(?:\s+(?:sebesar|hingga))?\s+([0-9]+(?:[.,][0-9]{1,2})?)\s*%/gu, values: facts.discountBps?.map(bps => bps / 100) },
  ];
  let remainder = text;
  for (const { pattern, values } of grounded) {
    remainder = remainder.replace(pattern, (claim: string, token: string, offset: number, input: string) => {
      // Do not validate a prefix of a malformed number or change a target into an observed success.
      // A comma or dot is only part of the number when a digit follows ("Rp108.000,5"); "Rp108.000, hemat" is punctuation.
      if (/^[\p{L}\p{N}]|^[.,][\p{N}]/u.test(input.slice(offset + claim.length))) return claim;
      const value = Number(/^\d{1,3}(?:\.\d{3})+$/.test(token) ? token.replaceAll(".", "") : token.replace(",", "."));
      return Number.isFinite(value) && values?.includes(value) ? "" : claim;
    });
  }
  for (const pattern of NEUTRAL_NUMBERS) remainder = remainder.replace(pattern, "");
  return /\p{N}|%|(?<![\p{L}\p{N}_])(?:rp|idr|rupiah)(?![\p{L}_])/u.test(remainder) ||
    /\b(?:nol|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|seribu|sejuta|belas|puluh|ratus|ribu|juta|miliar)\s+(?:unit|porsi|pesanan|transaksi|persen|rupiah|kali)\b/u.test(remainder);
}

function qualified(clause: string) {
  return /\b(?:mungkin|berpotensi|hipotesis|direncanakan|belum terverifikasi)\b|\b(?:dapat|bisa)\s+(?:membantu|mendukung|meningkatkan|menghasilkan)|\b(?:tidak|belum)\s+(?:ada\s+)?(?:bukti|terbukti|membuktikan|kepastian|menjamin)\b/u.test(clause);
}

/** Outcome, causality, execution and revenue claims; numbers are checked separately. */
function claimRejection(text: string, externalExecutionUnverified: boolean): NarrativeRejection | null {
  if (hasAffirmativeClaim(text, /(?<![\p{L}\p{N}_])(?:pasti(?:nya|lah|kah)?|kepastian(?:nya)?|dipastikan(?:nya)?|dijamin(?:nya)?|terjamin|menjamin|jaminan|guarantee(?:d|s|ing)?|definitely)(?![\p{L}\p{N}_])/gu, false, true)) return "guaranteed_outcome";
  for (const clause of text.split(/[.!?;,]|\s+(?:tetapi|namun|tapi|but|dan)\s+/u)) {
    if (!qualified(clause) && /\b(?:penjualan|pendapatan|laba|keuntungan|roi|konversi)\s+(?:akan|selalu)\s+(?:meningkat|naik|positif|bertambah|berhasil)\b/u.test(clause)) return "guaranteed_outcome";
    const causal = /\b(?:disebabkan|menyebabkan|caused|berkat)\b|\bkarena\s+(?:campaign|kampanye|promosi|pengingat|konten|iklan)|\b(?:campaign|kampanye|promosi|pengingat|konten|iklan|whatsapp|instagram)(?:\s+ini)?\s+(?:meningkatkan|menaikkan|menghasilkan)\s+(?:penjualan|pendapatan|laba|konversi|pesanan)/gu;
    if (!qualified(clause) && hasAffirmativeClaim(clause, causal)) return "causal_claim";
    if (externalExecutionUnverified && !qualified(clause) && !/\b(?:rencana|rencanakan|jadwalkan|akan|perlu|sebaiknya|disarankan)\b/u.test(clause) && hasAffirmativeClaim(clause,
      /\b(?:(?:telah|sudah|berhasil)\s+(?:di)?(?:kirim|mengirim|posting|memposting|bagikan|membagikan|tayang|dilaksanakan)|(?:pesan|pengingat|konten|iklan)(?:\s+(?:pengingat|promosi|ini|tersebut))?\s+(?:dikirim|dipublikasikan|dibagikan|ditayangkan)|(?:pengiriman|pelaksanaan|penerbitan|penayangan)[^.!?;]{0,90}(?:mencatatkan|menghasilkan|selesai|terlaksana))\b/gu)) return "execution_claim";
  }
  if (/pendapatan\s+nyata/u.test(text)) return "real_revenue_claim";
  return null;
}

export function narrativeRejection(value: string, facts: NarrativeFacts = {}, externalExecutionUnverified = false): NarrativeRejection | null {
  const text = normalizeNarrative(value);
  if (numericClaim(text, facts)) return "numeric_claim";
  return claimRejection(text, externalExecutionUnverified);
}

/** Outcome, causal, revenue and execution claims only, ignoring numbers: tells "promises too much" apart from "quotes a number". */
export function outcomeClaimRejection(value: string, externalExecutionUnverified = false): NarrativeRejection | null {
  return claimRejection(normalizeNarrative(value), externalExecutionUnverified);
}

/**
 * Owner-written text (manual Blueprint edits): the owner may state their own dates, prices and product details,
 * but guarantees, causal uplift and "real revenue" claims stay blocked.
 */
export function ownerNarrativeRejection(value: string): NarrativeRejection | null {
  return claimRejection(normalizeNarrative(value), false);
}

/** Splits prose into sentences without breaking thousand separators or decimals such as "Rp120.000" or "12,5". */
export function narrativeSentences(value: string): string[] {
  return value.split(/(?<=[.!?])\s+|\n+/u).map(sentence => sentence.trim()).filter(Boolean);
}

/** Keeps only sentences the predicate accepts; returns null when nothing safe remains. */
export function keepSafeSentences(value: string, isUnsafe: (sentence: string) => boolean): string | null {
  const kept = narrativeSentences(value).filter(sentence => !isUnsafe(sentence));
  return kept.length > 0 ? kept.join(" ") : null;
}

export function contradictsAssessments(value: string, states: { outcome: string; financialState: string; executionState: string }) {
  const text = normalizeNarrative(value);
  return (states.outcome !== "above_target" && hasAffirmativeClaim(text, /\b(?:target (?:tercapai|terlampaui)|melampaui target)\b/gu, true)) ||
    (states.financialState !== "positive" && hasAffirmativeClaim(text, /\bkontribusi positif\b/gu, true)) ||
    (states.executionState !== "complete" && hasAffirmativeClaim(text, /\b(?:(?:semua|seluruh)\s+(?:tugas|checklist)(?:\s+(?:telah|sudah))?\s+(?:selesai|lengkap|tuntas)|(?:tugas|checklist)\s+(?:telah|sudah)\s+(?:selesai|lengkap|tuntas))\b/gu, true));
}
