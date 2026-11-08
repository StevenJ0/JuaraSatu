// Uji C1 terhadap Supabase lokal sungguhan. Data uji dibuat lewat SQL dan dibersihkan. Nilai key tidak pernah dicetak.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findPreorder, findPreorderContext, findPublicPreorder } from "@/features/preorders/repository";
import { anon, anonKey, publishFixture, service, sha256, sql, url } from "./helpers";

const stamp = Date.now();
const COST = 75317;
const SKU = `SKUC1${stamp}`;
const BUYER_EMAIL = `c1-buyer-${stamp}@example.com`;
const BUYER_NAME = `PembeliRahasia${stamp}`;
const BUYER_CONTACT = `0899${String(stamp).slice(-7)}`;
// 60 karakter hex + 4 digit nomor pesanan = SHA-256 hex yang sah menurut schema.
const TOKEN_HASH = sha256(`tokenhash${stamp}`).slice(0, 60);
const INTERNAL_NOTE = `catatan${stamp}`;
const password = "C1Check-Lokal-12345";

type Tenant = { businessId: string; productId: string; client: SupabaseClient; userId: string };
const tenants: Tenant[] = [];
const slugs: Record<string, string> = {};
const ids: Record<string, string> = {};
let dayOffset = 200;

async function tenant(label: string): Promise<Tenant> {
  const email = `c1-check-${label}-${stamp}@example.com`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const businessId = sql(`insert into public.businesses (name, slug, categories, description, public_contact, pickup_instructions)
    values ('Usaha ${label} ${stamp}', 'c1-${label}-${stamp}', array['Fashion'], 'Deskripsi ${label}', '0812-${label}', 'Ambil di toko ${label}') returning id`);
  sql(`insert into public.business_members (business_id, user_id) values ('${businessId}', '${data.user.id}')`);
  const productId = sql(`insert into public.products (business_id, name, sku, description, photo_path, base_price_idr, variable_cost_idr, cost_quality)
    values ('${businessId}', 'Kaos ${label}', '${SKU}${label}', 'Kaos katun', '${businessId}/foto.webp', 120000, ${COST}, 'estimated') returning id`);
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);
  const created = { businessId, productId, client, userId: data.user.id };
  tenants.push(created);
  return created;
}

function preorder(
  owner: Tenant,
  key: string,
  options: { status?: string; quota?: number; capacity?: number; startsIn?: string; endsIn?: string; cutoffIn?: string } = {},
) {
  const { status = "published", quota = 40, capacity = 40, startsIn = "-1 day", endsIn = "5 days", cutoffIn = "6 days" } = options;
  dayOffset += 1;
  const date = new Date(Date.now() + dayOffset * 86400e3).toISOString().slice(0, 10);
  const capacityId = sql(`insert into public.production_capacity (business_id, product_id, fulfillment_date, total_units, intake_cutoff_at, fulfillment_window_end_at)
    values ('${owner.businessId}', '${owner.productId}', '${date}', ${capacity}, now() + interval '${cutoffIn}', '${date} 17:00+07') returning id`);
  const slug = `c1-${key}-${stamp}`;
  const terms = status === "draft" || status === "cancelled"
    ? "null"
    : `jsonb_build_object('pickup_instructions', 'Ambil beku ${key}', 'public_contact', '0812-beku', 'intake_cutoff_at', (now() + interval '${cutoffIn}'), 'fulfillment_window_end_at', '${date} 17:00+07'::timestamptz)`;
  const id = sql(`insert into public.preorders (business_id, name, slug, status, fulfillment_date, starts_at, ends_at, pickup_terms_snapshot)
    values ('${owner.businessId}', 'Preorder ${key}', '${slug}', 'draft', '${date}', now() + interval '${startsIn}', now() + interval '${endsIn}', ${terms}) returning id`);
  const itemId = sql(`insert into public.preorder_items (business_id, preorder_id, product_id, capacity_id, target_units, quota_units, base_price_snapshot_idr, product_name_snapshot, sku_snapshot)
    values ('${owner.businessId}', '${id}', '${owner.productId}', '${capacityId}', ${Math.min(40, quota)}, ${quota}, 120000, 'Kaos beku', '${SKU}') returning id`);
  publishFixture(id, status);
  slugs[key] = slug;
  ids[key] = id;
  return { id, itemId, capacityId, date, owner };
}

