// Run only against the T1-owned 16-migration runtime. Requires Chrome and T3_RUNTIME_ROOT.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const repo = resolve(import.meta.dirname, "../..");
const runtimeRoot = process.env.T3_RUNTIME_ROOT;
assert(runtimeRoot && resolve(runtimeRoot) !== repo, "Set T3_RUNTIME_ROOT to the private T1 runtime root");
const cfg = JSON.parse(readFileSync(join(runtimeRoot, "runtime.json"), "utf8"));
assert.equal(cfg.project, "cl-t1-5c24f460eb0e");
assert.equal(resolve(cfg.repo), repo);
assert.deepEqual(cfg.ports, { api: 57321, db: 57322, studio: 57323, mail: 57324, shadow: 57320, app: 3311 });
const status = spawnSync(process.execPath, [join(runtimeRoot, "runtime.mjs"), "status"], { cwd: repo, encoding: "utf8", windowsHide: true });
assert.equal(status.status, 0, "T1 ownership/ledger guard failed; no test data was written");
const identity = JSON.parse(status.stdout);
assert.equal(identity.project, cfg.project);
assert.equal(identity.migrations, 16);
assert.equal(identity.catalog.tables, 26);
assert.equal(identity.catalog.columns, 352);
const source = readFileSync(join(repo, "src/features/public-preorder/checkout-form.tsx"), "utf8");
assert(source.includes("const activeIntent = useRef") && source.includes("if (submitting.current) return"), "T2 checkout source missing");
const branch = spawnSync("git", ["branch", "--show-current"], { cwd: repo, encoding: "utf8" });
assert.equal(branch.stdout.trim(), "feat/mvp-final-gaps");
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
assert.equal(head, "dbe828455874a93d30a68469065af6e192efda44");
const platform = JSON.parse(readFileSync(join(runtimeRoot, "platform-status.private.json"), "utf8"));
const secret = JSON.parse(readFileSync(join(runtimeRoot, "private-env.json"), "utf8"));
assert.equal(platform.API_URL, "http://127.0.0.1:57321");
const runId = randomBytes(6).toString("hex");
const artifact = join(repo, "node_modules/.cache/mvp-e2e", runId);
mkdirSync(artifact, { recursive: true });
const statePath = join(artifact, "provider-state.json");
const auditPath = join(artifact, "provider-audit.jsonl");
const resumedProvider = process.env.T3_RESUME_PROVIDER_ARTIFACT ?? process.env.T3_RESUME_BUYER_ARTIFACT;
if (resumedProvider) assert(resolve(resumedProvider).startsWith(join(repo, "node_modules/.cache/mvp-e2e") + "\\"));
writeFileSync(statePath, resumedProvider ? readFileSync(join(resumedProvider, "provider-state.json")) : JSON.stringify({ chargeCount: 0, transactions: {} }));
writeFileSync(auditPath, "");
const results = Object.fromEntries([...Array.from({ length: 14 }, (_, index) => `E${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 10 }, (_, index) => `N${String(index + 1).padStart(2, "0")}`)].map(id => [id, { status: "NOT EXECUTED" }]));
const record = (id, evidence) => { results[id] = { status: evidence.status ?? "PASS — BROWSER + DATABASE", ...evidence }; console.log(`${id} ${results[id].status}`); };
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|USERNAME|HOMEDRIVE|HOMEPATH|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(key)));
const appEnv = { ...safeEnv, NEXT_PUBLIC_SUPABASE_URL: platform.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: platform.PUBLISHABLE_KEY ?? platform.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: platform.SERVICE_ROLE_KEY, RATE_LIMIT_HMAC_KEY: secret.RATE_LIMIT_HMAC_KEY, CRON_SECRET: secret.CRON_SECRET,
  GEMINI_API_KEY: "t3-local-synthetic", GEMINI_MODEL: "gemini-3.8-flash", MIDTRANS_SERVER_KEY: "SB-Mid-server-t3_synthetic",
  MIDTRANS_MERCHANT_ID: "G_T3_LOCAL", RESEND_API_KEY: "", EMAIL_PROVIDER: "mailpit", MAILPIT_URL: `http://127.0.0.1:${cfg.ports.mail}`,
  EMAIL_FROM: "noreply@t3.local", CAMPAIGN_DISCUSSION_PROVIDER: "", CAMPAIGN_BLUEPRINT_PROVIDER: "", CAMPAIGN_MEMORY_PROVIDER: "",
  NEXT_TELEMETRY_DISABLED: "1", T3_ISOLATED_PROJECT: cfg.project, T3_PROVIDER_STATE_PATH: statePath, T3_PROVIDER_AUDIT_PATH: auditPath,
  NODE_OPTIONS: `--require=${join(repo, "tests/fixtures/mvp-e2e-provider-preload.cjs")}` };
const request = async (path, init) => fetch(`http://127.0.0.1:${cfg.ports.app}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
const sql = query => {
  const row = spawnSync("docker", ["--host", cfg.engine, "exec", "supabase_db_" + cfg.project, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", query],
    { cwd: repo, encoding: "utf8", windowsHide: true });
  assert.equal(row.status, 0, "Isolated SQL assertion failed");
  return row.stdout.trim();
};
const pause = ms => new Promise(done => setTimeout(done, ms));
async function waitFor(check, message, duration = 30_000) {
  const until = Date.now() + duration;
  do { if (await check()) return; await pause(100); } while (Date.now() < until);
  throw Error(message);
}
function oldApp() {
  const path = join(runtimeRoot, "app-process.json");
  if (!existsSync(path)) return null;
  const known = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(resolve(known.repo), repo);
  assert.equal(known.port, cfg.ports.app);
  const checked = spawnSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter 'ProcessId=${known.pid}' | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`],
    { encoding: "utf8", windowsHide: true });
  assert.equal(checked.status, 0, "Cannot verify the T1 application PID");
  if (!checked.stdout.trim()) return null;
  const process = JSON.parse(checked.stdout);
  assert(process.CommandLine.includes("--port " + cfg.ports.app));
  assert(process.CommandLine.replaceAll("\\", "/").includes(repo.replaceAll("\\", "/") + "/node_modules/next/dist/bin/next"));
  return known.pid;
}
let app;
let chrome;
let socket;
let lostCheckout = null;
const pending = new Map();
let sequence = 0;
const runtimeErrors = [];
function command(method, params = {}) {
  return new Promise((done, fail) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); fail(Error("CDP timeout " + method)); }, method === "Page.navigate" ? 45_000 : 15_000);
    pending.set(id, { done, fail, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description?.split("\n")[0] ?? "Browser evaluation failed");
  return result.result.value;
}
const page = path => command("Page.navigate", { url: new URL(path, `http://127.0.0.1:${cfg.ports.app}`).href });
const shown = selector => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
async function click(selector) {
  await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`), "Control missing: " + selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function clickText(selector, label) {
  await waitFor(() => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(el=>el.textContent.includes(${JSON.stringify(label)}))`), "Control missing: " + label);
  await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el=>el.textContent.includes(${JSON.stringify(label)})).click()`);
}
async function input(selector, value) {
  await setValue(selector, value);
}
async function setValue(selector, value) {
  const fieldSelector = `form ${selector}`;
  await waitFor(async () => await shown(fieldSelector) || await shown(selector), "Field missing: " + selector);
  try {
    await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(fieldSelector)}) ?? document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT' ? HTMLSelectElement.prototype : el.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set; if(setter) setter.call(el,${JSON.stringify(value)}); else el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  } catch (error) { throw Error("Field interaction failed: " + selector + " (" + (error instanceof Error ? error.message : "unknown") + ")"); }
}
async function screenshot(label) {
  const shot = await command("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(artifact, label + ".png"), Buffer.from(shot.data, "base64"));
}
async function location(path) {
  await waitFor(() => evaluate(`location.pathname === ${JSON.stringify(path)}`), `Navigation to ${path} failed`, 45_000);
}
const bodyText = () => evaluate("document.body.innerText");
async function mailFor(address) {
  const list = await (await fetch(`http://127.0.0.1:${cfg.ports.mail}/api/v1/messages`)).json();
  const item = list.messages?.find(message => message.To?.some(recipient => recipient.Address === address));
  if (!item) return null;
  return (await (await fetch(`http://127.0.0.1:${cfg.ports.mail}/api/v1/message/${item.ID}`)).json());
}
async function ownerRegistration() {
  if (process.env.T3_RESUME_RUN_ID) {
    const prior = process.env.T3_RESUME_RUN_ID;
    assert(/^[a-f0-9]{12}$/.test(prior));
    const email = `t3-owner-${prior}@example.test`;
    const password = `T3-Owner-${prior}!2026`;
    await page("/login");
    await input('[name="email"]', email);
    await input('[name="password"]', password);
    await click('form button[type="submit"]');
    await waitFor(() => evaluate("['/onboarding','/dashboard'].includes(location.pathname)"), "Owned account login failed", 45_000);
    record("E01", { status: "BROKEN", evidence: "Prior browser run confirmed account but default T1 PKCE confirmation link returned /login?notice=confirm_failed; subsequent login succeeds" });
    return { email, password };
  }
  const email = `t3-owner-${runId}@example.test`;
  const password = `T3-Owner-${runId}!2026`;
  await page("/register");
  await input('[name="email"]', email);
  await input('[name="password"]', password);
  await input('[name="confirmPassword"]', password);
  await click('form button[type="submit"]');
  await waitFor(() => shown('a[href="/login"]'), "Registration did not complete");
  let confirmation;
  await waitFor(async () => { confirmation = await mailFor(email); return Boolean(confirmation); }, "Local confirmation email missing");
  const match = confirmation.HTML?.match(/href="([^\"]*\/auth\/v1\/verify[^\"]*)"/);
  assert(match, "Local confirmation link missing");
  const confirmationUrl = new URL(match[1].replaceAll("&amp;", "&"));
  assert.equal(confirmationUrl.origin, platform.API_URL);
  await page(confirmationUrl.href);
  await waitFor(() => evaluate("['/login','/onboarding','/dashboard'].includes(location.pathname)"), "Confirmation navigation did not settle", 45_000);
  const callbackPath = await evaluate("location.pathname + location.search");
  if (callbackPath.startsWith("/login?notice=confirm_failed")) {
    record("E01", { status: "BROKEN", evidence: "Mailpit confirmation reached /auth/confirm, but callback returned /login?notice=confirm_failed; isolated account became confirmed" });
  } else {
    await page("/onboarding");
    await location("/onboarding");
    await click('form:has(button span) button[type="submit"]');
    await location("/login");
  }
  assert.equal(await evaluate("location.pathname"), "/login", "Confirmation did not reach a login state");
  await page("/login");
  await input('[name="email"]', email);
  await input('[name="password"]', password);
  await click('form button[type="submit"]');
  await location("/onboarding");
  return { email, password };
}
async function businessSetup(owner) {
  const business = `T3 Kitchen ${process.env.T3_RESUME_BUSINESS_RUN_ID ?? runId}`;
  const prior = sql(`select b.id, m.user_id from public.businesses b join public.business_members m on m.business_id=b.id join auth.users u on u.id=m.user_id where u.email='${owner.email}' and b.name='${business}'`);
  if (prior) {
    await location("/dashboard");
    assert((await bodyText()).includes(business));
    record("E02", { evidence: "Owned business and membership verified in isolated DB; dashboard reload through real owner session" });
    return { businessId: prior.split("|")[0], business };
  }
  await location("/onboarding");
  await input('[name="name"]', business);
  await waitFor(async () => {
    if (await shown('input[name="categories"][value="Makanan & minuman"]')) return true;
    await clickText('button[aria-pressed="false"]', "Makanan & minuman");
    await pause(500);
    return shown('input[name="categories"][value="Makanan & minuman"]');
  }, "Business category did not bind");
  await input('[name="publicContact"]', "WhatsApp 081234567890");
  await input('[name="pickupInstructions"]', "Ambil di gerai T3 pukul 10.00–12.00 WIB.");
  await click('form:has([name="pickupInstructions"]) button[type="submit"]');
  await location("/dashboard");
  assert((await bodyText()).includes(business));
  const row = sql(`select b.id, m.user_id from public.businesses b join public.business_members m on m.business_id=b.id join auth.users u on u.id=m.user_id where u.email='${owner.email}' and b.name='${business}'`);
  assert(row.includes("|"), "Owner membership missing");
  await page("/dashboard");
  await location("/dashboard");
  assert((await bodyText()).includes(business));
  record("E02", { evidence: "Browser onboarding form; business and owner membership persisted; dashboard reload" });
  await click('form:has(button span) button[type="submit"]');
  await location("/login");
  await page("/dashboard");
  await location("/login");
  if (results.E01.status !== "BROKEN") record("E01", { evidence: "Browser registration, Mailpit confirmation through app callback, login, dashboard reload, logout; isolated Auth account persisted" });
  await page("/login");
  await input('[name="email"]', owner.email);
  await input('[name="password"]', owner.password);
  await click('form button[type="submit"]');
  await location("/dashboard");
  return { businessId: row.split("|")[0], business };
}
async function upload(selector, file) {
  const root = await command("DOM.getDocument");
  const node = await command("DOM.querySelector", { nodeId: root.root.nodeId, selector });
  assert(node.nodeId, "File input missing");
  await command("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [file] });
}
async function productAndCapacity(business) {
  const productName = `T3 Product ${business.business.split(" ").at(-1)}`;
  const existing = sql(`select id,photo_path,base_price_idr,variable_cost_idr from public.products where business_id='${business.businessId}' and name='${productName}'`);
  let productId;
  if (existing) {
    [productId] = existing.split("|");
  } else {
    await page("/dashboard/products/new");
    await location("/dashboard/products/new");
    await input('[name="name"]', productName);
    await input('[name="description"]', "Produk uji preorder lokal.");
    const photo = join(artifact, "product.png");
    await sharp({ create: { width: 32, height: 32, channels: 4, background: "#e7a234" } }).png().toFile(photo);
    await upload('[name="photo"]', photo);
    await input('[name="basePrice"]', "120000");
    await waitFor(async () => {
      if (await shown('[name="variableCost"]')) return true;
      await setValue('[name="costQuality"]', "estimated");
      await pause(500);
      return shown('[name="variableCost"]');
    }, "Cost quality did not bind");
    await input('[name="variableCost"]', "70000");
    assert.deepEqual(await evaluate("[document.querySelector('form [name=name]').value,document.querySelector('form [name=description]').value]"), [productName, "Produk uji preorder lokal."]);
    await click('form:has([name="photo"]) button[type="submit"]');
    await location("/dashboard/products");
    const row = sql(`select id,photo_path,base_price_idr,variable_cost_idr from public.products where business_id='${business.businessId}' and name='${productName}'`);
    assert(row, "Product not persisted");
    [productId] = row.split("|");
  }
  const product = sql(`select photo_path,base_price_idr,variable_cost_idr from public.products where id='${productId}'`);
  const [photoPath, base, cost] = product.split("|");
  assert(photoPath && base === "120000" && cost === "70000", "Product price/cost/photo mismatch");
  await page("/dashboard/products");
  assert((await bodyText()).includes(productName));
  const capacityExisting = sql(`select id,total_units,fulfillment_date from public.production_capacity where business_id='${business.businessId}' and product_id='${productId}' order by created_at desc limit 1`);
  let capacityId;
  if (capacityExisting) {
    [capacityId] = capacityExisting.split("|");
  } else {
    await page("/dashboard/capacity/new");
    await location("/dashboard/capacity/new");
    const wibNow = Date.now() + 7 * 3_600_000;
    const date = new Date(wibNow + 3 * 86_400_000).toISOString().slice(0, 10);
    const cutoff = new Date(wibNow + 2 * 86_400_000).toISOString().slice(0, 16);
    await setValue('[name="productId"]', productId);
    await setValue('[name="fulfillmentDate"]', date);
    await input('[name="totalUnits"]', "20");
    await setValue('[name="intakeCutoff"]', cutoff);
    await setValue('[name="fulfillmentWindowEndTime"]', "12:00");
    await click('form:has([name="totalUnits"]) button[type="submit"]');
    await location("/dashboard/capacity");
    const row = sql(`select id,total_units,fulfillment_date from public.production_capacity where business_id='${business.businessId}' and product_id='${productId}' order by created_at desc limit 1`);
    assert(row, "Capacity not persisted");
    [capacityId] = row.split("|");
  }
  assert.equal(sql(`select total_units from public.production_capacity where id='${capacityId}'`), "20");
  await page("/dashboard/capacity");
  assert((await bodyText()).includes(productName));
  record("E03", { evidence: "Browser product/photo/cost and capacity forms; isolated Product, Storage path, production_capacity persisted and reloaded" });
  return { productId, capacityId, productName };
}
async function preorderPublication(business, core) {
  const name = `T3 Preorder ${business.business.split(" ").at(-1)}`;
  const existing = sql(`select id,status,slug from public.preorders where business_id='${business.businessId}' and name='${name}' order by created_at desc limit 1`);
  let preorderId;
  if (existing) {
    [preorderId] = existing.split("|");
  } else {
    await page("/dashboard/preorders/new");
    await location("/dashboard/preorders/new");
    await input('[name="name"]', name);
    await waitFor(async () => {
      await setValue('[name="capacityId"]', core.capacityId);
      await pause(300);
      return evaluate(`document.querySelector('form [name="capacityId"]').value === ${JSON.stringify(core.capacityId)} && document.querySelector('form [name="startsAt"]').value !== ''`);
    }, "Preorder capacity did not bind");
    await input('[name="targetUnits"]', "5");
    await input('[name="quotaUnits"]', "15");
    const wibNow = Date.now() + 7 * 3_600_000;
    await setValue('[name="startsAt"]', new Date(wibNow - 60_000).toISOString().slice(0, 16));
    await setValue('[name="endsAt"]', new Date(wibNow + 86_400_000).toISOString().slice(0, 16));
    await click('form:has([name="capacityId"]) button[type="submit"]');
    await waitFor(() => evaluate("/^\\/dashboard\\/preorders\\/[a-f0-9-]+$/.test(location.pathname)"), "Preorder draft was not created", 45_000);
    preorderId = (await evaluate("location.pathname.split('/').at(-1)"));
  }
  let row = sql(`select status,slug from public.preorders where id='${preorderId}' and business_id='${business.businessId}'`);
  if (row.startsWith("draft|")) {
    await page(`/dashboard/preorders/${preorderId}`);
    await waitFor(async () => {
      if (await shown('form:has([name="preorderId"]) button[type="submit"]')) return true;
      await clickText('button[type="button"]', "Terbitkan preorder");
      await pause(500);
      return shown('form:has([name="preorderId"]) button[type="submit"]');
    }, "Publish confirmation did not open");
    await clickText('form button[type="submit"]', "Ya, terbitkan preorder");
    await waitFor(() => evaluate("document.body.innerText.includes('Preorder sedang dibuka')"), "Preorder publication failed", 45_000);
    row = sql(`select status,slug from public.preorders where id='${preorderId}'`);
  }
  const [status, slug] = row.split("|");
  assert.equal(status, "published");
  assert(slug);
  const frozen = sql(`select (p.pickup_terms_snapshot ? 'pickup_instructions')::text, (p.pickup_terms_snapshot ? 'public_contact')::text, (p.pickup_terms_snapshot ? 'intake_cutoff_at')::text, (p.pickup_terms_snapshot ? 'fulfillment_window_end_at')::text, i.base_price_snapshot_idr, i.quota_units from public.preorders p join public.preorder_items i on i.preorder_id=p.id where p.id='${preorderId}'`);
  assert.equal(frozen, "true|true|true|true|120000|15");
  await page(`/dashboard/preorders/${preorderId}`);
  assert((await bodyText()).includes("Preorder sedang dibuka"));
  record("E04", { evidence: "Browser draft and two-step publish; canonical snake_case pickup snapshot, frozen Rp120000 price, quota 15, reload" });
  return { preorderId, slug };
}
async function aiStrategist(business, preorder) {
  const prior = sql(`select id from public.campaign_ai_sessions where business_id='${business.businessId}' and preorder_id='${preorder.preorderId}' order by created_at desc limit 1`);
  await page(prior ? `/dashboard/campaigns?sessionId=${prior}` : "/dashboard/campaigns");
  await location("/dashboard/campaigns");
  await waitFor(() => shown("#discussion-preorder"), "Owner strategist did not load");
  await waitFor(() => evaluate(`Array.from(document.querySelector('#discussion-preorder').options).some(option=>option.value===${JSON.stringify(preorder.preorderId)})`), "Real published preorder missing from strategist");
  if (!prior) {
    await setValue("#discussion-preorder", preorder.preorderId);
    await click("#discussion-create");
    await waitFor(() => evaluate("location.search.includes('sessionId=')"), "AI discussion was not created", 45_000);
  }
  const sessionId = new URLSearchParams(await evaluate("location.search")).get("sessionId");
  assert(sessionId);
  const persisted = sql(`select count(*) from public.campaign_ai_messages where session_id='${sessionId}' and role='assistant' and jsonb_array_length(proposal_json->'options') > 0`);
  if (persisted === "0") {
    await input("#discussion-budget", "50000");
    await input("#discussion-message", "Buat opsi diskon preorder untuk WhatsApp dengan asumsi dua unit tambahan dan biaya promosi Rp1000.");
    await click("#discussion-send");
    await waitFor(() => evaluate("document.querySelector('#discussion-send')?.textContent.includes('Kirim pesan')"), "Strategy request did not settle", 60_000);
  }
  const proposed = sql(`select count(*) from public.campaign_ai_messages where session_id='${sessionId}' and role='assistant' and jsonb_array_length(proposal_json->'options') > 0`);
  assert.equal(proposed, "1", "No validated AI proposal persisted");
  const priorAudit = process.env.T3_PRIOR_AI_AUDIT;
  if (priorAudit) assert(resolve(priorAudit).startsWith(join(repo, "node_modules/.cache/mvp-e2e") + "\\"));
  const auditRows = [auditPath, ...(priorAudit ? [priorAudit] : [])].flatMap(path => readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)));
  const facts = auditRows.find(row => row.kind === "gemini_strategy_mock");
  assert(facts && facts.frozenBasePriceIdr === 120000 && facts.variableCostIdr === 70000 && facts.orderableUnits === 15 && facts.sourceVersionCount >= 3,
    "Real Core facts did not reach the Gemini transport boundary");
  const hash = sql(`select context_version_hash from public.campaign_ai_sessions where id='${sessionId}' and business_id='${business.businessId}'`);
  assert.match(hash, /^[a-f0-9]{64}$/);
  record("E05", { evidence: "Owner UI selected published preorder; real C1 price/cost/available/source versions reached mocked Gemini HTTP transport; validated proposal and context hash persisted", ...(priorAudit ? { priorArtifact: priorAudit } : {}) });
  return { sessionId };
}
async function blueprintApproval(business, ai) {
  let campaignId = sql(`select id from public.campaigns where business_id='${business.businessId}' and preorder_id=(select preorder_id from public.campaign_ai_sessions where id='${ai.sessionId}') order by created_at desc limit 1`);
  if (!campaignId) {
    await waitFor(() => shown("[data-blueprint-create]:not([disabled])"), "Validated proposal unavailable for Blueprint");
    await click("[data-blueprint-create]");
    await waitFor(() => shown("[data-blueprint-status]"), "Blueprint creation did not settle", 60_000);
    campaignId = sql(`select id from public.campaigns where business_id='${business.businessId}' and preorder_id=(select preorder_id from public.campaign_ai_sessions where id='${ai.sessionId}') order by created_at desc limit 1`);
  } else {
    await page(`/dashboard/campaigns?sessionId=${ai.sessionId}&campaignId=${campaignId}`);
    await waitFor(() => shown("[data-blueprint-status]"), "Saved Blueprint did not reload");
  }
  assert(campaignId, "Campaign draft not persisted");
  let state = sql(`select version,approval_status,id from public.campaign_blueprints where campaign_id='${campaignId}' order by version desc limit 1`);
  if (state.startsWith("1|")) {
    const before = readFileSync(auditPath, "utf8").split("gemini_blueprint_mock").length - 1;
    await input("#blueprint-goal", "Tinjau kesiapan preorder dan pesan campaign secara manual.");
    await input("#blueprint-notes", "Revisi manual oleh pemilik untuk pengujian lokal.");
    await click("#blueprint-save");
    await waitFor(() => evaluate("document.querySelector('[data-blueprint-status]')?.textContent.includes('blueprint v2')"), "Manual Blueprint revision did not persist", 60_000);
    assert.equal(readFileSync(auditPath, "utf8").split("gemini_blueprint_mock").length - 1, before, "Manual edit unexpectedly called Gemini");
    state = sql(`select version,approval_status,id from public.campaign_blueprints where campaign_id='${campaignId}' order by version desc limit 1`);
  }
  const [version, approval, blueprintId] = state.split("|");
  assert.equal(version, "2");
  if (approval !== "approved") {
    await click("#blueprint-confirm");
    await click("#blueprint-approve");
    await waitFor(() => evaluate("document.querySelector('[data-blueprint-status]')?.textContent.includes('approved')"), "Blueprint approval did not settle", 60_000);
  }
  const confirmed = sql(`select approval_status,blueprint_json->>'goal',approved_by_user_id is not null from public.campaign_blueprints where id='${blueprintId}' and business_id='${business.businessId}'`);
  assert.equal(confirmed, "approved|Tinjau kesiapan preorder dan pesan campaign secara manual.|t");
  await page(`/dashboard/campaigns?sessionId=${ai.sessionId}&campaignId=${campaignId}`);
  await waitFor(() => shown("#blueprint-open-execution"), "Approved Blueprint missing after reload");
  record("E06", { evidence: "Owner UI created campaign draft and Blueprint with mocked Gemini; manual plan edit saved v2 without provider call; approval persisted and survived reload" });
  return { campaignId, blueprintId };
}
async function campaignPublication(business, blueprint) {
  await page(`/dashboard/campaigns/execution?campaignId=${blueprint.campaignId}`);
  await location("/dashboard/campaigns/execution");
  await waitFor(() => shown("[data-campaign-state]"), "Execution workspace did not load");
  const tasks = sql(`select count(*) from public.campaign_tasks where campaign_id='${blueprint.campaignId}' and blueprint_id='${blueprint.blueprintId}'`);
  assert(Number(tasks) >= 1, "Approved task materialization missing");
  let row = sql(`select status,slug,discount_bps,budget_cap_idr,target_additional_units from public.campaigns where id='${blueprint.campaignId}' and business_id='${business.businessId}'`);
  if (row.startsWith("draft|")) {
    await click("#campaign-publish-confirm");
    await click("#campaign-publish");
    await waitFor(() => evaluate("document.querySelector('[data-campaign-state]')?.textContent.includes('published')"), "Campaign publication did not settle", 60_000);
    row = sql(`select status,slug,discount_bps,budget_cap_idr,target_additional_units from public.campaigns where id='${blueprint.campaignId}'`);
  }
  const [status, slug, discount, budget, target] = row.split("|");
  assert.equal(status, "published");
  assert(slug && discount === "1000" && Number(budget) >= 0 && target === "2");
  await page(`/dashboard/campaigns/execution?campaignId=${blueprint.campaignId}`);
  await waitFor(() => evaluate("document.querySelector('[data-campaign-state]')?.textContent.includes('published')"), "Published campaign missing on reload");
  record("E07", { evidence: "Approved task materialization, execution UI and two-step owner publication; published 10% campaign persisted with slug, budget, target and reload" });
  return { slug };
}
async function publicOffer(business, preorder, campaign, blueprint) {
  await page("/dashboard");
  await click('form:has(button span) button[type="submit"]');
  await location("/login");
  await page(`/p/${preorder.slug}?ref=${campaign.slug}`);
  await location(`/p/${preorder.slug}`);
  await waitFor(() => evaluate("Boolean(document.body?.innerText.includes('Rp108.000') && document.querySelector('#customerEmail'))"), "Public checkout unavailable", 45_000);
  const pageBody = await bodyText();
  assert(pageBody.includes(business.business) && pageBody.includes("Rp108.000") && pageBody.includes("Rp120.000"));
  assert(Number(/Tersedia (\d+) dari kuota/.exec(pageBody)?.[1]) >= 2, "Public capacity exhausted before checkout");
  assert.equal(await evaluate("new URLSearchParams(location.search).get('ref')"), campaign.slug);
  const authoritative = sql(`select (public.read_preorder_offer('${preorder.preorderId}'::uuid)->>'final_unit_price_idr'),(public.read_preorder_offer('${preorder.preorderId}'::uuid)->>'discount_bps'),(public.read_preorder_offer('${preorder.preorderId}'::uuid)->>'pricing_campaign_id')`);
  assert.equal(authoritative, `108000|1000|${blueprint.campaignId}`);
  record("E08", { evidence: "Logged-out buyer page via campaign ref; public Rp108000, base Rp120000, 15 available; read_preorder_offer SQL resolves same 10% campaign" });
}
async function buyerCheckout(preorder, campaign) {
  if (process.env.T3_RESUME_BUYER_ARTIFACT) {
    const prior = resolve(process.env.T3_RESUME_BUYER_ARTIFACT);
    assert(prior.startsWith(join(repo, "node_modules/.cache/mvp-e2e") + "\\"));
    const token = readFileSync(join(prior, "order-token.private.txt"), "utf8");
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const orderId = sql(`select id from public.orders where private_token_hash='${createHash("sha256").update(token).digest("hex")}'`);
    assert(orderId, "Prior T3 order missing");
    await page(`/o/${token}`);
    await waitFor(() => evaluate("Boolean(document.querySelector('#nomor-pesanan'))"), "Private order did not load");
    record("E09", { status: "PASS — PRIOR BROWSER + DATABASE", evidence: "Prior T3 CDP run proved committed-then-lost response and one-order replay; current run verified same private token hash", priorArtifact: prior });
    record("N05", { status: "PARTIAL", evidence: "Lost-response retry proved one order/hold; rapid double-submit and blocked storage cases not yet exercised" });
    return { orderId, token, email: null };
  }
  const email = `t3-buyer-${runId}@example.test`;
  const intentKey = `checkout-intent:${preorder.slug}`;
  await waitFor(() => evaluate(`Boolean(sessionStorage.getItem(${JSON.stringify(intentKey)}))`), "Checkout identity unavailable");
  const intent = JSON.parse(await evaluate(`sessionStorage.getItem(${JSON.stringify(intentKey)})`));
  assert.match(intent.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(intent.idempotencyKey, /^[a-f0-9-]{36}$/);
  await input("#quantity", "2");
  await input("#customerName", "Pembeli T3 Lokal");
  await input("#customerEmail", email);
  await input("#customerContact", "081234567890");
  await click('form:has(#customerEmail) button[type="submit"]');
  await waitFor(() => evaluate("Array.from(document.querySelectorAll('button')).some(button=>button.textContent.includes('Buat pesanan'))"), "Checkout review did not open");
  assert((await bodyText()).includes("Rp216.000"));
  lostCheckout = { email, committed: false, error: null };
  await command("Fetch.enable", { patterns: [
    { urlPattern: "https://api.sandbox.midtrans.com/*", requestStage: "Request" },
    { urlPattern: `http://127.0.0.1:${cfg.ports.app}/p/*`, requestStage: "Response" },
  ] });
  await clickText('button[type="button"]', "Buat pesanan");
  await waitFor(() => lostCheckout.committed || lostCheckout.error, "Checkout response was not intercepted after commit", 60_000);
  assert(!lostCheckout.error, lostCheckout.error ?? "lost response setup failed");
  await command("Fetch.enable", { patterns: [{ urlPattern: "https://api.sandbox.midtrans.com/*", requestStage: "Request" }] });
  lostCheckout = null;
  await waitFor(() => evaluate("document.querySelector('[role=alert]')?.textContent.includes('Koneksi terputus')"), "Buyer did not receive ambiguous response", 30_000);
  assert.equal(await evaluate("location.pathname"), `/p/${preorder.slug}`, "Checkout form was remounted after lost response");
  await clickText('button[type="button"]', "Buat pesanan");
  await waitFor(() => evaluate("/^\\/o\\/[A-Za-z0-9_-]{43}$/.test(location.pathname)"), "Idempotent retry did not navigate to private order", 60_000);
  const token = await evaluate("location.pathname.split('/').at(-1)");
  assert.equal(token, intent.token, "Retry changed private order token");
  const row = sql(`select o.id,o.idempotency_key,o.private_token_hash,o.total_idr,o.discount_total_idr,o.attribution_campaign_id,o.pricing_campaign_id,i.quantity,i.final_unit_price_idr from public.orders o join public.order_items i on i.order_id=o.id where o.customer_email='${email}'`);
  const [orderId, key, tokenHash, total, discount, attribution, pricing, quantity, unit] = row.split("|");
  assert.equal(sql(`select count(*) from public.orders where customer_email='${email}'`), "1");
  assert.equal(sql(`select count(*) from public.capacity_reservations where order_id='${orderId}'`), "1");
  assert.deepEqual([key, tokenHash, total, discount, attribution, pricing, quantity, unit],
    [intent.idempotencyKey, createHash("sha256").update(intent.token).digest("hex"), "216000", "24000", campaign.campaignId, campaign.campaignId, "2", "108000"]);
  writeFileSync(join(artifact, "order-token.private.txt"), token, { mode: 0o600 });
  record("E09", { evidence: "Browser checkout 2 units; CDP hid response only after SQL observed committed order; same mounted form retried to original token; one order/hold, Rp216000, campaign attribution" });
  record("N05", { status: "PARTIAL", evidence: "Lost-response retry proved one order/hold; rapid double-submit and blocked storage cases not yet exercised" });
  return { orderId, token, email };
}
async function qrisAttempt(order) {
  let attempt = sql(`select id,provider_order_id,amount_idr,status from public.payments where order_id='${order.orderId}' order by attempt_number desc limit 1`);
  if (attempt.endsWith("|paid_sandbox")) {
    const [paymentId, providerOrderId, amount] = attempt.split("|");
    assert(amount === "216000" && providerState().chargeCount === 1);
    record("E10", { status: "PASS — PRIOR BROWSER + DATABASE", evidence: "Prior T3 QR creation and reload reused one mock charge; current DB payment is persisted", priorArtifact: process.env.T3_RESUME_PROVIDER_ARTIFACT });
    return { paymentId, providerOrderId };
  }
  await waitFor(() => evaluate("Boolean(document.querySelector('#bayar'))"), "Private payment panel did not load");
  if (!attempt) {
    await clickText('#bayar button[type="button"]', "Bayar dengan QRIS");
    await waitFor(() => evaluate("document.body?.innerText.includes('Bayar dengan QRIS Sandbox')"), "QRIS action did not return QR", 60_000);
    attempt = sql(`select id,provider_order_id,amount_idr,status from public.payments where order_id='${order.orderId}' order by attempt_number desc limit 1`);
  }
  const [paymentId, providerOrderId, amount, status] = attempt.split("|");
  assert(paymentId && providerOrderId && amount === "216000" && status === "pending");
  const provider = providerState();
  assert.equal(provider.chargeCount, 1);
  assert.equal(provider.transactions[providerOrderId]?.amount, 216000);
  assert.equal(sql(`select count(*) from public.payments where order_id='${order.orderId}'`), "1");
  await page(`/o/${order.token}`);
  await waitFor(() => evaluate("Boolean(document.querySelector('#bayar'))"), "Payment panel missing on reload");
  await waitFor(async () => {
    if (await evaluate("document.body?.innerText.includes('Bayar dengan QRIS Sandbox')")) return true;
    await clickText('#bayar button[type="button"]', "Bayar dengan QRIS");
    await pause(1_000);
    return evaluate("document.body?.innerText.includes('Bayar dengan QRIS Sandbox')");
  }, "QRIS did not resume on reload", 60_000);
  assert.equal(providerState().chargeCount, 1, "Refresh created duplicate charge");
  record("E10", { evidence: "Real payment claim and DB attempt Rp216000; mock Midtrans charged once; QR shown; private page reload reused same provider charge" });
  return { paymentId, providerOrderId };
}
async function verifiedPayment(order, payment) {
  const row = providerState().transactions[payment.providerOrderId];
  assert(row && row.amount === 216000);
  const base = { order_id: payment.providerOrderId, status_code: "200", gross_amount: "216000.00",
    transaction_id: row.transactionId, transaction_status: "settlement" };
  const notify = signature_key => request("/api/payments/midtrans/notification", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, signature_key }),
  });
  const pending = sql(`select status,applied_at is null from public.payments where id='${payment.paymentId}'`);
  if (pending.startsWith("pending|")) {
    const bad = await notify("0".repeat(128));
    assert.equal(bad.status, 401);
    assert.equal((await bad.json()).result, "invalid_signature");
    assert.equal(sql(`select status,applied_at is null from public.payments where id='${payment.paymentId}'`), "pending|t");
    assert.equal(sql(`select count(*) from public.job_runs where job_type='send_paid_email' and entity_id='${order.orderId}'`), "0");
    record("N07", { evidence: "Actual webhook rejected invalid SHA512 with 401 before payment mutation, provider confirmation or email job" });
    updateProvider(state => {
      state.transactions[payment.providerOrderId].status = "settlement";
      state.transactions[payment.providerOrderId].settlementTime = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
    });
  } else {
    assert.equal(pending, "paid_sandbox|f");
    record("N07", { status: "PASS — PRIOR BROWSER + DATABASE", evidence: "Prior T3 actual webhook rejected invalid signature before payment mutation", priorArtifact: process.env.T3_RESUME_PROVIDER_ARTIFACT });
  }
  const signature = createHash("sha512").update(base.order_id + base.status_code + base.gross_amount + appEnv.MIDTRANS_SERVER_KEY).digest("hex");
  const accepted = await notify(signature);
  assert.equal(accepted.status, 200);
  const result = (await accepted.json()).result;
  assert(["applied", "duplicate"].includes(result), "Valid notification was not applied/idempotent");
  const applied = sql(`select o.order_status,r.state,p.status,p.applied_at is not null,(select count(*) from public.job_runs where job_type='send_paid_email' and entity_id=o.id) from public.orders o join public.capacity_reservations r on r.order_id=o.id join public.payments p on p.order_id=o.id where o.id='${order.orderId}'`);
  assert.equal(applied, "awaiting_confirmation|allocated|paid_sandbox|t|1");
  assert.equal(sql(`select count(*) from public.payment_events where payment_id='${payment.paymentId}'`), "1");
  record("E11", { evidence: "Signed real webhook verified with mock GET Status, applied payment once, allocated hold and enqueued exactly one paid-email job" });
  const replays = await Promise.all([notify(signature), notify(signature)]);
  for (const response of replays) {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result, "duplicate");
  }
  assert.equal(sql(`select count(*) from public.payment_events where payment_id='${payment.paymentId}'`), "1");
  assert.equal(sql(`select count(*) from public.job_runs where job_type='send_paid_email' and entity_id='${order.orderId}'`), "1");
  record("N06", { evidence: "Two concurrent replay notifications returned duplicate; one payment event, one allocation and one paid-email job persisted" });
}
async function privateStatus(order) {
  await page(`/o/${order.token}`);
  await waitFor(() => evaluate("Boolean(document.querySelector('#nomor-pesanan'))"), "Private status page did not render");
  const visible = await bodyText();
  assert(visible.includes("Pembayaran terverifikasi") && visible.includes("Lunas (simulasi Sandbox)") &&
    visible.includes("2 unit") && visible.includes("Rp108.000") && visible.includes("Rp216.000") &&
    visible.includes("Petunjuk pengambilan"));
  assert(!visible.includes("@example.test"), "Buyer email leaked on private page");
  record("E12", { evidence: "Private token reload shows paid sandbox state, 2 units at Rp108000, Rp216000 total and frozen pickup terms; no email displayed" });
}
async function emailAndCron(order) {
  const email = sql(`select customer_email from public.orders where id='${order.orderId}'`);
  const before = sql(`select status,attempt_count from public.job_runs where job_type='send_paid_email' and entity_id='${order.orderId}'`);
  assert(before);
  for (const credential of [undefined, "Bearer wrong-t3-secret"]) {
    const response = await request("/api/jobs/run", { headers: credential ? { authorization: credential } : {} });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).result, "unauthorized");
  }
  assert.equal(sql(`select status,attempt_count from public.job_runs where job_type='send_paid_email' and entity_id='${order.orderId}'`), before);
  const foreignQueued = sql(`select count(*) from public.job_runs where status in ('queued','retryable_failed') and (business_id is distinct from (select business_id from public.orders where id='${order.orderId}'))`);
  assert.equal(foreignQueued, "0", "Valid cron would process non-T3 jobs");
  const valid = await request("/api/jobs/run", { headers: { authorization: `Bearer ${secret.CRON_SECRET}` } });
  assert.equal(valid.status, 200);
  await waitFor(async () => Boolean(await mailFor(email)), "Paid email missing from Mailpit", 30_000);
  const message = await mailFor(email);
  assert(message.Text?.includes("Rp216.000") && message.Text.includes("Rp24.000") && message.Text.includes("2 unit") && message.Text.includes("simulasi"));
  assert.equal(sql(`select status from public.job_runs where job_type='send_paid_email' and entity_id='${order.orderId}'`), "succeeded");
  const firstCount = (await (await fetch(`http://127.0.0.1:${cfg.ports.mail}/api/v1/messages`)).json()).messages.filter(row => row.To?.some(item => item.Address === email)).length;
  const replay = await request("/api/jobs/run", { headers: { authorization: `Bearer ${secret.CRON_SECRET}` } });
  assert.equal(replay.status, 200);
  const secondCount = (await (await fetch(`http://127.0.0.1:${cfg.ports.mail}/api/v1/messages`)).json()).messages.filter(row => row.To?.some(item => item.Address === email)).length;
  assert.equal(secondCount, firstCount);
  record("E13", { evidence: "Actual paid-email worker delivered Rp216000/discount/quantity to local Mailpit; job ACK succeeded; repeated cron sent no second email" });
  record("N10", { status: "PARTIAL", evidence: "Cron without/wrong secret rejected without job mutation; valid isolated cron succeeded. Checkout/payment-check rate limits not yet exercised" });
}
async function campaignKpi(owner, business, preorder) {
  await page("/login");
  await input('[name="email"]', owner.email);
  await input('[name="password"]', owner.password);
  await click('form button[type="submit"]');
  await location("/dashboard");
  await page(`/dashboard/preorders/${preorder.preorderId}`);
  await waitFor(() => evaluate("Boolean(document.querySelector('#hasil-kampanye'))"), "Persisted campaign results unavailable");
  const visible = await bodyText();
  assert(visible.includes("Pesanan lunas") && visible.includes("Rp216.000") && visible.includes("2 unit") && visible.includes("Rp24.000"));
  const actual = sql(`select count(*),coalesce(sum(o.total_idr),0),coalesce(sum(o.discount_total_idr),0),coalesce(sum(i.quantity),0) from public.orders o join public.order_items i on i.order_id=o.id join public.payments p on p.order_id=o.id and p.applied_at is not null where o.business_id='${business.businessId}' and o.preorder_id='${preorder.preorderId}' and o.attribution_campaign_id=o.pricing_campaign_id`);
  assert.equal(actual, "1|216000|24000|2");
  await page(`/dashboard/preorders/${preorder.preorderId}`);
  await waitFor(() => evaluate("document.body?.innerText.includes('Rp216.000')"), "Campaign KPI did not persist on reload");
  record("E14", { evidence: "Owner preorder result shows 1 paid campaign order, 2 paid units, Rp216000 simulated value, Rp24000 discount; SQL excludes unpaid order and reload persists" });
}
async function invalidPrivateToken(order) {
  const before = sql(`select count(*) from public.payments where order_id='${order.orderId}'`);
  const wrong = randomBytes(32).toString("base64url");
  for (const token of [wrong, "not-a-private-token"]) {
    const response = await request(`/o/${token}`);
    assert.equal(response.status, 404);
    assert(!(await response.text()).includes("Rp216.000"));
  }
  assert.equal(sql(`select count(*) from public.payments where order_id='${order.orderId}'`), before);
  record("N09", { evidence: "Actual private-order route returned 404 for random/invalid tokens without disclosing paid order data or creating attempts" });
}
async function crossBusiness(owner, business, preorder, blueprint, ai) {
  const other = JSON.parse(readFileSync(join(runtimeRoot, "ready-account.private.json"), "utf8"));
  assert(other.email !== owner.email && other.id);
  await page("/dashboard");
  await click('form:has(button span) button[type="submit"]');
  await location("/login");
  await input('[name="email"]', other.email);
  await input('[name="password"]', other.password);
  await click('form button[type="submit"]');
  await waitFor(() => evaluate("['/onboarding','/dashboard'].includes(location.pathname)"), "Second owner login failed", 45_000);
  let otherBusiness = sql(`select business_id from public.business_members where user_id='${other.id}' order by created_at desc limit 1`);
  if (!otherBusiness) {
    await location("/onboarding");
    await input('[name="name"]', `T3 Other Kitchen ${runId}`);
    await waitFor(async () => {
      if (await shown('input[name="categories"][value="Makanan & minuman"]')) return true;
      await clickText('button[aria-pressed="false"]', "Makanan & minuman");
      await pause(500);
      return shown('input[name="categories"][value="Makanan & minuman"]');
    }, "Second owner category missing");
    await input('[name="pickupInstructions"]', "Ambil di gerai B.");
    await click('form:has([name="pickupInstructions"]) button[type="submit"]');
    await location("/dashboard");
    otherBusiness = sql(`select business_id from public.business_members where user_id='${other.id}' order by created_at desc limit 1`);
  }
  assert(otherBusiness && otherBusiness !== business.businessId);
  assert.equal(sql(`select count(*) from public.business_members where user_id='${other.id}' and business_id='${business.businessId}'`), "0");
  const probes = [
    `/api/owner/discussions?sessionId=${ai.sessionId}`,
    `/api/owner/blueprints?campaignId=${blueprint.campaignId}`,
    `/api/owner/campaigns?campaignId=${blueprint.campaignId}`,
    `/dashboard/preorders/${preorder.preorderId}`,
    `/dashboard/preorders/${preorder.preorderId}/orders`,
  ];
  const statuses = await evaluate(`Promise.all(${JSON.stringify(probes)}.map(path=>fetch(path,{credentials:'same-origin'}).then(response=>response.status)))`);
  assert(statuses.every(status => status === 403 || status === 404), "Second owner could read A's protected resource");
  const version = Number(sql(`select version from public.campaigns where id='${blueprint.campaignId}'`));
  const forbidden = await evaluate(`fetch('/api/owner/campaigns',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'close',campaignId:${JSON.stringify(blueprint.campaignId)},expectedCampaignVersion:${version},confirm:true})}).then(response=>response.status)`);
  assert([403, 404].includes(forbidden), "Second owner could mutate A's campaign");
  assert.equal(sql(`select status,version from public.campaigns where id='${blueprint.campaignId}'`), `published|${version}`);
  await page("/dashboard/business");
  const otherView = await bodyText();
  assert(!otherView.includes(business.business));
  record("N01", { evidence: "Second real Supabase owner/business denied A's discussion, Blueprint, campaign, preorder/KPI/orders and campaign mutation; A version unchanged" });
  await page("/dashboard");
  await click('form:has(button span) button[type="submit"]');
  await location("/login");
  await input('[name="email"]', owner.email);
  await input('[name="password"]', owner.password);
  await click('form button[type="submit"]');
  await location("/dashboard");
}
async function unpublishedPreorder(business, core) {
  let draft = sql(`select id,coalesce(slug,''),status from public.preorders where business_id='${business.businessId}' and name like 'T3 Draft %' order by created_at desc limit 1`);
  if (!draft) {
    const name = `T3 Draft ${runId}`;
    await page("/dashboard/preorders/new");
    await location("/dashboard/preorders/new");
    await input('[name="name"]', name);
    await waitFor(async () => {
      await setValue('[name="capacityId"]', core.capacityId);
      await pause(300);
      return evaluate(`document.querySelector('form [name="capacityId"]').value === ${JSON.stringify(core.capacityId)} && document.querySelector('form [name="startsAt"]').value !== ''`);
    }, "Draft capacity did not bind");
    await input('[name="targetUnits"]', "1");
    await input('[name="quotaUnits"]', "1");
    const wibNow = Date.now() + 7 * 3_600_000;
    await setValue('[name="startsAt"]', new Date(wibNow - 60_000).toISOString().slice(0, 16));
    await setValue('[name="endsAt"]', new Date(wibNow + 86_400_000).toISOString().slice(0, 16));
    await click('form:has([name="capacityId"]) button[type="submit"]');
    await waitFor(() => evaluate("/^\\/dashboard\\/preorders\\/[a-f0-9-]+$/.test(location.pathname)"), "Draft was not created", 45_000);
    draft = sql(`select id,coalesce(slug,''),status from public.preorders where business_id='${business.businessId}' and name='${name}'`);
  }
  const [id, slug, status] = draft.split("|");
  assert.equal(status, "draft");
  const before = sql(`select count(*) from public.orders where preorder_id='${id}'`);
  for (const path of [slug && `/p/${slug}`, `/p/t3-invalid-${runId}`].filter(Boolean)) {
    const response = await request(path);
    const html = await response.text();
    assert([200, 404].includes(response.status) && html.includes("Preorder tidak tersedia") && !html.includes('id="customerEmail"'), "Unavailable preorder exposed checkout");
  }
  assert.equal(sql(`select count(*) from public.orders where preorder_id='${id}'`), before);
  assert.equal(sql(`select count(*) from public.capacity_reservations r join public.preorder_items i on i.id=r.preorder_item_id where i.preorder_id='${id}'`), "0");
  record("N02", { evidence: "Owner-created draft and invalid public slug returned 404; no draft orders or reservations" });
}
async function blockedStorageDuplicate(preorder, campaign) {
  await command("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(window,'sessionStorage',{configurable:true,get(){throw Error('blocked storage')},set(){throw Error('blocked storage')}})" });
  await page(`/p/${preorder.slug}?ref=${campaign.slug}`);
  await location(`/p/${preorder.slug}`);
  await waitFor(() => shown("#customerEmail"), "Blocked-storage checkout did not load");
  await waitFor(() => evaluate("Object.keys(document.querySelector('#customerEmail')).some(key=>key.startsWith('__reactFiber$'))"), "Blocked-storage checkout did not hydrate", 45_000);
  assert.equal(await evaluate("(() => {try {void sessionStorage; return false} catch {return true}})()"), true);
  const email = `t3-blocked-${runId}@example.test`;
  await input("#quantity", "1");
  await input("#customerName", "Pembeli Storage T3");
  await input("#customerEmail", email);
  await click('form:has(#customerEmail) button[type="submit"]');
  await waitFor(() => evaluate("Array.from(document.querySelectorAll('button')).some(button=>button.textContent.includes('Buat pesanan'))"), "Blocked-storage review did not open");
  lostCheckout = { email, committed: false, error: null };
  await command("Fetch.enable", { patterns: [
    { urlPattern: "https://api.sandbox.midtrans.com/*", requestStage: "Request" },
    { urlPattern: `http://127.0.0.1:${cfg.ports.app}/p/*`, requestStage: "Response" },
  ] });
  await evaluate("(() => {const button=Array.from(document.querySelectorAll('button')).find(item=>item.textContent.includes('Buat pesanan')); button.click(); button.click()})()");
  await waitFor(() => lostCheckout.committed || lostCheckout.error, "Blocked-storage response was not intercepted", 60_000);
  assert(!lostCheckout.error, lostCheckout.error ?? "Blocked-storage interception failed");
  const original = sql(`select id,idempotency_key,private_token_hash from public.orders where customer_email='${email}'`);
  await command("Fetch.enable", { patterns: [{ urlPattern: "https://api.sandbox.midtrans.com/*", requestStage: "Request" }] });
  lostCheckout = null;
  await waitFor(() => evaluate("document.querySelector('[role=alert]')?.textContent.includes('Koneksi terputus')"), "Blocked-storage ambiguous response missing");
  assert.equal(await evaluate("location.pathname"), `/p/${preorder.slug}`);
  await clickText('button[type="button"]', "Buat pesanan");
  await waitFor(() => evaluate("/^\\/o\\/[A-Za-z0-9_-]{43}$/.test(location.pathname)"), "Blocked-storage retry failed", 60_000);
  const token = await evaluate("location.pathname.split('/').at(-1)");
  assert.equal(sql(`select id,idempotency_key,private_token_hash from public.orders where customer_email='${email}'`), original);
  assert.equal(original.split("|")[2], createHash("sha256").update(token).digest("hex"));
  assert.equal(sql(`select count(*) from public.orders where customer_email='${email}'`), "1");
  assert.equal(sql(`select count(*) from public.capacity_reservations where order_id='${original.split("|")[0]}'`), "1");
  record("N05", { evidence: "Normal retry and committed lost response (E09), plus rapid double click with throwing sessionStorage getter/setter; same key/token, one order and hold" });
}
async function staleOffer(preorder, campaign, blueprint) {
  await page(`/p/${preorder.slug}?ref=${campaign.slug}`);
  await location(`/p/${preorder.slug}`);
  await waitFor(() => shown("#customerEmail"), "Stale-offer checkout did not load");
  await waitFor(() => evaluate("Object.keys(document.querySelector('#customerEmail')).some(key=>key.startsWith('__reactFiber$'))"), "Stale-offer checkout did not hydrate", 45_000);
  assert((await bodyText()).includes("Rp108.000"));
  const email = `t3-stale-${runId}@example.test`;
  await input("#quantity", "1");
  await input("#customerName", "Pembeli Harga Lama T3");
  await input("#customerEmail", email);
  await click('form:has(#customerEmail) button[type="submit"]');
  await waitFor(() => evaluate("Array.from(document.querySelectorAll('button')).some(button=>button.textContent.includes('Buat pesanan'))"), "Stale-offer review did not open");
  const version = Number(sql(`select version from public.campaigns where id='${blueprint.campaignId}' and status='published'`));
  assert(Number.isInteger(version) && version > 0);
  const status = await evaluate(`fetch('/api/owner/campaigns',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'close',campaignId:${JSON.stringify(blueprint.campaignId)},expectedCampaignVersion:${version},confirm:true})}).then(response=>response.status)`);
  assert.equal(status, 200, "Owner campaign close failed");
  assert.equal(sql(`select status from public.campaigns where id='${blueprint.campaignId}'`), "closed");
  await clickText('button[type="button"]', "Buat pesanan");
  await waitFor(() => evaluate("document.querySelector('[role=alert]')?.textContent.includes('Harga baru saja berubah')"), "Stale quote was not rejected", 45_000);
  assert.equal(sql(`select count(*) from public.orders where customer_email='${email}'`), "0");
  record("N03", { evidence: "Mounted 10% buyer quote submitted after authorized owner close; OFFER_CHANGED shown and no stale-price order created" });
}
function providerState() { return JSON.parse(readFileSync(statePath, "utf8")); }
function updateProvider(update) { const state = providerState(); update(state); writeFileSync(statePath, JSON.stringify(state)); }
async function start() {
  const pid = oldApp();
  if (pid !== null) {
    const stopped = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8", windowsHide: true });
    assert.equal(stopped.status, 0, "Owned T1 app could not be stopped");
  }
  app = spawn(process.execPath, [join(repo, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(cfg.ports.app)],
    { cwd: repo, env: appEnv, detached: true, windowsHide: true,
      stdio: ["ignore", openSync(join(artifact, "app.stdout.log"), "a"), openSync(join(artifact, "app.stderr.log"), "a")] });
  app.unref();
  writeFileSync(join(runtimeRoot, "app-process.json"), JSON.stringify({ pid: app.pid, repo: cfg.repo, port: cfg.ports.app }));
  await waitFor(async () => { try { return (await request("/login")).status === 200; } catch { return false; } }, "T3 app did not start", 60_000);
  const profile = join(artifact, "chrome-profile");
  mkdirSync(profile);
  chrome = spawn(process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  await waitFor(() => existsSync(join(profile, "DevToolsActivePort")), "Chrome did not start");
  const port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(item => item.type === "page").webSocketDebuggerUrl);
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails.text);
    if (message.method === "Fetch.requestPaused") {
      const paused = message.params;
      if (paused.request.url.startsWith("https://api.sandbox.midtrans.com/")) {
        void command("Fetch.fulfillRequest", { requestId: paused.requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "image/png" }], body: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==" });
      } else if (lostCheckout && paused.request.method === "POST" && paused.responseStatusCode) {
        try {
          assert.equal(sql(`select count(*) from public.orders where customer_email='${lostCheckout.email}'`), "1");
          lostCheckout.committed = true;
          void command("Fetch.failRequest", { requestId: paused.requestId, errorReason: "Failed" });
        } catch (error) {
          lostCheckout.error = error instanceof Error ? error.message : "unknown interception failure";
          void command("Fetch.continueResponse", { requestId: paused.requestId });
        }
      } else {
        void command("Fetch.continueResponse", { requestId: paused.requestId });
      }
    }
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.fail(Error(message.error.message)); else item.done(message.result);
  });
  await new Promise((done, fail) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", fail, { once: true }); });
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Fetch.enable", { patterns: [{ urlPattern: "https://api.sandbox.midtrans.com/*", requestStage: "Request" }] });
}

