import "server-only";
import { Agent, type Dispatcher } from "undici";

export const GEMINI_CONNECT_TIMEOUT_MS = 30_000;
export type GeminiTransportPhase = "dispatch" | "socket_assigned" | "request_sent" | "response_started" | "response_headers" | "response_complete";
const handlerPhases = new Map<string, GeminiTransportPhase>([
  ["onConnect", "socket_assigned"], ["onRequestSent", "request_sent"], ["onResponseStarted", "response_started"],
  ["onHeaders", "response_headers"], ["onComplete", "response_complete"],
]);
let dispatcher: Agent | undefined;

/** Next rebuilds Request inputs and drops their opaque dispatcher; pass URL + init instead. */
export function geminiFetch(input: RequestInfo | URL, init?: RequestInit, onDispatch?: (phase: GeminiTransportPhase) => void): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== "https://generativelanguage.googleapis.com") return fetch(input, init);
  dispatcher ??= new Agent({ connect: { timeout: GEMINI_CONNECT_TIMEOUT_MS } });
  const agent = dispatcher;
  const monitored: Pick<Dispatcher, "dispatch"> = {
    dispatch(options, handler) {
      onDispatch?.("dispatch");
      // Preserve every native handler method, receiver and backpressure return value.
      const observed = new Proxy(handler, { get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        const phase = typeof key === "string" ? handlerPhases.get(key) : undefined;
        if (phase) return (...args: unknown[]) => {
          onDispatch?.(phase);
          return typeof value === "function" ? Reflect.apply(value, target, args) : undefined;
        };
        return typeof value === "function" ? value.bind(target) : value;
      } });
      return agent.dispatch(options, observed);
    },
  };
  const options = {
    ...(input instanceof Request ? {
      method: input.method, headers: input.headers, body: input.body, signal: input.signal,
      cache: input.cache, credentials: input.credentials, integrity: input.integrity, keepalive: input.keepalive,
      mode: input.mode, redirect: input.redirect, referrer: input.referrer, referrerPolicy: input.referrerPolicy,
      duplex: "half",
    } : {}),
    ...init, dispatcher: onDispatch ? monitored : agent,
  };
  return fetch(input instanceof Request ? input.url : input, options);
}
