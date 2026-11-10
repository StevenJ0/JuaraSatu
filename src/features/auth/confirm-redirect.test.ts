import { describe, expect, it } from "vitest";
import { resolveConfirmRedirect } from "@/features/auth/confirm-redirect";

describe("resolveConfirmRedirect", () => {
  it("mengarahkan verifikasi email yang berhasil ke dashboard", () => {
    expect(resolveConfirmRedirect(true)).toBe("/dashboard");
  });

  it("mengarahkan verifikasi yang gagal ke login dengan pemberitahuan", () => {
    expect(resolveConfirmRedirect(false)).toBe("/login?notice=confirm_failed");
  });
});