try {
  await start();
  const owner = await ownerRegistration();
  const business = await businessSetup(owner);
  const core = await productAndCapacity(business);
  const preorder = await preorderPublication(business, core);
  const ai = await aiStrategist(business, preorder);
  const blueprint = await blueprintApproval(business, ai);
  const campaign = await campaignPublication(business, blueprint);
  await publicOffer(business, preorder, campaign, blueprint);
  const order = await buyerCheckout(preorder, { ...campaign, campaignId: blueprint.campaignId });
  const payment = await qrisAttempt(order);
  await verifiedPayment(order, payment);
  await privateStatus(order);
  await emailAndCron(order);
  await campaignKpi(owner, business, preorder);
  await invalidPrivateToken(order);
  await crossBusiness(owner, business, preorder, blueprint, ai);
  await unpublishedPreorder(business, core);
  await blockedStorageDuplicate(preorder, campaign);
  await staleOffer(preorder, campaign, blueprint);
  writeFileSync(join(artifact, "owner-email.txt"), owner.email);
} catch (error) {
  console.error("T3 stopped at verified scenario boundary:", error instanceof Error ? error.message : "unknown");
  if (socket?.readyState === WebSocket.OPEN) {
    try { console.error("Browser state:", await evaluate("location.pathname + location.search"), (await bodyText()).slice(-900)); } catch { /* Browser may already have closed. */ }
  }
  process.exitCode = 1;
} finally {
  writeFileSync(join(artifact, "results.json"), JSON.stringify({ runId, project: cfg.project, branch: branch.stdout.trim(), head,
    sourceDigest: createHash("sha256").update(source).digest("hex"), scenarios: results, browserExceptions: runtimeErrors.length,
    providerModes: { gemini: "mock HTTP transport", midtrans: "mock HTTP transport", email: "local Mailpit" } }, null, 2));
  console.log("T3 artifact: " + join(artifact, "results.json"));
  if (socket) socket.close();
  if (chrome) chrome.kill();
  if (app) {
    const owned = oldApp();
    if (owned === app.pid) spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { windowsHide: true });
    const restored = spawnSync(process.execPath, [join(runtimeRoot, "runtime.mjs"), "app"], { cwd: repo, encoding: "utf8", windowsHide: true });
    if (restored.status !== 0) { console.error("T1 app restore failed"); process.exitCode = 1; }
  }
}
