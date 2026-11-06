"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { AnalyticsScenarioSchema, EvaluationProviderScenarioSchema, EvaluationViewSchema, Money, type EvaluationView } from "../contracts";
import "../../campaign-strategist/components/discussion.css";
import "../../campaign-execution/components/execution.css";
import "./evaluation.css";

const ListSchema = z.object({ campaigns: z.array(z.object({ id: z.uuid(), name: z.string(), status: z.enum(["closed", "completed"]) })), synthetic: z.literal(true) });
const currency = (n: number | null) => n === null ? "Belum diketahui" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const value = (n: number | null) => n === null ? "Belum diketahui" : new Intl.NumberFormat("id-ID").format(n);
const time = (s: string) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(new Date(s));
const messages: Record<string, string> = { UNAUTHENTICATED: "Masuk melalui halaman diskusi lalu kembali ke evaluasi ini.", NOT_FOUND: "Data tidak ditemukan untuk akun ini.",
  VERSION_CONFLICT: "Versi sumber berubah. Muat ulang sebelum mencoba lagi.", STALE_CONTEXT: "Sumber atau skenario berubah. Muat ulang lalu buat snapshot evaluasi baru.",
  IDEMPOTENCY_CONFLICT: "Request ID dipakai dengan isi berbeda. Muat ulang dan buat request baru.", INVALID_INPUT: "Input tidak valid; periksa nominal, alasan koreksi dan konfirmasi.",
  CLOSED_CAMPAIGN_REQUIRED: "Evaluasi dan pencatatan biaya ini memerlukan campaign closed.", FUTURE_COST: "Biaya aktual tidak boleh memiliki waktu di masa depan.",
  SYNTHETIC_EVALUATION_DISABLED: "Aktifkan mode evaluasi sintetis pada server development.", NARRATIVE_REVIEW_UNAVAILABLE: "Narasi belum valid. Buat snapshot baru dengan provider valid sebelum review.",
  STALE_EVALUATION_VERSION: "Ada snapshot atau review yang lebih baru. Muat ulang dan tinjau evaluasi terbaru.",
  STALE_SOURCE_STATE: "Biaya, checklist, atau sumber lain berubah. Muat ulang lalu buat dan review snapshot terbaru.",
  OWNER_REVIEW_REQUIRED: "Evaluasi terbaru harus ditinjau pemilik sebelum finalisasi.", EVALUATION_REQUIRED: "Buat dan review evaluasi terbaru terlebih dahulu.",
  COSTS_INCOMPLETE: "Konfirmasikan kelengkapan pengeluaran sebelum finalisasi.", KPI_INCOMPLETE: "Sumber KPI atau biaya produksi belum lengkap; finalisasi ditolak.",
  VERIFIED_C6_UNAVAILABLE: "C6 terverifikasi belum tersedia. Finalisasi produksi tetap diblokir.",
  SYNTHETIC_COHORT_REQUIRED: "Penyelesaian simulasi hanya untuk preorder uji tanpa order atau reservasi nyata.",
  COMPLETED_CAMPAIGN_IMMUTABLE: "Campaign sudah completed. Catatan biaya dan checklist dibekukan.",
  NUMERIC_RANGE: "Total finansial melampaui rentang yang didukung; tidak ada nilai yang dipotong atau dianggap nol." };
