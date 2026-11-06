// Runs an owned temporary production server against the current build, without touching Supabase.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
const port = 3199;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = ""; let launchError;
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", () => {}); child.on("error", (error) => { launchError = error; });
try {
  const deadline = Date.now() + 20000;
  while (!output.includes("Ready in")) {
    if (launchError || child.exitCode !== null || Date.now() > deadline) throw new Error("Temporary production server did not start; check port3199 availability");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const [path, method] of [["/dev/discussion", "GET"], ["/api/dev/discussions", "GET"], ["/api/dev/discussions", "POST"], ["/api/dev/discussions/auth", "POST"], ["/api/dev/blueprints", "GET"], ["/api/dev/blueprints", "POST"], ["/dev/campaigns", "GET"], ["/api/dev/campaigns", "GET"], ["/api/dev/campaigns", "POST"], ["/dev/evaluations", "GET"], ["/api/dev/evaluations", "GET"], ["/api/dev/evaluations", "POST"],["/dev/memories","GET"],["/api/dev/memories","GET"],["/api/dev/memories","POST"]]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "Content-Type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}) });
    assert.equal(response.status, 404); console.log(`PASS production ${method} ${path} returns404`);
  }
} finally { child.kill(); }
