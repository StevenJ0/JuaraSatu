// Run against `npm run dev -- --port 3100`; requires local Chrome, no test dependencies.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const baseUrl = new URL(process.env.SIMULATOR_BASE_URL ?? "http://127.0.0.1:3100");
assert.ok(["localhost", "127.0.0.1"].includes(baseUrl.hostname), "Use a local development server");
const cache = resolve("node_modules/.cache/campaign-simulator");
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), "comparison-chrome-"));
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
async function row(label) {
  return evaluate(`(() => {
    const row = [...document.querySelectorAll('.simulator-comparison tbody tr')].find(row => row.querySelector('th').textContent === ${JSON.stringify(label)});
    return row && [...row.querySelectorAll('td')].map(cell => Number(cell.textContent.replace(/[^0-9-]/g, '')));
  })()`);
}
async function test(name, check) {
  await check();
  passed++;
  console.log(`PASS ${name}`);
}

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
  await command("Page.navigate", { url: new URL("/dev/campaign-simulator", baseUrl).href });
  await waitFor(() => evaluate(`(() => {
    const field = document.getElementById('discountPercent');
    return field && Object.keys(field).some(key => key.startsWith('__reactProps'));
  })()`), "Development preview did not hydrate");
  await test("independent default assumptions and non-stacking prices", async () => {
    assert.equal(await evaluate("document.querySelector('[data-testid=scenario-contribution]').textContent.replace(/[^0-9-]/g,'')"), "214000");
    await evaluate("document.querySelector('#scenario-form button[type=submit]').click()");
    await waitFor(() => evaluate("Boolean(document.querySelector('.simulator-comparison table'))"), "Comparison not shown");
    assert.deepEqual(await row("Tambahan unit (asumsi)"), [4, 6, 8]);
    assert.deepEqual(await row("Asumsi biaya promosi"), [0, 25_000, 50_000]);
    assert.deepEqual(await row("Harga hipotetis / unit"), [120_000, 114_000, 108_000]);
    assert.deepEqual(await row("Kontribusi setelah promosi"), [180_000, 209_000, 214_000]);
    assert.ok(await evaluate("document.querySelector('.simulator-comparison').textContent.includes('Perbedaan hasil tidak membuktikan efek promosi')"));
  });
  await test("baseline changes to a paid normal-price campaign independently", async () => {
    assert.ok(await evaluate("document.querySelector('.simulator-comparison thead').textContent.includes('Tanpa promosi (baseline hipotetis)')"));
    await input("comparison-0-assumedAdditionalUnits", "5");
    await input("comparison-0-assumedPromotionCostIdr", "10000");
    assert.ok(await evaluate("document.querySelector('.simulator-comparison thead').textContent.includes('Campaign harga normal (0%)')"));
    assert.deepEqual(await row("Kontribusi setelah promosi"), [215_000, 209_000, 214_000]);
    await input("comparison-1-assumedAdditionalUnits", "7");
    await input("comparison-1-assumedPromotionCostIdr", "30000");
    assert.deepEqual(await row("Kontribusi setelah promosi"), [215_000, 243_000, 214_000]);
  });
  await test("main scenario updates without overwriting the other assumptions", async () => {
    await input("discountPercent", "0");
    await input("assumedAdditionalUnits", "6");
    await input("assumedPromotionCostIdr", "20000");
    assert.deepEqual(await row("Tambahan unit (asumsi)"), [5, 7, 6]);
    assert.deepEqual(await row("Asumsi biaya promosi"), [10_000, 30_000, 20_000]);
    assert.deepEqual(await row("Kontribusi setelah promosi"), [215_000, 243_000, 250_000]);
  });
  await test("capacity and invalid costs hide comparison, retain input, and focus errors", async () => {
    for (const id of ["comparison-0-assumedAdditionalUnits", "comparison-1-assumedAdditionalUnits", "assumedAdditionalUnits"]) {
      const previous = await evaluate(`document.getElementById(${JSON.stringify(id)}).value`);
      await input(id, "9");
      assert.equal(await evaluate(`document.getElementById(${JSON.stringify(id)}).getAttribute('aria-invalid')`), "true");
      assert.equal(await evaluate("Boolean(document.querySelector('.simulator-comparison table'))"), false);
      await evaluate("document.querySelector('#scenario-form button[type=submit]').click()");
      assert.equal(await evaluate("document.activeElement.classList.contains('simulator-errorSummary')"), true);
      await input(id, previous);
    }
    for (const invalid of ["-1", "1000000001"]) {
      await input("comparison-1-assumedPromotionCostIdr", invalid);
      assert.equal(await evaluate("document.getElementById('comparison-1-assumedPromotionCostIdr').value"), invalid);
      assert.equal(await evaluate("Boolean(document.querySelector('.simulator-comparison table'))"), false);
    }
    await input("comparison-1-assumedPromotionCostIdr", "30000");
    assert.deepEqual(await row("Kontribusi setelah promosi"), [215_000, 243_000, 250_000]);
  });
  await test("zero-unit scenario and equal-assumption warning removal", async () => {
    await input("comparison-0-assumedAdditionalUnits", "0");
    assert.deepEqual(await row("Kontribusi setelah promosi"), [-10_000, 243_000, 250_000]);
    for (const prefix of ["comparison-0-", "comparison-1-", ""]) {
      await input(`${prefix}assumedAdditionalUnits`, "4");
      await input(`${prefix}assumedPromotionCostIdr`, "10000");
    }
    assert.equal(await evaluate("document.querySelector('.simulator-comparison').textContent.includes('Perbedaan hasil tidak membuktikan efek promosi')"), false);
  });
  await test("reset restores all three scenarios", async () => {
    await evaluate("document.querySelector('#scenario-form button[type=button]').click()");
    assert.equal(await evaluate("Boolean(document.querySelector('.simulator-comparison'))"), false);
    await evaluate("document.querySelector('#scenario-form button[type=submit]').click()");
    assert.deepEqual(await row("Kontribusi setelah promosi"), [180_000, 209_000, 214_000]);
  });
  await test("styled desktop and mobile layouts have no page overflow or runtime errors", async () => {
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.simulator-workspace')).backgroundColor"), "rgb(248, 249, 245)");
    for (const width of [1440, 390, 320]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 1100, deviceScaleFactor: 1, mobile: width < 500 });
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
      await evaluate("document.querySelector('.simulator-comparison').scrollIntoView()");
      const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(resolve(cache, `comparison-${width}.png`), Buffer.from(screenshot.data, "base64"));
    }
    assert.deepEqual(runtimeErrors, []);
  });
  console.log(`${passed} interaction checks passed`);
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  socket?.close();
  chrome.kill();
}
