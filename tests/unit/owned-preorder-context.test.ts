import { AuthSessionMissingError, createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildBusinessContext, BuildBusinessContextInputSchema } from "../../src/features/ai-context";
import { loadOwnedPreorderContext } from "../../src/features/ai-context/owned-preorder-context.server";
import { generateOwnedCampaignStrategies } from "../../src/features/campaign-strategist/owned-strategy.server";
import { revalidateStrategyProposal } from "../../src/features/campaign-strategist/strategy-service";
import { discussionFixture, replyFixture } from "../fixtures/campaign-strategist";
import type { StrategyPrompt } from "../../src/features/campaign-strategist/contracts";

const ids = {
  business: "22222222-2222-4222-8222-222222222221", product: "22222222-2222-4222-8222-222222222222",
  preorder: "22222222-2222-4222-8222-222222222223", item: "22222222-2222-4222-8222-222222222224",
  capacity: "22222222-2222-4222-8222-222222222225", owner: "22222222-2222-4222-8222-222222222226",
};
const now = () => "2026-11-02T03:00:00.000Z";
const scope = { businessId: ids.business, preorderId: ids.preorder };
function reservation(quantity: number, state: "held" | "allocated" | "released", options: {
  external?: "unpaid" | "confirmed" | "voided" | null; verified?: boolean; applied?: boolean;
  expired?: boolean; other?: boolean; cancelled?: boolean;
} = {}) {
  return { quantity, state, expires_at: state === "held" ? options.expired ? "2026-11-01T00:00:00Z" : "2026-11-03T00:00:00Z" : null,
    preorder_item_id: options.other ? null : ids.item,
    orders: { order_status: options.cancelled ? "cancelled" : "active", external_payment_status: options.external ?? null,
      payments: options.verified || options.applied ? [{ status: "paid_sandbox", verified_at: options.verified ? now() : null,
        applied_at: options.applied ? now() : null }] : [] } };
}
function sourceRow(reservations: ReturnType<typeof reservation>[] = [], cost: number | null = 12000) {
  return { id: ids.preorder, name: "Preorder nyata", slug: "actual", status: "published", fulfillment_date: "2026-11-07",
    starts_at: "2026-11-01T00:00:00+00:00", ends_at: "2026-11-06T11:00:00+00:00", version: 3,
    pickup_terms_snapshot: { pickup_instructions: "Ambil di toko", public_contact: null,
      intake_cutoff_at: "2026-11-06T11:00:00+00:00", fulfillment_window_end_at: "2026-11-07T10:00:00+00:00" },
    businesses: { id: ids.business, name: "Usaha aktual", categories: ["Katering", "Makanan & minuman"], description: "Usaha preorder" },
    preorder_items: [{ id: ids.item, product_id: ids.product, capacity_id: ids.capacity, target_units: 30, quota_units: 50,
      base_price_snapshot_idr: 25000, product_name_snapshot: "Produk beku", version: 4,
      products: { description: "Deskripsi aktual", base_price_idr: 30000, variable_cost_idr: cost,
        cost_quality: "estimated", is_active: true, version: 5 },
      production_capacity: { total_units: 60, intake_cutoff_at: "2026-11-06T11:00:00+00:00",
        fulfillment_window_end_at: "2026-11-07T10:00:00+00:00", version: 6, capacity_reservations: reservations } }],
  };
}
const campaignId = "22222222-2222-4222-8222-222222222227";
const campaignRow = { id: campaignId, version: 2, status: "published", starts_at: "2026-11-01T12:00:00+00:00",
  ends_at: "2026-11-05T11:00:00+00:00", published_at: "2026-11-01T12:00:00+00:00" };
function setup(row = sourceRow(), options: { unauthenticated?: boolean; foreign?: boolean; readFailed?: boolean; campaign?: boolean; campaignHidden?: boolean } = {}) {
  const calls: string[] = [];
  const offer = { discountBps: options.campaign ? 1000 : 0 };
  // Same shape as the SQL resolver read_preorder_offer; the price follows the row so price changes stay observable.
  const readOffer = async () => { const base = row.preorder_items[0].base_price_snapshot_idr;
    return { discount_bps: offer.discountBps, pricing_campaign_id: options.campaign ? campaignId : null,
      final_unit_price_idr: base - Math.floor(base * offer.discountBps / 10000) }; };
  const client = createClient("http://127.0.0.1:1", "test-only", { auth: { persistSession: false }, global: { fetch: async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.pathname);
    if (options.readFailed) return new Response(JSON.stringify({ message: "read failed", code: "TEST" }), { status: 400 });
    const data = url.pathname.endsWith("/business_members") ? [{ business_id: options.foreign ? ids.capacity : ids.business }]
      : url.pathname.endsWith("/campaigns") ? options.campaign && !options.campaignHidden ? [campaignRow] : []
        : url.pathname.endsWith("/preorders") && url.searchParams.get("id") === `eq.${ids.preorder}` ? [row] : [];
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  } } });
  vi.spyOn(client.auth, "getUser").mockResolvedValue(options.unauthenticated
    ? { data: { user: null }, error: new AuthSessionMissingError() }
    : { data: { user: { id: ids.owner, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: now() } }, error: null });
  return { client, calls, row, readOffer };
}
async function built(test: ReturnType<typeof setup>) {
  const input = await loadOwnedPreorderContext(test.client, scope, now, test.readOffer);
  const context = buildBusinessContext(input);
  if (!context.success) throw new Error(context.errors[0].code);
  return { input, context: context.data };
}
const fake = (prompt: StrategyPrompt) => ({ success: true as const, text: JSON.stringify({ ...replyFixture,
  contextHash: z.object({ contextBinding: z.object({ contextHash: z.string() }) }).parse(JSON.parse(prompt.input)).contextBinding.contextHash }), model: "test-only", requestId: null });

