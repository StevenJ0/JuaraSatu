import { afterEach, describe, expect, it, vi } from "vitest";
import { requireOwnerOrigin, authenticateOwnerApi } from "../../src/features/auth/owner-api.server";
import { ownerProviderIdentity, ownerStrategyProvider } from "../../src/features/campaign-strategist/owner-provider.server";
import { acceptDiscussionResponse, type DiscussionSelection } from "../../src/features/campaign-strategist/components/discussion-response";
import { generateBlueprint } from "../../src/features/campaign-blueprint/blueprint-service";
import { validateBlueprint } from "../../src/features/campaign-blueprint/blueprint-domain";
import { blueprintFixture } from "../fixtures/blueprint";
import type { BlueprintProvider } from "../../src/features/campaign-blueprint/contracts";

const mocks = vi.hoisted(() => ({ client: vi.fn(), business: vi.fn() }));
vi.mock("../../src/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("../../src/features/business/repository", () => ({ findOwnedBusinessId: mocks.business }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("owner boundary retains SSR auth and source guards", () => {
  it.each([null, "https://foreign.example"])("rejects mutation origin %s even with a dev bearer", (origin) => {
    const headers: Record<string, string> = { Authorization: "Bearer dev-token" };
    if (origin) headers.Origin = origin;
    expect(() => requireOwnerOrigin(new Request("http://localhost:3301/api/owner/discussions", { method: "POST", headers })))
      .toThrow(expect.objectContaining({ status: 403 }));
  });
  it("allows an exact same-origin mutation", () => {
    expect(() => requireOwnerOrigin(new Request("http://localhost:3301/api/owner/discussions", { headers: { Origin: "http://localhost:3301" } }))).not.toThrow();
  });
  it("uses the public Host when Next development normalizes the internal URL hostname", () => {
    expect(() => requireOwnerOrigin(new Request("http://localhost:3301/api/owner/discussions", {
      headers: { Host: "127.0.0.1:3301", Origin: "http://127.0.0.1:3301" },
    }))).not.toThrow();
  });
  it("does not use a caller-supplied forwarded host to authorize a foreign Origin", () => {
    expect(() => requireOwnerOrigin(new Request("http://localhost:3301/api/owner/discussions", { headers: {
      Host: "127.0.0.1:3301", "X-Forwarded-Host": "foreign.example", Origin: "http://foreign.example",
    } }))).toThrow(expect.objectContaining({ status: 403 }));
  });
  it("does not authenticate bearer/dev cookies when SSR has no user", async () => {
    mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ error: null, data: { user: null } }) } });
    await expect(authenticateOwnerApi()).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });
  it("requires actual owner membership", async () => {
    mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ error: null, data: { user: { id: "owner" } } }) } });
    mocks.business.mockResolvedValue(null);
    await expect(authenticateOwnerApi()).rejects.toMatchObject({ code: "BUSINESS_REQUIRED", status: 403 });
  });
  it("never selects the dev fake provider from owner configuration", () => {
    vi.stubEnv("CAMPAIGN_DISCUSSION_PROVIDER", "fake"); vi.stubEnv("GEMINI_API_KEY", undefined); vi.stubEnv("GEMINI_MODEL", undefined);
    expect(ownerProviderIdentity().provider).toBe("gemini-unconfigured");
    expect(ownerStrategyProvider).toThrow(expect.objectContaining({ code: "CONFIGURATION_ERROR" }));
  });
});

describe("A6-10 async selection regression", () => {
  it("a late A poll cannot replace B or its hash/history/URL", async () => {
    let active: DiscussionSelection = { id: "A", epoch: 1, version: 4 };
    let displayed = "A";
    const pending = { id: "A", epoch: 1 };
    const late = Promise.resolve().then(() => { if (acceptDiscussionResponse(active, pending, 5)) displayed = "A-late"; });
    active = { id: "B", epoch: 2, version: 2 }; displayed = "B";
    await late;
    expect(displayed).toBe("B");
    expect(acceptDiscussionResponse(active, { id: "B", epoch: 2 }, 1)).toBe(false);
    expect(acceptDiscussionResponse(active, { id: "B", epoch: 2 }, 2)).toBe(true);
  });
});

describe("Blueprint real provenance and current replan facts", () => {
  it("A6-11: replan provider receives edited quantities/budget and the recalculated scenario", async () => {
    const f = await blueprintFixture();
    f.input.command.edits = { ...f.input.command.edits, targetAdditionalUnits: 2, budgetCapIdr: 1000 };
    expect(f.input.selected.alternative.assumedAdditionalUnits).not.toBe(2);
    const original = f.dependencies.provider;
    const provider: BlueprintProvider = { generate: vi.fn(async input => {
      expect(input.alternative.assumedAdditionalUnits).toBe(2);
      expect(input.alternative.assumedPromotionCostIdr).toBe(1000);
      expect(input.alternative.computedScenario.scenarioRevenueIdr).toBe(240000);
      return original.generate(input);
    }) };
    const body = await generateBlueprint(f.input, { ...f.dependencies, provider });
    expect(body.targetAdditionalUnits).toBe(2);
    expect(provider.generate).toHaveBeenCalledOnce();
  });
  it("real context yields synthetic=false; changing the flag cannot upgrade a fixture", async () => {
    const f = await blueprintFixture();
    const fixture = await generateBlueprint(f.input, f.dependencies);
    expect(() => validateBlueprint({ ...fixture, synthetic: false }, f.contextInput, f.dependencies.now())).toThrow("INVALID_PROVENANCE");
    if (f.contextInput.c1.status !== "available" || f.contextInput.c8.status !== "available") throw new Error("Fixture unavailable");
    f.contextInput.c1.data.snapshot.provenance = "server"; f.contextInput.c8.data.snapshot.provenance = "server";
    if (f.contextInput.c6.status === "available") f.contextInput.c6.data.snapshot.provenance = "server";
    const body = await generateBlueprint(f.input, f.dependencies);
    expect(body.synthetic).toBe(false);
  });
});
