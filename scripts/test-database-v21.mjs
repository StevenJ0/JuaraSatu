import { runDatabaseContracts } from "../database/v2.1/tests/job-acknowledgement.mjs";

// Canonical Layer 1: one disposable engine, explicit historical and current contracts.
await runDatabaseContracts({ fullChain: true, strictDocs: process.argv.includes("--strict-docs") });
