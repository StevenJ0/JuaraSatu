import { describe, expect, it } from "vitest";
import { preorderSchema } from "@/features/preorders/schemas";

const valid = {
  name: "  Kaos November ",
  capacityId: "11111111-1111-4111-8111-111111111111",
  targetUnits: "40",
  quotaUnits: "40",
  startsAt: "2026-11-05T08:00",
  endsAt: "2026-11-08T20:00",
};

function pathsOf(input: Record<string, string>) {
  return preorderSchema.safeParse(input).error?.issues.map((issue) => issue.path[0]);
}

describe("preorderSchema", () => {
  it("merapikan nama dan mengubah waktu WIB menjadi UTC", () => {
    expect(preorderSchema.parse(valid)).toEqual({
      name: "Kaos November",
      capacityId: valid.capacityId,
      targetUnits: 40,
      quotaUnits: 40,
      startsAt: "2026-11-05T01:00:00.000Z",
      endsAt: "2026-11-08T13:00:00.000Z",
    });
  });

  it("menerima kuota lebih besar dari target", () => {
    expect(preorderSchema.safeParse({ ...valid, targetUnits: "30" }).success).toBe(true);
  });

  it("menolak kuota lebih kecil dari target", () => {
    expect(pathsOf({ ...valid, quotaUnits: "39" })).toEqual(["quotaUnits"]);
  });

  it.each(["0", "-1", "1.5", "abc", "", "007"])("menolak target %j", (targetUnits) => {
    expect(pathsOf({ ...valid, targetUnits })).toContain("targetUnits");
  });

  it("menolak di atas batas unit", () => {
    expect(pathsOf({ ...valid, targetUnits: "10001", quotaUnits: "10001" })).toEqual(["targetUnits", "quotaUnits"]);
  });

  it("menolak waktu tutup yang tidak setelah waktu mulai", () => {
    expect(pathsOf({ ...valid, endsAt: valid.startsAt })).toEqual(["endsAt"]);
  });

  it("menolak waktu yang kosong atau tidak ada di kalender", () => {
    expect(pathsOf({ ...valid, startsAt: "" })).toEqual(["startsAt"]);
    expect(pathsOf({ ...valid, endsAt: "2026-02-31T10:00" })).toEqual(["endsAt"]);
  });

  it("menolak jadwal kapasitas yang bukan uuid", () => {
    expect(pathsOf({ ...valid, capacityId: "" })).toEqual(["capacityId"]);
  });

  it("mengabaikan isian di luar kontrak", () => {
    const parsed = preorderSchema.parse({ ...valid, businessId: "lain", basePriceIdr: "1", status: "published" });
    expect(parsed).not.toHaveProperty("businessId");
    expect(parsed).not.toHaveProperty("basePriceIdr");
    expect(parsed).not.toHaveProperty("status");
  });
});
