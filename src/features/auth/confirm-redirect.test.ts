import { describe, expect, it } from "vitest";
import { RECOVERY_FAILED_URL, resolveConfirmRedirect } from "@/features/auth/confirm-redirect";

describe("resolveConfirmRedirect", () => {
  it("mengarahkan link reset password ke form password baru", () => {
    expect(resolveConfirmRedirect("recovery", true)).toBe("/reset-password");
  });

  it("mengarahkan link reset yang gagal ke permintaan link baru", () => {
    expect(resolveConfirmRedirect("recovery", false)).toBe(RECOVERY_FAILED_URL);
  });

  it.each(["email", "signup", null])("mengarahkan verifikasi email tipe %s ke dashboard", (type) => {
    expect(resolveConfirmRedirect(type, true)).toBe("/dashboard");
  });

  it("mengarahkan verifikasi yang gagal ke login dengan pemberitahuan", () => {
    expect(resolveConfirmRedirect("email", false)).toBe("/login?notice=confirm_failed");
  });
});
