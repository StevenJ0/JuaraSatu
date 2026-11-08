import { createClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicPreorderReadError, readPublicPreorder } from "./read";
import { PublicPreorderView } from "./page-view";

const businessId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const capacityId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const otherId = "55555555-5555-4555-8555-555555555555";
const slug = "kaos-akhir-pekan-sintetis";
const now = new Date("2026-11-05T03:00:00Z");

function fixture() {
  return {
    business_id: businessId, slug, name: "Preorder akhir pekan", status: "published", published_at: "2026-11-01T00:00:00Z",
    fulfillment_date: "2026-11-08", starts_at: "2026-11-04T00:00:00Z", ends_at: "2026-11-07T12:00:00Z",
    pickup_terms_snapshot: {
      pickup_instructions: "Ambil di gerai contoh, tunjukkan nomor pesanan.", public_contact: "Kontak publik contoh",
      intake_cutoff_at: "2026-11-07T15:00:00Z", fulfillment_window_end_at: "2026-11-08T10:00:00Z",
    },
    businesses: { id: businessId, name: "Usaha Sintetis", is_demo: true },
    preorder_items: [{
      id: itemId, business_id: businessId, product_id: productId, capacity_id: capacityId,
      product_name_snapshot: "Kaos Oversized", sku_snapshot: "KAOS-SYNTH", base_price_snapshot_idr: 120_000, quota_units: 40,
      products: { id: productId, business_id: businessId, description: "Katun untuk keseharian.", photo_path: `${businessId}/synthetic-full.webp` },
      production_capacity: {
        id: capacityId, business_id: businessId, product_id: productId, total_units: 40,
        capacity_reservations: [
          { quantity: 30, state: "allocated", expires_at: null, preorder_item_id: itemId },
          { quantity: 2, state: "held", expires_at: "2026-11-05T03:15:00Z", preorder_item_id: itemId },
          { quantity: 5, state: "held", expires_at: "2026-11-05T02:59:59Z", preorder_item_id: itemId },
        ],
      },
    }],
  };
}

function setup(data: unknown = fixture(), count = 3, fail = false) {
  const requests: { url: URL; method: string }[] = [];
  const client = createClient("https://synthetic.supabase.co", "synthetic-service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (fail) return Response.json({ message: "synthetic private database detail", code: "XX000" }, { status: 500 });
      if (method === "HEAD") return new Response(null, { status: 200, headers: { "Content-Range": `*/${count}` } });
      return Response.json(data);
    } },
  });
  return { client, requests };
}

