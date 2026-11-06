import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { executionFixture } from "../fixtures/execution";
import { executionCalendar, projectPublishedOffer, assertMaterializedPlan, taskUpdateDisposition } from "../../src/features/campaign-execution/projections";
import { validateCampaignPublication, campaignExecutionService } from "../../src/features/campaign-execution/service";
import { PublishCampaignCommandSchema, TaskCommandSchema, PublicationBaselineSchema, CampaignExecutionError } from "../../src/features/campaign-execution/contracts";
import { readPublishedOffer } from "../../src/features/campaign-execution/published-offer.server";
import { executionDatabaseError, type ExecutionRepository } from "../../src/features/campaign-execution/repository.server";
import { SupabaseError } from "../../src/lib/supabase/transport.server";

describe("campaign publishing and C3", () => {
  it.each([0, 500])("validates approved publication, frozen pricing and non-stacking: %i bps", async (bps) => {
    const f = await executionFixture(bps);
    expect(validateCampaignPublication(f.snapshot, f.command, f.input.selected, f.contextInput, f.now)).toBe(f.snapshot);
    const offer = projectPublishedOffer(f.scope, f.published, f.now);
    expect(offer).toMatchObject({ state: "active", eligible: true, configuration: { frozenBaseUnitPriceIdr: 120000, unitPriceIdr: bps ? 114000 : 120000,
      offer: { offerType: bps ? "percent_discount" : "normal_price", discountBps: bps } } });
    expect(f.snapshot.campaign).toMatchObject({ status: "draft", published_at: null, completed_at: null });
  });
  it.each(["unapproved", "version", "blueprint", "business", "preorder", "hash", "financial", "frozen", "capacity", "dates", "schedule", "materialization"] as const)("rejects invalid publication: %s", async (kind) => {
    const f = await executionFixture(500); const s = f.snapshot; if (!s.blueprint) throw new Error("Missing blueprint");
    if (kind === "unapproved") s.blueprint.approval_status = "proposed";
    if (kind === "version") f.command.expectedCampaignVersion++;
    if (kind === "blueprint") f.command.expectedBlueprintVersion++;
    if (kind === "business") s.campaign.business_id = "99999999-9999-4999-8999-999999999999";
    if (kind === "preorder") s.campaign.preorder_id = "99999999-9999-4999-8999-999999999999";
    if (kind === "hash") f.command.expectedContextHash = "0".repeat(64);
    if (kind === "financial") s.blueprint.blueprint_json.financial.calculation.scenarioRevenueIdr++;
    if (kind === "frozen") s.item.base_price_snapshot_idr = 130000;
    if (kind === "capacity" && f.contextInput.c1.status === "available") f.contextInput.c1.data.preorder.orderableUnits = 0;
    if (kind === "dates") s.campaign.ends_at = "2026-12-01T00:00:00Z";
    if (kind === "schedule") s.tasks[0].due_at = "2026-12-01T00:00:00Z";
    if (kind === "materialization") s.contents = [];
    expect(() => validateCampaignPublication(s, f.command, f.input.selected, f.contextInput, f.now)).toThrow();
  });
  it("rejects a source version change before publication", async () => {
    const f = await executionFixture(); if (f.contextInput.c1.status === "available") f.contextInput.c1.data.snapshot.productVersion++;
    expect(() => validateCampaignPublication(f.snapshot, f.command, f.input.selected, f.contextInput, f.now)).toThrowError(expect.objectContaining({ code: "STALE_CONTEXT" }));
  });
  it.each(["none", "scheduled", "expired", "closed", "invalid"] as const)("projects non-eligible C3 %s without fallback discount", async (state) => {
    const f = await executionFixture(500); let raw: unknown = f.published; let now = f.now;
    if (state === "none") raw = null;
    if (state === "scheduled") now = "2026-11-01T12:00:00Z";
    if (state === "expired") now = "2026-11-06T11:00:00Z";
    if (state === "closed") { f.published.campaign.status = "closed"; f.published.campaign.closed_at = f.now; }
    if (state === "invalid") f.published.campaign.published_blueprint_id = null;
    expect(projectPublishedOffer(f.scope, raw, now)).toMatchObject({ state, eligible: false });
    if (state === "invalid" || state === "none") expect(projectPublishedOffer(f.scope, raw, now).configuration).toBeNull();
  });
  it("rejects mutated published pricing and cross-tenant C3 data", async () => {
    const f = await executionFixture(500); f.published.campaign.discount_bps = 1000;
    expect(projectPublishedOffer(f.scope, f.published, f.now).state).toBe("invalid");
    expect(projectPublishedOffer({ ...f.scope, businessId: "99999999-9999-4999-8999-999999999999" }, f.published, f.now).configuration).toBeNull();
  });
  it("validates the actual baseline projection while accepting additional locked context fields", async () => {
    const f = await executionFixture(); const original = f.published.campaign.baseline_json;
    f.published.campaign.baseline_json = {}; expect(projectPublishedOffer(f.scope, f.published, f.now).state).toBe("invalid");
    if (typeof original !== "object" || original === null || !("sourceVersions" in original)) throw new Error("No baseline");
    const parsed = PublicationBaselineSchema.parse(original);
    f.published.campaign.baseline_json = { ...parsed, sourceVersions: { ...parsed.sourceVersions, orderableUnits: 8 } };
    expect(projectPublishedOffer(f.scope, f.published, f.now).state).toBe("active");
  });
  it("projects a future published window as scheduled without changing stored publication status", async () => {
    const f = await executionFixture(); if (!f.published.blueprint) throw new Error("No blueprint");
    f.published.campaign.starts_at = "2026-11-03T00:00:00Z"; f.published.blueprint.blueprint_json.executionWindow.startsAt = f.published.campaign.starts_at;
    expect(projectPublishedOffer(f.scope, f.published, f.now)).toMatchObject({ state: "scheduled", eligible: false });
    expect(f.published.campaign.status).toBe("published");
  });
  it("requires explicit publication confirmation and rejects extra client pricing", () => {
    expect(PublishCampaignCommandSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(TaskCommandSchema.safeParse({ completed: "true" }).success).toBe(false);
  });
  it.each([["40001", "STALE_FACT_VERSIONS", "STALE_CONTEXT", 409], ["40001", "VERSION_CONFLICT", "VERSION_CONFLICT", 409],
    ["40001", "could not serialize access due to concurrent update", "DATABASE_BUSY", 503], ["40P01", "deadlock detected", "DATABASE_BUSY", 503],
    ["23505", "unique published campaign", "CAMPAIGN_CONFLICT", 409]] as const)("distinguishes SQL %s %s from transient abort", (sql, detail, code, status) => {
    expect(() => executionDatabaseError(new SupabaseError(sql, detail, 400))).toThrowError(expect.objectContaining({ code, status }));
  });
});
describe("execution calendar and checklist", () => {
  it("groups by Jakarta date at midnight, orders deterministically and separates overdue/completed/upcoming", async () => {
    const f = await executionFixture(); const tasks = [
      { ...f.snapshot.tasks[0], due_at: "2026-11-02T16:59:00Z" },
      { ...f.snapshot.tasks[1], due_at: "2026-11-02T17:01:00Z", completed_at: "2026-11-02T17:02:00Z" },
      { ...f.snapshot.tasks[0], id: "99999999-9999-4999-8999-999999999999", due_at: "2026-11-03T17:00:00Z" },
    ];
    const result = executionCalendar(tasks.reverse(), "2026-11-02T17:03:00Z");
    expect(result.days.map((day) => day.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(result.days.map((day) => day.tasks[0].executionStatus)).toEqual(["overdue", "completed", "upcoming"]);
    expect(result.progress).toMatchObject({ total: 3, completed: 1, percent: 33, overdue: 1, remaining: 2 });
    expect(executionCalendar([], f.now).progress.percent).toBe(0);
  });
  it("validates active approved materialization and never invents task-content relationships", async () => {
    const f = await executionFixture(); expect(() => assertMaterializedPlan(f.snapshot)).not.toThrow();
    f.snapshot.tasks[0].blueprint_id = "99999999-9999-4999-8999-999999999999";
    expect(() => assertMaterializedPlan(f.snapshot)).toThrow();
  });
  it("replays one applied desired state, preserves CAS and rejects older ABA payloads", async () => {
    const f = await executionFixture(); const task = f.snapshot.tasks[0];
    expect(taskUpdateDisposition(task, 1, true)).toBe("write");
    task.completed_at = f.now; task.version = 2;
    expect(taskUpdateDisposition(task, 1, true)).toBe("replayed");
    expect(taskUpdateDisposition(task, 2, false)).toBe("write");
    expect(() => taskUpdateDisposition(task, 1, false)).toThrow();
    task.version = 4; expect(() => taskUpdateDisposition(task, 1, true)).toThrow();
  });
});
describe("lifecycle orchestration", () => {
  async function setup(published = false) {
    const f = await executionFixture(); let state = published ? f.published : f.snapshot;
    const repo: ExecutionRepository = { campaign: async () => state.campaign, load: async () => structuredClone(state), conflicting: async () => false, list: async () => [state.campaign],
      offer: async () => state, publish: vi.fn(async () => { state = f.published; }), close: vi.fn(async () => { state.campaign.status = "closed"; state.campaign.closed_at = f.now; state.campaign.version++; }),
      updateTask: vi.fn(async () => []) };
    const dependencies = { selection: async () => f.input.selected, loadContext: vi.fn(async () => f.contextInput), now: () => f.now, publishingEnabled: true, databaseError: executionDatabaseError };
    return { f, repo, dependencies, service: campaignExecutionService(repo, dependencies) };
  }
  it("publishes once and reconciles a repeated command from the durable baseline witness", async () => {
    const f = await setup(); expect((await f.service.publish(f.f.command)).campaign.status).toBe("published");
    expect((await f.service.publish(f.f.command)).replayed).toBe(true); expect(f.repo.publish).toHaveBeenCalledTimes(1);
    expect(f.dependencies.loadContext).toHaveBeenCalledTimes(1);
  });
  it("blocks conflicting campaign and unavailable source before calling the publish RPC", async () => {
    const f = await setup(); f.repo.conflicting = async () => true;
    await expect(f.service.publish(f.f.command)).rejects.toMatchObject({ code: "CAMPAIGN_CONFLICT" });
    f.repo.conflicting = async () => false; f.dependencies.loadContext.mockRejectedValue(new Error("Source unavailable"));
    await expect(f.service.publish(f.f.command)).rejects.toThrow(); expect(f.repo.publish).not.toHaveBeenCalled();
  });
  it("closes once, preserves plan and does not complete or create evaluation", async () => {
    const f = await setup(true); const command = { campaignId: f.f.published.campaign.id, expectedCampaignVersion: 4, confirm: true };
    const result = await f.service.close(command); expect(result.campaign).toMatchObject({ status: "closed", completed_at: null });
    expect(result.tasks).toHaveLength(2); expect(result.c3.eligible).toBe(false);
    expect((await f.service.close(command)).replayed).toBe(true); expect(f.repo.close).toHaveBeenCalledTimes(1);
  });
  it("rejects draft closing and task execution on an unpublished plan", async () => {
    const f = await setup(); const id = f.f.snapshot.campaign.id;
    await expect(f.service.close({ campaignId: id, expectedCampaignVersion: 3, confirm: true })).rejects.toMatchObject({ code: "INVALID_CAMPAIGN_STATE" });
    await expect(f.service.task({ campaignId: id, blueprintId: f.f.command.blueprintId, taskId: f.f.snapshot.tasks[0].id, expectedTaskVersion: 1, completed: true })).rejects.toMatchObject({ code: "INVALID_CAMPAIGN_STATE" });
  });
  it("requires explicit development publishing mode before the first write", async () => {
    const f = await setup(); f.dependencies.publishingEnabled = false;
    await expect(f.service.publish(f.f.command)).rejects.toMatchObject({ code: "SYNTHETIC_PUBLISHING_DISABLED" });
    expect(f.repo.publish).not.toHaveBeenCalled();
  });
  it("distinguishes unavailable/invalid C3 source from no offer and preserves access-denied errors", async () => {
    const f = await setup(true);
    f.repo.offer = async () => { throw new SupabaseError("PERSISTENCE_UNAVAILABLE", "TRANSPORT", 503); };
    expect(await readPublishedOffer(f.repo, f.f.scope, f.f.now)).toMatchObject({ state: "unavailable", eligible: false, configuration: null });
    f.repo.offer = async () => { PublicationBaselineSchema.parse({}); return null; };
    expect((await readPublishedOffer(f.repo, f.f.scope, f.f.now)).state).toBe("invalid");
    f.repo.offer = async () => { throw new CampaignExecutionError("NOT_FOUND", 404); };
    await expect(readPublishedOffer(f.repo, f.f.scope, f.f.now)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
