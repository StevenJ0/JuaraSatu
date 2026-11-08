/** PRD v2.1 §13.2: application codes, not database statuses or HTTP mappings. */
export const APP_ERROR_CODES = Object.freeze([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "PREORDER_NOT_OPEN",
  "CAPACITY_UNAVAILABLE",
  "OFFER_CHANGED",
  "BLUEPRINT_NOT_APPROVED",
  "CAMPAIGN_CONFLICT",
  "COSTS_INCOMPLETE",
  "PAYMENT_REVIEW_REQUIRED",
  "PROVIDER_UNAVAILABLE",
  "AI_INVALID_OUTPUT",
  "RETRIEVAL_UNAVAILABLE",
  "RATE_LIMITED",
] as const);

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === "string" && APP_ERROR_CODES.some((code) => code === value);
}
