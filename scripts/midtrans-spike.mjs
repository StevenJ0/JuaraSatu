// Manual, synthetic Sandbox probe. No app server, database, buyer data, webhook, or email.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { open, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { env, loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createMidtransSandboxClient, MidtransSandboxError, parseMidtransSandboxConfig } from "../src/features/payments/midtrans-sandbox.ts";

const help = `Midtrans Sandbox spike — synthetic, no real money.

Node >=22.6 with TypeScript stripping is required (verified locally with Node 24).
Fill server-only MIDTRANS_SERVER_KEY and MIDTRANS_MERCHANT_ID in .env.local first.

Create one synthetic Rp216.000 QR, saving its reference BEFORE HTTP:
  npm run spike:midtrans -- create --state /private/tmp/campaignlab-midtrans-spike.json

Read the SAME transaction without making a charge:
  npm run spike:midtrans -- status --state /private/tmp/campaignlab-midtrans-spike.json

The state path must be a NEW .json file in the OS temporary directory.
Never delete/recreate its reference to retry an ambiguous charge.
Use only the official Sandbox simulator; never a real payment app.
This local journal does not replace the database attempt contract required for application checkout.
`;

const journalSchema = z.object({
  version: z.literal(1),
  environment: z.literal("sandbox"),
  providerOrderId: z.string().regex(/^cl-spike-[a-f0-9-]+$/),
  amountIdr: z.literal(216_000),
  paymentDueAt: z.iso.datetime(),
  phase: z.enum(["charge_requested", "charge_returned", "ambiguous"]),
  result: z.object({ providerTransactionId: z.string() }).optional(),
});

function localError(code) {
  const error = new Error(code);
  error.name = "SpikeLocalError";
  return error;
}

async function statePath(value) {
  if (!value || !isAbsolute(value) || !value.endsWith(".json")) throw localError("STATE_PATH_INVALID");
  const parent = await realpath(dirname(value));
  // /private/tmp hanya ada di macOS. Di Windows dan Linux root yang tidak ada dilewati, bukan menggagalkan semua perintah.
  const roots = (await Promise.all([tmpdir(), "/private/tmp"].map((root) => realpath(root).catch(() => null)))).filter((root) => root !== null);
  if (!roots.some((root) => {
    const subpath = relative(root, parent);
    return subpath === "" || (!isAbsolute(subpath) && subpath !== ".." && !subpath.startsWith(`..${sep}`));
  })) throw localError("STATE_MUST_BE_IN_TEMP_DIRECTORY");
  return resolve(parent, basename(value));
}

async function updateJournal(path, journal) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && ["--help", "help"].includes(args[0]))) {
    console.log(help);
    return;
  }
  const [command, flag, value] = args;
  if (args.length !== 3 || !["create", "status"].includes(command) || flag !== "--state") throw localError("ARGUMENTS_INVALID");
  const path = await statePath(value);
  const localEnv = fileURLToPath(new URL("../.env.local", import.meta.url));
  if (existsSync(localEnv)) loadEnvFile(localEnv);
  const client = createMidtransSandboxClient(parseMidtransSandboxConfig(env));

  if (command === "status") {
    const parsed = journalSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (!parsed.success) throw localError("STATE_INVALID");
    const journal = parsed.data;
    const result = await client.getStatus({
      providerOrderId: journal.providerOrderId,
      amountIdr: journal.amountIdr,
      providerTransactionId: journal.result?.providerTransactionId,
    });
    console.log(JSON.stringify({ environment: "sandbox", statePath: path, ...result }, null, 2));
    return;
  }

  const journal = {
    version: 1, environment: "sandbox", providerOrderId: `cl-spike-${randomUUID()}`,
    amountIdr: 216_000, paymentDueAt: new Date(Date.now() + 900_000).toISOString(), phase: "charge_requested",
  };
  // Exclusive creation prevents two create commands using the same state file from sending two POSTs.
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") throw localError("STATE_ALREADY_EXISTS_USE_STATUS");
    throw localError("STATE_CREATE_FAILED");
  }
  try {
    await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  console.log(JSON.stringify({ environment: "sandbox", statePath: path, providerOrderId: journal.providerOrderId, phase: journal.phase }));
  try {
    const result = await client.createQris(journal);
    await updateJournal(path, { ...journal, phase: "charge_returned", result });
    console.log(JSON.stringify({ environment: "sandbox", statePath: path, ...result }, null, 2));
  } catch (error) {
    const code = error instanceof MidtransSandboxError ? error.code : "SPIKE_LOCAL_ERROR";
    await updateJournal(path, { ...journal, phase: "ambiguous", lastErrorCode: code });
    throw error;
  }
}

main().catch((error) => {
  const report = error instanceof MidtransSandboxError
    ? { code: error.code, operation: error.operation, reconciliationRequired: error.reconciliationRequired }
    : { code: error instanceof Error && error.name === "SpikeLocalError" ? error.message : "SPIKE_LOCAL_ERROR" };
  console.error(JSON.stringify(report));
  process.exitCode = 1;
});
