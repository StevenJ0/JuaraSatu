"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ExecutionViewSchema, LifecycleCampaignSchema, type ExecutionView } from "../contracts";
import "../../campaign-strategist/components/discussion.css";
import "./execution.css";

const ListSchema = z.object({ campaigns: z.array(LifecycleCampaignSchema), synthetic: z.boolean() });
const time = (value: string) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
const labels: Record<string, string> = { completed: "Selesai", overdue: "Terlambat", upcoming: "Akan datang" };
const errors: Record<string, string> = {
  UNAUTHENTICATED: "Sesi login belum tersedia atau berakhir. Masuk melalui halaman diskusi lalu kembali ke campaign ini.",
  NOT_FOUND: "Campaign tidak ditemukan untuk akun ini.", FORBIDDEN: "Akses ditolak.",
  INVALID_INPUT: "Input atau konfirmasi tidak valid. Muat ulang dan tinjau aksi yang dipilih.",
  VERSION_CONFLICT: "Versi berubah di request lain. Muat ulang sebelum mencoba lagi.",
  STALE_CONTEXT: "Fakta sumber berubah. Campaign belum dipublikasikan; buat strategi dan blueprint baru dengan fakta terkini.",
  BLUEPRINT_NOT_APPROVED: "Publikasi memerlukan blueprint tersimpan yang sudah disetujui pemilik.",
  CAMPAIGN_CONFLICT: "Masih ada campaign published pada preorder ini. Tutup campaign tersebut dahulu.",
  CAMPAIGN_WINDOW_INVALID: "Publikasi harus dilakukan di dalam periode campaign dan batas preorder.",
  CONTEXT_UNAVAILABLE: "Context sintetis yang konsisten belum tersedia. Publikasi diblokir sampai sumber dapat diverifikasi.",
  INVALID_CAMPAIGN_STATE: "Aksi tidak sesuai status campaign saat ini. Muat ulang untuk melihat status tersimpan.",
  INVALID_CAMPAIGN_CONFIGURATION: "Konfigurasi campaign berbeda dari blueprint approved. Publikasi diblokir.",
  INVALID_EXECUTION_PLAN: "Tugas/konten tersimpan berbeda dari blueprint approved. Perubahan diblokir.",
  SYNTHETIC_PUBLISHING_DISABLED: "Mode publikasi sintetis belum diaktifkan pada server development.",
  DATABASE_BUSY: "Transaksi bersamaan belum selesai. Muat ulang lalu ulangi aksi yang sama.",
  CAMPAIGN_NOT_PUBLISHABLE: "Database menolak publikasi berdasarkan kondisi terbaru. Muat ulang sebelum mencoba lagi.",
  DISCOUNT_POLICY_BLOCKER: "Diskon tidak memenuhi kebijakan biaya dan kontribusi. Publikasi diblokir.",
  CLIPBOARD_UNAVAILABLE: "Browser belum mengizinkan clipboard. Pilih teks caption lalu salin secara manual.",
};
async function api(base: string, query = "", body?: unknown) {
  const response = await fetch(`${base}${query}`, { method: body ? "POST" : "GET", cache: "no-store",
    headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const raw: unknown = await response.json();
  if (!response.ok) { const parsed = z.object({ code: z.string() }).safeParse(raw); throw new Error(parsed.success ? parsed.data.code : "PERSISTENCE_UNAVAILABLE"); }
  return raw;
}
export function ExecutionWorkspace({ owner = false }: { owner?: boolean }) {
  const call = useCallback((query = "", body?: unknown) => api(owner ? "/api/owner/campaigns" : "/api/dev/campaigns", query, body), [owner]);
  const [campaigns, setCampaigns] = useState<z.infer<typeof ListSchema>["campaigns"]>([]);
  const [view, setView] = useState<ExecutionView | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [publishConfirm, setPublishConfirm] = useState(false); const [closeConfirm, setCloseConfirm] = useState(false);
  const lock = useRef(false);
  const failed = useCallback((value: unknown) => { const code = value instanceof Error ? value.message : "PERSISTENCE_UNAVAILABLE";
    setError(errors[code] ?? "Hasil penyimpanan belum dapat dipastikan. Muat ulang atau ulangi aksi yang sama untuk rekonsiliasi."); }, []);
  const load = useCallback(async (id: string) => {
    const next = ExecutionViewSchema.parse(await call(`?campaignId=${encodeURIComponent(id)}`)); setView(next); setPublishConfirm(false); setCloseConfirm(false);
    const url = new URL(location.href); url.searchParams.set("campaignId", id); history.replaceState(null, "", url);
  }, [call]);
  const list = useCallback(async () => { setCampaigns(ListSchema.parse(await call()).campaigns); }, [call]);
  useEffect(() => {
    let mounted = true;
    void call().then(async (raw) => { if (!mounted) return; setCampaigns(ListSchema.parse(raw).campaigns);
      const id = new URL(location.href).searchParams.get("campaignId"); if (id) await load(id);
    }).catch((error: unknown) => { if (mounted) failed(error); });
    return () => { mounted = false; };
  }, [load, failed, call]);
  async function run(work: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (error) { failed(error); } finally { lock.current = false; setBusy(false); }
  }
  async function mutate(body: unknown, message: string) {
    const saved = ExecutionViewSchema.parse(await call("", body)); await load(saved.campaign.id); await list(); setNotice(saved.replayed ? "Aksi sebelumnya sudah tersimpan; tidak ada perubahan ganda." : message);
  }
  const c = view?.campaign; const bp = view?.blueprint;
  const Root = owner ? "div" : "main";
  return <Root className="discussion-workspace execution-workspace" lang="id"><div className="discussion-container">
    <header><Link href={owner ? "/dashboard/campaigns" : "/dev/discussion"}>Kembali ke diskusi & blueprint</Link><h1>Eksekusi campaign</h1>
      <p className="discussion-mode">{owner ? "Rencana dari preorder usaha Anda. Publikasi untuk pembeli menunggu integrasi C8." : "Development sintetis · Auth, publikasi, checklist dan persistence Supabase nyata. Harga C3 belum terhubung ke checkout C8."}</p></header>
    {error && <p role="alert" className="discussion-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="discussion-layout"><aside aria-label="Campaign milik Anda"><h2>Campaign tersimpan</h2>
      <button className="discussion-secondary" id="execution-refresh" disabled={busy} onClick={() => void run(async () => { await list(); if (c) await load(c.id); })}>Muat ulang</button>
      <ul className="discussion-sessions">{campaigns.map((entry) => <li key={entry.id}><button data-campaign-select={entry.id} disabled={busy} aria-current={c?.id === entry.id}
        onClick={() => void run(() => load(entry.id))}>{entry.name} · {entry.status} · {entry.id.slice(0, 8)}</button></li>)}</ul>
      {!campaigns.length && <p>Belum ada campaign approved untuk ditinjau. Masuk dan setujui blueprint melalui halaman diskusi.</p>}
    </aside><section className="execution-detail" aria-label="Rencana eksekusi">
      {!view && <p>Pilih campaign tersimpan untuk meninjau kelayakan publikasi dan jadwalnya.</p>}
      {view && c && <>
        <h2>{c.name}</h2><p className="execution-state" data-campaign-state>{c.status} · campaign v{c.version} · blueprint v{bp?.version ?? "—"}</p>
        {!owner && ["closed", "completed"].includes(c.status) && <p><Link id="campaign-open-evaluation" href={`/dev/evaluations?campaignId=${c.id}`}>Tinjau KPI, biaya & evaluasi</Link></p>}
        <p>Periode: {time(c.starts_at)} — {time(c.ends_at)} WIB</p>
        {c.published_at && <p>Dipublikasikan: {time(c.published_at)} WIB{c.closed_at && ` · Ditutup: ${time(c.closed_at)} WIB`}</p>}
        {bp && <p>KPI rencana: {bp.blueprint_json.primaryKpi}, target {bp.blueprint_json.targetAdditionalUnits} unit. Ini target, bukan hasil aktual.</p>}
        {bp && <p>Anggaran rencana: {money(bp.blueprint_json.budgetCapIdr)}</p>}
        {c.status === "draft" && <div className="execution-action"><h3>Publikasi oleh pemilik</h3>
          <p>{owner ? "Publikasi untuk pembeli belum tersedia sampai integrasi C8 selesai." : view.eligibility.eligible ? "Blueprint approved dan fakta terkini lolos pemeriksaan publikasi." : errors[view.eligibility.code ?? ""] ?? "Campaign belum memenuhi syarat publikasi."}</p>
          <label><input id="campaign-publish-confirm" type="checkbox" checked={publishConfirm} disabled={owner || busy} onChange={(event) => setPublishConfirm(event.target.checked)} /> Saya sudah meninjau versi ini dan ingin mempublikasikan campaign sekarang.</label>
          <button id="campaign-publish" disabled={owner || busy || !publishConfirm || !view.eligibility.eligible || !bp} onClick={() => void run(async () => {
            if (!bp) return; await mutate({ action: "publish", campaignId: c.id, blueprintId: bp.id, expectedBlueprintVersion: bp.version,
              expectedCampaignVersion: c.version, expectedContextHash: bp.context_hash, confirm: true }, "Campaign published dan baseline tersimpan atomik. Checkout belum terintegrasi.");
          })}>Publikasikan campaign</button></div>}
        <h3>Konfigurasi offer C3</h3><p data-c3-state>{view.c3.state} · {view.c3.eligible ? "Eligible menurut konfigurasi dan waktu" : "Tidak eligible"}</p>
        {view.c3.configuration && <p>{view.c3.configuration.offer.offerType} · diskon {view.c3.configuration.offer.discountBps / 100}% · harga frozen {money(view.c3.configuration.frozenBaseUnitPriceIdr)} → {money(view.c3.configuration.unitPriceIdr)}</p>}
        <p>Kelayakan C3 adalah input untuk C8. Ketersediaan preorder dan harga checkout tetap perlu diverifikasi oleh integrasi checkout.</p>
        <h3>Progress checklist manual</h3><p data-execution-progress>{view.calendar.progress.completed} dari {view.calendar.progress.total} tugas selesai · {view.calendar.progress.percent}% · {view.calendar.progress.overdue} terlambat</p>
        {owner && c.status === "draft" && <p>Checklist dapat diperbarui setelah campaign dipublikasikan. Rencana approved ini masih hanya dapat ditinjau sampai C8 tersedia.</p>}
        <progress aria-label="Progress tugas manual" max={100} value={view.calendar.progress.percent} />
        <p>Menandai tugas selesai merupakan konfirmasi pemilik, bukan bukti posting atau keberhasilan penjualan. Jadwal tidak digeser otomatis.</p>
        <h3>Kalender aktivitas · WIB</h3>
        {!view.calendar.days.length && <p>Belum ada tugas termaterialisasi dari blueprint approved.</p>}
        <ol className="execution-days">{view.calendar.days.map((day) => <li key={day.date}><h4>{new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "Asia/Jakarta" }).format(new Date(`${day.date}T12:00:00+07:00`))}</h4>
          <ul>{day.tasks.map((task) => <li key={task.id} className="execution-task"><label><input data-execution-task={task.id} type="checkbox" checked={task.completed_at !== null}
            disabled={busy || !["published", "closed"].includes(c.status)} onChange={(event) => {
              const completed = event.target.checked; void run(() => mutate({ action: "task", campaignId: c.id, blueprintId: task.blueprint_id, taskId: task.id,
                expectedTaskVersion: task.version, completed }, completed ? "Checklist selesai tersimpan." : "Checklist dibuka kembali."));
            }} /> {task.title}</label><p>{time(task.due_at)} WIB · {task.channel ?? "Tanpa channel"} · {labels[task.executionStatus]}</p><p>{task.description}</p>
            {task.completed_at && <p>Selesai dikonfirmasi: {time(task.completed_at)} WIB</p>}</li>)}</ul>
        </li>)}</ol>
        <h3>Caption & konten approved</h3><p>Konten terkait blueprint dan channel; schema tidak menyimpan relasi ke satu task/tanggal tertentu.</p>
        {view.contents.map((content) => <article className="execution-content" key={content.id}><h4>{content.channel} · {content.content_type}</h4><p>{content.body}</p>
          <button data-caption-copy={content.id} disabled={busy} className="discussion-secondary" onClick={() => void run(async () => {
            try { await navigator.clipboard.writeText(content.body); setNotice("Caption disalin. Menyalin tidak menandakan konten sudah diposting."); }
            catch { throw new Error("CLIPBOARD_UNAVAILABLE"); }
          })}>Salin konten</button></article>)}
        {c.status === "published" && <div className="execution-action"><h3>Tutup publikasi campaign</h3>
          <p>Penutupan menonaktifkan offer C3 dan mempertahankan riwayat, tugas, konten serta baseline. Tidak membuat evaluasi atau mengubah status menjadi completed.</p>
          <label><input id="campaign-close-confirm" type="checkbox" checked={closeConfirm} disabled={busy} onChange={(event) => setCloseConfirm(event.target.checked)} /> Saya ingin menutup publikasi campaign ini.</label>
          <button id="campaign-close" disabled={busy || !closeConfirm} onClick={() => void run(() => mutate({ action: "close", campaignId: c.id, expectedCampaignVersion: c.version, confirm: true }, "Campaign closed. Riwayat dan checklist tetap tersimpan."))}>Tutup campaign</button>
        </div>}
        {c.status === "closed" && <p className="execution-state">Publikasi telah ditutup. Checklist manual masih dapat diselesaikan atau dibuka kembali. Buka evaluasi untuk meninjau snapshot dan prasyarat finalisasi.</p>}
        {c.status === "completed" && <p className="execution-state">Campaign completed. Checklist dan biaya dibekukan; tinjau provenance serta audit penyelesaian pada evaluasi tersimpan.</p>}
      </>}
    </section></div>
  </div></Root>;
}
