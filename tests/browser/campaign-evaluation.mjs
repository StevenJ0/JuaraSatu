import { randomUUID } from 'node:crypto';
import { fixtureTokens, localFixtureSettings } from '../fixtures/local-campaign.mjs';
import { createEvaluationFixture } from '../fixtures/local-evaluation.mjs';
// Run against `npm run dev -- --port 3100`; requires local Chrome, no test dependencies.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const baseUrl = new URL(process.env.DISCUSSION_BASE_URL ?? "http://localhost:3100");
assert.ok(["localhost", "127.0.0.1"].includes(baseUrl.hostname), "Use a local development server");
const cache = resolve("node_modules/.cache/campaign-evaluation");
await mkdir(cache, { recursive: true });
// Keep Chrome's frequently written profile outside Turbopack's watched workspace.
const profile = await mkdtemp(resolve(tmpdir(), "campaign-discussion-chrome-"));
const chrome = spawn(process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
let launchError;
chrome.on("error", (error) => { launchError = error; });
let socket;
const pending = new Map();
let sequence = 0;
let passed = 0;
const runtimeErrors = [];
const pause = () => new Promise((resolve) => setTimeout(resolve, 50));

async function waitFor(check, message) {
  const deadline = Date.now() + 30_000;
  do {
    if (launchError) throw launchError;
    if (await check()) return;
    await pause();
  } while (Date.now() < deadline);
  throw new Error(message);
}
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, method === "Page.navigate" ? 45_000 : 10_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function input(id, value) {
  await evaluate(`(() => { const field = document.getElementById(${JSON.stringify(id)}); field.focus(); field.select(); })()`);
  await command("Input.insertText", { text: value });
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
}

async function test(name,check){await check();passed++;console.log(`PASS ${name}`);}
try {
  let port;
  await waitFor(async () => {
    try { port = (await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; return true; }
    catch { return false; }
  }, "Chrome did not start; set CHROME_PATH if necessary");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((page) => page.type === "page");
  assert.ok(page, "Chrome page missing");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails.text);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

  const [token] = await fixtureTokens(); const fixture = await createEvaluationFixture(token, false); const { accounts } = localFixtureSettings();
  async function click(selector) {
    await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled)`), `Control unavailable: ${selector}`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }
  async function choose(id, value) {
    await evaluate(`(() => { const el=document.getElementById(${JSON.stringify(id)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
  }
  const read = () => evaluate(`fetch('/api/dev/evaluations?campaignId=${fixture.campaignId}&scenario='+document.getElementById('evaluation-scenario').value).then(r=>r.json())`);
  const post = (body) => evaluate(`fetch('/api/dev/evaluations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>({status:r.status,body:await r.json()}))`);
  const report = () => evaluate("document.querySelector('[data-evaluation-review-status]')?.textContent??''");
  let parentId;
  await command("Page.navigate", { url: new URL("/dev/discussion", baseUrl).href });
  await waitFor(() => evaluate("Boolean(document.getElementById('discussion-email')&&Object.keys(document.getElementById('discussion-email')).some(k=>k.startsWith('__reactProps')))"), "Login did not hydrate");
  await test("real owner login opens a persisted closed campaign and evaluation link", async () => {
    await input("discussion-email", accounts[0].email); await input("discussion-password", accounts[0].password); await click(".discussion-login button");
    await waitFor(() => evaluate("Boolean(document.getElementById('discussion-create'))"), "Login failed");
    await command("Page.navigate", { url: new URL(`/dev/campaigns?campaignId=${fixture.campaignId}`, baseUrl).href });
    await waitFor(() => evaluate("Boolean(document.getElementById('campaign-open-evaluation'))"), "Closed campaign link missing");
    await click("#campaign-open-evaluation"); await waitFor(() => evaluate("Boolean(document.querySelector('[data-evaluation-metrics]'))"), "Evaluation context missing");
    assert.ok(await evaluate("document.body.textContent.includes('SIMULASI DEVELOPMENT')"));
  });
  await test("owner records actual reported expense and explicitly reviews completeness", async () => {
    assert.equal((await read()).summary.actualPromotionSpendIdr, null);
    await input("evaluation-cost-description", "Pengeluaran sintetis browser Slice 7"); await input("evaluation-cost-amount", "50000"); await click("#evaluation-cost-save");
    await waitFor(() => evaluate("document.querySelector('[data-cost-review-state]').textContent.includes('50.000')"), "Recorded cost missing");
    assert.equal((await read()).context.costsCompleteness, "unreviewed");
    await click("#evaluation-cost-confirm"); await click("#evaluation-cost-review");
    await waitFor(() => evaluate("document.querySelector('[data-cost-review-state]').textContent.includes('confirmed_complete')"), "Cost completeness missing");
    assert.equal((await read()).summary.contributionIdr, 214000);
  });
  await test("AI interpretation and deterministic KPI snapshot persist before owner review", async () => {
    await click("#evaluation-generate"); await waitFor(async () => (await report()).includes("available · unreviewed"), "Evaluation snapshot missing");
    const view = await read(); parentId = view.history[0].row.id; assert.equal(view.summary.observed.paidUnitsInWindow, 8); assert.equal(view.summary.observed.attributedPaidUnits, 5);
    assert.equal(view.history[0].row.evaluation_kind, "provisional"); assert.equal(await evaluate("document.getElementById('evaluation-review').disabled"), true);
  });
  await test("explicit owner review appends a child and survives full browser refresh", async () => {
    await click("#evaluation-review-confirm"); await click("#evaluation-review");
    await waitFor(async () => (await report()).includes("available · reviewed"), "Reviewed snapshot missing");
    await command("Page.reload"); await waitFor(async () => (await report()).includes("available · reviewed"), "Review not restored after refresh");
    const view = await read(); assert.equal(view.history.length, 2); assert.equal(view.history.find((entry) => entry.row.id === parentId).row.analysis_json.review.status, "unreviewed");
  });
  await test("scenario changes distinguish below-target, missing costs and unavailable C6", async () => {
    await choose("evaluation-scenario", "below_target"); await waitFor(() => evaluate("document.querySelector('[data-evaluation-metrics]').textContent.includes('49.000')"), "Below-target scenario missing");
    assert.equal((await read()).summary.observed.paidUnitsInWindow, 3);
    await choose("evaluation-scenario", "missing_cost"); await waitFor(async () => (await read()).summary.contributionIdr === null, "Missing costs not preserved");
    await choose("evaluation-scenario", "unavailable"); await waitFor(() => evaluate("document.querySelector('[data-kpi-provenance]').textContent.includes('tidak tersedia')"), "Unavailable C6 missing");
    assert.equal((await read()).summary.observed.paidUnitsInWindow, null);
    await choose("evaluation-scenario", "exceeds_target");
  });
  await test("provider failure and invalid output save explicit failure metadata and retain earlier reports", async () => {
    await choose("evaluation-provider", "failure"); await click("#evaluation-generate"); await waitFor(async () => (await report()).startsWith("failed"), "Provider failure not shown");
    assert.ok(await evaluate("document.querySelector('[data-evaluation-report]').textContent.includes('Provider gagal')"));
    await choose("evaluation-provider", "invalid"); await click("#evaluation-generate"); await waitFor(async () => (await report()).startsWith("invalid"), "Invalid output not shown");
    assert.ok((await read()).history.some((entry) => entry.row.id === parentId));
  });
  await test("void/replacement preserves expense history and invalidates prior snapshot freshness", async () => {
    await input("evaluation-void-reason", "Koreksi expense sintetis browser"); await click("[data-cost-void]");
    await waitFor(() => evaluate("document.querySelector('[data-cost-review-state]').textContent.includes('unreviewed')"), "Void did not invalidate review");
    let view = await read(); assert.ok(view.context.costs[0].voided_at); assert.ok(view.history.find((entry) => entry.row.id === parentId).stale);
    const denied = await post({ action: "review", campaignId: fixture.campaignId, requestId: randomUUID(), evaluationId: parentId, expectedCampaignVersion: view.context.snapshot.campaign.version, expectedContextHash: view.context.contextHash, confirm: true });
    assert.equal(denied.status, 409); assert.equal(denied.body.code, "STALE_CONTEXT");
    await input("evaluation-cost-description", "Replacement expense sintetis browser"); await click("#evaluation-cost-save");
    await waitFor(async () => (await read()).context.costs.length === 2, "Replacement expense missing");
    await waitFor(() => evaluate("document.querySelector('.evaluation-costs').textContent.includes('Replacement expense sintetis browser') && !document.getElementById('evaluation-cost-save').disabled"), "Replacement expense UI did not finish reloading");
    await click("#evaluation-cost-confirm"); await click("#evaluation-cost-review");
    await waitFor(() => evaluate("document.querySelector('[data-cost-review-state]').textContent.includes('confirmed_complete')"), "Replacement review missing");
    view = await read(); assert.equal(view.summary.actualPromotionSpendIdr, 50000);
  });
  await test("owner generates and reviews a fresh snapshot after correction", async () => {
    await choose("evaluation-provider", "valid"); await click("#evaluation-generate"); await waitFor(async () => (await report()).includes("available · unreviewed"), "Fresh evaluation missing");
    await click("#evaluation-review-confirm"); await click("#evaluation-review"); await waitFor(async () => (await report()).includes("available · reviewed"), "Fresh review missing");
    await command("Page.reload"); await waitFor(async () => (await report()).includes("available · reviewed"), "Fresh review not durable");
  });
  await test("stale finalization shows a recovery error and requires a fresh owner-reviewed snapshot", async () => {
    const view = await read(); const task = view.context.snapshot.tasks.find((entry) => !entry.completed_at); assert.ok(task);
    const change = { action: "task", campaignId: fixture.campaignId, blueprintId: task.blueprint_id, taskId: task.id, expectedTaskVersion: task.version, completed: true };
    assert.equal(await evaluate(`fetch('/api/dev/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(change)})}).then(r=>r.status)`), 200);
    await click("#evaluation-finalize-confirm"); await click("#evaluation-finalize");
    await waitFor(() => evaluate("Boolean(document.querySelector('[role=alert]')?.textContent.includes('Sumber atau skenario berubah'))"), "Stale finalization recovery not shown");
    assert.equal((await read()).context.snapshot.campaign.status, "closed");
    await click("#evaluation-refresh"); await click("#evaluation-generate");
    await waitFor(async () => (await report()).includes("available · unreviewed"), "Regeneration after conflict missing");
    await click("#evaluation-review-confirm"); await click("#evaluation-review");
    await waitFor(async () => (await report()).includes("available · reviewed"), "New review after conflict missing");
  });
  await test("explicit finalization completes the local simulation, freezes writes and survives refresh", async () => {
    const view = await read(); const row = view.history[0].row;
    const body = { action: "finalize", campaignId: fixture.campaignId, requestId: randomUUID(), evaluationId: row.id, expectedCampaignVersion: view.context.snapshot.campaign.version, expectedContextHash: view.context.contextHash, confirm: true };
    assert.equal((await post({ ...body, confirm: false })).status, 400);
    assert.equal(await evaluate("document.getElementById('evaluation-finalize').disabled"), true);
    await click("#evaluation-finalize-confirm"); await click("#evaluation-finalize");
    await waitFor(() => evaluate("document.querySelector('[data-evaluation-state]')?.textContent.includes('completed')"), "Completion not shown");
    await command("Page.reload"); await waitFor(() => evaluate("Boolean(document.querySelector('[data-finalization-result]'))"), "Completion not durable after refresh");
    assert.equal(await evaluate("document.getElementById('evaluation-cost-save').disabled"), true);
    await command("Page.navigate", { url: new URL(`/dev/campaigns?campaignId=${fixture.campaignId}`, baseUrl).href });
    await waitFor(() => evaluate("Boolean(document.getElementById('campaign-open-evaluation'))"), "Completed campaign lost its evaluation link");
    assert.equal(await evaluate("[...document.querySelectorAll('[data-execution-task]')].every(task=>task.disabled)"), true);
    await click("#campaign-open-evaluation"); await waitFor(() => evaluate("Boolean(document.querySelector('[data-finalization-result]'))"), "Completed evaluation cannot be reopened");
    const current = await read(); assert.equal(current.context.snapshot.campaign.status, "completed"); assert.equal(current.history[0].row.evaluation_kind, "final");
    assert.equal(current.history[0].row.metrics_json.finalization.mode, "development_synthetic"); assert.equal(current.history[0].stale, false);
    assert.equal(current.finalization.productionEligible, false); assert.ok(current.history[0].memoryExclusions.includes("SYNTHETIC_EVALUATION"));
    await writeFile(resolve(cache, "example.json"), JSON.stringify(current, null, 2));
  });
  await test("desktop/mobile evaluation is readable without horizontal overflow", async () => {
    for (const width of [1440, 390, 320]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 1100, deviceScaleFactor: 1, mobile: width < 500 });
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true); await evaluate("document.querySelector('.evaluation-detail').scrollIntoView({block:'start'})");
      const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(resolve(cache, `evaluation-${width}.png`), Buffer.from(screenshot.data, "base64"));
    }
    await evaluate("document.querySelector('[data-finalization-result]').scrollIntoView({block:'center'})");
    const completion = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(resolve(cache, "evaluation-completion-320.png"), Buffer.from(completion.data, "base64"));
  });
  await test("owner B cannot read owner A evaluation history after fresh browser login", async () => {
    await evaluate("fetch('/api/dev/discussions/auth',{method:'DELETE'}).then(r=>r.status)"); await command("Page.navigate", { url: new URL("/dev/discussion", baseUrl).href });
    await waitFor(() => evaluate("Boolean(document.getElementById('discussion-email')&&Object.keys(document.getElementById('discussion-email')).some(k=>k.startsWith('__reactProps')))"), "Second login did not hydrate");
    await input("discussion-email", accounts[1].email); await input("discussion-password", accounts[1].password); await click(".discussion-login button");
    await waitFor(() => evaluate("Boolean(document.getElementById('discussion-create'))"), "Owner B login failed");
    await command("Page.navigate", { url: new URL(`/dev/evaluations?campaignId=${fixture.campaignId}`, baseUrl).href });
    await waitFor(() => evaluate("Boolean(document.querySelector('[role=alert]')?.textContent.includes('tidak ditemukan'))"), "Foreign evaluation not denied");
    assert.equal(await evaluate("Boolean(document.querySelector('[data-evaluation-metrics]'))"), false);
  });
  assert.deepEqual(runtimeErrors, []); console.log(`${passed} campaign evaluation browser groups passed; explicit synthetic completion, no memory writes`);
} finally {
  for (const request of pending.values()) clearTimeout(request.timer); socket?.close(); chrome.kill();
}