let orderCount = 0;
function reservation(
  target: ReturnType<typeof preorder>,
  quantity: number,
  state: "held" | "allocated",
  { expiresIn = "1 hour" }: { expiresIn?: string } = {},
) {
  orderCount += 1;
  const { owner, date } = target;
  const amount = quantity * 120000;
  if (state === "allocated") {
    // Allocated alone is not paid: use the existing owner-confirmed manual-order contract for this paid fixture.
    sql(`begin;
      set local role authenticated;
      set local request.jwt.claim.role = 'authenticated';
      set local request.jwt.claim.sub = '${owner.userId}';
      select public.create_manual_order('${target.id}', ${quantity}, '${BUYER_NAME}', '${BUYER_EMAIL}', '${BUYER_CONTACT}', true,
        'idem-${stamp}-${orderCount}', '${sha256(`hash-${stamp}-${orderCount}`)}');
      commit;`);
    return;
  }
  // Satu transaksi: cek total pesanan di baseline berjalan saat commit dan butuh item sudah ada.
  const orderId = randomUUID();
  const orderItemId = randomUUID();
  sql(`begin;
    insert into public.orders (id, business_id, preorder_id, public_order_number, private_token_hash, idempotency_key, request_hash, source, customer_name, customer_email, customer_contact, fulfillment_date, payment_mode, order_status, fulfillment_status, subtotal_idr, discount_total_idr, total_idr)
    values ('${orderId}', '${owner.businessId}', '${target.id}'::uuid, 'C1-${stamp}-${orderCount}', '${TOKEN_HASH}${String(orderCount).padStart(4, "0")}', 'idem-${stamp}-${orderCount}', '${sha256(`hash-${stamp}-${orderCount}`)}', 'public', '${BUYER_NAME}', '${BUYER_EMAIL}', '${BUYER_CONTACT}', '${date}', 'midtrans_sandbox', '${state === "held" ? "pending_payment" : "active"}', '${state === "held" ? "pending_confirmation" : "confirmed"}', ${amount}, 0, ${amount});
    insert into public.order_items (id, business_id, order_id, preorder_item_id, product_id, product_name_snapshot, sku_snapshot, quantity, base_unit_price_idr, discount_bps_snapshot, discount_per_unit_idr, final_unit_price_idr, variable_cost_per_unit_idr, cost_quality_snapshot, line_total_idr)
    values ('${orderItemId}', '${owner.businessId}', '${orderId}', '${target.itemId}', '${owner.productId}', 'Kaos beku', '${SKU}', ${quantity}, 120000, 0, 0, 120000, ${COST}, 'estimated', ${amount});
    insert into public.capacity_reservations (business_id, order_id, order_item_id, preorder_item_id, capacity_id, quantity, state, expires_at)
    values ('${owner.businessId}', '${orderId}', '${orderItemId}', '${target.itemId}', '${target.capacityId}', ${quantity}, '${state}', ${state === "held" ? `now() + interval '${expiresIn}'` : "null"});
    commit;`);
}

function cleanup() {
  sql(`begin;
    create temp table doomed on commit drop as select id from public.businesses where slug like 'c1-%-${stamp}';
    set local session_replication_role = replica;
    delete from public.capacity_reservations where business_id in (select id from doomed);
    delete from public.order_events where business_id in (select id from doomed);
    delete from public.order_items where business_id in (select id from doomed);
    delete from public.orders where business_id in (select id from doomed);
    delete from public.preorder_items where business_id in (select id from doomed);
    delete from public.preorders where business_id in (select id from doomed);
    delete from public.production_capacity where business_id in (select id from doomed);
    delete from public.products where business_id in (select id from doomed);
    delete from public.business_members where business_id in (select id from doomed);
    delete from public.businesses where id in (select id from doomed);
    delete from auth.users where email like 'c1-check-%-${stamp}@example.com';
    commit;`);
}

