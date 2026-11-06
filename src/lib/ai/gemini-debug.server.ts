import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export type GeminiDebugStage = "API_REQUEST" | "INPUT_VALIDATION" | "PROVIDER_CONFIGURATION" | "PROVIDER_INITIALIZATION"
  | "REQUEST_PREPARATION" | "SDK_REQUEST" | "TRANSPORT" | "UPSTREAM_HTTP" | "INTERACTION_RESPONSE"
  | "CONTEXT_VALIDATION" | "JSON_PARSE" | "ZOD_VALIDATION" | "DOMAIN_VALIDATION" | "IDEMPOTENCY" | "PERSISTENCE";
type DebugResult = "STARTED" | "SUCCESS" | "FAILED" | "REJECTED" | "SKIPPED";
export type GeminiDebugTrace = {
  readonly enabled: boolean;
  event(stage: GeminiDebugStage, result: DebugResult, details?: Record<string, unknown>): void;
  issues(stage: GeminiDebugStage, error: z.ZodError, input: unknown, result?: "FAILED" | "REJECTED"): void;
  end(httpStatus: number, code: string): void;
};
export function geminiDebugEnabled() { return process.env.NODE_ENV === "development" && process.env.GEMINI_DEBUG === "true"; }

const safeNames = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AggregateError", "ZodError", "AbortError", "TimeoutError",
  "DOMException", "ConnectTimeoutError", "HeadersTimeoutError", "BodyTimeoutError", "SocketError", "InvalidArgumentError", "Object", "DiscussionHttpError", "SupabaseError", "ApiError", "APIError", "APIConnectionError", "APIConnectionTimeoutError", "APIUserAbortError", "GoogleGenAiError",
  "HTTPClientError", "UnexpectedClientError", "InvalidRequestError", "ConnectionError", "RequestAbortedError", "RequestTimeoutError",
  "BadRequestError", "AuthenticationError", "PermissionDeniedError", "NotFoundError", "ConflictError", "UnprocessableEntityError",
  "RateLimitError", "InternalServerError", "CreateInteractionClientError", "CreateInteractionServerError", "ContinuationTimeoutError"]);
const safeNetworkCodes = new Set(["EACCES", "EPERM", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_INVALID_ARG", "ERR_INVALID_ARG_TYPE",
  "ERR_INVALID_ARG_VALUE", "ERR_INVALID_URL", "ERR_INVALID_CHAR", "ERR_HTTP_INVALID_HEADER_VALUE", "CERT_HAS_EXPIRED", "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED"]);
const safeCodes = new Set(["COMPLETED", "RUNNING", "UNCLASSIFIED", "CONFIGURATION_ERROR", "PROVIDER_REFUSED", "PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMITED",
  "MODEL_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "INVALID_RESPONSE", "INVALID_INPUT", "CONTEXT_UNAVAILABLE", "STALE_CONTEXT", "UNSAFE_TEXT", "NO_FEASIBLE_OPTIONS",
  "PERSISTENCE_UNAVAILABLE", "VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT", "TURN_IN_PROGRESS", "NOT_FOUND", "FORBIDDEN", "UNAUTHENTICATED",
  "INVALID_OPTION", "SOURCE_MISMATCH", "INVALID_DATES", "PREFERENCE_CONFLICT", "FINANCIAL_OR_CAPACITY_BLOCKER", "FAKE_SCENARIO_DISABLED"]);
const providerStatuses = new Set(["INVALID_ARGUMENT", "UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION",
  "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED", "CANCELLED", "UNKNOWN", "UNIMPLEMENTED", "OUT_OF_RANGE", "ABORTED", "DATA_LOSS", "ALREADY_EXISTS"]);
const interactionStatuses = new Set(["completed", "incomplete", "failed", "cancelled", "in_progress", "requires_action", "requires_continuation"]);
const HttpStatus = z.number().int().min(100).max(599);
const Fields = z.object({ status: z.unknown().optional(), statusCode: z.unknown().optional(), name: z.unknown().optional(),
  code: z.unknown().optional(), message: z.unknown().optional(), cause: z.unknown().optional(), error: z.unknown().optional() });
const object = (value: unknown) => z.record(z.string(), z.unknown()).safeParse(value);
const name = (value: unknown) => typeof value === "string" && safeNames.has(value) ? value : "UnknownError";
const type = (value: unknown): string => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

