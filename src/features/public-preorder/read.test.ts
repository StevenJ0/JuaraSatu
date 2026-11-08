import { describe, expect, it, vi } from "vitest";

const findPublicPreorder = vi.fn();
vi.mock("@/features/preorders/repository", () => ({ findPublicPreorder }));
vi.mock("@/lib/supabase/service-role", () => ({ createSupabaseServiceRoleClient: () => ({ client: "service" }) }));

const { loadPublicPreorder } = await import("@/features/public-preorder/read");

describe("loadPublicPreorder", () => {
  it.each([undefined, null, 12, "", "ab", "Huruf-Besar", "spasi di-tengah", "../rahasia", "a".repeat(161)])(
    "slug tidak sah %s langsung null tanpa menyentuh database",
    async (slug) => {
      findPublicPreorder.mockClear();
      await expect(loadPublicPreorder(slug)).resolves.toBeNull();
      expect(findPublicPreorder).not.toHaveBeenCalled();
    },
  );

  it("slug sah dibaca lewat kontrak C1 dengan client service role", async () => {
    findPublicPreorder.mockReset().mockResolvedValue(null);
    await loadPublicPreorder("preorder-kaos-abc123");
    expect(findPublicPreorder).toHaveBeenCalledWith({ client: "service" }, "preorder-kaos-abc123");
  });
});
