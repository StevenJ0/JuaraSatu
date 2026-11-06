// Read-only diagnostics: fixed Google endpoint, no real credentials, no generation and no retry.
import assert from "node:assert/strict";
import dns from "node:dns";
import net from "node:net";
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile);
const endpoint = "https://generativelanguage.googleapis.com/v1beta/models";
const modes = ["native", "ipv4-preferred", "https4", "https6", "sdk-app", "sdk-default"];
const baseModes = [...modes]; modes.push("sdk-delayed");
const filename = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const childMode = process.argv[2] === "--child" ? process.argv[3] : null;
function errorSummary(error) {
  const chain = [];
  for (let value = error, depth = 0; value && typeof value === "object" && depth < 6; value = value.cause, depth++)
    chain.push({ name: typeof value.name === "string" && /^[A-Za-z]{1,64}$/.test(value.name) ? value.name : "UnknownError",
      code: typeof value.code === "string" && /^(?:UND_ERR_[A-Z_]+|EACCES|EPERM|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|CERT_HAS_EXPIRED|SELF_SIGNED_CERT_IN_CHAIN|ERR_TLS_CERT_ALTNAME_INVALID)$/.test(value.code) ? value.code : null,
      status: Number.isInteger(value.status) ? value.status : Number.isInteger(value.statusCode) ? value.statusCode : null });
  return chain;
}
if (childMode) {
  await (async () => {
  assert(modes.includes(childMode), "Unknown diagnostic mode");
  const started = Date.now(), originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    assert.equal(url.origin, new URL(endpoint).origin);
    assert(["GET", "HEAD"].includes(method), "Generation/mutation forbidden in diagnostics");
    assert(++calls <= 1, "Unexpected retry");
    return originalFetch(input, init);
  };
  let delayedLookups = 0;
  if (childMode === "sdk-delayed") {
    const originalLookup = dns.lookup;
    dns.lookup = function(host, options, callback) {
      const cb = typeof options === "function" ? options : callback;
      const opts = typeof options === "function" ? undefined : options;
      const wrapped = (error, address, family) => { delayedLookups++; setTimeout(() => cb(error, address, family), 11200); };
      return opts === undefined ? originalLookup(host, wrapped) : originalLookup(host, opts, wrapped);
    };
  }
  try {
    if (childMode === "ipv4-preferred") dns.setDefaultResultOrder("ipv4first");
    if (childMode.startsWith("https")) {
      const family = childMode === "https4" ? 4 : 6;
      const result = await new Promise((resolve, reject) => {
        const request = https.request(endpoint, { method: "HEAD", family, agent: false, rejectUnauthorized: true,
          signal: AbortSignal.timeout(12000) }, response => { response.resume(); resolve({ status: response.statusCode, remoteAddress: response.socket.remoteAddress,
            remoteFamily: response.socket.remoteFamily, tlsAuthorized: response.socket.authorized, tlsProtocol: response.socket.getProtocol() }); });
        request.on("error", reject); request.end();
      });
      console.log(JSON.stringify({ mode: childMode, ...result, elapsedMs: Date.now() - started }));
    } else if (childMode.startsWith("sdk")) {
      const { GoogleGenAI } = await import("@google/genai");
      const helper = new URL("../src/lib/ai/gemini-fetch.server.ts", import.meta.url);
      const appMode = childMode === "sdk-app" || childMode === "sdk-delayed";
      const configuredFetch = appMode && existsSync(helper) ? (await import(helper.href)).geminiFetch : globalThis.fetch;
      let actualStatus = null;
      const fetcher = async (input, options) => { const response = await configuredFetch(input, options); actualStatus = response.status; return response; };
      const client = new GoogleGenAI({ apiKey: "diagnostic-not-a-real-key", vertexai: false,
        ...(appMode ? { httpOptions: { fetch: fetcher } } : {}) });
      try { await client.interactions.get("diagnostic-nonexistent-connection-check", {}, { timeout_ms: childMode === "sdk-delayed" ? 30000 : 12000, retries: { strategy: "none" } }); }
      catch (error) {
        const chain = errorSummary(error), status = actualStatus ?? chain.find(value => value.status !== null)?.status;
        if (!status) throw error;
        console.log(JSON.stringify({ mode: childMode, status, sdkErrorChain: chain, calls, configuredHelper: appMode && existsSync(helper), delayedLookups, elapsedMs: Date.now() - started }));
        return;
      }
      throw Error("Unexpected diagnostic interaction lookup success");
    } else {
      const response = await fetch(endpoint, { method: "GET", signal: AbortSignal.timeout(12000) });
      const status = response.status; await response.body?.cancel();
      console.log(JSON.stringify({ mode: childMode, status, elapsedMs: Date.now() - started }));
    }
  } catch (error) { console.log(JSON.stringify({ mode: childMode, error: errorSummary(error), calls, delayedLookups, elapsedMs: Date.now() - started })); }
  })();
} else {
  const verify = process.argv.includes("--verify");
  const delayed = process.argv.includes("--delayed");
  const cases = delayed ? ["sdk-delayed"] : verify ? Array.from({ length: 5 }, () => "sdk-app") : process.argv.includes("--quick") ? baseModes : Array.from({ length: 2 }, () => baseModes).flat();
  assert(cases.length <= 12, "Diagnostic request cap exceeded");
  const results = [];
  console.log(JSON.stringify({ step: "runtime", node: process.version, undici: process.versions.undici, dnsOrder: dns.getDefaultResultOrder(),
    autoSelectFamily: net.getDefaultAutoSelectFamily(), familyAttemptTimeoutMs: net.getDefaultAutoSelectFamilyAttemptTimeout(), httpRequestCap: cases.length + (verify || delayed ? 0 : 3) }));
  for (const [index, mode] of cases.entries()) {
    try {
      const result = await execute(process.execPath, ["--conditions=react-server", filename, "--child", mode], { cwd: root, timeout: delayed ? 45000 : 15000, maxBuffer: 16384 });
      const row = JSON.parse(result.stdout.trim()); results.push(row); console.log(JSON.stringify({ index: index + 1, ...row }));
    } catch (error) {
      let observed = null; try { observed = JSON.parse(error.stdout?.trim() ?? "null"); } catch { /* No raw process output. */ }
      const row = observed ? { ...observed, processExitAnomaly: true } : { mode, error: "PROBE_PROCESS_TIMEOUT_OR_FAILURE" };
      results.push(row); console.log(JSON.stringify(row));
    }
  }
  if (!verify && !delayed) for (const family of ["default", "4", "6"]) {
    try {
      const args = ["--head", "--silent", "--max-time", "12", "--connect-timeout", "10", "--output", "NUL", "--write-out",
        '{"status":"%{http_code}","remoteAddress":"%{remote_ip}","connectSeconds":%{time_connect},"tlsSeconds":%{time_appconnect},"elapsedSeconds":%{time_total},"proxyConnectStatus":"%{http_connect}"}',
        ...(family === "default" ? [] : ["-" + family]), endpoint];
      const result = await execute(process.env.SystemRoot + "\\System32\\curl.exe", args, { timeout: 15000, maxBuffer: 16384 });
      const parsed = JSON.parse(result.stdout.trim());
      const row = { mode: "curl-" + family, ...parsed, status: Number(parsed.status) }; results.push(row); console.log(JSON.stringify(row));
    } catch (error) {
      let partial = {}; try { partial = JSON.parse(error.stdout?.trim() ?? "{}"); } catch { /* Never print raw stderr. */ }
      const row = { mode: "curl-" + family, error: "CURL_FAILED", exitCode: typeof error.code === "number" || ["ENOENT", "EACCES", "EPERM"].includes(error.code) ? error.code : null, ...partial }; results.push(row); console.log(JSON.stringify(row));
    }
  }
  const output = new URL("../docs/qa/gemini-network-" + (delayed ? "delayed-" : verify ? "verify-" : "baseline-") + new Date().toISOString().replaceAll(":", "-") + ".json", import.meta.url);
  writeFileSync(output, JSON.stringify({ capturedAt: new Date().toISOString(), node: process.version, undici: process.versions.undici,
    requests: results.length, realCredentialsUsed: false, generationCalls: 0, results }, null, 2) + "\n");
  console.log(JSON.stringify({ saved: fileURLToPath(output), successes: results.filter(row => row.status >= 100).length, total: results.length }));
}
