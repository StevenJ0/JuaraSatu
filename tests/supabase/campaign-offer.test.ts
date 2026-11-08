// Uji C8 terhadap Supabase lokal sungguhan: harga dan atribusi pesanan dari kampanye terbit yang aktif.
// Kampanye terbit dibuat lewat SQL dengan trigger dimatikan, karena publish_campaign butuh alur Blueprint lengkap milik modul AI.
// Kolom yang dibaca resolver (status, offer, jendela waktu) sama dengan hasil publish_campaign.
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicOrderSchema } from "@/features/orders/schemas";
import { createManualOrder, createPrivateOrderToken, placePublicOrder } from "@/features/orders/service";
import { findPublicPreorder } from "@/features/preorders/repository";
import { cleanupOwners, container, createOwner, createPublishedPreorder, service, sleep, sql, type Owner, type PreorderFixture } from "./helpers";

const stamp = Date.now();
const PREFIX = "c8o";
let A: Owner;
let B: Owner;
let cheap: Owner;

beforeAll(async () => {
  A = await createOwner(PREFIX, "a", stamp);
  B = await createOwner(PREFIX, "b", stamp);
  cheap = await createOwner(PREFIX, "c", stamp, { price: 101 });
});

afterAll(() => {
  cleanupOwners(PREFIX, stamp);
});

type CampaignOptions = {
  status?: "published" | "closed";
  offerType?: "percent_discount" | "normal_price";
  bps?: number;
  startsAt?: string;
  endsAt?: string;
};

let campaignCount = 0;
function campaign(target: PreorderFixture, { status = "published", offerType = "percent_discount", bps = 1000,
  startsAt = "now() - interval '1 hour'", endsAt = "now() + interval '2 days'" }: CampaignOptions = {}) {
  campaignCount += 1;
  const slug = `${PREFIX}-kampanye-${stamp}-${campaignCount}`;
  const discount = offerType === "normal_price" ? 0 : bps;
  const approach = offerType === "normal_price" ? "scheduled_reminder" : "limited_discount";
  const id = sql(`begin;
    set local session_replication_role = replica;
    with blueprint as (select gen_random_uuid() as id)
    insert into public.campaigns (business_id, preorder_id, name, slug, status, offer_type, marketing_approach, discount_bps, budget_cap_idr,
      primary_kpi, target_additional_units, starts_at, ends_at, published_at, closed_at, active_blueprint_id, published_blueprint_id,
      baseline_json, baseline_calculated_at, metrics_schema_version, costs_completeness)
    select '${target.owner.businessId}', '${target.id}', 'Kampanye ${campaignCount}', '${slug}', '${status}', '${offerType}', '${approach}', ${discount}, 50000,
      'paid_units_in_window', 5, ${startsAt}, ${endsAt}, now() - interval '1 hour', ${status === "closed" ? "now() - interval '1 minute'" : "null"},
      blueprint.id, blueprint.id, '{}'::jsonb, now(), 1, 'unreviewed'
    from blueprint returning id;
    commit;`);
  return { id, slug };
}

let keyCount = 0;
function buyer(target: PreorderFixture, expectedUnitPriceIdr: number, extra: { quantity?: number; attributionRef?: string } = {}) {
  keyCount += 1;
  return publicOrderSchema.parse({ slug: target.slug, idempotencyKey: `${PREFIX}-key-${stamp}-${keyCount}-abcdef`, privateToken: createPrivateOrderToken(),
    customerName: "Pembeli", customerEmail: `${PREFIX}-buyer-${keyCount}@example.com`, customerContact: "", quantity: extra.quantity ?? 2,
    expectedUnitPriceIdr, attributionRef: extra.attributionRef ?? null });
}

async function order(target: PreorderFixture, expectedUnitPriceIdr: number, extra: { quantity?: number; attributionRef?: string } = {}) {
  const outcome = await placePublicOrder(service, buyer(target, expectedUnitPriceIdr, extra), 900);
  if (outcome.kind !== "ok") throw new Error(`order: ${outcome.violation}`);
  return outcome.value.orderId;
}

const offer = (preorderId: string) => sql(`select (read_preorder_offer->>'discount_bps') || '|' || (read_preorder_offer->>'final_unit_price_idr') || '|' || coalesce(read_preorder_offer->>'pricing_campaign_id', 'null')
  from public.read_preorder_offer('${preorderId}')`);
