// Run against `npm run dev -- --port 3100`; requires local Chrome, no test dependencies.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { discussionFixtureScope } from "../fixtures/local-campaign.mjs";

const baseUrl = new URL(process.env.DISCUSSION_BASE_URL ?? "http://localhost:3100");
assert.ok(["localhost", "127.0.0.1"].includes(baseUrl.hostname), "Use a local development server");
const cache = resolve("node_modules/.cache/campaign-blueprint");
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "campaign-blueprint-chrome-"));
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

  const accounts = JSON.parse(await readFile("node_modules/.cache/database-v21-cutover/fixture-credentials.json", "utf8"));
  async function click(selector) {
    await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`), `Control unavailable: ${selector}`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }
  async function selectScenario(value) {
    await evaluate(`(() => {const el=document.getElementById('blueprint-scenario');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  }
  const status = () => evaluate("document.querySelector('[data-blueprint-status]')?.textContent ?? ''");
  const blueprintApi = (body) => evaluate(`fetch('/api/dev/blueprints',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>({status:r.status,body:await r.json()}))`);
  let campaignId; let sessionId; let oldApproval;
  await command("Page.navigate", { url: new URL("/dev/discussion", baseUrl).href });
  await waitFor(() => evaluate("Boolean(document.getElementById('discussion-email')&&Object.keys(document.getElementById('discussion-email')).some(k=>k.startsWith('__reactProps')))"), "Login did not hydrate");
  await test("blueprint uses real local login and HttpOnly cookies", async () => {
    await input("discussion-email", accounts[0].email); await input("discussion-password", accounts[0].password); await click(".discussion-login button");
    await waitFor(() => evaluate("Boolean(document.getElementById('discussion-create'))"), "Login failed");
    assert.equal(await evaluate("document.cookie.includes('campaign-lab-dev-access')"), false);
  });
  await test("reopens an existing persisted discussion and creates a sourced draft with proposed blueprint", async () => {
    await evaluate(`(() => { const el=document.getElementById('discussion-preorder'); el.value=${JSON.stringify(discussionFixtureScope().preorderId)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await click("#discussion-create"); await waitFor(() => evaluate("Boolean(document.getElementById('discussion-message'))"), "Session missing");
    await input("discussion-message", "Pengingat unit 4 biaya 10000 untuk blueprint"); await click("#discussion-send");
    await waitFor(() => evaluate("document.querySelectorAll('.discussion-proposal').length===1 && document.getElementById('discussion-send').textContent==='Kirim pesan'"), "Persisted proposal missing");
    sessionId = await evaluate("new URL(location.href).searchParams.get('sessionId')");
    await command("Page.reload");
    await waitFor(() => evaluate("Boolean(document.querySelector('[data-blueprint-create]:not(:disabled)'))"), "Eligible persisted source missing after reload");
    await click("[data-blueprint-create]");
    await waitFor(async () => (await status()).includes("proposed · blueprint v1"), "Atomic draft/blueprint creation failed");
    campaignId = await evaluate("new URL(location.href).searchParams.get('campaignId')"); assert.ok(campaignId);
    assert.ok(await evaluate("document.querySelector('.blueprint-panel').textContent.includes('120.000')"));
    assert.equal(await evaluate("document.getElementById('blueprint-approve').disabled"), true);
  });
  await test("failed and invalid provider output leave the persisted active version intact", async () => {
    await selectScenario("failure"); await click("#blueprint-save");
    await waitFor(() => evaluate("Boolean(document.querySelector('.blueprint-error')?.textContent.includes('gagal'))"), "Provider failure not shown");
    assert.ok((await status()).includes("blueprint v1"));
    await selectScenario("invalid"); await click("#blueprint-save");
    await waitFor(() => evaluate("Boolean(document.querySelector('.blueprint-error')?.textContent.includes('ditolak'))"), "Invalid output not shown");
    assert.ok((await status()).includes("blueprint v1")); await selectScenario("valid");
  });
  await test("owner revises independent offer, units and budget and saves a new version", async () => {
    await input("blueprint-discount", "500"); await input("blueprint-budget", "20000"); await input("blueprint-units", "6");
    await input("blueprint-notes", "Tambahkan pengingat akhir"); await click("#blueprint-save");
    await waitFor(async () => (await status()).includes("proposed · blueprint v2"), "Revision not persisted");
    assert.ok(await evaluate("document.querySelector('.blueprint-panel').textContent.includes('114.000')"));
    assert.ok(await evaluate("document.querySelector('.blueprint-panel').textContent.includes('214.000')"));
  });
  await test("invalid confirmation and stale approval are rejected without materializing tasks", async () => {
    const view = await evaluate(`fetch('/api/dev/blueprints?campaignId=${campaignId}').then(r=>r.json())`);
    oldApproval = { action: "approve", campaignId, blueprintId: view.active.id, expectedBlueprintVersion: 2, expectedCampaignVersion: view.campaign.version, confirm: true };
    assert.equal((await blueprintApi({ ...oldApproval, confirm: false })).status, 400);
    assert.equal((await blueprintApi({ ...oldApproval, expectedBlueprintVersion: 1 })).status, 409);
    const unchanged = await evaluate(`fetch('/api/dev/blueprints?campaignId=${campaignId}').then(r=>r.json())`);
    assert.equal(unchanged.active.approval_status, "proposed"); assert.equal(unchanged.materialized.tasks.length, 0);
  });
  await test("explicit owner approval is persisted and survives a complete browser reload", async () => {
    await click("#blueprint-confirm"); await click("#blueprint-approve");
    await waitFor(async () => (await status()).includes("approved · blueprint v2"), "Approval missing");
    await command("Page.reload"); await waitFor(async () => (await status()).includes("approved · blueprint v2"), "Approved version not restored");
    assert.equal(await evaluate("new URL(location.href).searchParams.get('sessionId')"), sessionId);
    const view = await evaluate(`fetch('/api/dev/blueprints?campaignId=${campaignId}').then(r=>r.json())`);
    assert.equal(view.campaign.status, "draft"); assert.equal(view.campaign.published_at, null);
    assert.equal(view.active.approved_by_user_id, accounts[0].id); assert.ok(view.active.approved_at);
    assert.equal(view.materialized.tasks.length, 3); assert.equal(view.materialized.contents.length, 1);
  });
  await test("a further revision invalidates approval and the old version cannot be approved", async () => {
    await input("blueprint-goal", "Meninjau tambahan paid units secara hipotetis tanpa janji hasil."); await click("#blueprint-save");
    await waitFor(async () => (await status()).includes("proposed · blueprint v3"), "Reapproval state missing");
    assert.equal((await blueprintApi(oldApproval)).status, 409);
    await click("#blueprint-confirm"); await click("#blueprint-approve");
    await waitFor(async () => (await status()).includes("approved · blueprint v3"), "New version approval missing");
    const latest = await evaluate(`fetch('/api/dev/blueprints?campaignId=${campaignId}').then(r=>r.json())`);
    await writeFile(resolve(cache, "example.json"), JSON.stringify(latest, null, 2));
  });
  await test("desktop/mobile blueprint preview has no horizontal overflow and records render evidence", async () => {
    for (const width of [1440, 390, 320]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 1100, deviceScaleFactor: 1, mobile: width < 500 });
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
      await evaluate("document.querySelector('[data-blueprint-status]').scrollIntoView({block:'start'})");
      const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(resolve(cache, `blueprint-${width}.png`), Buffer.from(screenshot.data, "base64"));
    }
    assert.equal(await evaluate("document.querySelectorAll('.blueprint-panel input:not([type=checkbox]),.blueprint-panel textarea,.blueprint-panel select').length === [...document.querySelectorAll('.blueprint-panel input:not([type=checkbox]),.blueprint-panel textarea,.blueprint-panel select')].filter(el=>el.closest('label')).length"), true);
  });
  assert.deepEqual(runtimeErrors, []);
  console.log(`${passed} campaign blueprint browser groups passed`);
} catch (error) {
  console.error("Browser state:", await evaluate("({login:!!document.querySelector('.discussion-login'),emailPresent:!!document.getElementById('discussion-email')?.value,passwordPresent:!!document.getElementById('discussion-password')?.value,alerts:[...document.querySelectorAll('[role=alert]')].map(el=>el.textContent),messages:document.querySelectorAll('.discussion-messages>li').length,send:document.getElementById('discussion-send')?.textContent})"));
  throw error;
} finally {
  for (const request of pending.values()) clearTimeout(request.timer); socket?.close(); chrome.kill();
}
