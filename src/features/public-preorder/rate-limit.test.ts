import { describe, expect, it } from "vitest";
import { clientAddress, limitKeyHash, limitWindow } from "@/features/public-preorder/rate-limit.server";

describe("pembatas pembeli", () => {
  it("jendela tetap: semua waktu di jendela yang sama memakai awal yang sama", () => {
    expect(limitWindow(600, new Date("2026-11-08T10:00:00.000Z"))).toEqual({ start: "2026-11-08T10:00:00.000Z", expires: "2026-11-08T10:10:00.000Z" });
    expect(limitWindow(600, new Date("2026-11-08T10:09:59.999Z")).start).toBe("2026-11-08T10:00:00.000Z");
    expect(limitWindow(600, new Date("2026-11-08T10:10:00.000Z")).start).toBe("2026-11-08T10:10:00.000Z");
  });

  it("kunci adalah HMAC hex 64 karakter, berbeda per nama batas dan per rahasia, tanpa IP mentah", () => {
    const secret = "s".repeat(32);
    const checkout = limitKeyHash(secret, "checkout", "203.0.113.7");
    expect(checkout).toMatch(/^[0-9a-f]{64}$/);
    expect(checkout).not.toContain("203");
    expect(limitKeyHash(secret, "paymentCheck", "203.0.113.7")).not.toBe(checkout);
    expect(limitKeyHash("t".repeat(32), "checkout", "203.0.113.7")).not.toBe(checkout);
  });

  it("IP dari x-forwarded-for pertama, lalu x-real-ip", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientAddress(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientAddress(new Headers())).toBe("unknown");
  });
});