const orderRow = (id: string) => sql(`select o.subtotal_idr || '|' || o.discount_total_idr || '|' || o.total_idr || '|' || coalesce(o.pricing_campaign_id::text, 'null') || '|' || coalesce(o.attribution_campaign_id::text, 'null')
  || '|' || i.discount_bps_snapshot || '|' || i.final_unit_price_idr || '|' || coalesce(i.pricing_campaign_id::text, 'null')
  from public.orders o join public.order_items i on i.order_id = o.id where o.id = '${id}'`);
const orderCount = (preorderId: string) => sql(`select (select count(*) from public.orders where preorder_id = '${preorderId}') || '|' ||
  (select count(*) from public.capacity_reservations r join public.preorder_items i on i.id = r.preorder_item_id where i.preorder_id = '${preorderId}')`);

/** Satu sesi psql terpisah, untuk menahan kunci di transaksi lain. */
function session(query: string): Promise<{ code: number | null; stderr: string }> {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  child.stdin.end(query);
  return new Promise((done) => child.on("close", (code) => done({ code, stderr })));
}

describe("harga dari kampanye terbit", () => {
  it("tanpa kampanye: harga dasar, tanpa kampanye harga", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    expect(offer(target.id)).toBe("0|120000|null");
    expect((await findPublicPreorder(service, target.slug))?.unitPriceIdr).toBe(120000);
    expect(orderRow(await order(target, 120000))).toBe("240000|0|240000|null|null|0|120000|null");
  });

  it("diskon aktif: tampilan dan pesanan memakai harga yang sama, pembeli organik tanpa atribusi", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const active = campaign(target, { bps: 1000 });
    expect(offer(target.id)).toBe(`1000|108000|${active.id}`);
    const shown = await findPublicPreorder(service, target.slug);
    expect(shown?.unitPriceIdr).toBe(108000);
    expect(orderRow(await order(target, 108000))).toBe(`240000|24000|216000|${active.id}|null|1000|108000|${active.id}`);
  });

  it("link kampanye sah: atribusi tercatat terpisah, harga tetap sama dengan organik", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const active = campaign(target, { bps: 1000 });
    expect(orderRow(await order(target, 108000, { attributionRef: active.slug }))).toBe(`240000|24000|216000|${active.id}|${active.id}|1000|108000|${active.id}`);
  });

  it("harga yang dilihat sudah basi: OFFER_CHANGED tanpa pesanan atau reservasi", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    campaign(target, { bps: 1000 });
    const outcome = await placePublicOrder(service, buyer(target, 120000), 900);
    expect(outcome).toEqual({ kind: "rejected", violation: "OFFER_CHANGED" });
    expect(orderCount(target.id)).toBe("0|0");
  });

  it.each([
    ["belum mulai", { startsAt: "now() + interval '1 hour'" }],
    ["sudah lewat", { startsAt: "now() - interval '3 hours'", endsAt: "now() - interval '1 minute'" }],
    ["sudah ditutup", { status: "closed" as const }],
  ])("kampanye %s: harga dasar dan link tidak memberi atribusi", async (_label, options) => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const inactive = campaign(target, options);
    expect(offer(target.id)).toBe("0|120000|null");
    expect(orderRow(await order(target, 120000, { attributionRef: inactive.slug }))).toBe("240000|0|240000|null|null|0|120000|null");
  });

  it("kampanye harga normal: tidak mengklaim harga, link tetap memberi atribusi", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const normal = campaign(target, { offerType: "normal_price" });
    expect(offer(target.id)).toBe("0|120000|null");
    expect(orderRow(await order(target, 120000, { attributionRef: normal.slug }))).toBe(`240000|0|240000|null|${normal.id}|0|120000|null`);
    expect(orderRow(await order(target, 120000))).toBe("240000|0|240000|null|null|0|120000|null");
  });

  it("link palsu, milik preorder lain, atau milik usaha lain tidak memberi atribusi", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const active = campaign(target, { bps: 1000 });
    const otherPreorder = campaign(createPublishedPreorder(A, PREFIX, stamp), { bps: 500 });
    const otherBusiness = campaign(createPublishedPreorder(B, PREFIX, stamp), { bps: 500 });
    for (const ref of ["tidak-ada", otherPreorder.slug, otherBusiness.slug]) {
      expect(orderRow(await order(target, 108000, { attributionRef: ref }))).toBe(`240000|24000|216000|${active.id}|null|1000|108000|${active.id}`);
    }
  });

  it("pembulatan dan batas diskon mengikuti rumus C2", async () => {
    const small = createPublishedPreorder(cheap, PREFIX, stamp);
    campaign(small, { bps: 500 });
    expect(offer(small.id)).toMatch(/^500\|96\|/);
    expect(orderRow(await order(small, 96, { quantity: 3 }))).toMatch(/^303\|15\|288\|/);
    const deepest = createPublishedPreorder(A, PREFIX, stamp);
    campaign(deepest, { bps: 9999 });
    expect(offer(deepest.id)).toMatch(/^9999\|12\|/);
    const smallest = createPublishedPreorder(A, PREFIX, stamp);
    campaign(smallest, { bps: 1 });
    expect(offer(smallest.id)).toMatch(/^1\|119988\|/);
  });

  it("pesanan lama tetap snapshot dan ulangan permintaan mengembalikan pesanan yang sama setelah kampanye ditutup", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const active = campaign(target, { bps: 1000 });
    const input = buyer(target, 108000);
    const first = await placePublicOrder(service, input, 900);
    if (first.kind !== "ok") throw new Error("order");
    sql(`update public.campaigns set status = 'closed', closed_at = clock_timestamp() where id = '${active.id}'`);
    expect(offer(target.id)).toBe("0|120000|null");
    const replay = await placePublicOrder(service, input, 900);
    expect(replay).toMatchObject({ kind: "ok", value: { orderId: first.value.orderId, replayed: true } });
    expect(orderRow(first.value.orderId)).toBe(`240000|24000|216000|${active.id}|null|1000|108000|${active.id}`);
  });

  it("pesanan manual pemilik tetap harga dasar walau diskon aktif", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    campaign(target, { bps: 1000 });
    const outcome = await createManualOrder(A.client, { preorderId: target.id, idempotencyKey: crypto.randomUUID(), customerName: "Manual", customerEmail: null, customerContact: null, quantity: 1, paymentStatus: "paid" });
    if (outcome.kind !== "ok") throw new Error("manual");
    expect(orderRow(outcome.value.orderId)).toBe("120000|0|120000|null|null|0|120000|null");
  });

  it("kampanye ditutup bersamaan: pesanan menunggu lalu ditolak OFFER_CHANGED, tidak mendapat diskon kampanye yang sudah ditutup", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const active = campaign(target, { bps: 1000 });
    // Sesi lain mengunci baris kampanye untuk menutupnya, lalu menahan transaksi 2 detik sebelum commit.
    const closing = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { stdio: ["pipe", "ignore", "pipe"] });
    const closed = new Promise<number | null>((done) => closing.on("close", done));
    closing.stdin.end(`begin; update public.campaigns set status = 'closed', closed_at = clock_timestamp() where id = '${active.id}'; select pg_sleep(2); commit;`);
    await new Promise((done) => setTimeout(done, 500));
    const started = Date.now();
    const outcome = await placePublicOrder(service, buyer(target, 108000), 900);
    const waited = Date.now() - started;
    expect(await closed).toBe(0);
    expect(outcome).toEqual({ kind: "rejected", violation: "OFFER_CHANGED" });
    expect(waited).toBeGreaterThan(900);
    expect(orderCount(target.id)).toBe("0|0");
  });
});

describe("urutan kunci kampanye dan checkout", () => {
  it("tutup kampanye bersamaan dengan checkout tidak deadlock", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const active = campaign(target, { bps: 1000 });
    const version = sql(`select version from public.campaigns where id = '${active.id}'`);
    // Sesi checkout memakai urutan kunci create_preorder_order (preorder, lalu kapasitas) dengan jeda di tengah.
    const checkout = session(`begin;
      select 1 from public.preorders where id = '${target.id}' for share;
      select pg_sleep(1.5);
      select 1 from public.production_capacity where id = '${target.capacityId}' for update;
      commit;`);
    await sleep(500);
    // close_campaign dipanggil server sebagai service_role, sama seperti repository eksekusi.
    const close = session(`begin;
      set local role service_role;
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      select public.close_campaign('${A.businessId}', '${active.id}', ${version}, '${A.userId}');
      commit;`);
    const [checkoutResult, closeResult] = await Promise.all([checkout, close]);
    expect(`${checkoutResult.stderr}${closeResult.stderr}`).toBe("");
    expect([checkoutResult.code, closeResult.code]).toEqual([0, 0]);
    expect(sql(`select status from public.campaigns where id = '${active.id}'`)).toBe("closed");
  });
});
