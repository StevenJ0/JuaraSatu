import { describe, expect, it } from "vitest";
import { isRecentRecovery } from "@/features/auth/session";

const NOW = 1_800_000_000;

describe("isRecentRecovery", () => {
  it("menerima session dari link reset yang masih baru", () => {
    // Supabase lokal menandai link reset sebagai otp.
    expect(isRecentRecovery([{ method: "otp", timestamp: NOW - 60 }], NOW)).toBe(true);
    expect(isRecentRecovery([{ method: "recovery", timestamp: NOW - 60 }], NOW)).toBe(true);
  });

  it("menerima tepat di batas satu jam, dan menolak setelahnya", () => {
    expect(isRecentRecovery([{ method: "recovery", timestamp: NOW - 3600 }], NOW)).toBe(true);
    expect(isRecentRecovery([{ method: "recovery", timestamp: NOW - 3601 }], NOW)).toBe(false);
  });

  it("session login biasa tidak cukup untuk membuat password baru", () => {
    expect(isRecentRecovery([{ method: "password", timestamp: NOW }], NOW)).toBe(false);
    expect(isRecentRecovery([{ method: "oauth", timestamp: NOW }], NOW)).toBe(false);
  });

  it("link email yang sudah lama tidak cukup", () => {
    expect(isRecentRecovery([{ method: "otp", timestamp: NOW - 3601 }], NOW)).toBe(false);
  });

  it("recovery ikut terbaca walau bukan cara masuk pertama", () => {
    expect(isRecentRecovery([{ method: "password", timestamp: NOW - 9999 }, { method: "recovery", timestamp: NOW - 5 }], NOW)).toBe(true);
  });

  it.each([undefined, null, "recovery", [{ method: "recovery" }], [{ timestamp: NOW }], {}])("bentuk tidak dikenal ditolak: %j", (value) => {
    expect(isRecentRecovery(value, NOW)).toBe(false);
  });
});