describe("public preorder projection — SDK dengan transport tiruan", () => {
  it("mengurangi allocated dan hold aktif, tetapi tidak menghitung expired hold", async () => {
    const { client } = setup();
    const result = await readPublicPreorder(client, slug, now);
    expect(result).toMatchObject({ state: "open", availableUnits: 8, quotaUnits: 40, offer: { kind: "normal_price", unitPriceIdr: 120_000 } });
    expect(result?.product.photoUrl).toBe(`https://synthetic.supabase.co/storage/v1/object/public/product-photos/${businessId}/synthetic-full.webp`);
  });

  it("query membatasi visibility dan tenant count, tanpa customer/cost/private field", async () => {
    const { client, requests } = setup();
    await readPublicPreorder(client, slug, now);
    expect(requests).toHaveLength(2);
    expect(requests[0].url.searchParams.get("status")).toBe("in.(published,closed,completed,cancelled)");
    expect(requests[0].url.searchParams.get("published_at")).toBe("not.is.null");
    expect(requests[0].url.searchParams.get("preorder_items.production_capacity.capacity_reservations.state")).toBe("in.(held,allocated)");
    expect(requests[0].url.searchParams.get("slug")).toBe(`eq.${slug}`);
    const select = requests[0].url.searchParams.get("select");
    for (const field of ["customer_email", "customer_name", "private_token_hash", "variable_cost", "business_members", "orders(", "*"]) expect(select).not.toContain(field);
    expect(requests[1].method).toBe("HEAD");
    expect(requests[1].url.searchParams.get("business_id")).toBe(`eq.${businessId}`);
    expect(requests[1].url.searchParams.get("capacity_id")).toBe(`eq.${capacityId}`);
  });

  it("menggunakan minimum kuota dan kapasitas bersama preorder lain/manual", async () => {
    const row = fixture();
    row.preorder_items[0].production_capacity.capacity_reservations.push({ quantity: 4, state: "allocated", expires_at: null, preorder_item_id: otherId });
    const { client } = setup(row, 4);
    expect(await readPublicPreorder(client, slug, now)).toMatchObject({ availableUnits: 4 });
  });

  it("kuota tidak melebihi kapasitas dan diklem nol jika data komitmen lebih besar", async () => {
    const row = fixture();
    row.preorder_items[0].quota_units = 31;
    const { client } = setup(row);
    expect(await readPublicPreorder(client, slug, now)).toMatchObject({ state: "full", availableUnits: 0 });
  });

  it("hold tepat pada expiry sudah tidak dihitung", async () => {
    const row = fixture();
    row.preorder_items[0].production_capacity.capacity_reservations[1].expires_at = now.toISOString();
    const { client } = setup(row);
    expect(await readPublicPreorder(client, slug, now)).toMatchObject({ availableUnits: 10 });
  });

  it.each(["closed", "completed", "cancelled"])("menampilkan lifecycle publik tanpa menerima order baru (%s)", async (status) => {
    const { client } = setup({ ...fixture(), status });
    expect(await readPublicPreorder(client, slug, now)).toMatchObject({ state: status, availableUnits: 0 });
  });

  it("batas waktu mengikuti yang paling awal, termasuk equality saat cutoff", async () => {
    const row = fixture();
    row.pickup_terms_snapshot.intake_cutoff_at = now.toISOString();
    const { client } = setup(row);
    expect(await readPublicPreorder(client, slug, now)).toMatchObject({ state: "closed", orderDeadlineAt: now.toISOString(), availableUnits: 0 });
  });

  it("jadwal belum dimulai tidak memberikan available checkout", async () => {
    const row = fixture();
    row.starts_at = "2026-11-05T04:00:00Z";
    const { client } = setup(row);
    expect(await readPublicPreorder(client, slug, now)).toMatchObject({ state: "scheduled", availableUnits: 0 });
  });

  it("tepat pada starts_at preorder terbuka", async () => {
    const row = fixture();
    row.starts_at = now.toISOString();
    const { client } = setup(row);
    expect(await readPublicPreorder(client, slug, now)).toMatchObject({ state: "open" });
  });

  it.each([null, { status: "draft", published_at: null }, { status: "cancelled", published_at: null }])("draft/unpublished/unknown tidak mengungkap keberadaan (%j)", async (data) => {
    const { client, requests } = setup(data);
    expect(await readPublicPreorder(client, slug, now)).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it.each(["../private", "MixedCase", "a".repeat(161), "ab", null, 1])("slug invalid tidak menyentuh database (%s)", async (badSlug) => {
    const { client, requests } = setup();
    expect(await readPublicPreorder(client, badSlug, now)).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("row yang terpotong oleh max_rows tidak menjadi stok yang terlalu besar", async () => {
    const { client } = setup(fixture(), 1_001);
    await expect(readPublicPreorder(client, slug, now)).rejects.toThrow("PUBLIC_PREORDER_UNAVAILABLE");
  });

  it("tenant atau relasi produk/kapasitas yang tidak sesuai ditolak", async () => {
    const row = fixture();
    row.preorder_items[0].products.business_id = otherId;
    const { client } = setup(row);
    await expect(readPublicPreorder(client, slug, now)).rejects.toBeInstanceOf(PublicPreorderReadError);
  });

  it("foto lintas tenant atau path traversal ditolak", async () => {
    for (const path of [`${otherId}/photo.webp`, `${businessId}/../secret.webp`]) {
      const row = fixture();
      row.preorder_items[0].products.photo_path = path;
      const { client } = setup(row);
      await expect(readPublicPreorder(client, slug, now)).rejects.toBeInstanceOf(PublicPreorderReadError);
    }
  });

  it("field ekstra dari server tidak ikut ke DTO; harga memakai snapshot", async () => {
    const row = fixture();
    const { client } = setup({ ...row, customer_email: "synthetic-private@example.test", variable_cost_idr: 75_000, private_token_hash: "private-synthetic-hash" });
    const result = await readPublicPreorder(client, slug, now);
    expect(result?.product.name).toBe(row.preorder_items[0].product_name_snapshot);
    const serialized = JSON.stringify(result);
    for (const field of ["customer_email", "variable_cost", "private_token", businessId, productId, capacityId, "paidUnits"]) expect(serialized.replace(result?.product.photoUrl ?? "", "")).not.toContain(field);
  });

  it("snapshot ketentuan publik yang hilang tidak diganti dengan data live diam-diam", async () => {
    const { client } = setup({ ...fixture(), pickup_terms_snapshot: null });
    await expect(readPublicPreorder(client, slug, now)).rejects.toThrow("PUBLIC_PREORDER_UNAVAILABLE");
  });

  it("kesalahan database tidak mengulang pesan privat pada UI", async () => {
    const { client } = setup(null, 0, true);
    await expect(readPublicPreorder(client, slug, now)).rejects.toThrow(/^PUBLIC_PREORDER_UNAVAILABLE$/);
  });

  it("view SSR menampilkan informasi operasional, anchors sah, dan tidak berpura-pura checkout tersedia", async () => {
    const { client } = setup();
    const preorder = await readPublicPreorder(client, slug, now);
    if (!preorder) throw new Error("fixture preorder missing");
    const html = renderToStaticMarkup(createElement(PublicPreorderView, { preorder }));
    expect(html).toContain("Kaos Oversized");
    expect(html).toContain("Rp120.000");
    expect(html).toContain("Pemesanan lewat website sedang disiapkan");
    expect(html).toContain('id="pengambilan"');
    expect(html).toContain('href="#pengambilan"');
    expect(html).toContain("Midtrans Sandbox");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("synthetic-service-key");
  });
});
