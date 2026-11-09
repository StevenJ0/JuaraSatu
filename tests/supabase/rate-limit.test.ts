// Uji pembatas pembeli terhadap Supabase lokal sungguhan: memakai take_rate_limit yang sudah ada di schema.
import { describe, expect, it } from "vitest";
import { LIMITS, limitKeyHash, takeLimit } from "@/features/public-preorder/rate-limit.server";
import { service, sql } from "./helpers";

const secret = `rahasia-uji-${Date.now()}-${"x".repeat(20)}`;
const now = new Date();

describe("take_rate_limit untuk checkout", () => {
  it("mengizinkan sampai batas lalu menolak, per IP dan per jendela", async () => {
    const ip = `198.51.100.${Date.now() % 250}`;
    const decisions = [];
    for (let attempt = 0; attempt < LIMITS.checkout.max + 2; attempt += 1) decisions.push(await takeLimit(service, "checkout", ip, now, secret));
    expect(decisions.slice(0, LIMITS.checkout.max).every((decision) => decision === "allowed")).toBe(true);
    expect(decisions.slice(LIMITS.checkout.max)).toEqual(["limited", "limited"]);
    expect(await takeLimit(service, "checkout", `${ip}-lain`, now, secret)).toBe("allowed");
    expect(await takeLimit(service, "checkout", ip, new Date(now.getTime() + LIMITS.checkout.windowSeconds * 1000), secret)).toBe("allowed");
  });

  it("database hanya menyimpan hash, bukan IP", async () => {
    const ip = "203.0.113.99";
    await takeLimit(service, "checkout", ip, now, secret);
    expect(sql(`select count(*) from public.rate_limit_buckets where bucket_key_hash = '${limitKeyHash(secret, "checkout", ip)}'`)).toBe("1");
    expect(sql(`select count(*) from public.rate_limit_buckets where bucket_key_hash like '%203.0.113%'`)).toBe("0");
  });

  it("tanpa rahasia pembatas tidak aktif, bukan menolak semua pembeli", async () => {
    expect(await takeLimit(service, "checkout", "192.0.2.1", now, undefined)).toBe("disabled");
    expect(await takeLimit(service, "checkout", "192.0.2.1", now, "pendek")).toBe("disabled");
  });

  it("membatasi cek status provider ke-11 untuk satu pesanan tanpa membatasi pesanan lain", async () => {
    const token = `private-order-${Date.now()}`;
    for (let attempt = 0; attempt < LIMITS.paymentCheck.max; attempt += 1) {
      expect(await takeLimit(service, "paymentCheck", token, now, secret)).toBe("allowed");
    }
    expect(await takeLimit(service, "paymentCheck", token, now, secret)).toBe("limited");
    expect(await takeLimit(service, "paymentCheck", `${token}-other`, now, secret)).toBe("allowed");
  });
});
