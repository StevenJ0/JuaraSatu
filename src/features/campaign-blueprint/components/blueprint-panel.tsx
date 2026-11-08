"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { BlueprintRowSchema, CampaignRowSchema, BlueprintPlanSchema, BlueprintEditsSchema, SelectionSchema, type BlueprintEdits, type CampaignBlueprint } from "../contracts";
import "./blueprint.css";

const ViewSchema = z.object({ campaign: CampaignRowSchema, active: BlueprintRowSchema.nullable(), history: z.array(BlueprintRowSchema), currentHash: z.string().nullable().optional(),
  materialized: z.object({ tasks: z.array(z.object({ id: z.uuid() })), contents: z.array(z.object({ id: z.uuid() })) }), replayed: z.boolean().optional() });
const ChoicesSchema = z.object({ proposals: z.array(z.object({ selection: SelectionSchema, title: z.string(), eligible: z.boolean() })), currentHash: z.string().nullable() });
type View = z.infer<typeof ViewSchema>;
const money = (value: number | null) => value === null ? "Belum diketahui" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
const time = (value: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value));
const errorMessages: Record<string, string> = {
  STALE_CONTEXT: "Context sumber berubah. Buat strategi tersimpan baru dengan fakta terkini; approval belum dilakukan.",
  VERSION_CONFLICT: "Versi campaign/blueprint berubah. Muat ulang sebelum mencoba lagi.",
  IDEMPOTENCY_CONFLICT: "Request ID dipakai dengan isi berbeda. Muat ulang lalu buat request baru.",
  INVALID_BLUEPRINT: "Blueprint ditolak. Periksa penawaran, tanggal, tugas, caption, dan batas form.",
  INVALID_CONTENT: "Teks rencana tidak boleh mengandung klaim tanpa bukti atau janji hasil. Angka target, estimasi, dan harga harus sesuai fakta server.",
  INVALID_SCHEDULE: "Jadwal tugas harus berada dalam periode preorder dan sebelum campaign berakhir.",
  INVALID_PROPOSAL: "Proposal atau alternatif sumber tidak valid/tersimpan.", INVALID_PROVENANCE: "Provenance sumber tidak cocok; perubahan dibatalkan.",
  FINANCIAL_OR_CAPACITY_BLOCKER: "Asumsi melanggar biaya, diskon, atau kapasitas. Periksa parameter; belum ada perubahan tersimpan.",
  CONTEXT_UNAVAILABLE: "Fakta sumber belum tersedia. Muat ulang dan periksa preorder.",
  SYNTHETIC_APPROVAL_DISABLED: "Aktifkan CAMPAIGN_BLUEPRINT_APPROVAL=synthetic pada server lokal untuk approval demo.",
  CONFIGURATION_ERROR: "Provider rencana belum dikonfigurasi oleh pengelola.",
  PROVIDER_UNAVAILABLE: "Layanan rencana gagal; versi tersimpan sebelumnya tetap tersedia.",
  CAMPAIGN_EXISTS: "Campaign preorder ini sudah tersedia. Buka campaign tersimpan dari daftar diskusi.",
  NOT_FOUND: "Campaign atau sumber tidak ditemukan untuk akun ini.", FORBIDDEN: "Akses ditolak.",
};
async function api(base: string, query = "", body?: unknown) {
  const response = await fetch(`${base}${query}`, { method: body ? "POST" : "GET", cache: "no-store",
    headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value: unknown = await response.json();
  if (!response.ok) { const parsed = z.object({ code: z.string() }).safeParse(value); throw new Error(parsed.success ? parsed.data.code : "PERSISTENCE_UNAVAILABLE"); }
  return value;
}
function editable(body: CampaignBlueprint): BlueprintEdits {
  return { title: body.campaignTitle, marketingApproach: body.marketingApproach, discountBps: body.offer.discountBps,
    budgetCapIdr: body.budgetCapIdr, targetAdditionalUnits: body.targetAdditionalUnits, startsAt: body.executionWindow.startsAt,
    endsAt: body.executionWindow.endsAt, channels: body.channels, notes: "", plan: BlueprintPlanSchema.strip().parse(body) };
}
export function BlueprintPanel({ sessionId, owner = false }: { sessionId: string; owner?: boolean }) {
  const call = useCallback((query = "", body?: unknown) => api(owner ? "/api/owner/blueprints" : "/api/dev/blueprints", query, body), [owner]);
  const [choices, setChoices] = useState<z.infer<typeof ChoicesSchema>>({ proposals: [], currentHash: null });
  const [view, setView] = useState<View | null>(null); const [edits, setEdits] = useState<BlueprintEdits | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false); const [scenario, setScenario] = useState<"valid" | "failure" | "invalid">("valid");
  const locked = useRef(false); const pending = useRef<{ signature: string; payload: unknown } | null>(null);
  const loadView = useCallback(async (id: string) => {
    const loaded = ViewSchema.parse(await call(`?campaignId=${encodeURIComponent(id)}`));
    if (loaded.active?.blueprint_json.source.sessionId !== sessionId) throw new Error("INVALID_PROVENANCE");
    setView(loaded); setEdits(loaded.active ? editable(loaded.active.blueprint_json) : null); setConfirm(false);
    const url = new URL(window.location.href); url.searchParams.set("campaignId", id); window.history.replaceState(null, "", url);
  }, [sessionId, call]);
  const failure = useCallback((value: unknown) => { const code = value instanceof Error ? value.message : "PERSISTENCE_UNAVAILABLE";
    setError(errorMessages[code] ?? "Proses belum dapat dipastikan. Muat ulang atau ulangi payload yang sama untuk rekonsiliasi."); }, []);
  useEffect(() => {
    let active = true;
    void call(`?sessionId=${encodeURIComponent(sessionId)}`).then(async (raw) => {
      if (!active) return; setChoices(ChoicesSchema.parse(raw));
      const id = new URL(window.location.href).searchParams.get("campaignId"); if (id) await loadView(id);
    }).catch((error: unknown) => { if (active) failure(error); });
    return () => { active = false; };
  }, [sessionId, loadView, failure, call]);
  async function run(work: () => Promise<void>) {
    if (locked.current) return; locked.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (error) { failure(error); } finally { locked.current = false; setBusy(false); }
  }
  function stable(signature: string, make: () => unknown) {
    if (pending.current?.signature === signature) return pending.current.payload;
    const payload = make(); pending.current = { signature, payload }; return payload;
  }
  const active = view?.active; const body = active?.blueprint_json;
  const stale = !!body && (view?.currentHash === null || (view?.currentHash !== undefined && view.currentHash !== body.contextHash));
  return <section className="blueprint-panel" aria-label="Campaign Blueprint"><h2>Campaign Blueprint</h2>
    <p className="blueprint-notice">{owner ? "Blueprint dari fakta preorder Anda. Approval menyetujui rencana; campaign belum aktif untuk pembeli." : "Blueprint · context sintetis · Auth dan persistence nyata. Approval demo tidak mempublikasikan campaign."}</p>
    {error && <p role="alert" className="blueprint-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button className="discussion-secondary" disabled={busy} onClick={() => void run(async () => { setChoices(ChoicesSchema.parse(await call(`?sessionId=${sessionId}`))); if (view) await loadView(view.campaign.id); })}>Muat ulang blueprint/sumber</button>
    <div className="blueprint-choices">{choices.proposals.map((entry) => <div key={`${entry.selection.generationId}:${entry.selection.proposalKey}`}>
      <p>{entry.title} · proposal {entry.selection.proposalVersion}{!entry.eligible && " · context stale"}</p>
      <button data-blueprint-create disabled={busy || !entry.eligible || !!view} onClick={() => void run(async () => {
        const payload = stable(JSON.stringify({ selection: entry.selection, scenario }), () => ({ action: "create", selection: entry.selection, campaignId: crypto.randomUUID(), requestId: crypto.randomUUID(), scenario }));
        const saved = ViewSchema.parse(await call("", payload)); await loadView(saved.campaign.id);
        setNotice(saved.replayed ? "Draft dan blueprint tersimpan diputar ulang." : "Draft dan blueprint awal tersimpan atomik; belum approved atau published.");
      })}>Buat campaign draft & blueprint</button></div>)}</div>
    {!choices.proposals.length && <p>Kirim strategi lalu muat ulang sumber. Hanya alternatif dari proposal yang benar-benar tersimpan dapat dipilih.</p>}
    {view && active && body && edits && <>
      <div className="blueprint-status" data-blueprint-status>{active.approval_status} · blueprint v{active.version} · campaign v{view.campaign.version} · {view.campaign.status}</div>
      {owner && body.provider === "development-fake-blueprint" && <p role="status">Rencana ini dibuat dengan provider mock untuk pengujian integrasi.</p>}
      {body.provider === "manual" && <p>Revisi manual tanpa generasi AI. Sumber rencana sebelumnya tetap tersedia pada riwayat versi induk.</p>}
      {active.approval_status === "approved" && <p><Link id="blueprint-open-execution" href={`${owner ? "/dashboard/campaigns/execution" : "/dev/campaigns"}?campaignId=${view.campaign.id}`}>Tinjau publikasi & kalender eksekusi</Link></p>}
      {stale && <p role="status">Context sumber berubah atau belum tersedia; approval diblokir sampai strategi dan fakta tervalidasi ulang.</p>}
      <h3>{body.campaignTitle}</h3><p>{body.goal}</p><p>Hipotesis: {body.hypothesis}</p><p>{body.rationale}</p><p>Audiens: {body.audienceHypothesis}</p>
      <dl className="discussion-numbers">
        <div><dt>Harga preorder frozen</dt><dd>{money(body.financial.frozenBasePriceIdr)}</dd></div>
        <div><dt>Harga efektif saat snapshot</dt><dd>{money(body.financial.calculation.currentOffer?.unitPriceIdr ?? null)}</dd></div>
        <div><dt>Biaya variabel / kualitas data</dt><dd>{money(body.financial.variableCostIdr)} / {body.financial.costQuality}</dd></div>
        <div><dt>Diskon / harga hipotetis</dt><dd>{body.offer.discountBps / 100}% / {money(body.financial.calculation.hypotheticalFinalUnitPriceIdr)}</dd></div>
        <div><dt>Asumsi unit / budget</dt><dd>{body.targetAdditionalUnits} / {money(body.budgetCapIdr)}</dd></div>
        <div><dt>Revenue / kontribusi skenario</dt><dd>{money(body.financial.calculation.scenarioRevenueIdr)} / {money(body.financial.calculation.scenarioContributionIdr)}</dd></div>
      </dl>
      <p>{time(body.executionWindow.startsAt)} — {time(body.executionWindow.endsAt)} WIB · {body.channels.join(", ")}</p>
      <h3>KPI target, bukan hasil aktual</h3><p>{body.primaryKpi}: target {body.kpiPlan.target} unit. {body.kpiPlan.definition} {body.kpiPlan.baselineNote}</p>
      <h3>Seluruh rencana tugas ({body.tasks.length})</h3><ol>{body.tasks.map((task) => <li key={task.key}><strong>{task.title}</strong><p>{time(task.dueAt)} WIB · {task.channel}</p><p>{task.description}</p></li>)}</ol>
      <h3>Seluruh caption/konten ({body.contents.length})</h3>{body.contents.map((content) => <article key={content.key}><h4>{content.channel} · {content.type}</h4><p>{content.body}</p></article>)}
      <h3>Asumsi dan batas evaluasi</h3><ul>{body.assumptions.map((item) => <li key={item}>{item}</li>)}</ul><p>{body.evaluationPlan}</p>
      <h3>Risiko, dependensi dan checklist review</h3><ul>{[...body.risks, ...body.dependencies, ...body.ownerChecklist].map((item, index) => <li key={index}>{item}</li>)}</ul>
      <h3>Riwayat versi</h3><ul>{view.history.map((row) => <li key={row.id}>Blueprint v{row.version} · {row.approval_status}{row.blueprint_json.provider === "manual" && " · revisi manual"}{row.approved_at && ` · approved ${time(row.approved_at)} WIB`}</li>)}</ul>
      <p>Materialisasi versi aktif: {view.materialized.tasks.length} tugas, {view.materialized.contents.length} konten. Riwayat versi lama dipertahankan.</p>
      <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
        const valid = BlueprintEditsSchema.parse(edits);
        const signature = JSON.stringify({ campaign: view.campaign.id, parent: active.id, version: view.campaign.version, valid, scenario });
        const payload = stable(signature, () => ({ action: "revise", campaignId: view.campaign.id, requestId: crypto.randomUUID(), expectedCampaignVersion: view.campaign.version,
          expectedBlueprintId: active.id, expectedBlueprintVersion: active.version, edits: valid, scenario }));
        const saved = ViewSchema.parse(await call("", payload)); await loadView(saved.campaign.id); setNotice(saved.replayed ? "Revisi sebelumnya diputar ulang tanpa versi ganda." : "Versi revisi tersimpan; approval lama sudah tidak aktif.");
      }); }}>
        <h3>Edit atau minta revisi</h3><label>Nama campaign<input id="blueprint-title" value={edits.title} readOnly /></label>
        <label>Diskon (basis points)<input id="blueprint-discount" type="number" min="0" max="9999" step="1" value={edits.discountBps} onChange={(event) => setEdits({ ...edits, discountBps: Number(event.target.value), marketingApproach: Number(event.target.value) ? "limited_discount" : "scheduled_reminder", plan: undefined })} /></label>
        <label>Budget hipotetis (Rp)<input id="blueprint-budget" type="number" min="0" max="1000000000" step="1" value={edits.budgetCapIdr} onChange={(event) => setEdits({ ...edits, budgetCapIdr: Number(event.target.value) })} /></label>
        <label>Asumsi tambahan unit<input id="blueprint-units" type="number" min="1" max="10000" step="1" value={edits.targetAdditionalUnits} onChange={(event) => setEdits({ ...edits, targetAdditionalUnits: Number(event.target.value) })} /></label>
        <label>Tujuan<textarea id="blueprint-goal" value={edits.plan?.goal ?? body.goal} maxLength={500} onChange={(event) => setEdits({ ...edits, plan: { ...(edits.plan ?? BlueprintPlanSchema.strip().parse(body)), goal: event.target.value } })} /></label>
        <label>Caption pertama (tanpa angka/harga bebas)<textarea id="blueprint-caption" value={edits.plan?.contents[0]?.body ?? body.contents[0].body} maxLength={2200} onChange={(event) => {
          const plan = edits.plan ?? BlueprintPlanSchema.strip().parse(body); setEdits({ ...edits, plan: { ...plan, contents: plan.contents.map((content, index) => index === 0 ? { ...content, body: event.target.value } : content) } });
        }} /></label>
        <label>Catatan revisi<textarea id="blueprint-notes" value={edits.notes} maxLength={500} onChange={(event) => setEdits({ ...edits, notes: event.target.value })} /></label>
        <label><input id="blueprint-replan" type="checkbox" checked={!edits.plan} onChange={(event) => setEdits({ ...edits, plan: event.target.checked ? undefined : BlueprintPlanSchema.strip().parse(body) })} /> Susun ulang tugas/konten dari strategi dan catatan; mengganti edit manual plan</label>
        <button id="blueprint-save" type="submit" disabled={busy || stale}>Simpan revisi baru</button>
      </form>
      <div className="blueprint-approval"><h3>Approval pemilik</h3>
        {active.approval_status === "approved" ? <p>Blueprint v{active.version} approved oleh {active.approved_by_user_id} pada {active.approved_at && time(active.approved_at)} WIB. Campaign tetap draft.</p>
          : <><label><input id="blueprint-confirm" type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} /> Saya sudah meninjau seluruh versi ini dan menyetujui rencana ini.</label>
            <button id="blueprint-approve" disabled={busy || stale || !confirm} onClick={() => void run(async () => {
              const saved = ViewSchema.parse(await call("", { action: "approve", campaignId: view.campaign.id, blueprintId: active.id, expectedBlueprintVersion: active.version,
                expectedCampaignVersion: view.campaign.version, confirm: true })); await loadView(saved.campaign.id); setNotice("Blueprint approved dan tugas/konten termaterialisasi atomik. Campaign belum dipublikasikan.");
            })}>Approve versi {active.version}</button></>}
      </div>
    </>}
    {!owner && <label className="blueprint-scenario">Skenario provider blueprint<select id="blueprint-scenario" value={scenario} onChange={(event) => setScenario(z.enum(["valid", "failure", "invalid"]).parse(event.target.value))}>
      <option value="valid">Valid</option><option value="failure">Failure sintetis</option><option value="invalid">Output invalid sintetis</option></select></label>}
  </section>;
}
