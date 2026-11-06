import { fixtureTokens, createCampaignFixture, closeFixtureCampaign, localFixtureSettings } from '../fixtures/local-campaign.mjs';
// Run against `npm run dev -- --port 3100`; requires local Chrome, no test dependencies.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const baseUrl = new URL(process.env.DISCUSSION_BASE_URL ?? "http://localhost:3100");
assert.ok(["localhost", "127.0.0.1"].includes(baseUrl.hostname), "Use a local development server");
const cache = resolve("node_modules/.cache/campaign-execution");
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

  const [token] = await fixtureTokens();
  const fixture = await createCampaignFixture(token);
  const { accounts } = localFixtureSettings();
  async function click(selector) {
    await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`), `Control unavailable: ${selector}`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }
  const state = () => evaluate("document.querySelector('[data-campaign-state]')?.textContent??''");
  const progress = () => evaluate("document.querySelector('[data-execution-progress]')?.textContent??''");
  const view = () => evaluate(`fetch('/api/dev/campaigns?campaignId=${fixture.command.campaignId}').then(r=>r.json())`);
  const post = (body) => evaluate(`fetch('/api/dev/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>({status:r.status,body:await r.json()}))`);
  try {
    await command("Browser.grantPermissions", { origin: baseUrl.origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    await command("Page.bringToFront");
    await command("Page.navigate", { url: new URL(`/dev/discussion?sessionId=${fixture.sessionId}&campaignId=${fixture.command.campaignId}`, baseUrl).href });
    await waitFor(() => evaluate("Boolean(document.getElementById('discussion-email')&&Object.keys(document.getElementById('discussion-email')).some(k=>k.startsWith('__reactProps')))"), "Login did not hydrate");
    await test("login and open an actual persisted approved blueprint, then its publishing UI", async () => {
      await input("discussion-email", accounts[0].email); await input("discussion-password", accounts[0].password); await click(".discussion-login button");
      await waitFor(() => evaluate("Boolean(document.getElementById('blueprint-open-execution'))"), "Approved blueprint link missing");
      await click("#blueprint-open-execution"); await waitFor(async () => (await state()).includes("draft"), "Execution draft not loaded");
      assert.equal(await evaluate("document.cookie.includes('campaign-lab-dev-access')"), false);
    });
    await test("publication requires explicit confirmation and rejects a wrong approved version", async () => {
      assert.equal(await evaluate("document.getElementById('campaign-publish').disabled"), true);
      assert.equal((await post({ ...fixture.command, confirm: false })).status, 400);
      assert.equal((await post({ ...fixture.command, expectedBlueprintVersion: 2 })).status, 409);
      assert.equal((await view()).campaign.published_at, null);
    });
    await test("owner explicitly publishes with real persisted baseline and active C3 projection", async () => {
      await click("#campaign-publish-confirm"); await click("#campaign-publish");
      await waitFor(async () => (await state()).includes("published"), "Publication did not persist");
      const current = await view(); assert.equal(current.c3.state, "active"); assert.equal(current.c3.configuration.unitPriceIdr, 108000);
      assert.equal(current.campaign.baseline_json.baseline_preorder_paid_units, 0); assert.ok(current.campaign.published_blueprint_id);
    });
    await test("calendar shows approved materialized schedule in WIB and checklist persists after refresh", async () => {
      assert.ok(await evaluate("document.querySelectorAll('.execution-days > li').length>0"));
      assert.ok(await evaluate("document.querySelector('.execution-days').textContent.includes('WIB')"));
      await click("[data-execution-task]"); await waitFor(async () => (await progress()).startsWith("1 dari 2"), "Task completion not persisted");
      assert.ok((await view()).tasks[0].completed_at);
      await command("Page.reload"); await waitFor(async () => (await state()).includes("published") && (await progress()).startsWith("1 dari 2"), "Checklist not restored");
      assert.equal(await evaluate("document.querySelector('[data-execution-task]').checked"), true);
    });
    await test("owner can reopen and complete the same published task with CAS", async () => {
      await click("[data-execution-task]"); await waitFor(async () => (await progress()).startsWith("0 dari 2"), "Task not reopened");
      await click("[data-execution-task]"); await waitFor(async () => (await progress()).startsWith("1 dari 2"), "Task not recompleted");
      const current = await view(); assert.equal(current.tasks[0].version, 4);
    });
    await test("approved caption copies to the real browser clipboard without claiming a social post", async () => {
      const expected = (await view()).contents[0].body;
      await click("[data-caption-copy]");
      await waitFor(() => evaluate("document.body.textContent.includes('Caption disalin')"), "Copy feedback missing");
      assert.equal(await evaluate("navigator.clipboard.readText()"), expected);
      assert.ok(await evaluate("document.body.textContent.includes('Menyalin tidak menandakan konten sudah diposting')"));
    });
    await test("explicit closing and refresh retain task history and make C3 ineligible", async () => {
      assert.equal(await evaluate("document.getElementById('campaign-close').disabled"), true);
      await click("#campaign-close-confirm"); await click("#campaign-close");
      await waitFor(async () => (await state()).includes("closed"), "Closing not persisted");
      await command("Page.reload"); await waitFor(async () => (await state()).includes("closed") && (await progress()).startsWith("1 dari 2"), "Closed history not restored");
      const current = await view(); assert.equal(current.campaign.completed_at, null); assert.equal(current.c3.eligible, false); assert.equal(current.c3.state, "closed");
      assert.equal(current.contents.length, 1); await writeFile(resolve(cache, "example.json"), JSON.stringify(current, null, 2));
    });
    await test("desktop and mobile calendar/content remain usable without horizontal overflow", async () => {
      for (const width of [1440, 390, 320]) {
        await command("Emulation.setDeviceMetricsOverride", { width, height: 1100, deviceScaleFactor: 1, mobile: width < 500 });
        assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
        await evaluate("document.querySelector('.execution-detail').scrollIntoView({block:'start'})");
        const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(resolve(cache, `execution-${width}.png`), Buffer.from(screenshot.data, "base64"));
      }
    });
    await test("owner B cannot read owner A campaign or its execution history in the browser", async () => {
      assert.equal(await evaluate("fetch('/api/dev/discussions/auth',{method:'DELETE'}).then(r=>r.status)"), 200);
      await command("Page.navigate", { url: new URL("/dev/discussion", baseUrl).href });
      await waitFor(() => evaluate("Boolean(document.getElementById('discussion-email')&&Object.keys(document.getElementById('discussion-email')).some(k=>k.startsWith('__reactProps')))"), "Login did not hydrate after logout");
      await input("discussion-email", accounts[1].email); await input("discussion-password", accounts[1].password); await click(".discussion-login button");
      await waitFor(() => evaluate("Boolean(document.getElementById('discussion-create'))"), "Owner B login failed");
      await command("Page.navigate", { url: new URL(`/dev/campaigns?campaignId=${fixture.command.campaignId}`, baseUrl).href });
      await waitFor(() => evaluate("Boolean(document.querySelector('[role=alert]')?.textContent.includes('tidak ditemukan'))"), "Foreign campaign not denied");
      assert.equal(await evaluate("Boolean(document.querySelector('[data-campaign-state]'))"), false);
      assert.equal(await evaluate(`fetch('/api/dev/campaigns?campaignId=${fixture.command.campaignId}').then(r=>r.status)`), 404);
    });
    assert.deepEqual(runtimeErrors, []); console.log(`${passed} campaign execution browser groups passed`);
  } finally { await closeFixtureCampaign(token, fixture.command.campaignId); }
} finally {
  for (const request of pending.values()) clearTimeout(request.timer); socket?.close(); chrome.kill();
}