function messageCategoryOf(value: unknown): string {
  const message = typeof value === "string" ? value.slice(0, 2048) : "";
  if (/cannot.{0,80}represent|not.{0,30}represent.{0,30}json.schema/i.test(message)) return "JSON_SCHEMA_UNREPRESENTABLE";
  if (/invalid.url/i.test(message)) return "INVALID_REQUEST_URL";
  if (/invalid.{0,40}header|header.{0,40}invalid/i.test(message)) return "INVALID_REQUEST_HEADER";
  if (/not.a.function/i.test(message)) return "SDK_METHOD_NOT_CALLABLE";
  if (/duplex/i.test(message)) return "REQUEST_DUPLEX_REQUIRED";
  if (/fetch.failed|connection.error/i.test(message)) return "FETCH_FAILED";
  if (/timeout|timed.out|aborted/i.test(message)) return "ABORTED_OR_TIMED_OUT";
  if (/unexpected.token|unterminated|unexpected.end/i.test(message)) return "INVALID_JSON";
  // Classify known diagnostics without ever emitting provider message text.
  return /api.?key.{0,40}(invalid|expired)|invalid.{0,20}api.?key/i.test(message) ? "API_KEY_INVALID"
    : /billing|billable/i.test(message) ? "BILLING_REQUIRED" : /quota|resource.exhausted/i.test(message) ? "QUOTA_EXHAUSTED"
    : /permission|not.authorized/i.test(message) ? "PERMISSION_DENIED" : /schema|response_format|generation_config|unknown.field/i.test(message) ? "REQUEST_SCHEMA_REJECTED"
    : /overload|capacity|temporar/i.test(message) ? "UPSTREAM_CAPACITY" : "UNCLASSIFIED";
}
function providerErrorSummary(value: unknown) {
  const parsed = object(value);
  if (!parsed.success) return null;
  const data = parsed.data;
  const messageCategory = messageCategoryOf(data.message);
  const code = HttpStatus.safeParse(data.code);
  const fieldViolations: string[] = [];
  if (Array.isArray(data.details)) for (const detail of data.details.slice(0, 8)) {
    const item = object(detail);
    if (!item.success || !Array.isArray(item.data.fieldViolations)) continue;
    for (const violation of item.data.fieldViolations.slice(0, 8)) {
      const entry = object(violation);
      if (entry.success && typeof entry.data.field === "string") fieldViolations.push(safePath(entry.data.field.slice(0, 256).split(/[.\[\]]/).filter(Boolean)));
    }
  }
  return { fieldViolations: fieldViolations.slice(0, 20), code: code.success ? code.data : null, status: typeof data.status === "string" && providerStatuses.has(data.status) ? data.status : null, messageCategory };
}
export function errorDiagnostics(error: unknown) {
  const errorChain: { name: string; constructorName: string; status: number | null; statusCode: number | null; code: string | null; messageCategory: string }[] = [];
  let current: unknown = error;
  let providerError: ReturnType<typeof providerErrorSummary> = null;
  for (let depth = 0; depth < 6; depth++) {
    const parsed = Fields.safeParse(current);
    if (!parsed.success) break;
    const status = HttpStatus.safeParse(parsed.data.status), statusCode = HttpStatus.safeParse(parsed.data.statusCode);
    errorChain.push({ name: name(parsed.data.name), constructorName: name(current !== null && typeof current === "object" ? current.constructor?.name : undefined),
      status: status.success ? status.data : null, statusCode: statusCode.success ? statusCode.data : null,
      code: typeof parsed.data.code === "string" && safeNetworkCodes.has(parsed.data.code) ? parsed.data.code : null, messageCategory: messageCategoryOf(parsed.data.message) });
    providerError ??= providerErrorSummary(parsed.data.error);
    current = parsed.data.cause;
    if (current === undefined || current === null) break;
  }
  const statusError = errorChain.find(node => node.status !== null || node.statusCode !== null);
  return { httpStatus: statusError?.status ?? statusError?.statusCode ?? null, sdkStatus: errorChain[0]?.status ?? null,
    sdkStatusCode: errorChain[0]?.statusCode ?? null, errorName: errorChain[0]?.name ?? "UnknownError",
    constructorName: errorChain[0]?.constructorName ?? "UnknownError", causeName: errorChain[1]?.name ?? null,
    causeCode: errorChain.slice(1).find(node => node.code !== null)?.code ?? null, errorChain, providerError };
}

const jsonFields = new Set(["schemaVersion", "contextHash", "reply", "sourceReferences", "options", "limitations", "proposalKey", "title", "marketingApproach",
  "offer", "offerType", "discountBps", "assumedAdditionalUnits", "assumedPromotionCostIdr", "channels", "startsAt", "endsAt", "hypothesis", "assumptions", "risks",
  "tasks", "contents", "key", "channel", "dueAt", "body", "headline", "cta", "notes", "preferences", "budgetCapIdr", "allowDiscount", "history", "message",
  "sessionId", "requestKey", "expectedVersion", "expectedContextHash", "businessId", "preorderId", "state", "status", "persistence", "requiresOwnerReview",
  "proposalVersion", "generatedAt", "model", "providerRequestId", "rejectedOptions", "computedScenario", "financial", "calculation", "id", "output_text", "errors", "code", "apiKey", "timeoutMs", "maxAttempts",
  "response_format", "mime_type", "system_instruction", "generation_config", "max_output_tokens", "schema", "input", "store", "stream", "tools"]);