let A: Tenant;
let B: Tenant;
// SKU snapshot memang tampil ke pembeli (PRD buyer, kontrak C5 §3), jadi tidak termasuk daftar terlarang.
const FORBIDDEN = [String(COST), BUYER_EMAIL, BUYER_NAME, BUYER_CONTACT, TOKEN_HASH, INTERNAL_NOTE, "variable", "customer", "token"];

beforeAll(async () => {
  A = await tenant("a");
  B = await tenant("b");
  const main = preorder(A, "main");
  reservation(main, 30, "allocated");
  reservation(main, 2, "held");
  reservation(main, 3, "held", { expiresIn: "-1 hour" });
  const sharedCapacity = preorder(A, "soldout", { quota: 5, capacity: 5 });
  reservation(sharedCapacity, 5, "allocated");
  preorder(A, "notstarted", { startsIn: "2 days", endsIn: "5 days" });
  preorder(A, "ended", { startsIn: "-3 days", endsIn: "-1 day" });
  // Baseline menolak batas pesan sebelum akhir preorder, jadi keadaan ini dibuat paksa untuk menguji penjagaan C1.
  const cutoff = preorder(A, "cutoff", { startsIn: "-3 days", endsIn: "5 days" });
  sql(`begin;
    set local session_replication_role = replica;
    update public.production_capacity set intake_cutoff_at = now() - interval '1 hour' where id = '${cutoff.capacityId}';
    update public.preorders set pickup_terms_snapshot = pickup_terms_snapshot || jsonb_build_object('intake_cutoff_at', now() - interval '1 hour') where id = '${cutoff.id}';
    commit;`);
  preorder(A, "closed", { status: "closed" });
  preorder(A, "completed", { status: "completed" });
  preorder(A, "draft", { status: "draft" });
  preorder(A, "cancelled", { status: "cancelled" });
  preorder(B, "tenantb");
});

afterAll(() => {
  cleanup();
});