async function api(query = "", body?: unknown) {
  const response = await fetch(`/api/dev/evaluations${query}`, { method: body ? "POST" : "GET", cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const raw: unknown = await response.json(); if (!response.ok) { const error = z.object({ code: z.string() }).safeParse(raw); throw new Error(error.success ? error.data.code : "PERSISTENCE_UNAVAILABLE"); } return raw;
}
export function EvaluationWorkspace() {
  const [list, setList] = useState<z.infer<typeof ListSchema>["campaigns"]>([]); const [view, setView] = useState<EvaluationView | null>(null);
  const [scenario, setScenario] = useState<z.infer<typeof AnalyticsScenarioSchema>>("exceeds_target"); const [provider, setProvider] = useState<z.infer<typeof EvaluationProviderScenarioSchema>>("valid");
  const [selectedId, setSelectedId] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [amount, setAmount] = useState("50000"); const [description, setDescription] = useState(""); const [category, setCategory] = useState<"advertising" | "printing" | "other">("advertising");
  const [reason, setReason] = useState(""); const [costConfirm, setCostConfirm] = useState(false); const [reviewConfirm, setReviewConfirm] = useState(false);
  const [finalizeConfirm, setFinalizeConfirm] = useState(false);
  const locked = useRef(false); const pending = useRef<{ signature: string; body: Record<string, string | number | boolean | null> } | null>(null);
  const failed = useCallback((error: unknown) => { const code = error instanceof Error ? error.message : "PERSISTENCE_UNAVAILABLE"; setError(messages[code] ?? "Hasil penyimpanan belum dapat dipastikan. Muat ulang atau ulangi payload yang sama untuk rekonsiliasi."); }, []);
  const load = useCallback(async (id: string, selectedScenario: z.infer<typeof AnalyticsScenarioSchema>) => {
    const next = EvaluationViewSchema.parse(await api(`?campaignId=${id}&scenario=${selectedScenario}`)); setView(next); setCostConfirm(false); setReviewConfirm(false); setFinalizeConfirm(false);
    const url = new URL(location.href); url.searchParams.set("campaignId", id); history.replaceState(null, "", url); return next;
  }, []);
  useEffect(() => {
    let mounted = true;
    void api().then(async (raw) => { if (!mounted) return; setList(ListSchema.parse(raw).campaigns); const id = new URL(location.href).searchParams.get("campaignId"); if (id) await load(id, "exceeds_target"); }).catch((e: unknown) => { if (mounted) failed(e); });
    return () => { mounted = false; };
  }, [load, failed]);
  async function run(work: () => Promise<void>) {
    if (locked.current) return; locked.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (e) { failed(e); } finally { locked.current = false; setBusy(false); }
  }
  function stable(signature: string, make: () => Record<string, string | number | boolean | null>) { if (pending.current?.signature !== signature) pending.current = { signature, body: make() }; return pending.current.body; }
  const c = view?.context.snapshot.campaign; const s = view?.summary; const selected = view?.history.find((entry) => entry.row.id === selectedId) ?? view?.history[0];
  const report = selected?.row.analysis_json.narrative;
  return <main lang="id" className="discussion-workspace evaluation-workspace"><div className="discussion-container">
    <header><Link href="/dev/campaigns">Kembali ke eksekusi campaign</Link><h1>Evaluasi campaign</h1><p className="discussion-mode">SIMULASI DEVELOPMENT · Fake Evaluation · KPI sintetis bukan transaksi, pembayaran terverifikasi, atau hasil usaha nyata. Penyimpanan dan Auth Supabase nyata.</p><p><Link href="/dev/discussion">Login & diskusi</Link></p></header>
    {error && <p className="discussion-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="discussion-layout"><aside><h2>Campaign closed / completed</h2><ul className="discussion-sessions">{list.map((row) => <li key={row.id}><button disabled={busy} aria-current={row.id === c?.id} onClick={() => void run(async () => { await load(row.id, scenario); setSelectedId(""); })}>{row.name} · {row.status} · {row.id.slice(0, 8)}</button></li>)}</ul>
      {!list.length && <p>Tutup campaign melalui alur eksekusi sebelum mengevaluasinya.</p>}</aside>
    <section className="execution-detail evaluation-detail" aria-label="Laporan evaluasi">
      {!view && <p>Pilih campaign closed untuk meninjau KPI, biaya dan evaluasinya.</p>}
      {view && c && s && <><h2>{c.name}</h2><p data-evaluation-state>{c.status} · campaign v{c.version} · {c.status === "completed" ? "penyelesaian simulasi tersimpan; bukan hasil usaha terverifikasi" : "snapshot provisional"}</p>
        <button id="evaluation-refresh" className="discussion-secondary" disabled={busy} onClick={() => void run(async () => { await load(c.id, scenario); })}>Muat ulang evaluasi</button>
        <p>Window pengukuran: {time(view.measurementWindow.startsAt)} — {time(view.measurementWindow.endsAt)} WIB. Target rencana berbeda dari pengamatan.</p>
        <label>Skenario KPI sintetis<select id="evaluation-scenario" value={scenario} disabled={busy} onChange={(event) => { const next = AnalyticsScenarioSchema.parse(event.target.value); setScenario(next); void run(async () => { await load(c.id, next); }); }}>
          <option value="exceeds_target">Melebihi target</option><option value="below_target">Di bawah target</option><option value="high_spend">Dampak pengeluaran tinggi</option><option value="incomplete_checklist">Review checklist belum lengkap</option><option value="missing_cost">Ledger produksi belum diketahui</option><option value="provisional">KPI operasional provisional</option><option value="unavailable">C6 belum tersedia</option>
        </select></label>
        <h3>Strategi approved & riwayat pelaksanaan</h3>
        {view.context.snapshot.blueprint && <><p>Blueprint v{view.context.snapshot.blueprint.version} · {view.context.snapshot.blueprint.blueprint_json.marketingApproach} · diskon {view.context.snapshot.blueprint.blueprint_json.offer.discountBps / 100}%</p>
          <p>{view.context.snapshot.blueprint.blueprint_json.goal}</p><p>Hipotesis rencana: {view.context.snapshot.blueprint.blueprint_json.hypothesis}</p>
          <p>Harga preorder frozen {currency(view.context.snapshot.item.base_price_snapshot_idr)} → harga campaign {currency(view.context.snapshot.blueprint.blueprint_json.financial.calculation.hypotheticalFinalUnitPriceIdr)}. Harga katalog tidak digunakan ulang.</p></>}
        <ol>{view.context.snapshot.tasks.map((task) => <li key={task.id}><strong>{task.title}</strong><p>{task.channel} · jadwal {time(task.due_at)} WIB · {task.completed_at ? `dikonfirmasi selesai ${time(task.completed_at)} WIB` : "belum selesai"}</p></li>)}</ol>
        <p>Checklist adalah konfirmasi manual, bukan bukti posting. <Link href={`/dev/campaigns?campaignId=${c.id}`}>Lihat caption dan rencana eksekusi lengkap</Link>.</p>
        <h3>Rencana dan pengamatan C6 saat ini</h3><p data-kpi-provenance>{view.context.analytics.status === "available" ? "KPI SIMULASI DEVELOPMENT — tidak berasal dari order/pembayaran nyata" : "C6 tidak tersedia — nilai pengamatan tetap belum diketahui"}</p>
        <dl className="discussion-numbers" data-evaluation-metrics>
          <div><dt>Baseline paid units saat publikasi SQL</dt><dd>{s.baselinePaidUnits}</dd></div><div><dt>Target tambahan / pengamatan window</dt><dd>{s.plannedAdditionalUnits} / {value(s.observed.paidUnitsInWindow)}</dd></div>
          <div><dt>Seluruh paid units preorder (simulasi)</dt><dd>{value(s.observed.currentPreorderPaidUnits)}</dd></div><div><dt>Atribusi tautan / penerima harga campaign (simulasi)</dt><dd>{value(s.observed.attributedPaidUnits)} / {value(s.observed.discountedPaidUnits)}</dd></div>
          <div><dt>Revenue rencana hipotetis</dt><dd>{currency(s.hypotheticalRevenueIdr)}</dd></div><div><dt>Revenue fulfilled dalam financial scope (simulasi)</dt><dd>{currency(s.observed.scopedFulfilledSalesValueIdr)}</dd></div>
          <div><dt>Biaya produksi incurred (simulasi)</dt><dd>{currency(s.observed.scopedProductionCostIncurredIdr)}</dd></div><div><dt>Budget / pengeluaran tercatat yang direview</dt><dd>{currency(s.budgetCapIdr)} / {currency(s.actualPromotionSpendIdr)}</dd></div>
          <div><dt>Selisih pengeluaran minus budget</dt><dd>{currency(s.budgetVarianceIdr)}</dd></div><div><dt>Kontribusi simulasi setelah biaya</dt><dd>{currency(s.contributionIdr)}</dd></div>
          <div><dt>Kontribusi rencana hipotetis</dt><dd>{currency(s.hypotheticalContributionIdr)}</dd></div>
          <div><dt>Pencapaian target (bukan uplift kausal)</dt><dd>{s.achievementBps === null ? "Belum diketahui" : `${value(s.achievementBps / 100)}%`}</dd></div><div><dt>Checklist manual</dt><dd>{s.completedTasks} / {s.totalTasks}</dd></div>
        </dl><p>Financial scope adalah union distinct order terkait atribusi atau pricing, bukan penjumlahan keduanya. Dalam simulasi ini tidak ada order asli yang dibuat.</p>
        <h3>Pengeluaran promosi tercatat</h3><p data-cost-review-state>{view.context.costsCompleteness} · subtotal nonvoid {currency(s.recordedSpendSubtotalIdr)}. Budget tidak otomatis menjadi pengeluaran.</p>
        {!view.context.costs.length && <p>Belum ada biaya tercatat. Ini belum menyatakan pengeluaran nol sampai pemilik mengonfirmasi kelengkapannya.</p>}
        <ul className="evaluation-costs">{view.context.costs.map((cost) => <li key={cost.id}><strong>{cost.category} · {currency(cost.amount_idr)}</strong><p>{cost.description} · {time(cost.incurred_at)} WIB</p>
          {cost.voided_at ? <p>Voided: {cost.void_reason}</p> : <button data-cost-void={cost.id} disabled={busy || !reason.trim() || c.status !== "closed"} className="discussion-secondary" onClick={() => void run(async () => {
            await api("", { action: "void_cost", campaignId: c.id, costId: cost.id, expectedCostVersion: cost.version, reason }); await load(c.id, scenario); setNotice("Biaya di-void; histori dipertahankan dan review kelengkapan dibatalkan.");
          })}>Void catatan biaya</button>}</li>)}</ul>
        <label>Alasan void (wajib untuk koreksi)<input id="evaluation-void-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>
        <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
          if (!/^\d{1,10}$/.test(amount)) throw new Error("INVALID_INPUT"); const amountIdr = Money.parse(Number(amount));
          const signature = JSON.stringify({ c: c.id, category, description, amountIdr }); const body = stable(signature, () => ({ action: "create_cost", campaignId: c.id, requestId: crypto.randomUUID(), category, description, amountIdr, incurredAt: new Date().toISOString() }));
          await api("", body); pending.current = null; await load(c.id, scenario); setDescription(""); setNotice("Pengeluaran tercatat tersimpan; belum dianggap lengkap sampai direview pemilik.");
        }); }}><label>Kategori<select id="evaluation-cost-category" value={category} onChange={(e) => setCategory(z.enum(["advertising", "printing", "other"]).parse(e.target.value))}><option value="advertising">Advertising</option><option value="printing">Printing</option><option value="other">Other</option></select></label>
          <label>Nominal IDR<input id="evaluation-cost-amount" inputMode="numeric" value={amount} maxLength={10} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label>Deskripsi pengeluaran<input id="evaluation-cost-description" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} required /></label>
          <button id="evaluation-cost-save" disabled={busy || c.status !== "closed"}>Catat pengeluaran</button></form>
        <label><input id="evaluation-cost-confirm" type="checkbox" checked={costConfirm} onChange={(e) => setCostConfirm(e.target.checked)} /> Saya sudah meninjau seluruh pengeluaran nonvoid, termasuk jika pengeluaran aktual nol.</label>
        <button id="evaluation-cost-review" disabled={busy || !costConfirm || c.status !== "closed"} onClick={() => void run(async () => { await api("", { action: "review_costs", campaignId: c.id, expectedCampaignVersion: c.version, confirm: true }); await load(c.id, scenario); setNotice("Kelengkapan pengeluaran dikonfirmasi. Perubahan biaya berikutnya membatalkan review ini."); })}>Konfirmasi biaya lengkap</button>
        <h3>Interpretasi AI atas angka deterministik</h3><label>Skenario Fake Provider<select id="evaluation-provider" value={provider} onChange={(e) => setProvider(EvaluationProviderScenarioSchema.parse(e.target.value))}><option value="valid">Valid</option><option value="failure">Failure sintetis</option><option value="invalid">Output invalid</option></select></label>
        <button id="evaluation-generate" disabled={busy || c.status !== "closed"} onClick={() => void run(async () => {
          const signature = JSON.stringify({ c: c.id, v: c.version, hash: view.context.contextHash, latest: view.latestEvaluationId, scenario, provider });
          const body = stable(signature, () => ({ action: "generate", campaignId: c.id, requestId: crypto.randomUUID(), expectedCampaignVersion: c.version, expectedEvaluationId: view.latestEvaluationId, expectedContextHash: view.context.contextHash, analyticsScenario: scenario, providerScenario: provider }));
          const saved = EvaluationViewSchema.parse(await api("", body)); if (typeof body.requestId === "string") setSelectedId(body.requestId); pending.current = null; setView(saved); setReviewConfirm(false); setFinalizeConfirm(false); setNotice("Snapshot provisional tersimpan. Review pemilik tidak memfinalisasi campaign.");
        })}>Generate & simpan snapshot</button>
        <h3>Riwayat snapshot immutable</h3><p>Review membuat catatan baru yang merujuk parent. PostgreSQL memeriksa ID evaluasi terbaru dan versi sumber secara atomik.</p>
        <ul className="evaluation-history">{view.history.map((entry) => <li key={entry.row.id}><button className="discussion-secondary" data-evaluation-select={entry.row.id} onClick={() => { setSelectedId(entry.row.id); setReviewConfirm(false); setFinalizeConfirm(false); }}>
          {time(entry.row.evaluated_at)} WIB · {entry.row.analysis_json.status} · {entry.row.analysis_json.review.status} · {entry.row.id.slice(0, 8)}{entry.stale && " · sumber/skenario berbeda"}</button></li>)}</ul>
        {view.unsupportedCount > 0 && <p>Ada snapshot dari kontrak lain yang dipertahankan, tetapi tidak dipakai oleh workflow ini.</p>}
        {selected && <article className="evaluation-report" data-evaluation-report><h3>Snapshot {selected.row.id.slice(0, 8)}</h3><p data-evaluation-review-status>{selected.row.analysis_json.status} · {selected.row.analysis_json.review.status} · {selected.row.evaluation_kind} · sintetis</p>
          <p>Fakta snapshot tersimpan {time(selected.row.metrics_json.sourceFactsAt)} WIB: target {selected.row.metrics_json.summary.plannedAdditionalUnits}, pengamatan window {value(selected.row.metrics_json.summary.observed.paidUnitsInWindow)}, pengeluaran direview {currency(selected.row.metrics_json.summary.actualPromotionSpendIdr)}, kontribusi simulasi {currency(selected.row.metrics_json.summary.contributionIdr)}.</p>
          {selected.stale && <p role="status">Sumber atau skenario berbeda dari snapshot tersimpan. Pilih skenario yang sesuai atau buat laporan baru dengan fakta terkini.</p>}
          {!report && <p role="status">Provider {selected.row.analysis_json.status === "failed" ? "gagal" : "menghasilkan output yang ditolak"}. KPI dan provenance tetap tersimpan; tidak ada narasi sukses palsu.</p>}
          {report && <><p>{report.summary}</p><p>{report.kpiAnalysis}</p><p>{report.financialAnalysis}</p><p>{report.executionAnalysis}</p>
            <h4>Temuan, risiko & rekomendasi</h4><ul>{[...report.successes, ...report.shortfalls, ...report.risks, ...report.recommendations, ...report.warnings].map((text, i) => <li key={i}>{text}</li>)}</ul><p>Sumber: {report.evidenceReferences.join(", ")}</p></>}
          <label><input id="evaluation-review-confirm" type="checkbox" checked={reviewConfirm} onChange={(e) => setReviewConfirm(e.target.checked)} /> Saya telah meninjau snapshot dan keterbatasan narasi ini.</label>
          <button id="evaluation-review" disabled={busy || c.status !== "closed" || selected.row.id !== view.latestEvaluationId || selected.stale || !report || !reviewConfirm || selected.row.analysis_json.review.status === "reviewed"} onClick={() => void run(async () => {
            const body = stable(JSON.stringify({ action: "review", id: selected.row.id, hash: view.context.contextHash, v: c.version }), () => ({ action: "review", campaignId: c.id, requestId: crypto.randomUUID(), evaluationId: selected.row.id, expectedCampaignVersion: c.version, expectedContextHash: view.context.contextHash, confirm: true }));
            const saved = EvaluationViewSchema.parse(await api("", body)); if (typeof body.requestId === "string") setSelectedId(body.requestId); pending.current = null; setView(saved); setReviewConfirm(false); setFinalizeConfirm(false); setNotice("Review pemilik tersimpan sebagai snapshot baru; parent tidak diubah.");
          })}>Simpan review pemilik</button></article>}
        <h3>Kualitas data & finalization</h3><ul>{view.context.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
        {c.status === "completed" ? <p data-finalization-result>Penyelesaian simulasi tersimpan {c.completed_at && time(c.completed_at)} WIB. Biaya dan checklist dibekukan; provenance tetap sintetis.</p> : <>
          <ul data-finalization-blockers>{view.finalization.blockers.map((code) => <li key={code}>{messages[code] ?? code}</li>)}</ul>
          <p>Finalisasi memakai evaluasi terbaru {view.latestEvaluationId?.slice(0, 8) ?? "(belum ada)"}. Task yang belum dicentang tetap tercatat sebagai keterbatasan, bukan bukti posting.</p>
          <label><input id="evaluation-finalize-confirm" type="checkbox" checked={finalizeConfirm} onChange={(event) => setFinalizeConfirm(event.target.checked)} /> Saya menyetujui penyelesaian simulasi lokal dan pembekuan biaya/checklist. Ini bukan finalisasi performa terverifikasi.</label>
          <button id="evaluation-finalize" disabled={busy || !finalizeConfirm || !view.finalization.eligible} onClick={() => void run(async () => {
            if (!view.latestEvaluationId) throw new Error("EVALUATION_REQUIRED");
            const body = stable(JSON.stringify({ action: "finalize", id: view.latestEvaluationId, hash: view.context.contextHash, v: c.version }), () => ({ action: "finalize", campaignId: c.id,
              requestId: crypto.randomUUID(), evaluationId: view.latestEvaluationId, expectedCampaignVersion: c.version, expectedContextHash: view.context.contextHash, confirm: true }));
            const saved = EvaluationViewSchema.parse(await api("", body)); setView(saved); if (typeof body.requestId === "string") setSelectedId(body.requestId);
            pending.current = null; setFinalizeConfirm(false); setList((rows) => rows.map((row) => row.id === c.id ? { ...row, status: saved.context.snapshot.campaign.status === "completed" ? "completed" : "closed" } : row));
            setNotice("Campaign completed sebagai simulasi lokal. Evaluasi final dan audit tersimpan; tidak ada Business Memory dibuat.");
          })}>Finalisasi simulasi lokal</button></>}
        <p>Snapshot sintetis/provisional tidak eligible untuk Business Memory produksi. Tidak ada memory atau embedding yang dibuat.</p>
        {c.status==="completed"&&<p><Link id="evaluation-open-memory" href={`/dev/memories?campaignId=${c.id}`}>Tinjau dan buat candidate Business Memory</Link></p>}
      </>}
    </section></div>
  </div></main>;
}