function safePath(path: readonly PropertyKey[]) {
  return path.slice(0, 12).map(key => typeof key === "number" ? Math.min(key, 10000) : typeof key === "string" && jsonFields.has(key) ? key : "[unknown_field]").join(".") || "$";
}
function jsonShape(value: unknown, depth = 0): unknown {
  if (depth >= 5) return "[depth_limit]";
  if (Array.isArray(value)) return { type: "array", count: Math.min(value.length, 10000), items: value.slice(0, 2).map(item => jsonShape(item, depth + 1)) };
  const parsed = object(value);
  if (parsed.success) {
    const entries = Object.entries(parsed.data), known = entries.filter(([key]) => jsonFields.has(key));
    return { ...Object.fromEntries(known.slice(0, 20).map(([key, item]) => [key, jsonShape(item, depth + 1)])),
      ...(entries.length > known.slice(0, 20).length ? { redactedFieldCount: entries.length - known.slice(0, 20).length } : {}) };
  }
  return "[" + type(value) + ":redacted]";
}
function responseSummary(value: unknown) {
  const parsed = object(value);
  if (!parsed.success) return { sdkResponseType: type(value) };
  const data = parsed.data, output = data.output_text;
  const contentTypes = new Set<string>();
  const steps = Array.isArray(data.steps) ? data.steps : [];
  for (const step of steps.slice(0, 20)) {
    const item = object(step);
    if (!item.success || !Array.isArray(item.data.content)) continue;
    for (const content of item.data.content.slice(0, 20)) {
      const part = object(content);
      if (part.success && typeof part.data.type === "string" && ["text", "image", "audio", "video", "document", "function_call", "function_result"].includes(part.data.type)) contentTypes.add(part.data.type);
    }
  }
  let jsonPreview: unknown = null, jsonState = "NO_JSON_OUTPUT";
  if (typeof output === "string" && output.length <= 64000) {
    try { const json: unknown = JSON.parse(output); jsonPreview = jsonShape(json); jsonState = "PARSED"; } catch { jsonState = "INVALID_JSON"; }
  } else if (typeof output === "string") jsonState = "OVERSIZED_OUTPUT";
  const previewText = jsonPreview === null ? null : JSON.stringify(jsonPreview);
  return { sdkResponseType: type(value), interactionIdHash: typeof data.id === "string" ? createHash("sha256").update(data.id.slice(0, 1024)).digest("hex").slice(0, 16) : null,
    interactionStatus: typeof data.status === "string" && interactionStatuses.has(data.status) ? data.status : "unknown",
    model: typeof data.model === "string" && data.model.replace(/^models\//, "") === process.env.GEMINI_MODEL ? process.env.GEMINI_MODEL : null,
    providerErrors: Array.isArray(data.errors) ? data.errors.slice(0, 8).map(error => {
      const item = object(error); if (!item.success) return { code: "UNKNOWN_PROVIDER_CODE" };
      const code = item.data.code;
      return { code: typeof code === "string" && (providerStatuses.has(code) || ["SAFETY_BLOCKED", "SAFETY", "PROHIBITED_CONTENT", "RECITATION", "MAX_TOKENS", "BLOCKLIST"].includes(code)) ? code : "UNKNOWN_PROVIDER_CODE",
        messageCategory: messageCategoryOf(item.data.message) };
    }) : [],
    outputTextPresent: typeof output === "string" && output.length > 0, outputContentTypes: [...contentTypes], stepCount: Math.min(steps.length, 10000),
    generatedJson: jsonState, jsonPreview: previewText?.slice(0, 4096) ?? null, jsonPreviewTruncated: (previewText?.length ?? 0) > 4096 };
}
function safeHeaders(value: unknown) {
  if (!(value instanceof Headers)) return {};
  const contentType = value.get("content-type")?.split(";")[0].trim().toLowerCase();
  const retryAfter = value.get("retry-after");
  return { contentType: contentType && ["application/json", "text/plain", "text/html", "text/event-stream"].includes(contentType) ? contentType : "other",
    retryAfterSeconds: retryAfter && /^\d{1,5}$/.test(retryAfter) ? Math.min(Number(retryAfter), 86400) : null };
}
function safeDetails(details: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const key of ["attempt", "timeoutMs", "connectTimeoutMs", "httpStatus", "elapsedMs", "acceptedOptions", "rejectedOptions", "outputTextLength", "optionIndex", "transportMs", "inputBytes", "systemBytes", "schemaBytes", "estimatedInputTokens"]) {
    const value = details[key]; if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
  }
  if (typeof details.transportPhase === "string" && ["dispatch", "socket_assigned", "request_sent", "response_started", "response_headers", "response_complete"].includes(details.transportPhase)) safe.transportPhase = details.transportPhase;
  if (details.httpStatus === null) safe.httpStatus = null;
  for (const key of ["apiKeyConfigured", "schemaCreated", "inputValidated", "transportInvoked", "dispatcherInvoked", "responseReceived", "persisted", "replayed"]) {
    if (typeof details[key] === "boolean") safe[key] = details[key];
  }
  if (typeof details.code === "string") safe.code = safeCodes.has(details.code) ? details.code : "UNCLASSIFIED";
  if (typeof details.model === "string" && /^gemini-[a-zA-Z0-9.-]{1,100}$/.test(details.model)) safe.model = details.model;
  if (typeof details.sessionId === "string" && z.uuid().safeParse(details.sessionId).success) safe.sessionId = details.sessionId;
  if (typeof details.action === "string" && ["send", "create", "refresh", "recover"].includes(details.action)) safe.action = details.action;
  if (typeof details.claimStatus === "string" && ["claimed", "running", "completed", "failed"].includes(details.claimStatus)) safe.claimStatus = details.claimStatus;
  if (details.route === "POST /api/dev/discussions") safe.route = details.route;
  if (details.provider === "gemini" || details.provider === "development-fake") safe.provider = details.provider;
  if (details.sdk === "@google/genai") safe.sdk = details.sdk;
  if ("headers" in details) safe.headers = safeHeaders(details.headers);
  if ("response" in details) safe.response = responseSummary(details.response);
  if ("error" in details) safe.error = errorDiagnostics(details.error);
  if (Array.isArray(details.domainCodes)) safe.domainCodes = details.domainCodes.filter((code): code is string => typeof code === "string" && safeCodes.has(code)).slice(0, 20);
  return safe;
}
function validationSummary(error: z.ZodError, input: unknown) {
  return { issueCount: error.issues.length, truncated: error.issues.length > 20, issues: error.issues.slice(0, 20).map(issue => {
    let actual: unknown = input;
    for (const key of issue.path.slice(0, 12)) {
      if (Array.isArray(actual) && typeof key === "number") actual = actual[key];
      else { const parsed = object(actual); actual = parsed.success && typeof key === "string" ? parsed.data[key] : undefined; }
    }
    const expected = "expected" in issue && typeof issue.expected === "string" && ["string", "number", "boolean", "object", "array", "null", "undefined", "int"].includes(issue.expected) ? issue.expected : null;
    return { path: safePath(issue.path), code: issue.code, expected, actualType: type(actual),
      ...("minimum" in issue && typeof issue.minimum === "number" ? { minimum: issue.minimum } : {}),
      ...("maximum" in issue && typeof issue.maximum === "number" ? { maximum: issue.maximum } : {}) };
  }) };
}

