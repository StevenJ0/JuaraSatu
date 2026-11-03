import { describe, expect, it } from "vitest";
import { emailRequestSchema, newPasswordSchema, signInSchema, signUpSchema } from "@/features/auth/schemas";
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

describe("emailRequestSchema", () => {
  it("menormalkan email dan menolak format salah", () => {
    expect(emailRequestSchema.parse({ email: " Owner@Example.COM " }).email).toBe("owner@example.com");
    expect(emailRequestSchema.safeParse({ email: "bukan-email" }).success).toBe(false);
  });
});

describe("newPasswordSchema", () => {
  it("menerima password baru yang sama dengan konfirmasinya", () => {
    expect(newPasswordSchema.safeParse({ password: "rahasia123", confirmPassword: "rahasia123" }).success).toBe(true);
  });

  it("menolak password pendek", () => {
    const result = newPasswordSchema.safeParse({ password: "pendek", confirmPassword: "pendek" });
    expect(result.error?.issues[0]?.path).toEqual(["password"]);
  });

  it("menolak konfirmasi yang tidak sama", () => {
    const result = newPasswordSchema.safeParse({ password: "rahasia123", confirmPassword: "rahasia124" });
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});

describe("toAuthErrorMessage", () => {
  it("memetakan kode yang dikenal", () => {
    expect(toAuthErrorMessage("invalid_credentials")).toBe("Email atau password salah.");
    expect(toAuthErrorMessage("email_not_confirmed")).toMatch(/belum diverifikasi/);
    expect(toAuthErrorMessage("same_password")).toMatch(/berbeda/);
  });

  it("memakai pesan umum untuk kode tak dikenal tanpa meneruskan pesan provider", () => {
    expect(toAuthErrorMessage(undefined)).toMatch(/Terjadi kesalahan/);
    expect(toAuthErrorMessage("something_new")).toMatch(/Terjadi kesalahan/);
  });
});