describe("owned real C1 projection and downstream seam", () => {
  it("maps owned business/categories, frozen price, actual capacity/quota, schedules and all source revisions", async () => {
    const { input, context } = await built(setup());
    expect(BuildBusinessContextInputSchema.safeParse(input).success).toBe(true);
    expect(context.business).toMatchObject({ businessId: ids.business, category: "Katering", categories: ["Katering", "Makanan & minuman"] });
    expect(context.product).toMatchObject({ productId: ids.product, name: "Produk beku", variableCostIdr: 12000 });
    expect(context.preorder).toMatchObject({ preorderItemId: ids.item, baseUnitPriceIdr: 25000, targetUnits: 30, quotaUnits: 50,
      paidUnits: 0, heldUnits: 0, allocatedUnits: 0, orderableUnits: 50, startsAt: "2026-11-01T00:00:00.000Z" });
    expect(context.capacity).toEqual({ capacityId: ids.capacity, totalUnits: 60, allocatedUnits: 0, heldUnits: 0, availableUnits: 60, version: 6 });
    expect(context.metadata.sources.c1).toMatchObject({ provenance: "server", preorderVersion: 3, preorderItemVersion: 4, productVersion: 5, capacityVersion: 6 });
    expect(context.analytics.status).toBe("unavailable");
    expect(context.history.status).toBe("not_requested");
  });

  it.each([6, 12000, 0, null])("preserves known/estimated/unknown cost %s", async (cost) => {
    const t = setup(); t.row.preorder_items[0].products.variable_cost_idr = cost;
    t.row.preorder_items[0].products.cost_quality = cost === null ? "unknown" : cost === 6 ? "verified" : "estimated";
    const { context } = await built(t);
    expect(context.product.variableCostIdr).toBe(cost);
  });

  it("does not repair inconsistent unknown cost to an invented zero", async () => {
    const t = setup(); t.row.preorder_items[0].products.cost_quality = "unknown";
    await expect(built(t)).rejects.toThrow();
  });

  it("separates paid/manual-unpaid/live hold/expired/released/other-capacity commitments", async () => {
    const t = setup(sourceRow([reservation(5, "allocated", { external: "confirmed" }), reservation(4, "allocated", { external: "unpaid" }),
      reservation(3, "held"), reservation(8, "held", { expired: true }), reservation(9, "released"),
      reservation(20, "allocated", { other: true, external: "unpaid" })]));
    const { context } = await built(t);
    expect(context.preorder).toMatchObject({ paidUnits: 5, allocatedUnits: 9, heldUnits: 3, orderableUnits: 28, paidTargetGapUnits: 25 });
    expect(context.capacity).toMatchObject({ allocatedUnits: 29, heldUnits: 3, availableUnits: 28 });
  });

  it("NULL external payment is awaiting until a verified applied payment exists; review is not paid", async () => {
    const { context } = await built(setup(sourceRow([reservation(2, "allocated"), reservation(3, "allocated", { verified: true }),
      reservation(4, "allocated", { verified: true, applied: true }), reservation(5, "allocated", { external: "confirmed", cancelled: true })])));
    expect(context.preorder).toMatchObject({ allocatedUnits: 14, paidUnits: 4, orderableUnits: 36 });
  });

  it.each([{ unauthenticated: true }, { foreign: true }, { readFailed: true }])("rejects unauthorized or failed reads without demo fallback %j", async (options) => {
    const t = setup(sourceRow(), options);
    await expect(loadOwnedPreorderContext(t.client, scope, now, t.readOffer)).rejects.toThrow();
    expect(t.calls.filter(c => c.endsWith("/preorders"))).toHaveLength(0);
  });

  it("rejects an unknown/foreign preorder after owner membership verification", async () => {
    const t = setup();
    await expect(loadOwnedPreorderContext(t.client, { ...scope, preorderId: ids.capacity }, now, t.readOffer)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uses the SQL offer of the active published campaign instead of blocking new discussions", async () => {
    const t = setup(sourceRow(), { campaign: true });
    const { context } = await built(t);
    expect(context.effectiveOffer).toMatchObject({ state: "active", offer: { offerType: "percent_discount", discountBps: 1000 }, unitPriceIdr: 22500,
      campaign: { campaignId, version: 2, status: "published" } });
    expect(context.metadata.sources.c8.offerVersion).toBe(`campaign:${campaignId}:v2`);
  });

  it("rejects a pricing campaign the owner session cannot read", async () => {
    const t = setup(sourceRow(), { campaign: true, campaignHidden: true });
    await expect(loadOwnedPreorderContext(t.client, scope, now, t.readOffer)).rejects.toMatchObject({ code: "INVALID_SOURCE" });
  });

  it("rejects a malformed SQL offer instead of inventing a normal price", async () => {
    const t = setup();
    await expect(loadOwnedPreorderContext(t.client, scope, now, async () => ({ discount_bps: 0 }))).rejects.toMatchObject({ code: "READ_FAILED" });
  });

  it("stable hashes ignore read time; changed price/cost/category/capacity/commitments invalidate proposals", async () => {
    const t = setup(); const before = await built(t);
    const later = await loadOwnedPreorderContext(t.client, scope, () => "2026-11-02T03:00:01.000Z", t.readOffer);
    expect(buildBusinessContext(later)).toMatchObject({ success: true, data: { contextHash: before.context.contextHash } });
    t.row.preorder_items[0].production_capacity.capacity_reservations.push(reservation(1, "allocated", { external: "unpaid" }));
    expect((await built(t)).context.contextHash).not.toBe(before.context.contextHash);
  });

  it.each(["price", "cost", "categories", "capacity"])("material %s changes update the hash even when quota remains the limiting factor", async (fact) => {
    const t = setup(); const before = await built(t);
    if (fact === "price") t.row.preorder_items[0].base_price_snapshot_idr++;
    if (fact === "cost") t.row.preorder_items[0].products.variable_cost_idr = 11000;
    if (fact === "categories") t.row.businesses.categories.push("Kue & camilan");
    if (fact === "capacity") t.row.preorder_items[0].production_capacity.total_units = 70;
    expect((await built(t)).context.contextHash).not.toBe(before.context.contextHash);
  });

  it("real producer reaches actual prompt/simulator and Blueprint-compatible source revalidation", async () => {
    const t = setup(); const initial = await built(t); let promptText = "";
    const provider = { generate: vi.fn(async (prompt: StrategyPrompt) => { promptText = prompt.input; return fake(prompt); }) };
    const result = await generateOwnedCampaignStrategies(t.client, { ...discussionFixture, ...scope, expectedContextHash: initial.context.contextHash }, provider, now, t.readOffer);
    expect(result.success).toBe(true);
    expect(promptText).toContain('"totalUnits":60');
    expect(promptText).toContain('"baseUnitPriceIdr":25000');
    expect(promptText).not.toContain('"provenance":"development_fixture"');
    if (!result.success) throw new Error(result.error.code);
    expect(result.data.options[0].computedScenario.hypotheticalFinalUnitPriceIdr).toBe(25000);
    t.row.preorder_items[0].products.version++;
    expect(revalidateStrategyProposal(result.data, (await built(t)).input, now())).toMatchObject({ success: false, error: { code: "STALE_CONTEXT" } });
  });

  it("changed source during generation rejects the result and never calls a live provider", async () => {
    const t = setup(); const initial = await built(t);
    const result = await generateOwnedCampaignStrategies(t.client, { ...discussionFixture, ...scope, expectedContextHash: initial.context.contextHash },
      { generate: async prompt => { t.row.preorder_items[0].products.version++; return fake(prompt); } }, now, t.readOffer);
    expect(result).toMatchObject({ success: false, error: { code: "STALE_CONTEXT" } });
  });

  it.each([12000, 0, null])("existing simulator computes contribution for cost %s without fabricated profit", async (cost) => {
    const t = setup(sourceRow([], cost));
    t.row.preorder_items[0].products.cost_quality = cost === null ? "unknown" : "estimated";
    const initial = await built(t);
    const result = await generateOwnedCampaignStrategies(t.client, { ...discussionFixture, ...scope, expectedContextHash: initial.context.contextHash },
      { generate: async prompt => fake(prompt) }, now, t.readOffer);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.code);
    expect(result.data.options[0].computedScenario.scenarioContributionIdr).toBe(cost === null ? null : (25000 - cost) * 4 - 10000);
  });

  it("generated financial fields cannot override server calculations", async () => {
    const t = setup(); const initial = await built(t);
    const result = await generateOwnedCampaignStrategies(t.client, { ...discussionFixture, ...scope, expectedContextHash: initial.context.contextHash },
      { generate: async prompt => {
        const reply = z.object({ contextBinding: z.object({ contextHash: z.string() }) }).parse(JSON.parse(prompt.input));
        return { success: true, model: "test-only", requestId: null, text: JSON.stringify({ ...replyFixture,
          contextHash: reply.contextBinding.contextHash, options: [{ ...replyFixture.options[0],
            computedScenario: { hypotheticalFinalUnitPriceIdr: 1 } }] }) };
      } }, now, t.readOffer);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.code);
    expect(result.data.options).toHaveLength(0);
  });
});
