import { developmentEnabled } from "../campaign-strategist/development-provider";
import { BlueprintError, type BlueprintProvider, type BlueprintPlan, type BlueprintScenarioSchema } from "./contracts";
import type { z } from "zod";

export type BlueprintEnvironment = Parameters<typeof developmentEnabled>[0] & { CAMPAIGN_BLUEPRINT_PROVIDER?: string; CAMPAIGN_BLUEPRINT_APPROVAL?: string };
export function blueprintDevelopmentEnabled(environment: BlueprintEnvironment) {
  return developmentEnabled(environment) && ["fake", "gemini"].includes(environment.CAMPAIGN_BLUEPRINT_PROVIDER ?? "");
}
export function developmentBlueprintProvider(scenario: z.infer<typeof BlueprintScenarioSchema>, environment: BlueprintEnvironment): BlueprintProvider {
  if (!blueprintDevelopmentEnabled(environment) || environment.CAMPAIGN_BLUEPRINT_PROVIDER !== "fake") throw new BlueprintError("CONFIGURATION_ERROR", 503);
  return { async generate({ alternative, edits, now }) {
    if (scenario === "failure") throw new BlueprintError("PROVIDER_UNAVAILABLE", 503);
    if (scenario === "invalid") return { tasks: "invalid synthetic output" };
    const starts = Math.max(Date.parse(edits.startsAt), Date.parse(now)); const ends = Date.parse(edits.endsAt);
    if (starts >= ends) throw new BlueprintError("INVALID_SCHEDULE", 400);
    const dueAt = (fraction: number) => new Date(Math.floor(starts + (ends - starts) * fraction)).toISOString();
    const discounted = edits.discountBps > 0;
    const plan: BlueprintPlan = {
      goal: "Mendukung tambahan paid units sebelum preorder berakhir; hasil belum diketahui.",
      hypothesis: alternative.hypothesis, audienceHypothesis: "Calon pembeli yang telah menunjukkan minat; belum tervalidasi.",
      rationale: discounted ? "Diskon diuji sebagai alternatif hipotetis dengan kontribusi per unit yang tetap dijaga." : "Pengingat menonjolkan manfaat preorder tanpa mengubah harga dasar.",
      tasks: edits.channels.flatMap((channel) => [
        { key: `${channel}-announce`, title: `Tinjau dan bagikan pengumuman ${channel}`, description: "Periksa penawaran dan batas waktu, lalu bagikan tautan preorder secara manual.", channel, dueAt: dueAt(0.1) },
        { key: `${channel}-remind`, title: `Bagikan pengingat ${channel}`, description: "Tinjau ketersediaan terkini sebelum membagikan ulang tautan; tidak ada auto-posting.", channel, dueAt: dueAt(0.7) },
        ...(/tambah.*pengingat|extra reminder/iu.test(edits.notes) ? [{ key: `${channel}-followup`, title: `Tindak lanjut ${channel}`, description: "Pengingat tambahan sesuai revisi pemilik; tinjau kondisi preorder dahulu.", channel, dueAt: dueAt(0.85) }] : []),
      ]),
      contents: edits.channels.map((channel) => ({ key: `${channel}-caption`, channel, type: "caption",
        body: discounted ? "Penawaran diskon preorder tersedia. Lihat rincian harga, ketersediaan, dan batas waktu pada tautan preorder. Tinjau sebelum memesan."
          : "Preorder tersedia. Lihat rincian produk, harga, dan batas waktu pada tautan preorder. Silakan tinjau pilihan Anda." })),
      risks: ["Respons calon pembeli belum diketahui.", ...(discounted ? ["Kontribusi per unit turun dibanding harga normal."] : []),
        ...(alternative.computedScenario.contributionPerUnitIdr === null ? ["Biaya variabel belum diketahui; estimasi kontribusi tidak tersedia."] : [])],
      dependencies: ["Auth dan persistence nyata; konteks bisnis dan Fake Blueprint tetap sintetis.", "Producer produksi dan publikasi belum terhubung."],
      ownerChecklist: ["Periksa penawaran, angka hipotetis dan ketersediaan.", "Tinjau semua tugas dan caption sebelum approval.", "Approval tidak mempublikasikan campaign."],
    };
    return edits.plan ?? plan;
  } };
}
