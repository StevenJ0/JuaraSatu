import { describe, expect, it } from "vitest";
import { signInSchema, signUpSchema } from "@/features/auth/schemas";
import { toAuthErrorMessage } from "@/features/auth/errors";

describe("signUpSchema", () => {
  it("menormalkan email", () => {
    const parsed = signUpSchema.parse({
      email: "  Owner@Example.COM ",
      password: "rahasia123",
      confirmPassword: "rahasia123",
    });
    expect(parsed.email).toBe("owner@example.com");
  });

  it("menolak password pendek dan konfirmasi berbeda", () => {
    const result = signUpSchema.safeParse({ email: "a@b.co", password: "pendek", confirmPassword: "beda" });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path[0]);
    expect(paths).toContain("password");
  });

  it("menolak konfirmasi password yang tidak sama", () => {
    const result = signUpSchema.safeParse({ email: "a@b.co", password: "rahasia123", confirmPassword: "rahasia124" });
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});

describe("signInSchema", () => {
  it("menolak email tidak valid", () => {
    expect(signInSchema.safeParse({ email: "bukan-email", password: "x" }).success).toBe(false);
  });
});

describe("toAuthErrorMessage", () => {
  it("memetakan kode yang dikenal", () => {
    expect(toAuthErrorMessage("invalid_credentials")).toBe("Email atau password salah.");
  });

  it("memakai pesan umum untuk kode tak dikenal tanpa meneruskan pesan provider", () => {
    expect(toAuthErrorMessage(undefined)).toMatch(/Terjadi kesalahan/);
    expect(toAuthErrorMessage("something_new")).toMatch(/Terjadi kesalahan/);
  });
});
