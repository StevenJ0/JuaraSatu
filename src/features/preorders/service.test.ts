import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PreorderRepositoryError, savePreorderDraft, transitionPreorder } from "@/features/preorders/repository";
import { createPreorderDraft, createPreorderSlug, runPreorderTransition, updatePreorderDraft } from "@/features/preorders/service";

vi.mock("@/features/preorders/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/preorders/repository")>();
  return { ...original, savePreorderDraft: vi.fn(), transitionPreorder: vi.fn() };
});

const save = vi.mocked(savePreorderDraft);
const transition = vi.mocked(transitionPreorder);

// Repository di-mock sehingga client tidak pernah dipakai.
const client = {} as SupabaseClient;
const PREORDER_ID = "22222222-2222-4222-8222-222222222222";
const input = {
  name: "Kaos November",
  capacityId: "11111111-1111-4111-8111-111111111111",
  targetUnits: 40,
  quotaUnits: 40,
  startsAt: "2026-11-05T01:00:00.000Z",
  endsAt: "2026-11-08T13:00:00.000Z",
};
const duplicateSlug = () => new PreorderRepositoryError("savePreorderDraft", "23505", null);
const rejected = () => new PreorderRepositoryError("savePreorderDraft", "P0001", "PRODUCT_INACTIVE");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("createPreorderSlug", () => {
  it("membentuk slug dari nama dengan akhiran acak", () => {
    expect(createPreorderSlug("Kaos Hitam: Edisi Natal!", "abc123")).toBe("kaos-hitam-edisi-natal-abc123");
  });

  it("memakai kata cadangan bila nama tanpa huruf latin", () => {
    expect(createPreorderSlug("焼き菓子", "abc123")).toBe("preorder-abc123");
  });

  it("tidak melebihi panjang kolom", () => {
    expect(createPreorderSlug("a".repeat(300), "abc123").length).toBeLessThanOrEqual(160);
  });
});

describe("createPreorderDraft", () => {
  it("mengembalikan id draf baru", async () => {
    save.mockResolvedValue(PREORDER_ID);
    await expect(createPreorderDraft(client, input)).resolves.toEqual({ kind: "saved", preorderId: PREORDER_ID });
  });

  it("mencoba slug baru saat bentrok", async () => {
    save.mockRejectedValueOnce(duplicateSlug()).mockResolvedValueOnce(PREORDER_ID);
    await expect(createPreorderDraft(client, input)).resolves.toEqual({ kind: "saved", preorderId: PREORDER_ID });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0]?.[2]).not.toEqual(save.mock.calls[1]?.[2]);
  });

  it("berhenti setelah 3 kali bentrok slug", async () => {
    save.mockRejectedValue(duplicateSlug());
    await expect(createPreorderDraft(client, input)).rejects.toBeInstanceOf(PreorderRepositoryError);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("melaporkan pelanggaran aturan tanpa mencoba ulang", async () => {
    save.mockRejectedValue(rejected());
    await expect(createPreorderDraft(client, input)).resolves.toEqual({ kind: "rejected", violation: "PRODUCT_INACTIVE" });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("meneruskan error lain", async () => {
    save.mockRejectedValue(new PreorderRepositoryError("savePreorderDraft", "42501", null));
    await expect(createPreorderDraft(client, input)).rejects.toThrow(/42501/);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("updatePreorderDraft", () => {
  it("mengirim versi yang diharapkan", async () => {
    save.mockResolvedValue(PREORDER_ID);
    await updatePreorderDraft(client, PREORDER_ID, 3, input);
    expect(save.mock.calls[0]?.[2]).toEqual({ kind: "existing", preorderId: PREORDER_ID, expectedVersion: 3 });
  });

  it("melaporkan konflik versi", async () => {
    save.mockRejectedValue(new PreorderRepositoryError("savePreorderDraft", "P0001", "VERSION_CONFLICT"));
    await expect(updatePreorderDraft(client, PREORDER_ID, 3, input)).resolves.toEqual({ kind: "rejected", violation: "VERSION_CONFLICT" });
  });
});

describe("runPreorderTransition", () => {
  it("melaporkan selesai", async () => {
    await expect(runPreorderTransition(client, "publish_preorder", PREORDER_ID, 1)).resolves.toEqual({ kind: "done" });
    expect(transition).toHaveBeenCalledWith(client, "publish_preorder", PREORDER_ID, 1);
  });

  it("membatalkan draf lewat fungsi yang sama", async () => {
    await expect(runPreorderTransition(client, "cancel_preorder_draft", PREORDER_ID, 2)).resolves.toEqual({ kind: "done" });
    expect(transition).toHaveBeenCalledWith(client, "cancel_preorder_draft", PREORDER_ID, 2);
  });

  it("menolak membatalkan yang sudah bukan draf", async () => {
    transition.mockRejectedValue(new PreorderRepositoryError("cancel_preorder_draft", "P0001", "NOT_DRAFT"));
    await expect(runPreorderTransition(client, "cancel_preorder_draft", PREORDER_ID, 2)).resolves.toEqual({ kind: "rejected", violation: "NOT_DRAFT" });
  });

  it("melaporkan pelanggaran aturan", async () => {
    transition.mockRejectedValue(new PreorderRepositoryError("publish_preorder", "P0001", "DATE_TAKEN"));
    await expect(runPreorderTransition(client, "publish_preorder", PREORDER_ID, 1)).resolves.toEqual({ kind: "rejected", violation: "DATE_TAKEN" });
  });

  it("meneruskan error tak terduga", async () => {
    transition.mockRejectedValue(new PreorderRepositoryError("publish_preorder", "08006", null));
    await expect(runPreorderTransition(client, "publish_preorder", PREORDER_ID, 1)).rejects.toThrow(/08006/);
  });
});
