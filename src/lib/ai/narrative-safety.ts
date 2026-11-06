export type NarrativeFacts = {
  targetUnits?: readonly number[];
  promotionBudgetIdr?: readonly number[];
  unitPriceIdr?: readonly number[];
  observedUnits?: readonly number[];
  discountBps?: readonly number[];
};
export type NarrativeRejection = "numeric_claim" | "guaranteed_outcome" | "causal_claim" | "real_revenue_claim" | "execution_claim";

export function normalizeNarrative(text: string) {
  return text.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase();
}

export function hasAffirmativeClaim(text: string, pattern: RegExp, allowUncertainSuffix = false) {
  for (const claim of text.matchAll(pattern)) {
    const prefix = text.slice(0, claim.index);
    const negation = /(?<![\p{L}\p{N}_])(?:(?:tidak|belum|bukan|tanpa)(?:\s+(?:ada|dapat|bisa))?|bukan prediksi atau)\s+$/u.exec(prefix);
    const doubleNegation = negation && /\b(?:bukan(?:nya)?|tidak|belum)(?:\s+(?:mungkin|dapat|bisa))?\s+$/u.test(prefix.slice(0, negation.index));
    const uncertainSuffix = allowUncertainSuffix && /^\s+(?:tidak|belum)(?:\s+(?:dapat|bisa))?\s+dipastikan\b/u.test(text.slice(claim.index + claim[0].length));
    if ((!negation || doubleNegation) && !uncertainSuffix) return true;
  }
  return false;
}

function numericClaim(text: string, facts: NarrativeFacts) {
  // Only labelled, source-matched values are allowed; matching an unrelated number is insufficient.
  const grounded = [
    { pattern: /\btarget(?:\s+(?:kampanye|campaign|preorder|penjualan|tambahan|adalah|sebesar))*\s+([0-9]+)\s*(?:unit|porsi|pesanan)\b/gu, values: facts.targetUnits },
    { pattern: /\b(?:estimasi|asumsi|budget|anggaran|batas)(?:\s+(?:biaya|promosi|belanja|kampanye|campaign|adalah|sebesar|maksimal))*\s+(?:rp|idr)\s*([0-9]+(?:[.,][0-9]+)*)/gu, values: facts.promotionBudgetIdr },
    { pattern: /\bharga(?:\s+(?:preorder|per|unit|frozen|adalah|sebesar))*\s+(?:rp|idr)\s*([0-9]+(?:[.,][0-9]+)*)/gu, values: facts.unitPriceIdr },
    { pattern: /\bpengamatan(?:\s+(?:simulasi|mencatat|menunjukkan|sebanyak))*\s+([0-9]+)\s*(?:unit|porsi|pesanan)\b/gu, values: facts.observedUnits },
    { pattern: /\bdiskon\s+([0-9]+(?:[.,][0-9]{1,2})?)\s*%/gu, values: facts.discountBps?.map(bps => bps / 100) },
  ];
  let remainder = text;
  for (const { pattern, values } of grounded) {
    remainder = remainder.replace(pattern, (claim: string, token: string, offset: number, input: string) => {
      // Do not validate a prefix of a malformed number or change a target into an observed success.
      if (/^[\p{L}\p{N},]|^\.[\p{N}]/u.test(input.slice(offset + claim.length))) return claim;
      const value = Number(/^\d{1,3}(?:\.\d{3})+$/.test(token) ? token.replaceAll(".", "") : token.replace(",", "."));
      return Number.isFinite(value) && values?.includes(value) ? "" : claim;
    });
  }
  return /\p{N}|%|(?<![\p{L}\p{N}_])(?:rp|idr|rupiah)(?![\p{L}_])/u.test(remainder) ||
    /\b(?:nol|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|seribu|sejuta|belas|puluh|ratus|ribu|juta|miliar)\s+(?:unit|porsi|pesanan|transaksi|persen|rupiah|kali)\b/u.test(remainder);
}

function qualified(clause: string) {
  return /\b(?:mungkin|berpotensi|hipotesis|direncanakan|belum terverifikasi)\b|\b(?:dapat|bisa)\s+(?:membantu|mendukung|meningkatkan|menghasilkan)|\b(?:tidak|belum)\s+(?:ada\s+)?(?:bukti|terbukti|membuktikan|kepastian|menjamin)\b/u.test(clause);
}

export function narrativeRejection(value: string, facts: NarrativeFacts = {}, externalExecutionUnverified = false): NarrativeRejection | null {
  const text = normalizeNarrative(value);
  if (numericClaim(text, facts)) return "numeric_claim";
  if (hasAffirmativeClaim(text, /(?<![\p{L}\p{N}_])(?:pasti(?:nya|lah|kah)?|kepastian(?:nya)?|dipastikan(?:nya)?|dijamin(?:nya)?|terjamin|menjamin|jaminan|guarantee(?:d|s|ing)?|definitely)(?![\p{L}\p{N}_])/gu)) return "guaranteed_outcome";
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

export function contradictsAssessments(value: string, states: { outcome: string; financialState: string; executionState: string }) {
  const text = normalizeNarrative(value);
  return (states.outcome !== "above_target" && hasAffirmativeClaim(text, /\b(?:target (?:tercapai|terlampaui)|melampaui target)\b/gu, true)) ||
    (states.financialState !== "positive" && hasAffirmativeClaim(text, /\bkontribusi positif\b/gu, true)) ||
    (states.executionState !== "complete" && hasAffirmativeClaim(text, /\b(?:(?:semua|seluruh)\s+(?:tugas|checklist)(?:\s+(?:telah|sudah))?\s+(?:selesai|lengkap|tuntas)|(?:tugas|checklist)\s+(?:telah|sudah)\s+(?:selesai|lengkap|tuntas))\b/gu, true));
}
