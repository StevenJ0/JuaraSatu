import "next/dist/server/node-environment-baseline";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import { once } from "node:events";
import { Agent } from "undici";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import type { GeminiDebugTrace } from "../../src/lib/ai/gemini-debug.server";
import { createPatchedFetcher } from "next/dist/server/lib/patch-fetch";
import { createWorkStore } from "next/dist/server/async-storage/work-store";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

vi.mock("server-only", () => ({}));
const nativeFetch = globalThis.fetch;
const measurements: Record<string, unknown>[] = [];
afterAll(() => {
  if (process.env.GEMINI_TRANSPORT_REPORT === "1") writeFileSync("docs/qa/gemini-next-transport-verification.json",
    JSON.stringify({ capturedAt: new Date().toISOString(), node: process.version, generationCalls: 0, measurements }, null, 2) + "\n");
});
const cert = readFileSync(new URL("../fixtures/gemini-transport/cert.pem", import.meta.url));
const key = readFileSync(new URL("../fixtures/gemini-transport/key.pem", import.meta.url));
const prompt = { input: "synthetic transport test", systemInstruction: "synthetic test only" };
const environment = { NODE_ENV: "test", CAMPAIGN_DISCUSSION_PROVIDER: "gemini", CAMPAIGN_DISCUSSION_CONTEXT: "seeded",
  GEMINI_API_KEY: "diagnostic-not-a-real-key", GEMINI_MODEL: "gemini-3.8-flash", GEMINI_TIMEOUT_MS: "60000" };
