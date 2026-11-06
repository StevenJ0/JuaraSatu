import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PreorderRepositoryError, closePreorderRecord } from "@/features/preorders/repository";
import { closePreorderSchema } from "@/features/preorders/schemas";
import { closePreorder } from "@/features/preorders/service";

vi.mock("@/features/preorders/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/preorders/repository")>();
  return { ...original, closePreorderRecord: vi.fn() };
});

const close = vi.mocked(closePreorderRecord);
// Repository di-mock sehingga client tidak pernah dipakai.
const client = {} as SupabaseClient;
const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("closePreorderSchema", () => {
  it("merapikan alasan", () => {
    expect(closePreorderSchema.parse({ preorderId: ID, version: "3", reason: "  Kuota cukup " })).toEqual({ preorderId: ID, version: 3, reason: "Kuota cukup" });
  });

  it.each(["", "   "])("alasan kosong ditolak: %j", (reason) => {
    const result = closePreorderSchema.safeParse({ preorderId: ID, version: "3", reason });
    expect(result.error?.issues[0]?.message).toBe("Tulis alasan menutup preorder");
  });

  it("alasan terlalu panjang ditolak", () => {
    expect(closePreorderSchema.safeParse({ preorderId: ID, version: "3", reason: "x".repeat(501) }).success).toBe(false);
  });
});

describe("closePreorder", () => {
  it("mengirim alasan ke database", async () => {
    await expect(closePreorder(client, ID, 3, "Kuota cukup")).resolves.toEqual({ kind: "done" });
    expect(close).toHaveBeenCalledWith(client, ID, 3, "Kuota cukup");
  });

  it.each(["NOT_PUBLISHED", "VERSION_CONFLICT", "INPUT_INVALID", "NOT_FOUND"] as const)("melaporkan %s", async (violation) => {
    close.mockRejectedValue(new PreorderRepositoryError("close_preorder", "P0001", violation));
    await expect(closePreorder(client, ID, 3, "x")).resolves.toEqual({ kind: "rejected", violation });
  });

  it("meneruskan error tak terduga", async () => {
    close.mockRejectedValue(new PreorderRepositoryError("close_preorder", "08006", null));
    await expect(closePreorder(client, ID, 3, "x")).rejects.toThrow(/08006/);
  });
});
