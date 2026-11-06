import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns";
import net from "node:net";
import { z } from "zod";
const { construct, globalDispatcher } = vi.hoisted(() => ({ construct: vi.fn<(options: unknown) => void>(), globalDispatcher: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("undici", () => ({ Agent: class { constructor(options: unknown) { construct(options); } }, setGlobalDispatcher: globalDispatcher }));
const transport = vi.fn<typeof fetch>();
beforeEach(() => { vi.resetModules(); construct.mockClear(); globalDispatcher.mockClear(); transport.mockReset(); vi.stubGlobal("fetch", transport); });
afterEach(() => vi.unstubAllGlobals());
const dispatcherOf = (value: unknown) => z.object({ dispatcher: z.unknown() }).parse(value).dispatcher;

describe("Google-only connection budget", () => {
  it("reuses one 30s connector and preserves SDK request, headers, body and deadline signal", async () => {
    const { geminiFetch, GEMINI_CONNECT_TIMEOUT_MS } = await import("../../src/lib/ai/gemini-fetch.server");
    const signal = new AbortController().signal;
    const input = new Request("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", body: "synthetic-body", signal,
      headers: { "x-goog-api-key": "synthetic-key" } });
    const options = { signal, headers: { "x-test": "unchanged" } };
    const response = new Response("synthetic-response"); transport.mockResolvedValue(response);
    expect(await geminiFetch(input, options)).toBe(response); await geminiFetch("https://generativelanguage.googleapis.com/v1beta/models");
    expect(GEMINI_CONNECT_TIMEOUT_MS).toBe(30000);
    expect(construct).toHaveBeenCalledExactlyOnceWith({ connect: { timeout: 30000 } });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0][0]).toBe(input.url);
    expect(transport.mock.calls[0][1]).toMatchObject({ method: "POST", duplex: "half", body: input.body });
    expect(transport.mock.calls[0][1]).toMatchObject(options);
    expect(dispatcherOf(transport.mock.calls[0][1])).toBe(dispatcherOf(transport.mock.calls[1][1]));
    expect(options).not.toHaveProperty("dispatcher"); expect(input.method).toBe("POST"); expect(await new Response(transport.mock.calls[0][1]?.body).text()).toBe("synthetic-body");
  });

  it("does not replace transport or allocate a dispatcher for other origins", async () => {
    const { geminiFetch } = await import("../../src/lib/ai/gemini-fetch.server");
    transport.mockResolvedValue(new Response("ok"));
    const url = new URL("http://127.0.0.1:54321/rest/v1/example");
    await geminiFetch(url);
    expect(transport).toHaveBeenCalledExactlyOnceWith(url, undefined); expect(construct).not.toHaveBeenCalled();
  });

  it("propagates errors without retrying or extending an aborted caller signal", async () => {
    const { geminiFetch } = await import("../../src/lib/ai/gemini-fetch.server");
    const controller = new AbortController(); const error = new DOMException("Synthetic deadline", "AbortError"); controller.abort(error);
    transport.mockRejectedValue(error);
    await expect(geminiFetch("https://generativelanguage.googleapis.com/v1beta/interactions", { signal: controller.signal })).rejects.toBe(error);
    expect(transport).toHaveBeenCalledTimes(1); expect(transport.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it("leaves global DNS order, address-family selection and global dispatcher unchanged", async () => {
    const order = dns.getDefaultResultOrder(), selection = net.getDefaultAutoSelectFamily();
    const { geminiFetch } = await import("../../src/lib/ai/gemini-fetch.server");
    transport.mockResolvedValue(new Response("ok")); await geminiFetch("https://generativelanguage.googleapis.com/v1beta/models");
    expect(dns.getDefaultResultOrder()).toBe(order); expect(net.getDefaultAutoSelectFamily()).toBe(selection);
    expect(globalDispatcher).not.toHaveBeenCalled();
    expect(construct).toHaveBeenCalledWith({ connect: { timeout: 30000 } });
  });
});
