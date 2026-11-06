// Run against `npm run dev -- --port 3100`; requires local Chrome, no test dependencies.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { discussionFixtureScope } from "../fixtures/local-campaign.mjs";

const baseUrl = new URL(process.env.DISCUSSION_BASE_URL ?? "http://localhost:3100");
assert.ok(["localhost", "127.0.0.1"].includes(baseUrl.hostname), "Use a local development server");
const cache = resolve("node_modules/.cache/campaign-discussion");
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

  const accounts = JSON.parse(await readFile("node_modules/.cache/database-v21-cutover/fixture-credentials.json", "utf8"));
  let sessionId;
  async function click(selector) {
    await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`), `Control unavailable: ${selector}`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }
  async function select(value) { await evaluate(`(() => {const el=document.getElementById('discussion-scenario');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
  const count = () => evaluate("document.querySelectorAll('.discussion-messages > li').length");
  async function send(text, expected) { await input("discussion-message", text); await click("#discussion-send");
    await waitFor(async () => (await count()) === expected && await evaluate("document.getElementById('discussion-send').textContent==='Kirim pesan'"), "Discussion did not persist expected messages"); }
  await command("Page.navigate", { url: new URL("/dev/discussion", baseUrl).href });
  await waitFor(() => evaluate("Boolean(document.getElementById('discussion-email')&&Object.keys(document.getElementById('discussion-email')).some(k=>k.startsWith('__reactProps')))"), "Discussion login did not hydrate");
  await test("real local GoTrue login; credentials stay out of document.cookie", async () => {
    await input("discussion-email", accounts[0].email); await input("discussion-password", accounts[0].password);
    await click(".discussion-login button");
    await waitFor(() => evaluate("Boolean(document.getElementById('discussion-create'))"), "Login failed");
    assert.equal(await evaluate("document.cookie.includes('campaign-lab-dev-access')"), false);
    const cookies = await command("Network.getCookies");
    assert.ok(cookies.cookies.filter((c) => c.name.startsWith("campaign-lab-dev-")).every((c) => c.httpOnly));
  });
  await test("authorized preorder, real persisted session and normal-price strategy", async () => {
    await evaluate(`(() => { const el=document.getElementById('discussion-preorder'); el.value=${JSON.stringify(discussionFixtureScope().preorderId)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await click("#discussion-create");
    await waitFor(() => evaluate("Boolean(document.getElementById('discussion-message'))"), "Session creation failed");
    sessionId = await evaluate("new URL(location.href).searchParams.get('sessionId')"); assert.ok(sessionId);
    await send("Buat pengingat unit 4 biaya 10000", 2);
    assert.ok(await evaluate("document.querySelector('.discussion-proposal').textContent.includes('120.000')"));
    assert.ok(await evaluate("document.querySelector('.discussion-proposal').textContent.includes('10.000')"));
  });
  await test("duplicate submission replays persisted output without duplicate messages", async () => {
    await click("#discussion-replay");
    await waitFor(() => evaluate("document.body.textContent.includes('provider tidak dipanggil lagi')"), "Replay confirmation missing");
    assert.equal(await count(), 2);
  });
  await test("discount and multi-turn revision use frozen base and deterministic calculator", async () => {
    await select("discount"); await send("Usulkan diskon preorder", 4);
    assert.ok(await evaluate("[...document.querySelectorAll('.discussion-proposal')].at(-1).textContent.includes('108.000')"));
    await select("revision"); await send("Revisi diskon 5% unit 8 biaya 20000", 6);
    assert.ok(await evaluate("[...document.querySelectorAll('.discussion-proposal')].at(-1).textContent.includes('114.000')"));
    assert.ok(await evaluate("[...document.querySelectorAll('.discussion-proposal')].at(-1).textContent.includes('292.000')"));
  });
  await test("full browser refresh keeps messages and proposal from PostgreSQL", async () => {
    await command("Page.reload");
    await waitFor(async () => (await count()) === 6, "Persisted history not restored after refresh");
    assert.equal(await evaluate("new URL(location.href).searchParams.get('sessionId')"), sessionId);
    assert.ok(await evaluate("document.body.textContent.includes('292.000')"));
  });
  await test("controlled provider failure and invalid output persist only user messages", async () => {
    await select("failure"); await input("discussion-message", "Uji kegagalan provider"); await click("#discussion-send");
    await waitFor(async () => (await count()) === 7 && await evaluate("document.body.textContent.includes('Kegagalan tersimpan')"), "Provider failure not shown");
    assert.equal(await evaluate("document.querySelectorAll('.discussion-messages > li[data-role=assistant]').length"), 3);
    await select("invalid"); await input("discussion-message", "Uji output tidak valid"); await click("#discussion-send");
    await waitFor(async () => (await count()) === 8 && await evaluate("document.body.textContent.includes('Output provider ditolak')"), "Invalid output not rejected");
    await select("normal"); await send("Coba pengingat baru", 10);
  });
  await test("desktop/mobile layout and rendered evidence", async () => {
    for (const width of [1440, 390, 320]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
      await evaluate("scrollTo(0,document.body.scrollHeight)");
      const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(resolve(cache, `discussion-${width}.png`), Buffer.from(screenshot.data, "base64"));
    }
  });
  await test("owner B cannot reopen owner A session after a fresh login", async () => {
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Keluar').click()");
    await waitFor(() => evaluate("Boolean(document.getElementById('discussion-email'))"), "Logout failed");
    await input("discussion-email", accounts[1].email); await input("discussion-password", accounts[1].password);
    await click(".discussion-login button");
    await waitFor(() => evaluate("Boolean(document.querySelector('[role=alert]')?.textContent.includes('bukan milik'))"), "Cross-tenant session access not denied");
    assert.equal(await count(), 0);
    const forbidden = await evaluate(`fetch('/api/dev/discussions?sessionId=${sessionId}').then(r=>r.status)`);
    assert.equal(forbidden, 404);
  });
  assert.deepEqual(runtimeErrors, []);
  console.log(`${passed} persistent discussion browser checks passed`);
} finally {
 for(const request of pending.values())clearTimeout(request.timer);socket?.close();chrome.kill();
}
