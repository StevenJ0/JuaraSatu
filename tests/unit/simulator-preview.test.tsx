import { renderToStaticMarkup } from "react-dom/server";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SimulatorPreviewPage from "../../src/app/dev/campaign-simulator/page";
import { CampaignSimulator } from "../../src/features/campaign-simulator/components/campaign-simulator";
import { developmentFacts } from "../../src/features/campaign-simulator/development-fixtures";

afterEach(() => vi.unstubAllEnvs());

describe("simulator development preview", () => {
  it.each(["production", "test"])("denies access in %s before rendering fixture data", (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    expect(() => SimulatorPreviewPage()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("renders labelled fixture data with a loading boundary in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(SimulatorPreviewPage().type).toBe(Suspense);
    const html = renderToStaticMarkup(<CampaignSimulator facts={developmentFacts} />);
    expect(html).toContain("Preview development · Data sintetis");
    expect(html).toContain("scenario-contribution");
    expect(html).toContain("214.000");
    expect(html).toContain('for="discountPercent"');
    expect(html).toContain("Waktu fixture, bukan kondisi terkini.");
  });

  it("shows an unavailable state rather than inventing missing producer facts", () => {
    const html = renderToStaticMarkup(<CampaignSimulator facts={null} />);
    expect(html).toContain("Data preorder belum tersedia");
    expect(html).not.toContain("scenario-contribution");
  });

  it("shows an error for invalid authoritative facts", () => {
    const html = renderToStaticMarkup(<CampaignSimulator facts={{ baseUnitPriceIdr: 1 }} />);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("scenario-contribution");
  });
});