describe("findPublicPreorder di database sungguhan", () => {
  it("acceptance: terbit, 30 terpakai, 2 ditahan memberi sisa 8, hold kedaluwarsa tidak dihitung", async () => {
    const result = await findPublicPreorder(service, slugs.main);
    expect(result).toMatchObject({ availability: "open", orderableUnits: 8, unitPriceIdr: 120000, businessName: `Usaha a ${stamp}` });
    expect(result?.product).toMatchObject({ name: "Kaos beku", description: "Kaos katun" });
    expect(result?.product.photoUrl).toContain("/product-photos/");
    expect(result?.pickup).toEqual({ instructions: "Ambil beku main", publicContact: "0812-beku" });
  });

  it("tidak memuat biaya atau data pelanggan, dan field-nya tepat", async () => {
    const result = await findPublicPreorder(service, slugs.main);
    expect(result?.product.sku).toBe(SKU);
    const text = JSON.stringify(result);
    for (const forbidden of FORBIDDEN) expect(text.includes(forbidden), forbidden).toBe(false);
    expect(Object.keys(result ?? {}).sort()).toEqual(
      ["asOf", "availability", "basePriceIdr", "businessName", "discountBps", "endsAt", "fulfillmentDate", "fulfillmentWindowEndAt", "intakeCutoffAt", "isDemo", "name", "orderableUnits", "pickup", "product", "quotaUnits", "slug", "startsAt", "unitPriceIdr", "version"].sort(),
    );
  });

  it("sama persis dengan angka dashboard pemilik", async () => {
    const [publicView, ownerView] = await Promise.all([findPublicPreorder(service, slugs.main), findPreorder(A.client, A.businessId, ids.main)]);
    expect(publicView?.orderableUnits).toBe(ownerView?.metrics.orderableUnits);
  });

  it.each([
    ["soldout", "sold_out"],
    ["notstarted", "not_started"],
    ["ended", "closed"],
    ["cutoff", "closed"],
    ["closed", "closed"],
    ["completed", "closed"],
  ])("%s dibaca %s dengan sisa 0", async (key, availability) => {
    expect(await findPublicPreorder(service, slugs[key])).toMatchObject({ availability, orderableUnits: 0 });
  });

  it("draf, dibatalkan, dan slug tidak ada sama-sama null", async () => {
    expect(await findPublicPreorder(service, slugs.draft)).toBeNull();
    expect(await findPublicPreorder(service, slugs.cancelled)).toBeNull();
    expect(await findPublicPreorder(service, "tidak-ada-slug-ini")).toBeNull();
    expect(await findPublicPreorder(service, "a'; drop table public.preorders; --")).toBeNull();
    expect(await findPublicPreorder(service, "a,b.c(d)*%")).toBeNull();
  });

  it("client tamu tanpa service role tidak mendapat apa pun", async () => {
    await expect(findPublicPreorder(anon, slugs.main)).rejects.toThrow();
  });

  it("pesanan sungguhan lewat RPC mengurangi sisa yang terbaca", async () => {
    const { error } = await service.rpc("create_preorder_order", {
      p_slug: slugs.main,
      p_quantity: 3,
      p_customer_name: "Pembeli RPC",
      p_customer_email: `c1-rpc-${stamp}@example.com`,
      p_customer_contact: "",
      p_token_hash: sha256(`rpc-token-${stamp}`),
      p_idempotency_key: `rpc-key-${stamp}-abcdef`,
      p_request_hash: sha256(`rpc-hash-${stamp}`),
      p_expected_unit_price_idr: 120000,
      p_hold_ttl_seconds: 900,
    });
    expect(error).toBeNull();
    expect((await findPublicPreorder(service, slugs.main))?.orderableUnits).toBe(5);
  });
});

describe("findPreorderContext di database sungguhan", () => {
  it("pemilik mendapat konteks lengkap dari satu query", async () => {
    const context = await findPreorderContext(A.client, A.businessId, ids.soldout);
    expect(context).toMatchObject({
      business: { name: `Usaha a ${stamp}`, categories: ["Fashion"], description: "Deskripsi a" },
      product: { name: "Kaos beku", basePriceIdr: 120000, costQuality: "estimated", isActive: true, description: "Kaos katun" },
      preorder: { status: "published", quotaUnits: 5, targetUnits: 5 },
      units: { allocated: 5, held: 0, orderable: 0, paid: 5, paidTargetGap: 0 },
    });
    expect(Date.parse(context?.asOf ?? "")).not.toBeNaN();
  });

  it("draf juga terbaca oleh pemiliknya", async () => {
    expect((await findPreorderContext(A.client, A.businessId, ids.draft))?.preorder.status).toBe("draft");
  });

  it("memuat biaya privat untuk C1 owner tanpa data pelanggan atau token", async () => {
    const context = await findPreorderContext(A.client, A.businessId, ids.main);
    expect(context?.product.variableCostIdr).toBe(COST);
    const text = JSON.stringify(context);
    for (const forbidden of FORBIDDEN.filter((value) => value !== String(COST) && value !== "variable")) {
      expect(text.includes(forbidden), forbidden).toBe(false);
    }
  });

  it("usaha lain tidak bisa membaca, walau memalsukan businessId", async () => {
    expect(await findPreorderContext(B.client, B.businessId, ids.main)).toBeNull();
    expect(await findPreorderContext(B.client, A.businessId, ids.main)).toBeNull();
  });

  it("tamu tidak bisa membaca", async () => {
    await expect(findPreorderContext(anon, A.businessId, ids.main)).rejects.toThrow();
  });
});
