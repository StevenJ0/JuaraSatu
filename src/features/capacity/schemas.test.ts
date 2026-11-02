import { describe, expect, it } from "vitest";
import { capacityCreateSchema, capacityRefSchema, capacityScheduleSchema } from "@/features/capacity/schemas";

const schedule = { totalUnits: "40", intakeCutoff: "2026-11-06T20:00", fulfillmentWindowEnd: "2026-11-07T17:00" };
const create = { ...schedule, productId: "33333333-3333-4333-8333-333333333333", fulfillmentDate: "2026-11-07" };

function errorPaths(input: Record<string, string>) {
  const result = capacityScheduleSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path[0]);
}

describe("capacityScheduleSchema", () => {
  it("mengubah jumlah menjadi angka dan waktu WIB menjadi UTC", () => {
    expect(capacityScheduleSchema.parse(schedule)).toEqual({
      totalUnits: 40,
      intakeCutoff: "2026-11-06T13:00:00.000Z",
      fulfillmentWindowEnd: "2026-11-07T10:00:00.000Z",
    });
  });

  it("kapasitas 0 sah", () => {
    expect(capacityScheduleSchema.parse({ ...schedule, totalUnits: "0" }).totalUnits).toBe(0);
  });

  it.each(["-1", "1.5", "abc", "", "10001"])("menolak jumlah %j", (totalUnits) => {
    expect(errorPaths({ ...schedule, totalUnits })).toEqual(["totalUnits"]);
  });

  it("menolak waktu kosong dan tanggal yang tidak ada", () => {
    expect(errorPaths({ ...schedule, intakeCutoff: "" })).toEqual(["intakeCutoff"]);
    expect(errorPaths({ ...schedule, fulfillmentWindowEnd: "2026-02-31T10:00" })).toEqual(["fulfillmentWindowEnd"]);
  });

  it("menolak batas pesan yang sama atau setelah batas pengambilan", () => {
    expect(errorPaths({ ...schedule, intakeCutoff: schedule.fulfillmentWindowEnd })).toEqual(["fulfillmentWindowEnd"]);
    expect(errorPaths({ ...schedule, intakeCutoff: "2026-11-08T00:00" })).toEqual(["fulfillmentWindowEnd"]);
  });
});

describe("capacityCreateSchema", () => {
  it("menerima produk dan tanggal yang sah", () => {
    expect(capacityCreateSchema.parse(create)).toMatchObject({ productId: create.productId, fulfillmentDate: "2026-11-07" });
  });

  it("menolak produk kosong dan tanggal tidak sah", () => {
    const result = capacityCreateSchema.safeParse({ ...create, productId: "", fulfillmentDate: "2026-02-31" });
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(["productId", "fulfillmentDate"]);
  });
});

describe("capacityRefSchema", () => {
  it("menolak id bukan uuid", () => {
    expect(capacityRefSchema.safeParse({ capacityId: "abc", version: "1" }).success).toBe(false);
  });
});
