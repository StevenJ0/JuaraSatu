import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BusinessRepositoryError, createBusinessWithOwner, findOwnedBusinessId } from "@/features/business/repository";
import { createBusinessForOwner } from "@/features/business/service";

vi.mock("@/features/business/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/business/repository")>();
  return { ...original, findOwnedBusinessId: vi.fn(), createBusinessWithOwner: vi.fn() };
});

const findOwned = vi.mocked(findOwnedBusinessId);
const createWithOwner = vi.mocked(createBusinessWithOwner);

// Repository di-mock sehingga client tidak pernah dipakai.
const client = {} as SupabaseClient;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const BUSINESS_ID = "22222222-2222-4222-8222-222222222222";
const input = {
  name: "Brownies Sabtu",
  category: "bakery",
  description: null,
  publicContact: null,
  pickupInstructions: "Ambil di toko, Sabtu 10.00-15.00",
};

const uniqueViolation = () => new BusinessRepositoryError("createBusinessWithOwner", "23505");

describe("createBusinessForOwner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("tidak membuat business kedua bila owner sudah punya", async () => {
    findOwned.mockResolvedValue(BUSINESS_ID);
    await expect(createBusinessForOwner(client, USER_ID, input)).resolves.toEqual({
      kind: "already_owned",
      businessId: BUSINESS_ID,
    });
    expect(createWithOwner).not.toHaveBeenCalled();
  });

  it("membuat business dengan slug yang dibentuk server", async () => {
    findOwned.mockResolvedValue(null);
    createWithOwner.mockResolvedValue(BUSINESS_ID);
    await expect(createBusinessForOwner(client, USER_ID, input)).resolves.toEqual({
      kind: "created",
      businessId: BUSINESS_ID,
    });
    expect(createWithOwner.mock.calls[0]?.[1].slug).toMatch(/^brownies-sabtu-[a-z0-9]{6}$/);
  });

  it("mencoba ulang dengan slug baru saat slug bentrok", async () => {
    findOwned.mockResolvedValue(null);
    createWithOwner.mockRejectedValueOnce(uniqueViolation()).mockResolvedValueOnce(BUSINESS_ID);
    await expect(createBusinessForOwner(client, USER_ID, input)).resolves.toMatchObject({ kind: "created" });
    expect(createWithOwner).toHaveBeenCalledTimes(2);
  });

  it("mengembalikan business yang ada bila bentrok karena submit ganda", async () => {
    findOwned.mockResolvedValueOnce(null).mockResolvedValueOnce(BUSINESS_ID);
    createWithOwner.mockRejectedValueOnce(uniqueViolation());
    await expect(createBusinessForOwner(client, USER_ID, input)).resolves.toEqual({
      kind: "already_owned",
      businessId: BUSINESS_ID,
    });
  });

  it("berhenti setelah 3 kali bentrok slug", async () => {
    findOwned.mockResolvedValue(null);
    createWithOwner.mockRejectedValue(uniqueViolation());
    await expect(createBusinessForOwner(client, USER_ID, input)).rejects.toBeInstanceOf(BusinessRepositoryError);
    expect(createWithOwner).toHaveBeenCalledTimes(3);
  });

  it("meneruskan error selain unique violation tanpa retry", async () => {
    findOwned.mockResolvedValue(null);
    createWithOwner.mockRejectedValue(new BusinessRepositoryError("createBusinessWithOwner", "PGRST202"));
    await expect(createBusinessForOwner(client, USER_ID, input)).rejects.toThrow(/PGRST202/);
    expect(createWithOwner).toHaveBeenCalledTimes(1);
  });
});
