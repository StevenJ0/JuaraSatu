// Test process only: intercept external HTTP at the transport boundary. No real provider requests leave this process.
const { readFileSync, writeFileSync, appendFileSync } = require("node:fs");
const { URL } = require("node:url");

const statePath = process.env.T3_PROVIDER_STATE_PATH;
const auditPath = process.env.T3_PROVIDER_AUDIT_PATH;
if (!statePath || !auditPath || process.env.T3_ISOLATED_PROJECT !== "cl-t1-5c24f460eb0e") {
  throw new Error("T3 provider preload requires the verified isolated target");
}
const originalFetch = globalThis.fetch;
const load = () => JSON.parse(readFileSync(statePath, "utf8"));
const save = (value) => writeFileSync(statePath, JSON.stringify(value));
const audit = (kind, facts = {}) => appendFileSync(auditPath, JSON.stringify({ kind, at: new Date().toISOString(), ...facts }) + "\n");
const wib = (time) => new Date(time + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");

function embedded(value, match) {
  if (typeof value === "string") {
    try { return embedded(JSON.parse(value), match); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  if (match(value)) return value;
  for (const child of Object.values(value)) {
    const found = embedded(child, match);
    if (found) return found;
  }
  return null;
}

function strategy(prompt) {
  const facts = prompt.authoritativeFacts.preorder;
  if (!prompt.ownerPreferences.allowDiscount || facts.baseUnitPriceIdr !== 120000) throw new Error("T3 controlled strategy facts differ");
  return { schemaVersion: 1, contextHash: prompt.contextBinding.contextHash,
    reply: "Rencana diskon untuk ditinjau pemilik.", sourceReferences: ["c1.preorder", "c1.product"],
    limitations: ["Provider lokal tiruan; hasil penjualan belum dapat diprediksi."],
    options: [{ proposalKey: "t3-discount", title: "Diskon preorder", marketingApproach: "limited_discount",
      offer: { offerType: "percent_discount", discountBps: 1000 }, assumedAdditionalUnits: 2,
      assumedPromotionCostIdr: 1000, channels: ["whatsapp"], startsAt: facts.startsAt, endsAt: facts.endsAt,
      hypothesis: "Diskon mungkin membantu pembeli meninjau preorder.", assumptions: ["Volume tambahan adalah asumsi, bukan hasil."],
      risks: ["Respons pembeli belum diketahui."], sourceReferences: ["c1.preorder"] }] };
}

function blueprint(prompt) {
  const starts = Math.max(Date.parse(prompt.ownerEdits.startsAt), Date.parse(prompt.now));
  if (!Number.isFinite(starts) || starts + 30_000 >= Date.parse(prompt.ownerEdits.endsAt)) throw new Error("T3 blueprint window unavailable");
  return { goal: "Meninjau pelaksanaan preorder.", hypothesis: "Diskon mungkin membantu calon pembeli.",
    audienceHypothesis: "Calon pembeli yang berminat.", rationale: "Gunakan fakta preorder yang disimpan.",
    tasks: [{ key: "review-message", title: "Tinjau pesan preorder", description: "Periksa penawaran sebelum dibagikan.",
      channel: "whatsapp", dueAt: new Date(starts + 30_000).toISOString() }],
    contents: [{ key: "campaign-caption", channel: "whatsapp", type: "caption",
      body: "Preorder tersedia. Tinjau penawaran dan jadwal pengambilan." }],
    risks: ["Minat pembeli belum dapat dipastikan."], dependencies: ["Preorder tetap terbuka."],
    ownerChecklist: ["Tinjau pesan sebelum dibagikan."] };
}

function transaction(row) {
  return { status_code: row.status === "settlement" ? "200" : "201", transaction_id: row.transactionId,
    order_id: row.orderId, merchant_id: "G_T3_LOCAL", gross_amount: `${row.amount}.00`, currency: "IDR",
    payment_type: "qris", transaction_status: row.status, fraud_status: "accept", expiry_time: row.expiry,
    ...(row.status === "settlement" ? { settlement_time: row.settlementTime } : {}),
    actions: [{ name: "generate-qr-code", method: "GET", url: `https://api.sandbox.midtrans.com/v2/qris/${row.transactionId}/qr-code` }] };
}

globalThis.fetch = async (input, init) => {
  const address = new URL(input instanceof Request ? input.url : String(input));
  if (address.origin === "https://generativelanguage.googleapis.com") {
    const body = init?.body ?? (input instanceof Request ? input.clone().body : null);
    const raw = JSON.parse(typeof body === "string" ? body : body ? await new Response(body).text() : "{}");
    const strategyPrompt = embedded(raw, value => value.contextBinding && value.authoritativeFacts && value.ownerPreferences);
    const blueprintPrompt = embedded(raw, value => value.validatedScenario && value.ownerEdits && value.now);
    if (!strategyPrompt && !blueprintPrompt) throw new Error("Unrecognized T3 Gemini request");
    const output = strategyPrompt ? strategy(strategyPrompt) : blueprint(blueprintPrompt);
    audit(strategyPrompt ? "gemini_strategy_mock" : "gemini_blueprint_mock", strategyPrompt ? {
      frozenBasePriceIdr: strategyPrompt.authoritativeFacts.preorder.baseUnitPriceIdr,
      variableCostIdr: strategyPrompt.authoritativeFacts.product.variableCostIdr,
      orderableUnits: strategyPrompt.authoritativeFacts.preorder.orderableUnits,
      sourceVersionCount: Object.keys(strategyPrompt.contextBinding.sourceVersions).length,
    } : {});
    return Response.json({ id: "t3-local-interaction", status: "completed", output_text: JSON.stringify(output),
      steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(output) }] }] });
  }
  if (address.origin === "https://api.sandbox.midtrans.com") {
    const state = load();
    if (init?.method === "POST" && address.pathname === "/v2/charge") {
      const request = JSON.parse(String(init.body));
      const orderId = request.transaction_details.order_id;
      if (state.transactions[orderId]) throw new Error("Duplicate T3 provider charge");
      const orderTime = Date.parse(request.custom_expiry.order_time.replace(" ", "T").replace(" +0700", "+07:00"));
      if (!Number.isFinite(orderTime)) throw new Error("Invalid T3 provider order time");
      const row = { orderId, transactionId: `t3-${orderId}`, amount: request.transaction_details.gross_amount,
        status: "pending", expiry: wib(orderTime + request.custom_expiry.expiry_duration * 1000) };
      state.transactions[orderId] = row;
      state.chargeCount += 1;
      save(state);
      audit("midtrans_charge_mock");
      return Response.json(transaction(row), { status: 201 });
    }
    const match = /^\/v2\/(.+)\/status$/.exec(address.pathname);
    if (init?.method === "GET" && match) {
      const row = state.transactions[decodeURIComponent(match[1])];
      audit("midtrans_status_mock");
      return row ? Response.json(transaction(row)) : Response.json({ status_code: "404" }, { status: 404 });
    }
    throw new Error("Unexpected T3 Midtrans request");
  }
  if (!["http://127.0.0.1", "http://localhost"].includes(address.origin.replace(/:\d+$/, ""))) {
    throw new Error("External network access blocked in T3 app process");
  }
  return originalFetch(input, init);
};
