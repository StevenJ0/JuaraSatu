import { describe, expect, it } from "vitest";
import { BlueprintApiError, keepsRequestId } from "../../src/features/campaign-blueprint/components/use-blueprint";

describe("blueprint retry request id", () => {
  it.each(["PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE", "OUTPUT_TRUNCATED", "INVALID_BLUEPRINT", "AI_RATE_LIMIT_EXCEEDED", "IDEMPOTENCY_CONFLICT"])(
    "starts a new request after a definite server error (%s), so a retry calls the AI again", (code) => {
      expect(keepsRequestId(new BlueprintApiError(code))).toBe(false);
    });

  it.each(["PERSISTENCE_UNAVAILABLE", "GENERATION_IN_PROGRESS"])("keeps the request when the outcome is unconfirmed (%s)", (code) => {
    expect(keepsRequestId(new BlueprintApiError(code))).toBe(true);
  });

  it("keeps the request when the response was lost or unreadable", () => {
    expect(keepsRequestId(new TypeError("Failed to fetch"))).toBe(true);
    expect(keepsRequestId(new SyntaxError("Unexpected end of JSON input"))).toBe(true);
  });
});
