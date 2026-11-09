import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { CheckoutForm } from "../../src/features/public-preorder/checkout-form";
import { loadCheckoutIntent } from "../../src/features/public-preorder/checkout-intent";
import { placeBuyerOrderAction } from "../../src/features/public-preorder/actions";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, pending: [] as Promise<void>[] }));
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: (initial: unknown) => {
      const index = hooks.cursor++;
      if (index === hooks.slots.length) hooks.slots.push({ current: initial });
      return hooks.slots[index];
    },
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (index === hooks.slots.length) hooks.slots.push(initial);
      return [hooks.slots[index], (next: unknown) => {
        hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next;
      }];
    },
    useEffect: (effect: () => void) => effect(),
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    useTransition: () => [false, (callback: () => Promise<void>) => { hooks.pending.push(callback()); }],
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("../../src/features/public-preorder/actions", () => ({ placeBuyerOrderAction: vi.fn() }));

type Props = Parameters<typeof CheckoutForm>[0];
const base: Props = { slug: "preorder-a", unitPriceIdr: 120000, orderableUnits: 10, attributionRef: null };
const rejected = { status: "rejected" as const, code: "FAILED" as const, message: "Koneksi terputus" };

function find(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> {
  if (isValidElement<Record<string, unknown>>(node)) {
    if (predicate(node)) return node;
    for (const child of Children.toArray(node.props.children as ReactNode)) {
      try { return find(child, predicate); } catch { /* continue */ }
    }
  }
  throw new Error("Elemen checkout tidak ditemukan");
}

function render(props: Props = base) {
  hooks.cursor = 0;
  return CheckoutForm(props);
}

function call(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean, prop: string, value?: unknown) {
  const handler = find(node, predicate).props[prop];
  if (typeof handler !== "function") throw new Error(`Handler ${prop} tidak ditemukan`);
  handler(value);
}

function review(props: Props = base) {
  let tree = render(props);
  for (const [id, value] of [["customerName", "Budi"], ["customerEmail", "budi@example.com"]]) {
    call(tree, (element) => element.type === "input" && element.props.id === id, "onChange", { target: { value } });
    tree = render(props);
  }
  call(tree, (element) => element.type === "form", "onSubmit", { preventDefault() {} });
  return render(props);
}

function submit(tree: ReactNode) {
  call(tree, (element) => element.type === "button" && element.props.children === "Buat pesanan", "onClick");
}

async function settle() {
  await Promise.all(hooks.pending.splice(0));
}

function stored() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.pending = [];
  vi.resetAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("CheckoutForm: identitas satu niat pembelian", () => {
  it("R01/R04: storage normal dan retry biasa memakai pasangan yang sama setelah rerender", async () => {
    const storage = stored();
    vi.stubGlobal("sessionStorage", storage);
    vi.mocked(placeBuyerOrderAction).mockResolvedValue(rejected);
    const tree = review();
    submit(tree);
    await settle();
    submit(render());
    await settle();
    const [first, second] = vi.mocked(placeBuyerOrderAction).mock.calls.map(([data]) => [data.get("privateToken"), data.get("idempotencyKey")]);
    expect(first).toEqual(second);
    expect(storage.data.size).toBeGreaterThan(0);
    expect(JSON.parse(storage.data.get("checkout-intent:preorder-a") ?? "null")).toMatchObject({ token: first[0], idempotencyKey: first[1] });
  });

  it.each(["getter", "setter"])("R02/R03: %s storage yang melempar tidak memutar pasangan saat retry", async (failure) => {
    const storage = stored();
    vi.stubGlobal("sessionStorage", failure === "getter" ? { ...storage, getItem: () => { throw new Error("blocked"); } } : { ...storage, setItem: () => { throw new Error("blocked"); } });
    vi.mocked(placeBuyerOrderAction).mockResolvedValue(rejected);
    submit(review());
    await settle();
    submit(render());
    await settle();
    const [first, second] = vi.mocked(placeBuyerOrderAction).mock.calls.map(([data]) => [data.get("privateToken"), data.get("idempotencyKey")]);
    expect(first).toEqual(second);
  });

  it("R05/R09: respons pertama hilang setelah commit, retry memakai identitas yang sama lalu menuju token asal", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    const accepted = new Map<string, string>();
    vi.mocked(placeBuyerOrderAction).mockImplementation(async (data) => {
      const key = String(data.get("idempotencyKey"));
      if (!accepted.has(key)) {
        accepted.set(key, String(data.get("privateToken")));
        throw new Error("response lost");
      }
      expect(data.get("privateToken")).toBe(accepted.get(key));
      return { status: "ok" };
    });
    submit(review());
    await settle();
    submit(render());
    await settle();
    expect(accepted.size).toBe(1);
    expect(navigation.push).toHaveBeenCalledWith(`/o/${[...accepted.values()][0]}`);
  });

  it("R06: dua klik sebelum response hanya mengirim satu request", async () => {
    let release: ((value: typeof rejected) => void) | undefined;
    vi.mocked(placeBuyerOrderAction).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const tree = review();
    submit(tree);
    submit(tree);
    expect(placeBuyerOrderAction).toHaveBeenCalledTimes(1);
    release?.(rejected);
    await settle();
    submit(render());
    release?.(rejected);
    await settle();
    expect(placeBuyerOrderAction).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(placeBuyerOrderAction).mock.calls.map(([data]) => [data.get("privateToken"), data.get("idempotencyKey")]);
    expect(first).toEqual(second);
  });

  it("R07/R08: sukses merotasi pasangan untuk pembelian berikutnya dan slug lain terisolasi", async () => {
    const storage = stored();
    vi.stubGlobal("sessionStorage", storage);
    vi.mocked(placeBuyerOrderAction).mockResolvedValue({ status: "ok" });
    submit(review());
    await settle();
    const first = vi.mocked(placeBuyerOrderAction).mock.calls[0][0];
    hooks.slots = []; // Navigasi balik memasang form baru.
    submit(review());
    await settle();
    const second = vi.mocked(placeBuyerOrderAction).mock.calls[1][0];
    expect(second.get("privateToken")).not.toBe(first.get("privateToken"));
    expect(second.get("idempotencyKey")).not.toBe(first.get("idempotencyKey"));
    hooks.slots = [];
    const other = { ...base, slug: "preorder-b" };
    submit(review(other));
    await settle();
    const third = vi.mocked(placeBuyerOrderAction).mock.calls[2][0];
    expect(third.get("privateToken")).not.toBe(second.get("privateToken"));
    expect(third.get("idempotencyKey")).not.toBe(second.get("idempotencyKey"));
  });

  it("R10: storage rusak tidak menggantikan intent aktif dalam form", async () => {
    const storage = stored();
    vi.stubGlobal("sessionStorage", storage);
    vi.mocked(placeBuyerOrderAction).mockResolvedValue(rejected);
    submit(review());
    await settle();
    storage.data.set("checkout-intent:preorder-a", "{corrupt");
    submit(render());
    await settle();
    const [first, second] = vi.mocked(placeBuyerOrderAction).mock.calls.map(([data]) => [data.get("privateToken"), data.get("idempotencyKey")]);
    expect(first).toEqual(second);
    hooks.slots = [];
    expect(loadCheckoutIntent("preorder-a")).not.toEqual({ token: first[0], idempotencyKey: first[1] });
  });
});
