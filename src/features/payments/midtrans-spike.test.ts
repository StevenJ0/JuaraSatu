import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const syntheticKey = "SB-Mid-server-synthetic_cli_key";
let directory: string;
let journal: string;
let preload: string;
let calls: string;

// Every child process replaces fetch before importing the adapter. These tests cannot call the provider.
const fakeTransport = String.raw`
import { appendFileSync, readFileSync } from "node:fs";
globalThis.fetch = async (url, init) => {
  const statePath = process.argv[process.argv.indexOf('--state') + 1];
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  appendFileSync(process.env.SPIKE_TEST_CALLS, init.method + '\n');
  if (init.method === 'POST') {
    const body = JSON.parse(init.body);
    if (state.phase !== 'charge_requested' || state.providerOrderId !== body.transaction_details.order_id || state.amountIdr !== body.transaction_details.gross_amount) {
      throw new Error('reference was not persisted before HTTP');
    }
    if (process.env.SPIKE_TEST_MODE === 'ambiguous') throw new Error('synthetic network failure ' + process.env.MIDTRANS_SERVER_KEY);
  }
  if (process.env.SPIKE_TEST_MODE === 'not_found') return Response.json({status_code:'404'}, {status:404});
  const expiry = new Date(Date.parse(state.paymentDueAt) + 7*3600000).toISOString().slice(0,19).replace('T',' ');
  return Response.json({
    status_code: '201', order_id: state.providerOrderId, transaction_id: 'cli-synthetic-txn',
    merchant_id: 'G_SYNTHETIC', gross_amount: '216000.00', currency: 'IDR', payment_type: 'qris',
    transaction_status: 'pending', fraud_status: 'accept', expiry_time: expiry,
    actions: [{name:'generate-qr-code',method:'GET',url:'https://api.sandbox.midtrans.com/v2/qris/cli-synthetic-txn/qr-code'}],
  }, {status:init.method === 'POST' ? 201 : 200});
};
`;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "campaignlab-b05-test-"));
  journal = join(directory, "state.json");
  preload = join(directory, "fetch.mjs");
  calls = join(directory, "calls.txt");
  await writeFile(preload, fakeTransport);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function run(args: string[], overrides: Record<string, string> = {}) {
  return new Promise<{ exitCode: string | number; stdout: string; stderr: string }>((resolveResult) => {
    execFile(process.execPath, [
      "--import", pathToFileURL(preload).href,
      "--conditions=react-server", "--experimental-strip-types",
      resolve("scripts/midtrans-spike.mjs"), ...args,
    ], {
      cwd: process.cwd(), encoding: "utf8", timeout: 5_000,
      env: {
        ...process.env, MIDTRANS_SERVER_KEY: syntheticKey, MIDTRANS_MERCHANT_ID: "G_SYNTHETIC",
        MIDTRANS_QRIS_ACQUIRER: "gopay", SPIKE_TEST_CALLS: calls, ...overrides,
      },
    }, (error, stdout, stderr) => resolveResult({ exitCode: error?.code ?? 0, stdout, stderr }));
  });
}

describe("CLI spike lokal — transport selalu tiruan", () => {
  it("help tidak butuh key atau membuat HTTP/file state", async () => {
    const result = await run(["--help"], { MIDTRANS_SERVER_KEY: "", MIDTRANS_MERCHANT_ID: "" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("synthetic, no real money");
    expect(existsSync(calls)).toBe(false);
    expect(existsSync(journal)).toBe(false);
  });

  it("config kosong gagal sebelum menulis reference atau memanggil HTTP", async () => {
    const result = await run(["create", "--state", journal], { MIDTRANS_SERVER_KEY: "", MIDTRANS_MERCHANT_ID: "" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('"code":"INVALID_CONFIGURATION"');
    expect(existsSync(journal)).toBe(false);
    expect(existsSync(calls)).toBe(false);
  });

  it("reference sudah durable sebelum POST, create kedua ditolak, status hanya GET", async () => {
    expect((await run(["create", "--state", journal])).exitCode).toBe(0);
    const saved = JSON.parse(await readFile(journal, "utf8"));
    expect(saved.phase).toBe("charge_returned");
    expect(saved.amountIdr).toBe(216_000);
    expect(saved.result.providerOrderId).toBe(saved.providerOrderId);
    expect(JSON.stringify(saved)).not.toContain(syntheticKey);
    const second = await run(["create", "--state", journal]);
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("STATE_ALREADY_EXISTS_USE_STATUS");
    const status = await run(["status", "--state", journal]);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).transaction.providerOrderId).toBe(saved.providerOrderId);
    expect(await readFile(calls, "utf8")).toBe("POST\nGET\n");
  });

  it("network failure menyimpan ambiguity dan reference lama, bukan blind POST ulang", async () => {
    const first = await run(["create", "--state", journal], { SPIKE_TEST_MODE: "ambiguous" });
    expect(first.exitCode).toBe(1);
    expect(first.stderr).toContain('"reconciliationRequired":true');
    expect(first.stderr).not.toContain(syntheticKey);
    const saved = JSON.parse(await readFile(journal, "utf8"));
    expect(saved.phase).toBe("ambiguous");
    expect(saved.lastErrorCode).toBe("PROVIDER_UNAVAILABLE");
    expect((await run(["create", "--state", journal])).stderr).toContain("STATE_ALREADY_EXISTS_USE_STATUS");
    const status = await run(["status", "--state", journal]);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).transaction.providerOrderId).toBe(saved.providerOrderId);
    expect(await readFile(calls, "utf8")).toBe("POST\nGET\n");
  });

  it("404 status tetap observasi, tidak membuat charge baru", async () => {
    expect((await run(["create", "--state", journal])).exitCode).toBe(0);
    const status = await run(["status", "--state", journal], { SPIKE_TEST_MODE: "not_found" });
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).kind).toBe("not_found");
    expect(await readFile(calls, "utf8")).toBe("POST\nGET\n");
  });

  it("tidak menulis state di repository", async () => {
    const result = await run(["create", "--state", resolve("should-not-exist-b05.json")]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("STATE_MUST_BE_IN_TEMP_DIRECTORY");
    expect(existsSync(resolve("should-not-exist-b05.json"))).toBe(false);
    expect(existsSync(calls)).toBe(false);
  });

  it("file state yang sudah ada tidak ditimpa", async () => {
    await writeFile(journal, "synthetic-original-content");
    const result = await run(["create", "--state", journal]);
    expect(result.exitCode).toBe(1);
    expect(await readFile(journal, "utf8")).toBe("synthetic-original-content");
    expect(existsSync(calls)).toBe(false);
  });
});
