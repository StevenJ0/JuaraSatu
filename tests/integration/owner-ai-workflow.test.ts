import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { CampaignRowSchema, BlueprintRowSchema } from "../../src/features/campaign-blueprint/contracts";
import { DiscussionViewSchema } from "../../src/features/campaign-strategist/persistence-contracts";
import { ExecutionViewSchema } from "../../src/features/campaign-execution/contracts";

// Opt-in: only the positively identified P1-1 stack; no normal-stack test helpers.
const workdir = process.env.CAMPAIGN_LAB_P13_WORKDIR;
const base = "http://127.0.0.1:3301";
const View = z.object({ campaign: CampaignRowSchema, active: BlueprintRowSchema, history: z.array(BlueprintRowSchema) });
describe.skipIf(!workdir)("P1-3 real owner HTTP, persistence and isolation", () => {
  let ownerCookie: string, foreignCookie: string, preorderId: string, campaignId: string, sessionId: string;
  let service: SupabaseClient;
  let saved: z.infer<typeof View>;
  const json = (name: string): unknown => JSON.parse(readFileSync(join(workdir!, name), "utf8"));
  async function request(path: string, cookie = ownerCookie, body?: unknown, origin: string | null = base) {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (cookie) headers.set("Cookie", cookie);
    if (origin) headers.set("Origin", origin);
    const response = await fetch(base + "/api/owner/" + path, { headers, method: body ? "POST" : "GET",
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as unknown };
  }
  const approve = () => ({ action: "approve", campaignId, blueprintId: saved.active.id,
    expectedBlueprintVersion: saved.active.version, expectedCampaignVersion: saved.campaign.version, confirm: true });
  beforeAll(async () => {
    assert(workdir);
    const manifest = z.array(z.object({ id: z.string() })).parse(json("environment-manifest.json"));
    const result = spawnSync("docker", ["--host", "npipe:////./pipe/dockerDesktopLinuxEngine", "inspect", ...manifest.map(c => c.id)], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, "Cannot verify isolated Docker identity");
    const containers = z.array(z.object({ Config: z.object({ Labels: z.record(z.string(), z.string()) }), State: z.object({ Running: z.boolean() }),
      Mounts: z.array(z.object({ Type: z.string(), Name: z.string().optional() })), NetworkSettings: z.object({ Networks: z.record(z.string(), z.unknown()),
        Ports: z.record(z.string(), z.array(z.object({ HostIp: z.string() })).nullable()) }) })).parse(JSON.parse(result.stdout));
    assert.equal(containers.length, 8);
    for (const c of containers) {
      assert.equal(c.Config.Labels["com.supabase.cli.project"], "cl-mvp-72e87c9aa2bc"); assert(c.State.Running);
      assert.deepEqual(Object.keys(c.NetworkSettings.Networks), ["supabase_network_cl-mvp-72e87c9aa2bc"]);
      assert(c.Mounts.every(m => m.Type !== "volume" || m.Name?.includes("cl-mvp-72e87c9aa2bc")));
      assert(Object.values(c.NetworkSettings.Ports).filter(p => p !== null).flat().every(p => p.HostIp === "127.0.0.1"));
    }
    const state = z.object({ API_URL: z.literal("http://127.0.0.1:56321"), ANON_KEY: z.string(), SERVICE_ROLE_KEY: z.string() }).parse(json("platform-status.private.json"));
    const accounts = z.array(z.object({ email: z.string(), password: z.string(), id: z.uuid() })).min(2).parse(json("owner-verified-accounts.private.json"));
    const ids = z.object({ preorderId: z.uuid() }).parse(json("smoke-identities.json")); preorderId = ids.preorderId;
    ({ campaignId, sessionId } = z.object({ campaignId: z.uuid(), sessionId: z.uuid() }).parse(json("p13-workflow-identities.json")));
    const cookies: string[] = [];
    for (const account of accounts.slice(0, 2)) {
      const jar = new Map<string, string>();
      const client = createServerClient(state.API_URL, state.ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: values => { for (const c of values) jar.set(c.name, c.value); } } });
      const auth = await client.auth.signInWithPassword({ email: account.email, password: account.password });
      assert.equal(auth.error, null); assert.equal(auth.data.user?.id, account.id);
      cookies.push([...jar].map(([name, value]) => `${name}=${value}`).join("; "));
    }
    [ownerCookie, foreignCookie] = cookies;
    service = createClient(state.API_URL, state.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const read = await request(`blueprints?campaignId=${campaignId}`); assert.equal(read.status, 200); saved = View.parse(read.body);
  }, 60000);

  it("requires SSR auth; bearer and development cookies cannot substitute", async () => {
    for (const path of ["discussions", "blueprints", "campaigns"]) {
      expect((await request(path, "")).status).toBe(401);
      const response = await fetch(`${base}/api/owner/${path}`, { headers: { Authorization: "Bearer development-test-token", Cookie: "campaign_discussion_session=development-test-token" } });
      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain("application/json");
    }
  });
  it("rejects missing/foreign mutation Origin and foreign/missing/invalid preorders", async () => {
    const create = { action: "create", preorderId };
    expect((await request("discussions", ownerCookie, create, null)).status).toBe(403);
    expect((await request("discussions", ownerCookie, create, "https://foreign.example")).status).toBe(403);
    expect((await request("discussions", foreignCookie, create)).status).toBe(404);
    expect((await request("discussions", ownerCookie, { ...create, preorderId: randomUUID() })).status).toBe(404);
    expect((await request("discussions", ownerCookie, { action: "create" })).status).toBe(400);
  });
  it("denies foreign discussion, Blueprint, execution and approval", async () => {
    for (const path of [`discussions?sessionId=${sessionId}`, `blueprints?campaignId=${campaignId}`, `campaigns?campaignId=${campaignId}`]) {
      expect([403, 404]).toContain((await request(path, foreignCookie)).status);
    }
    expect([403, 404]).toContain((await request("blueprints", foreignCookie, approve())).status);
    const list = await request("discussions"); expect(list.status).toBe(200);
    expect(z.object({ campaigns: z.array(z.object({ id: z.uuid(), sessionId: z.uuid() })) }).parse(list.body).campaigns)
      .toContainEqual(expect.objectContaining({ id: campaignId, sessionId }));
  });
  it("persists real source, manual edits, approval and one execution task", async () => {
    expect(saved.active.approval_status).toBe("approved"); expect(saved.active.version).toBe(2);
    expect(saved.active.blueprint_json).toMatchObject({ synthetic: false, preorderId, budgetCapIdr: 2000, targetAdditionalUnits: 3,
      provider: "manual", financial: { frozenBasePriceIdr: 25000, variableCostIdr: 12000, costQuality: "estimated" } });
    const again = View.parse((await request(`blueprints?campaignId=${campaignId}`)).body);
    expect(again.active.id).toBe(saved.active.id); expect(again.history).toHaveLength(2);
    const execution = ExecutionViewSchema.parse((await request(`campaigns?campaignId=${campaignId}`)).body);
    expect(execution.synthetic).toBe(false); expect(execution.campaign.status).toBe("draft");
    expect(execution.blueprint?.id).toBe(saved.active.id); expect(execution.calendar.progress.total).toBe(1);
    expect(execution.contents).toHaveLength(1);
  });
  it("keeps real admission, mock provenance and manual-save provider counts truthful", async () => {
    const discussion = DiscussionViewSchema.parse(z.object({ session: DiscussionViewSchema }).parse((await request(`discussions?sessionId=${sessionId}`)).body).session);
    expect(discussion.preorderId).toBe(preorderId); expect(discussion.generations.filter(g => g.status === "success")).toHaveLength(1);
    const generations = await service.from("ai_generations").select("generation_type,status,model_id,request_key").eq("business_id", saved.campaign.business_id);
    assert.equal(generations.error, null);
    const rows = z.array(z.object({ generation_type: z.string(), status: z.string(), model_id: z.string(), request_key: z.string() })).parse(generations.data);
    expect(rows.filter(g => g.request_key === saved.active.blueprint_json.revision.requestId)).toHaveLength(0);
    expect(rows).toContainEqual(expect.objectContaining({ generation_type: "discussion", status: "success", model_id: "p13-test-mock" }));
    expect(rows).toContainEqual(expect.objectContaining({ generation_type: "blueprint", status: "success", model_id: "development-fake-blueprint" }));
    const buckets = await service.from("rate_limit_buckets").select("bucket_key_hash,count"); assert.equal(buckets.error, null);
    const counts = z.array(z.object({ bucket_key_hash: z.string().regex(/^[a-f0-9]{64}$/), count: z.number().int().positive() })).parse(buckets.data);
    expect(counts.length).toBeGreaterThanOrEqual(3);
    const audit = readFileSync(join(workdir!, "p13-provider-audit.jsonl"), "utf8").trim().split("\n").map(line => z.object({ kind: z.string() }).passthrough().parse(JSON.parse(line)));
    expect(audit.filter(a => a.kind === "strategy")).toHaveLength(1); expect(audit.filter(a => a.kind === "blueprint")).toHaveLength(1);
    expect(audit[0]).toMatchObject({ contextBinding: { sourceVersions: { c1: { provenance: "server" } } }, authoritativeFacts: {
      preorder: { preorderId, baseUnitPriceIdr: 25000, quotaUnits: 50, allocatedUnits: 7, paidUnits: 3, heldUnits: 0 },
      product: { variableCostIdr: 12000 }, capacity: { totalUnits: 60 } } });
  });
  it.skipIf(process.env.CAMPAIGN_LAB_P13_EXPECT_UNCONFIGURED === "1")("configured test provider rejects a stale context before inference", async () => {
    const discussion = z.object({ session: DiscussionViewSchema }).parse((await request(`discussions?sessionId=${sessionId}`)).body).session;
    expect((await request("discussions", ownerCookie, { action: "send", sessionId, requestKey: randomUUID(), expectedVersion: discussion.version,
      expectedContextHash: "0".repeat(64), message: "Periksa konteks", preferences: { budgetCapIdr: null, allowDiscount: false, channels: ["whatsapp"] } })).body)
      .toMatchObject({ code: "STALE_CONTEXT" });
  });
  it("rejects stale Blueprint version, invalid finance and owner fake scenarios", async () => {
    const discussion = z.object({ session: DiscussionViewSchema }).parse((await request(`discussions?sessionId=${sessionId}`)).body).session;
    const command = { action: "send", sessionId, requestKey: randomUUID(), expectedVersion: discussion.version, expectedContextHash: "0".repeat(64),
      message: "Periksa konteks", preferences: { budgetCapIdr: null, allowDiscount: false, channels: ["whatsapp"] }, scenario: "normal" };
    expect((await request("discussions", ownerCookie, { ...command, scenario: "failure" })).status).toBe(400);
    expect((await request("blueprints", ownerCookie, { ...approve(), expectedBlueprintVersion: 1 })).body).toMatchObject({ code: "VERSION_CONFLICT" });
    const b = saved.active.blueprint_json;
    expect((await request("blueprints", ownerCookie, { action: "revise", campaignId, requestId: randomUUID(), expectedCampaignVersion: saved.campaign.version,
      expectedBlueprintId: saved.active.id, expectedBlueprintVersion: saved.active.version, edits: { title: b.campaignTitle, marketingApproach: b.marketingApproach,
        discountBps: 0, budgetCapIdr: -1, targetAdditionalUnits: 3, ...b.executionWindow, channels: b.channels, notes: "" } })).status).toBe(400);
  });
  it("keeps checklist state restrictions and C8 publication fail-closed", async () => {
    const execution = ExecutionViewSchema.parse((await request(`campaigns?campaignId=${campaignId}`)).body);
    const task = execution.calendar.days[0].tasks[0]; assert(task);
    const update = await request("campaigns", ownerCookie, { action: "task", campaignId, blueprintId: saved.active.id, taskId: task.id,
      expectedTaskVersion: task.version, completed: true });
    expect(update.status).toBe(409); expect(update.body).toMatchObject({ code: "INVALID_CAMPAIGN_STATE" });
    const publish = await request("campaigns", ownerCookie, { action: "publish", campaignId, blueprintId: saved.active.id,
      expectedBlueprintVersion: saved.active.version, expectedCampaignVersion: saved.campaign.version, expectedContextHash: saved.active.context_hash, confirm: true });
    expect(publish.status).toBe(409); expect(publish.body).toMatchObject({ code: "C8_NOT_READY" });
    const reloaded = ExecutionViewSchema.parse((await request(`campaigns?campaignId=${campaignId}`)).body);
    expect(reloaded.campaign.published_at).toBeNull(); expect(reloaded.calendar.progress.completed).toBe(0);
  });
  it.skipIf(process.env.CAMPAIGN_LAB_P13_EXPECT_UNCONFIGURED !== "1")("normal bundle has no mock provider fallback", async () => {
    expect((await request("discussions")).body).toMatchObject({ provider: "gemini-unconfigured" });
    const discussion = z.object({ session: DiscussionViewSchema }).parse((await request(`discussions?sessionId=${sessionId}`)).body).session;
    const response = await request("discussions", ownerCookie, { action: "send", sessionId, requestKey: randomUUID(), expectedVersion: discussion.version,
      expectedContextHash: discussion.contextHash, message: "Periksa konfigurasi", preferences: { budgetCapIdr: null, allowDiscount: false, channels: ["whatsapp"] } });
    expect(response.status).toBe(503); expect(response.body).toMatchObject({ code: "CONFIGURATION_ERROR" });
    const after = z.object({ session: DiscussionViewSchema }).parse((await request(`discussions?sessionId=${sessionId}`)).body).session;
    expect(after.generations).toEqual(discussion.generations);
  });
});
