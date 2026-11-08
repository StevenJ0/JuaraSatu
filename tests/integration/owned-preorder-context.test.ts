import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildBusinessContext } from "../../src/features/ai-context";
import { loadOwnedPreorderContext } from "../../src/features/ai-context/owned-preorder-context.server";
import { generateOwnedCampaignStrategies } from "../../src/features/campaign-strategist/owned-strategy.server";
import { revalidateStrategyProposal } from "../../src/features/campaign-strategist/strategy-service";
import { blueprintFacts } from "../../src/features/campaign-blueprint/blueprint-domain";
import { discussionFixture, replyFixture } from "../fixtures/campaign-strategist";
import type { StrategyPrompt } from "../../src/features/campaign-strategist/contracts";

// Opt-in only: never imports tests/supabase/helpers or its normal-stack credentials/setup.
const workdir = process.env.CAMPAIGN_LAB_P12_WORKDIR;
describe.skipIf(!workdir)("P1-2 real isolated Supabase → existing Strategist", () => {
  let owner: SupabaseClient;
  let foreign: SupabaseClient;
  let anon: SupabaseClient;
  let service: SupabaseClient;
  let scope: { businessId: string; preorderId: string };
  let productId: string;
  let capacityId: string;
  let slug: string;
  let basePrice: number;
  let initialProduct: { base_price_idr: number; variable_cost_idr: number | null; cost_quality: string };
  const evidence: string[] = [];
  const productSchema = z.object({ base_price_idr: z.number(), variable_cost_idr: z.number().nullable(), cost_quality: z.string(), version: z.number() });
  const orderSchema = z.object({ order_id: z.uuid() });
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const clock = () => new Date().toISOString();
  function record(value: string) { evidence.push(value); }
  async function context(client = owner) {
    const input = await loadOwnedPreorderContext(client, scope, clock);
    const result = buildBusinessContext(input);
    if (!result.success) throw new Error(result.errors[0].code);
    return { input, data: result.data };
  }
  async function product() {
    const result = await owner.from("products").select("base_price_idr,variable_cost_idr,cost_quality,version").eq("id", productId).single();
    if (result.error) throw new Error(result.error.code);
    return productSchema.parse(result.data);
  }
  async function editProduct(values: { base_price_idr: number; variable_cost_idr: number | null; cost_quality: string }) {
    const current = await product();
    const result = await owner.from("products").update({ base_price_idr: values.base_price_idr,
      variable_cost_idr: values.variable_cost_idr, cost_quality: values.cost_quality })
      .eq("id", productId).eq("version", current.version).select("id").single();
    if (result.error) throw new Error(result.error.code);
  }
  async function ownedRpc(name: string, args: Record<string, string | number | boolean | null>, client = owner) {
    const result = await client.rpc(name, args);
    if (result.error) throw new Error(`${name}:${result.error.code}`);
    return orderSchema.parse(result.data);
  }
  beforeAll(async () => {
    assert(workdir);
    const project = "cl-mvp-72e87c9aa2bc";
    const manifest = z.array(z.object({ id: z.string(), name: z.string() })).parse(JSON.parse(readFileSync(join(workdir, "environment-manifest.json"), "utf8")));
    const inspect = spawnSync("docker", ["--host", "npipe:////./pipe/dockerDesktopLinuxEngine", "inspect", ...manifest.map(c => c.id)], { encoding: "utf8", windowsHide: true });
    assert.equal(inspect.status, 0, "Isolated Docker identity unavailable");
    const containers = z.array(z.object({ Config: z.object({ Labels: z.record(z.string(), z.string()) }),
      State: z.object({ Running: z.boolean() }),
      Mounts: z.array(z.object({ Type: z.string(), Name: z.string().optional() })),
      NetworkSettings: z.object({ Networks: z.record(z.string(), z.unknown()),
        Ports: z.record(z.string(), z.array(z.object({ HostIp: z.string() })).nullable()) }) })).parse(JSON.parse(inspect.stdout));
    assert.equal(containers.length, 8);
    for (const c of containers) {
      assert.equal(c.Config.Labels["com.supabase.cli.project"], project);
      assert(c.State.Running);
      assert.deepEqual(Object.keys(c.NetworkSettings.Networks), [`supabase_network_${project}`]);
      assert(c.Mounts.every(m => m.Type !== "volume" || m.Name?.includes(project)));
      assert(Object.values(c.NetworkSettings.Ports).filter(p => p !== null).flat().every(p => p.HostIp === "127.0.0.1"));
    }
    const state = z.object({ API_URL: z.literal("http://127.0.0.1:56321"), ANON_KEY: z.string().min(1), SERVICE_ROLE_KEY: z.string().min(1) })
      .parse(JSON.parse(readFileSync(join(workdir, "platform-status.private.json"), "utf8")));
    const accounts = z.array(z.object({ email: z.string(), password: z.string(), id: z.uuid() })).min(2)
      .parse(JSON.parse(readFileSync(join(workdir, "owner-verified-accounts.private.json"), "utf8")));
    const identities = z.object({ ownerA: z.uuid(), ownerB: z.uuid(), businessId: z.uuid(), productId: z.uuid(), capacityId: z.uuid(), preorderId: z.uuid() })
      .parse(JSON.parse(readFileSync(join(workdir, "smoke-identities.json"), "utf8")));
    assert.equal(identities.ownerA, accounts[0].id);
    scope = { businessId: identities.businessId, preorderId: identities.preorderId };
    productId = identities.productId; capacityId = identities.capacityId;
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    owner = createClient(state.API_URL, state.ANON_KEY, options); foreign = createClient(state.API_URL, state.ANON_KEY, options);
    anon = createClient(state.API_URL, state.ANON_KEY, options); service = createClient(state.API_URL, state.SERVICE_ROLE_KEY, options);
    for (const [index, client] of [owner, foreign].entries()) {
      const result = await client.auth.signInWithPassword({ email: accounts[index].email, password: accounts[index].password });
      assert.equal(result.error, null, "Real Auth login failed");
      assert.equal(result.data.user?.id, accounts[index].id);
    }
    const preorder = await owner.from("preorders").select("slug,status").eq("id", scope.preorderId).single();
    const actual = z.object({ slug: z.string(), status: z.literal("published") }).parse(preorder.data);
    slug = actual.slug; initialProduct = await product();
    basePrice = (await context()).data.preorder.baseUnitPriceIdr;
    record("Identity: same eight P1-1 containers/network/volumes/loopback; real owner A/B Auth; no normal DB access");
  });

  afterAll(async () => {
    if (owner && initialProduct) {
      const current = await product();
      if (current.base_price_idr !== initialProduct.base_price_idr || current.variable_cost_idr !== initialProduct.variable_cost_idr || current.cost_quality !== initialProduct.cost_quality) {
        await editProduct(initialProduct);
      }
    }
    if (workdir) writeFileSync(join(workdir, "p12-real-context-results.json"), JSON.stringify({ evidence, provider: "mock only", originalDatabaseAccessed: false }, null, 2));
  });

  it("loads the actual P1-1 records and passes them into the schema and existing Blueprint facts consumer", async () => {
    const loaded = await context();
    expect(loaded.data.business.businessId).toBe(scope.businessId);
    expect(loaded.data.product.productId).toBe(productId);
    const item = await owner.from("preorder_items").select("id,version,base_price_snapshot_idr,quota_units,target_units").eq("preorder_id", scope.preorderId).single();
    const actual = z.object({ id: z.uuid(), version: z.number(), base_price_snapshot_idr: z.number(), quota_units: z.number(), target_units: z.number() }).parse(item.data);
    expect(loaded.data.preorder).toMatchObject({ preorderItemId: actual.id, baseUnitPriceIdr: actual.base_price_snapshot_idr,
      quotaUnits: actual.quota_units, targetUnits: actual.target_units });
    expect(loaded.data.product.variableCostIdr).toBe(initialProduct.variable_cost_idr);
    expect(loaded.data.metadata.sources.c1).toMatchObject({ provenance: "server", preorderItemVersion: actual.version });
    expect(blueprintFacts(loaded.input, clock()).contextHash).toBe(loaded.data.contextHash);
    record(`Owned readback: preorder ${scope.preorderId}; frozen price/cost/quota/target match actual rows; Blueprint facts accepted`);
  });

  it("uses real manual paid/unpaid, live/expired held, and shared-capacity commitments without a payment provider", async () => {
    const prefix = `p12-${scope.preorderId}`;
    for (const [label, quantity, paid] of [["paid", 3, true], ["unpaid", 4, false]] as const) {
      await ownedRpc("create_manual_order", { p_preorder_id: scope.preorderId, p_quantity: quantity, p_is_paid: paid,
        p_customer_name: "P1-2 Synthetic", p_customer_email: null, p_customer_contact: null,
        p_idempotency_key: `${prefix}-${label}`, p_request_hash: hash(`${prefix}-${label}`) });
    }
    await ownedRpc("create_standalone_manual_order", { p_capacity_id: capacityId, p_quantity: 12, p_is_paid: false,
      p_customer_name: "P1-2 Shared Capacity", p_customer_email: null, p_customer_contact: null,
      p_idempotency_key: `${prefix}-other`, p_request_hash: hash(`${prefix}-other`) });
    for (const [label, quantity, ttl] of [["expired", 5, 1], ["live", 2, 3600]] as const) {
      await ownedRpc("create_preorder_order", { p_slug: slug, p_quantity: quantity,
        p_customer_name: "P1-2 Synthetic Hold", p_customer_email: "p12-hold@example.test", p_customer_contact: null,
        p_token_hash: hash(`${prefix}-${label}-token`), p_idempotency_key: `${prefix}-${label}`,
        p_request_hash: hash(`${prefix}-${label}`), p_expected_unit_price_idr: basePrice, p_hold_ttl_seconds: ttl,
        p_attribution_ref: null }, service);
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
    const loaded = await context();
    const raw = await owner.from("capacity_reservations").select("state,quantity,expires_at,preorder_item_id,orders(order_status,external_payment_status,payments(status,verified_at,applied_at))").eq("capacity_id", capacityId);
    const rows = z.array(z.object({ state: z.string(), quantity: z.number(), expires_at: z.string().nullable(), preorder_item_id: z.string().nullable(),
      orders: z.object({ order_status: z.string(), external_payment_status: z.string().nullable(), payments: z.array(z.object({
        status: z.string(), verified_at: z.string().nullable(), applied_at: z.string().nullable() })) }) })).parse(raw.data);
    const capacityRow = await owner.from("production_capacity").select("total_units").eq("id", capacityId).single();
    const capacity = z.object({ total_units: z.number() }).parse(capacityRow.data);
    const itemRow = await owner.from("preorder_items").select("id,quota_units,target_units").eq("preorder_id", scope.preorderId).single();
    const item = z.object({ id: z.uuid(), quota_units: z.number(), target_units: z.number() }).parse(itemRow.data);
    const allocated = rows.filter(r => r.state === "allocated").reduce((n, r) => n + r.quantity, 0);
    const held = rows.filter(r => r.state === "held" && r.expires_at !== null && Date.parse(r.expires_at) > Date.now()).reduce((n, r) => n + r.quantity, 0);
    const own = rows.filter(r => r.preorder_item_id === item.id);
    const ownAllocated = own.filter(r => r.state === "allocated").reduce((n, r) => n + r.quantity, 0);
    const ownHeld = own.filter(r => r.state === "held" && r.expires_at !== null && Date.parse(r.expires_at) > Date.now()).reduce((n, r) => n + r.quantity, 0);
    const paid = own.filter(r => r.state === "allocated" && !["cancelled", "expired"].includes(r.orders.order_status) &&
      (r.orders.external_payment_status === "confirmed" || r.orders.payments.some(p => p.status === "paid_sandbox" && p.verified_at && p.applied_at)))
      .reduce((n, r) => n + r.quantity, 0);
    const available = Math.max(capacity.total_units - allocated - held, 0);
    expect(loaded.data.preorder).toMatchObject({ allocatedUnits: ownAllocated, paidUnits: paid, heldUnits: ownHeld,
      orderableUnits: Math.max(Math.min(available, item.quota_units - ownAllocated - ownHeld), 0), paidTargetGapUnits: Math.max(item.target_units - paid, 0) });
    expect(loaded.data.capacity).toMatchObject({ totalUnits: capacity.total_units, allocatedUnits: allocated, heldUnits: held, availableUnits: available });
    record(`Persisted fixtures: paid manual 3, unpaid 4, shared 12, live hold 2; expired hold 5 excluded. DB readback: capacity ${capacity.total_units}, allocated ${allocated}, held ${held}, paid ${paid}, orderable ${loaded.data.preorder.orderableUnits}`);
  });

  it("rejects foreign/anonymous/unknown scope using real Auth and RLS", async () => {
    await expect(context(foreign)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(context(anon)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const member = await foreign.from("business_members").select("business_id").eq("role", "owner").single();
    const business = z.object({ business_id: z.uuid() }).parse(member.data);
    await expect(loadOwnedPreorderContext(foreign, { businessId: business.business_id, preorderId: scope.preorderId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(loadOwnedPreorderContext(owner, { ...scope, preorderId: "00000000-0000-4000-8000-000000000001" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    record("Real identity/RLS: foreign business/forged scope, unknown preorder and no-session rejected");
  });

  it("frozen price survives a catalog edit; unknown cost stays null and changes the source/hash", async () => {
    const before = await context();
    try {
      await editProduct({ base_price_idr: initialProduct.base_price_idr + 1, variable_cost_idr: null, cost_quality: "unknown" });
      const changed = await context();
      expect(changed.data.preorder.baseUnitPriceIdr).toBe(basePrice);
      expect(changed.data.product).toMatchObject({ variableCostIdr: null, costQuality: "unknown" });
      expect(changed.data.contextHash).not.toBe(before.data.contextHash);
      expect(changed.data.metadata.sources.c1.productVersion).toBeGreaterThan(before.data.metadata.sources.c1.productVersion);
      record("Owner-scoped product CAS edit: mutable catalog price changed, frozen price unchanged; unknown cost null; source revision/hash changed");
    } finally { await editProduct(initialProduct); }
  });

  it("actual Strategist consumes real prompt/financial facts and rejects a real mid-generation source change", async () => {
    const initial = await context();
    const reply = (prompt: StrategyPrompt) => {
      const binding = z.object({ contextBinding: z.object({ contextHash: z.string() }), authoritativeFacts: z.object({
        capacity: z.object({ totalUnits: z.number() }), preorder: z.object({ baseUnitPriceIdr: z.number() }) }) }).parse(JSON.parse(prompt.input));
      expect(binding.authoritativeFacts.capacity.totalUnits).toBe(initial.data.capacity?.totalUnits);
      expect(binding.authoritativeFacts.preorder.baseUnitPriceIdr).toBe(basePrice);
      const option = { ...replyFixture.options[0], assumedAdditionalUnits: 1, assumedPromotionCostIdr: 0,
        startsAt: clock(), endsAt: initial.data.preorder.endsAt };
      return { success: true as const, text: JSON.stringify({ ...replyFixture, contextHash: binding.contextBinding.contextHash,
        reply: "Berikut rancangan yang perlu ditinjau pemilik.", options: [option] }), model: "p12-mock", requestId: null };
    };
    const input = { ...discussionFixture, ...scope, expectedContextHash: initial.data.contextHash };
    const result = await generateOwnedCampaignStrategies(owner, input, { generate: async prompt => reply(prompt) }, clock);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.code);
    expect(result.data.options[0].computedScenario.hypotheticalFinalUnitPriceIdr).toBe(basePrice);
    try {
      const stale = await generateOwnedCampaignStrategies(owner, input, { generate: async prompt => {
        await editProduct({ ...initialProduct, variable_cost_idr: null, cost_quality: "unknown" });
        return reply(prompt);
      } }, clock);
      expect(stale).toMatchObject({ success: false, error: { code: "STALE_CONTEXT" } });
      expect(revalidateStrategyProposal(result.data, (await context()).input, clock())).toMatchObject({ success: false, error: { code: "STALE_CONTEXT" } });
    } finally { await editProduct(initialProduct); }
    record("Existing generateCampaignStrategies → real buildStrategyPrompt/simulator accepted owned facts; mocked provider only; mid-generation DB edit and old proposal rejected STALE_CONTEXT");
  });
});
