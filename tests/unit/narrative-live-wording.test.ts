import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { narrativeRejection, ownerNarrativeRejection, keepSafeSentences, narrativeSentences } from "../../src/lib/ai/narrative-safety";
import { blueprintFixture } from "../fixtures/blueprint";
import { generateBlueprint } from "../../src/features/campaign-blueprint/blueprint-service";
import { sanitizeGeneratedPlan, validateBlueprint, validateBlueprintOffer } from "../../src/features/campaign-blueprint/blueprint-domain";
import { BlueprintPlanSchema } from "../../src/features/campaign-blueprint/contracts";

// Facts shaped like the "Kaos Sehat" live audit: base 120000, 10% discount → 108000, target 15, quota 40, capacity 50.
const facts = { targetUnits: [15, 5], promotionBudgetIdr: [50000], unitPriceIdr: [120000, 108000], discountBps: [1000], capacityUnits: [40, 50], observedUnits: [0] };

describe("wording seen in real Gemini answers", () => {
  it.each([
    "Berikut adalah 2 opsi rencana promosi preorder Kaos Sehat.",
    "Target kekurangannya adalah 15 unit dari kuota 40 unit.",
    "Mengirimkan pengingat dapat mendorong calon pembeli mencapai target gap 15 unit.",
    "Kapasitas tersedia sebanyak 50 unit merupakan potret data saat ini.",
    "Potongan harga 10% dari harga dasar Rp 120.000 dapat menarik minat mahasiswa.",
    "Harga promo Rp108.000, hemat dari Rp120.000.",
    "Promo Diskon Terbatas WhatsApp (Diskon 10%)",
    "Estimasi penjualan adalah asumsi pemilik dan bukan perkiraan yang dijamin.",
    "Jumlah unit tambahan merupakan asumsi pemilik dan bukan prediksi pasti.",
    "Jumlah penjualan adalah asumsi perencanaan pemilik usaha, bukan prediksi permintaan pasti.",
    "Pesan sebelum 20 November ya, ambil pesanan tanggal 25 November di toko.",
    "Sisa waktu preorder tinggal 3 hari lagi.",
    "Kirim pengingat H-2 pukul 10.00 WIB.",
    // Real Gemini Blueprint sentences (9 November 2026 replay, target 5, budget 50000).
    "Mencapai target unit 5 dengan estimasi anggaran promosi Rp50000 melalui pengingat jadwal dengan harga Rp120000 dan diskon 10%.",
    "Mengirimkan pesan pengingat jadwal dengan harga Rp108000 dan diskon 10% untuk target unit 5.",
  ])("accepts %s", (text) => {
    expect(narrativeRejection(text, facts, true)).toBeNull();
  });

  it.each([
    ["Penjualan 10-20 unit dalam seminggu.", "numeric_claim"],
    ["Mencapai target unit 99.", "numeric_claim"],
    ["Target tercapai 15 unit minggu ini.", "numeric_claim"],
    ["Sudah 30 orang memesan.", "numeric_claim"],
    ["Hanya tersisa 5 slot!", "numeric_claim"],
    ["Harga promo Rp99.000.", "numeric_claim"],
    ["Diskon 50% hari ini.", "numeric_claim"],
    ["Kuota 45 unit.", "numeric_claim"],
    ["Strategi bukan tidak menjamin penjualan.", "guaranteed_outcome"],
    ["Ini bukan janji, penjualan pasti meningkat.", "guaranteed_outcome"],
    ["Penjualan dijamin naik.", "guaranteed_outcome"],
    ["Promosi ini meningkatkan penjualan.", "causal_claim"],
  ])("still rejects %s", (text, code) => {
    expect(narrativeRejection(text, facts, true)).toBe(code);
  });

  it("splits sentences without breaking thousand separators", () => {
    expect(narrativeSentences("Harga Rp120.000 per kaos. Diskon 10%! Cek tautan?\nSelesai")).toEqual(["Harga Rp120.000 per kaos.", "Diskon 10%!", "Cek tautan?", "Selesai"]);
    expect(keepSafeSentences("Aman. Penjualan pasti naik. Juga aman.", (s) => narrativeRejection(s, facts) !== null)).toBe("Aman. Juga aman.");
    expect(keepSafeSentences("Penjualan pasti naik.", (s) => narrativeRejection(s, facts) !== null)).toBeNull();
  });
});

describe("owner-written Blueprint text", () => {
  it.each(["Preorder dibuka! Harga promo Rp108.000. Pesan sebelum 20 November.", "Bahan katun 24s, 100% nyaman.", "Kuota terbatas 50 kaos."])(
    "allows the owner's own dates, prices and product details: %s", (text) => {
      expect(ownerNarrativeRejection(text)).toBeNull();
    });
  it.each(["Penjualan dijamin naik.", "Kampanye ini meningkatkan penjualan.", "Untung pasti besar."])("still blocks promises from the owner: %s", (text) => {
    expect(ownerNarrativeRejection(text)).not.toBeNull();
  });

  it("validates a manual revision with owner policy and keeps blocking unsupported offers", async () => {
    const f = await blueprintFixture(), body = await generateBlueprint(f.input, f.dependencies);
    const manual = { ...body, provider: "manual" as const,
      revision: { ...body.revision, parentBlueprintId: "88888888-8888-4888-8888-888888888888", parentVersion: 1 } };
    manual.contents = [{ ...manual.contents[0], body: "Preorder kaos katun 24s dibuka. Pesan sebelum 20 November, ambil 25 November." }];
    expect(validateBlueprint(manual, f.contextInput, f.dependencies.now()).contents[0].body).toContain("24s");
    manual.contents = [{ ...manual.contents[0], body: "Ongkir gratis untuk semua pembeli." }];
    expect(() => validateBlueprint(manual, f.contextInput, f.dependencies.now())).toThrow("INVALID_CONTENT");
    manual.contents = [{ ...manual.contents[0], body: "Penjualan dijamin habis." }];
    expect(() => validateBlueprint(manual, f.contextInput, f.dependencies.now())).toThrow("INVALID_CONTENT");
  });

  it("generated plans keep strict grounding: the same 24s caption from AI is reduced to safe sentences", async () => {
    const f = await blueprintFixture(), body = await generateBlueprint(f.input, f.dependencies);
    const facts = validateBlueprintOffer(f.input.command.edits, f.contextInput, f.dependencies.now());
    const generated = BlueprintPlanSchema.strip().parse(body);
    const plan = sanitizeGeneratedPlan({ ...generated, contents: [{ ...generated.contents[0], body: "Bahan katun 24s. Pesan sebelum 20 November." }],
      risks: ["Penjualan pasti meningkat."] }, f.input.command.edits, facts);
    expect(plan.contents[0].body).toBe("Pesan sebelum 20 November.");
    expect(plan.risks).toEqual(["Tinjau dan sesuaikan bagian ini sebelum rencana disetujui."]);
  });
});
