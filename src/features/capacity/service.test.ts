import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CapacityRepositoryError,
  findCapacity,
  insertCapacity,
  updateCapacitySchedule,
  type Capacity,
} from "@/features/capacity/repository";
import { changeCapacitySchedule, createCapacity } from "@/features/capacity/service";
import { findProduct, type Product } from "@/features/products/repository";

vi.mock("@/features/capacity/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/capacity/repository")>();
  return { ...original, findCapacity: vi.fn(), insertCapacity: vi.fn(), updateCapacitySchedule: vi.fn() };
});
vi.mock("@/features/products/repository", () => ({ findProduct: vi.fn() }));

const findCurrent = vi.mocked(findCapacity);
const insert = vi.mocked(insertCapacity);
const update = vi.mocked(updateCapacitySchedule);
const findProductMock = vi.mocked(findProduct);

// Repository di-mock sehingga client tidak pernah dipakai.
const client = {} as SupabaseClient;
const BUSINESS_ID = "22222222-2222-4222-8222-222222222222";
const CAPACITY_ID = "44444444-4444-4444-8444-444444444444";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-02T00:00:00Z");

const schedule = {
  totalUnits: 40,
  intakeCutoff: "2026-11-06T13:00:00.000Z",
  fulfillmentWindowEnd: "2026-11-07T10:00:00.000Z",
};
const createInput = { ...schedule, productId: PRODUCT_ID, fulfillmentDate: "2026-11-07" };

const activeProduct: Product = {
  id: PRODUCT_ID,
  name: "Brownies",
  description: null,
  photoPath: null,
  photoUrl: null,
  basePriceIdr: 25000,
  variableCostIdr: null,
  costQuality: "unknown",
  isActive: true,
  version: 1,
};

const current: Capacity = {
  id: CAPACITY_ID,
  productId: PRODUCT_ID,
  productName: "Brownies",
  fulfillmentDate: "2026-11-07",
  totalUnits: 40,
  intakeCutoffAt: schedule.intakeCutoff,
  fulfillmentWindowEndAt: schedule.fulfillmentWindowEnd,
  version: 2,
  availability: { allocated: 0, effectiveHeld: 0, available: 40 },
};

describe("createCapacity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    findProductMock.mockResolvedValue(activeProduct);
  });

  it("menyimpan kapasitas yang sah", async () => {
    await expect(createCapacity(client, BUSINESS_ID, createInput, NOW)).resolves.toBe("created");
    expect(insert).toHaveBeenCalledWith(client, BUSINESS_ID, createInput);
  });

  it("menolak batas pesan yang sudah lewat", async () => {
    const later = new Date("2026-11-06T13:00:00Z");
    await expect(createCapacity(client, BUSINESS_ID, createInput, later)).resolves.toBe("cutoff_passed");
    expect(insert).not.toHaveBeenCalled();
  });

  it("menolak batas pengambilan di luar tanggal pengambilan menurut WIB", async () => {
    const nextDayWib = { ...createInput, fulfillmentWindowEnd: "2026-11-07T17:00:00.000Z" };
    await expect(createCapacity(client, BUSINESS_ID, nextDayWib, NOW)).resolves.toBe("window_outside_date");
  });

  it("menerima batas pengambilan malam hari yang di UTC masih tanggal sebelumnya", async () => {
    const earlyMorningWib = {
      ...createInput,
      intakeCutoff: "2026-11-06T16:30:00.000Z",
      fulfillmentWindowEnd: "2026-11-06T17:30:00.000Z",
    };
    await expect(createCapacity(client, BUSINESS_ID, earlyMorningWib, NOW)).resolves.toBe("created");
  });

  it("menolak produk nonaktif dan produk di luar business ini", async () => {
    findProductMock.mockResolvedValueOnce({ ...activeProduct, isActive: false });
    await expect(createCapacity(client, BUSINESS_ID, createInput, NOW)).resolves.toBe("product_unavailable");
    findProductMock.mockResolvedValueOnce(null);
    await expect(createCapacity(client, BUSINESS_ID, createInput, NOW)).resolves.toBe("product_unavailable");
    expect(insert).not.toHaveBeenCalled();
  });

  it("melapor duplicate untuk produk dan tanggal yang sama", async () => {
    insert.mockRejectedValue(new CapacityRepositoryError("insertCapacity", "23505", null));
    await expect(createCapacity(client, BUSINESS_ID, createInput, NOW)).resolves.toBe("duplicate");
  });

  it("meneruskan error lain", async () => {
    insert.mockRejectedValue(new CapacityRepositoryError("insertCapacity", "42501", null));
    await expect(createCapacity(client, BUSINESS_ID, createInput, NOW)).rejects.toThrow(/42501/);
  });
});

describe("changeCapacitySchedule", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    findCurrent.mockResolvedValue(current);
    update.mockResolvedValue(true);
  });

  const run = (version = 2, input = schedule) => changeCapacitySchedule(client, BUSINESS_ID, CAPACITY_ID, version, input);

  it("menyimpan perubahan", async () => {
    await expect(run()).resolves.toBe("updated");
  });

  it("melapor not_found untuk kapasitas di luar business ini", async () => {
    findCurrent.mockResolvedValue(null);
    await expect(run()).resolves.toBe("not_found");
  });

  it("tidak menulis bila versi sudah kedaluwarsa", async () => {
    await expect(run(1)).resolves.toBe("conflict");
    expect(update).not.toHaveBeenCalled();
  });

  it("melapor conflict bila kalah balapan saat menulis", async () => {
    update.mockResolvedValue(false);
    await expect(run()).resolves.toBe("conflict");
  });

  it("memeriksa batas pengambilan terhadap tanggal baris, bukan kiriman browser", async () => {
    await expect(run(2, { ...schedule, fulfillmentWindowEnd: "2026-11-08T10:00:00.000Z" })).resolves.toBe("window_outside_date");
    expect(update).not.toHaveBeenCalled();
  });

  it.each(["below_commitment", "schedule_frozen"] as const)("menerjemahkan penolakan trigger %s", async (violation) => {
    update.mockRejectedValue(new CapacityRepositoryError("updateCapacitySchedule", "P0001", violation));
    await expect(run()).resolves.toBe(violation);
  });

  it("meneruskan error lain", async () => {
    update.mockRejectedValue(new CapacityRepositoryError("updateCapacitySchedule", "42501", null));
    await expect(run()).rejects.toThrow(/42501/);
  });
});