function requestContext() {
  return createWorkStore({ page: "/api/dev/discussions/route", buildId: "transport-test", deploymentId: "transport-test",
    previouslyRevalidatedTags: [], renderOpts: { cacheLifeProfiles: { default: { stale: 0, revalidate: 0, expire: 1 } }, staticPageGenerationTimeout: 60, cacheComponents: false,
      waitUntil: undefined, onClose: () => {}, onAfterTaskError: () => {},
      validationLevel: "warning", fetchCache: "force-no-store", experimental: { authInterrupts: false, useCacheTimeout: 60_000, durableUseCacheEntries: false } } });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function loopbackTransport(handshakeDelay: number | null, responseDelay: { headers?: number; body?: number } = {}) {
  const sockets = new Set<net.Socket>(), timers = new Set<ReturnType<typeof setTimeout>>();
  const authorizations: boolean[] = [];
  const debug: GeminiDebugTrace = { enabled: true, event: vi.fn(), issues: vi.fn(), end: vi.fn() };
  const requests: { method: string; path: string; body: unknown }[] = [];
  const secureContext = tls.createSecureContext({ cert, key });
  const parser = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [], incoming: AsyncIterable<unknown> = request;
    for await (const chunk of incoming) { if (!Buffer.isBuffer(chunk)) throw Error("Unexpected HTTP chunk"); chunks.push(chunk); }
    requests.push({ method: request.method ?? "", path: request.url ?? "", body: JSON.parse(Buffer.concat(chunks).toString()) });
    const later = (delay: number, action: () => void) => { const timer = setTimeout(() => { timers.delete(timer); if (!response.destroyed) action(); }, delay); timers.add(timer); };
    later(responseDelay.headers ?? 0, () => {
      response.writeHead(200, { "Content-Type": "application/json", Connection: "close" }); response.flushHeaders();
      later(responseDelay.body ?? 0, () => response.end(JSON.stringify({ id: "local-transport-test", status: "completed",
        steps: [{ type: "model_output", content: [{ type: "text", text: "{}" }] }] })));
    });
  });
  const server = net.createServer({ pauseOnConnect: true }, socket => {
    sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket));
    if (handshakeDelay === null) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (socket.destroyed) return;
      const secure = new tls.TLSSocket(socket, { isServer: true, secureContext });
      sockets.add(secure); secure.on("error", () => {}); secure.on("close", () => sockets.delete(secure));
      secure.once("secure", () => parser.emit("connection", secure));
      secure.resume();
    }, handshakeDelay);
    timers.add(timer);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw Error("Missing loopback port");
  const originalConnect = tls.connect;
  const connects = vi.spyOn(tls, "connect").mockImplementation(options => {
    const google = z.object({ host: z.literal("generativelanguage.googleapis.com"), servername: z.literal("generativelanguage.googleapis.com") }).parse(options);
    const client = originalConnect({ ...google, host: "127.0.0.1", port: address.port, ca: cert });
    client.once("secureConnect", () => authorizations.push(client.authorized)); return client;
  });
  const dispatches = vi.spyOn(Agent.prototype, "dispatch");
  const origin = vi.fn<typeof fetch>((input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    expect(new URL(request.url).origin).toBe("https://generativelanguage.googleapis.com");
    expect(request.method).toBe("POST");
    return nativeFetch(input, init);
  });
  vi.stubGlobal("fetch", createPatchedFetcher(origin, { workAsyncStorage, workUnitAsyncStorage }));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { configuredDiscussionProvider } = await import("../../src/features/campaign-strategist/configured-provider.server");
  return { origin, connects, dispatches, warning, requests, debug, authorizations,
    generate: (timeoutMs = 60_000) => workAsyncStorage.run(requestContext(), () => configuredDiscussionProvider("normal", { ...environment, GEMINI_TIMEOUT_MS: String(timeoutMs) }, debug).generate(prompt)),
    close: async () => { for (const timer of timers) clearTimeout(timer); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

describe("actual provider + SDK + Next patched fetch + real loopback TLS (no Google generation)", () => {
  it("keeps the Gemini dispatcher through Next and completes a TLS handshake delayed beyond 10s", async () => {
    const test = await loopbackTransport(11_200), started = performance.now();
    try {
      const result = await test.generate(), elapsedMs = Math.round(performance.now() - started);
      expect(result).toMatchObject({ success: true, text: "{}", model: environment.GEMINI_MODEL });
      expect(elapsedMs).toBeGreaterThanOrEqual(11_200);
      expect(test.origin).toHaveBeenCalledTimes(1); expect(test.connects).toHaveBeenCalledTimes(1);
      expect(test.dispatches).toHaveBeenCalledTimes(1);
      expect(test.authorizations).toEqual([true]);
      for (const transportPhase of ["dispatch", "socket_assigned", "request_sent", "response_started", "response_headers", "response_complete"]) {
        expect(test.debug.event).toHaveBeenCalledWith("TRANSPORT", expect.any(String), expect.objectContaining({ transportPhase }));
      }
      expect(test.debug.event).toHaveBeenCalledWith("TRANSPORT", "STARTED", expect.objectContaining({ dispatcherInvoked: true, connectTimeoutMs: 30_000 }));
      measurements.push({ case: "slow-tls", elapsedMs, agentDispatches: test.dispatches.mock.calls.length, connections: test.connects.mock.calls.length, tlsVerified: true, success: result.success });
      expect(test.requests).toMatchObject([{ method: "POST", path: "/v1beta/interactions", body: { model: environment.GEMINI_MODEL, store: false, input: prompt.input } }]);
    } finally { await test.close(); }
  }, 25_000);

  it("actually expires the connector near 30s when the local TLS handshake never finishes, without retries", async () => {
    const test = await loopbackTransport(null), started = performance.now();
    try {
      expect(await test.generate()).toEqual({ success: false, code: "PROVIDER_UNAVAILABLE" });
      const elapsedMs = Math.round(performance.now() - started);
      expect(elapsedMs).toBeGreaterThanOrEqual(29_500); expect(elapsedMs).toBeLessThan(36_000);
      expect(test.warning).toHaveBeenCalledWith("Gemini request failed", expect.objectContaining({ httpStatus: null, causeCode: "UND_ERR_CONNECT_TIMEOUT" }));
      expect(test.origin).toHaveBeenCalledTimes(1); expect(test.connects).toHaveBeenCalledTimes(1);
      expect(test.dispatches).toHaveBeenCalledTimes(1); expect(test.requests).toHaveLength(0);
      measurements.push({ case: "connect-timeout", elapsedMs, agentDispatches: test.dispatches.mock.calls.length, connections: test.connects.mock.calls.length, causeCode: "UND_ERR_CONNECT_TIMEOUT", httpStatus: null });
    } finally { await test.close(); }
  }, 40_000);
});


it.each([
  [{ headers: 800 }, false, "request_sent"],
  [{ body: 800 }, true, "response_headers"],
] as const)("distinguishes delayed response phase %s and cancels once at the total deadline", async (delay, headersReceived, phase) => {
  const test = await loopbackTransport(0, delay), started = performance.now();
  try {
    expect(await test.generate(300)).toEqual({ success: false, code: "PROVIDER_TIMEOUT" });
    const elapsedMs = Math.round(performance.now() - started);
    expect(elapsedMs).toBeGreaterThanOrEqual(250); expect(elapsedMs).toBeLessThan(2500);
    expect(test.requests).toHaveLength(1); expect(test.origin).toHaveBeenCalledTimes(1); expect(test.dispatches).toHaveBeenCalledTimes(1);
    expect(test.warning).toHaveBeenCalledWith("Gemini request failed", expect.objectContaining({
      code: "PROVIDER_TIMEOUT", responseReceived: headersReceived, httpStatus: headersReceived ? 200 : null, transportPhase: phase,
    }));
    expect(test.debug.event).not.toHaveBeenCalledWith("SDK_REQUEST", "SUCCESS");
    measurements.push({ case: headersReceived ? "body-timeout" : "headers-timeout", elapsedMs, responseReceived: headersReceived, phase, requests: test.requests.length, connections: test.connects.mock.calls.length });
  } finally { await test.close(); }
}, 5000);


it.skipIf(process.env.GEMINI_METADATA_CHECK !== "1")("GET real model metadata through Next + geminiFetch, no generation", async () => {
  const apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL;
  expect(apiKey).toBeTruthy(); expect(model).toMatch(/^gemini-[a-zA-Z0-9.-]+$/);
  let calls = 0, status = 0, dispatched = 0;
  const origin = vi.fn<typeof fetch>((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    expect(url.origin).toBe("https://generativelanguage.googleapis.com");
    expect(request.method).toBe("GET"); expect(url.pathname).toBe("/v1beta/models/" + model);
    expect(++calls).toBe(1); return nativeFetch(input, init);
  });
  vi.stubGlobal("fetch", createPatchedFetcher(origin, { workAsyncStorage, workUnitAsyncStorage }));
  const { geminiFetch } = await import("../../src/lib/ai/gemini-fetch.server");
  const agent = vi.spyOn(Agent.prototype, "dispatch");
  const client = new GoogleGenAI({ apiKey, vertexai: false, httpOptions: { timeout: 60_000, retryOptions: { attempts: 1 },
    fetch: async (input, options) => {
      const response = await geminiFetch(new Request(input, options), undefined, () => dispatched++);
      status = response.status; return response;
    } } });
  const started = performance.now();
  let metadata: Awaited<ReturnType<typeof client.models.get>>;
  try { metadata = await workAsyncStorage.run(requestContext(), () => client.models.get({ model: model ?? "" })); }
  catch (error: unknown) {
    const { errorDiagnostics } = await import("../../src/lib/ai/gemini-debug.server");
    const diagnostic = errorDiagnostics(error);
    measurements.push({ case: "real-metadata", method: "GET", httpStatus: status || diagnostic.httpStatus, requests: calls,
      dispatcherCallback: dispatched, errorName: diagnostic.errorName, causeCode: diagnostic.causeCode });
    throw Error("Metadata verification failed; inspect sanitized transport artifact");
  }
  expect(status).toBe(200); expect(metadata.name).toBe("models/" + model);
  expect(calls).toBe(1); expect(dispatched).toBe(1); expect(agent).toHaveBeenCalledTimes(1);
  measurements.push({ case: "real-metadata", method: "GET", httpStatus: status, elapsedMs: Math.round(performance.now() - started),
    requests: calls, agentDispatches: agent.mock.calls.length, dispatcherCallback: dispatched });
}, 65_000);