export function createGeminiDebugTrace(correlationId?: string | null): GeminiDebugTrace {
  let requestId: string | undefined = z.uuid().safeParse(correlationId).success ? correlationId ?? undefined : undefined;
  let failureStage: GeminiDebugStage | undefined;
  const started = Date.now();
  function emit(stage: GeminiDebugStage | "END", result: DebugResult, details: Record<string, unknown>) {
    if (!geminiDebugEnabled()) return;
    requestId ??= randomUUID();
    if (result === "FAILED" && stage !== "END") failureStage ??= stage;
    const entry = { requestId, stage, result, ...details, elapsedMs: Date.now() - started };
    if (result === "FAILED") console.error("[GEMINI_DEBUG]", JSON.stringify(entry)); else console.log("[GEMINI_DEBUG]", JSON.stringify(entry));
  }
  return {
    get enabled() { return geminiDebugEnabled(); },
    event(stage, result, details = {}) { if (geminiDebugEnabled()) { const safe = safeDetails(details);
      if (result === "FAILED" && details.responseReceived === false) safe.upstreamHttpResponse = "NO_UPSTREAM_HTTP_RESPONSE";
      emit(stage, result, safe); } },
    issues(stage, error, input, result = "FAILED") { if (geminiDebugEnabled()) emit(stage, result, validationSummary(error, input)); },
    end(httpStatus, code) { emit("END", httpStatus >= 400 ? "FAILED" : "SUCCESS", { httpStatus, code: safeCodes.has(code) ? code : "UNCLASSIFIED",
      failureStage: httpStatus >= 400 ? failureStage ?? "API_REQUEST" : null }); },
  };
}
