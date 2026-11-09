import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckoutIntent, finishCheckoutIntent, loadCheckoutIntent, loadLastOrderToken } from "./checkout-intent";

const data = new Map<string, string>();
const storage = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value); },
  removeItem: (key: string) => { data.delete(key); },
};

beforeEach(() => {
  data.clear();
  vi.stubGlobal("sessionStorage", storage);
});
afterEach(() => vi.unstubAllGlobals());

describe("checkout intent per preorder", () => {
  it("memulihkan pasangan yang sama dari storage dan mengisolasi slug", () => {
    const first = loadCheckoutIntent("preorder-a");
    expect(loadCheckoutIntent("preorder-a")).toEqual(first);
    const other = loadCheckoutIntent("preorder-b");
    expect(other.token).not.toBe(first.token);
    expect(other.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("mengganti isi storage rusak dengan pasangan baru yang valid", () => {
    data.set("checkout-intent:preorder-a", '{"token":"rusak","idempotencyKey":"x"}');
    const intent = loadCheckoutIntent("preorder-a");
    expect(intent.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(intent.idempotencyKey.length).toBeGreaterThanOrEqual(16);
    expect(loadCheckoutIntent("preorder-a")).toEqual(intent);
  });

  it("sukses mencatat token asal dan merotasi dua bagian identitas untuk pesanan baru", () => {
    const first = loadCheckoutIntent("preorder-a");
    const next = finishCheckoutIntent("preorder-a", first.token);
    expect(loadLastOrderToken("preorder-a")).toBe(first.token);
    expect(loadCheckoutIntent("preorder-a")).toEqual(next);
    expect(next.token).not.toBe(first.token);
    expect(next.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(createCheckoutIntent()).not.toEqual(next);
  });
});
