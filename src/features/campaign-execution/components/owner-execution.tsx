"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Badge, type BadgeTone } from "@/components/owner/badge";
import { BusyLabel } from "@/components/owner/busy-label";
import { plainText } from "@/lib/ai/plain-text";
import { Card } from "@/components/owner/card";
import { DANGER_BUTTON_CLASS, PRIMARY_BUTTON_CLASS, ROW_ACTION_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/form-message";
import { campaignStatusLabel, executionChannelLabel, executionContentLabel, executionErrors, executionMoney, executionTime, offerLabel, taskLabels,
  useExecution, type ExecutionState } from "./use-execution";

const statusTone: Record<string, BadgeTone> = { draft: "neutral", published: "success", closed: "warning", completed: "neutral", cancelled: "danger" };
const taskTone: Record<string, BadgeTone> = { completed: "success", overdue: "warning", upcoming: "neutral" };
const CHECKBOX_CLASS = "mt-0.5 size-5 shrink-0 accent-[var(--ui-brand)]";

export function OwnerMessages({ error, notice }: { error: string; notice: string }) {
  return <>
    {error && <p role="alert" className="rounded-[10px] bg-[var(--owner-danger-bg)] px-3 py-2 text-base text-[color:var(--owner-danger-fg)]">{error}</p>}
    {notice && <p role="status" className="rounded-[10px] bg-[var(--owner-success-bg)] px-3 py-2 text-base text-[color:var(--owner-success-fg)]">{notice}</p>}
  </>;
}

/** Publish, close, checklist, and captions of one campaign in the owner theme. */
export function ExecutionDetail({ e }: { e: ExecutionState }) {
  const { view, busy } = e;
  if (!view) return <div className="flex flex-col gap-4"><OwnerMessages error={e.error} notice={e.notice} />
    {!e.error && <Card><p className="text-base text-muted">Memuat kampanye…</p></Card>}</div>;
  const c = view.campaign; const bp = view.blueprint; const config = view.c3.configuration;
  const progress = view.calendar.progress;
  return <div className="flex flex-col gap-4">
    <OwnerMessages error={e.error} notice={e.notice} />
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold break-words text-ink">{c.name}</h2>
          <p className="text-sm text-muted" data-campaign-state data-status={c.status}>
            Status: {campaignStatusLabel[c.status] ?? c.status}{bp ? ` · rencana versi ${bp.version}` : ""}
          </p>
        </div>
        <Badge tone={statusTone[c.status] ?? "neutral"}>{campaignStatusLabel[c.status] ?? c.status}</Badge>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="text-sm text-muted">Periode kampanye</dt><dd className="font-semibold text-ink">{executionTime(c.starts_at)} sampai {executionTime(c.ends_at)} WIB</dd></div>
        <div><dt className="text-sm text-muted">Penawaran untuk pembeli</dt><dd className="font-semibold text-ink" data-c3-state>{offerLabel[view.c3.state] ?? view.c3.state}</dd></div>
        {bp && <div><dt className="text-sm text-muted">Target rencana</dt><dd className="font-semibold text-ink">{bp.blueprint_json.targetAdditionalUnits} unit terbayar tambahan</dd></div>}
        {bp && <div><dt className="text-sm text-muted">Anggaran promosi</dt><dd className="font-semibold text-ink">{executionMoney(bp.blueprint_json.budgetCapIdr)}</dd></div>}
      </dl>
      {config && <p className="rounded-[10px] bg-subtle px-3 py-2 text-base text-ink">
        {config.offer.discountBps ? `Diskon ${config.offer.discountBps / 100}%` : "Harga normal"} · harga dasar {executionMoney(config.frozenBaseUnitPriceIdr)} menjadi <b>{executionMoney(config.unitPriceIdr)}</b>
      </p>}
      {c.published_at && <p className="text-sm text-muted">Diterbitkan {executionTime(c.published_at)} WIB{c.closed_at && ` · ditutup ${executionTime(c.closed_at)} WIB`}</p>}
      <p className="text-sm text-muted">Target bukan hasil aktual. Harga checkout dihitung ulang oleh database saat pesanan dibuat, dan pembeli dengan atau tanpa tautan kampanye mendapat harga yang sama.</p>
      {c.status === "draft" && <div className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="text-base font-semibold text-ink">Terbitkan kampanye</h3>
        <p className={view.eligibility.eligible ? "text-base text-[color:var(--owner-success-fg)]" : "text-base text-[color:var(--owner-warning-fg)]"}>
          {view.eligibility.eligible ? "Rencana sudah disetujui dan data preorder terbaru lolos pemeriksaan." : executionErrors[view.eligibility.code ?? ""] ?? "Kampanye belum memenuhi syarat untuk diterbitkan."}
        </p>
        <label className="flex items-start gap-3 text-base text-ink"><input id="campaign-publish-confirm" type="checkbox" className={CHECKBOX_CLASS} checked={e.publishConfirm} disabled={busy}
          onChange={(event) => e.setPublishConfirm(event.target.checked)} />Saya sudah meninjau rencana ini dan ingin menerbitkan kampanye sekarang.</label>
        <button id="campaign-publish" type="button" className={`w-full sm:w-fit ${PRIMARY_BUTTON_CLASS}`} disabled={busy || !e.publishConfirm || !view.eligibility.eligible || !bp}
          aria-busy={e.activeAction === "publish"}
          onClick={() => void e.publish()}><BusyLabel busy={e.activeAction === "publish"} label="Terbitkan kampanye" busyLabel="Menerbitkan…" /></button>
      </div>}
      {c.status === "published" && <div className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="text-base font-semibold text-ink">Tutup kampanye</h3>
        <p className="text-base text-muted">Menutup kampanye menghentikan diskon untuk pesanan baru. Pesanan lama, riwayat, tugas, dan caption tetap tersimpan.</p>
        <label className="flex items-start gap-3 text-base text-ink"><input id="campaign-close-confirm" type="checkbox" className={CHECKBOX_CLASS} checked={e.closeConfirm} disabled={busy}
          onChange={(event) => e.setCloseConfirm(event.target.checked)} />Saya ingin menutup kampanye ini.</label>
        <button id="campaign-close" type="button" className={`w-full sm:w-fit ${DANGER_BUTTON_CLASS}`} disabled={busy || !e.closeConfirm} aria-busy={e.activeAction === "close"}
          onClick={() => void e.close()}><BusyLabel busy={e.activeAction === "close"} label="Tutup kampanye" busyLabel="Menutup…" /></button>
      </div>}
      {c.status === "closed" && <p className="text-base text-muted">Kampanye sudah ditutup. Checklist masih bisa diselesaikan atau dibuka kembali.</p>}
      {c.status === "completed" && <p className="text-base text-muted">Kampanye selesai. Checklist dan biaya dibekukan.</p>}
    </Card>

    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">Checklist tugas</h3>
        <p className="text-sm text-muted" data-execution-progress>{progress.completed} dari {progress.total} tugas selesai · {progress.percent}% · {progress.overdue} terlambat</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Kemajuan tugas" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
        <div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${progress.percent}%` }} />
      </div>
      {c.status === "draft" && <p className="text-sm text-muted">Checklist bisa dicentang setelah kampanye diterbitkan.</p>}
      {!view.calendar.days.length && <p className="text-base text-muted">Tugas muncul setelah rencana disetujui.</p>}
      <ol className="flex flex-col gap-4">{view.calendar.days.map((day) => <li key={day.date} className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-muted">{new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "Asia/Jakarta" }).format(new Date(`${day.date}T12:00:00+07:00`))}</h4>
        <ul className="flex flex-col divide-y divide-line rounded-[12px] border border-line">{day.tasks.map((task) => <li key={task.id} className="flex flex-col gap-1 p-3">
          <label className="flex items-start gap-3 text-base font-semibold text-ink"><input data-execution-task={task.id} type="checkbox" className={CHECKBOX_CLASS} checked={task.completed_at !== null}
            disabled={busy || !["published", "closed"].includes(c.status)} onChange={(event) => void e.toggleTask(task, event.target.checked)} />{plainText(task.title)}</label>
          <div className="flex flex-wrap items-center gap-2 pl-8 text-sm text-muted">
            <span>{executionTime(task.due_at)} WIB · {task.channel ? executionChannelLabel[task.channel] ?? task.channel : "Platform lain"}</span>
            <Badge tone={taskTone[task.executionStatus] ?? "neutral"}>{taskLabels[task.executionStatus]}</Badge>
          </div>
          {task.description && <p className="pl-8 text-base whitespace-pre-wrap text-ink">{plainText(task.description)}</p>}
          {task.completed_at && <p className="pl-8 text-sm text-muted">Selesai dikonfirmasi {executionTime(task.completed_at)} WIB</p>}
        </li>)}</ul>
      </li>)}</ol>
      <p className="text-sm text-muted">Mencentang tugas adalah konfirmasi Anda, bukan bukti posting atau keberhasilan penjualan.</p>
    </Card>

    <Card className="flex flex-col gap-4">
      <div><h3 className="text-base font-semibold text-ink">Caption siap dibagikan</h3>
        <p className="text-sm text-muted">Salin lalu tempel ke WhatsApp atau Instagram. Aplikasi tidak memposting otomatis.</p></div>
      <ul className="grid gap-3 lg:grid-cols-2">{view.contents.map((content) => <li key={content.id} className="flex flex-col gap-3 rounded-[12px] border border-line p-4">
        <p className="text-sm font-semibold text-muted">{executionChannelLabel[content.channel] ?? content.channel} · {executionContentLabel[content.content_type] ?? content.content_type}</p>
        <p className="text-base whitespace-pre-wrap break-words text-ink">{plainText(content.body)}</p>
        <button data-caption-copy={content.id} type="button" disabled={busy} className={`mt-auto w-full sm:w-fit ${ROW_ACTION_CLASS}`} aria-busy={e.activeAction === `copy:${content.id}`}
          onClick={() => void e.copy(plainText(content.body), content.id)}><BusyLabel busy={e.activeAction === `copy:${content.id}`} label="Salin caption" busyLabel="Menyalin…" /></button>
      </li>)}</ul>
    </Card>
  </div>;
}

/**
 * Tab "Terbit dan tugas" inside the Campaign hub: one campaign, pinned by id.
 * `onCampaignVersion` reports each loaded campaign version so the hub can resync its plan state after publish or close.
 */
export function OwnerExecutionPanel({ campaignId, onCampaignVersion }: { campaignId: string; onCampaignVersion?: (version: number) => void }) {
  const e = useExecution(true, campaignId);
  const report = useRef(onCampaignVersion);
  useEffect(() => { report.current = onCampaignVersion; });
  const version = e.view?.campaign.version;
  useEffect(() => { if (version !== undefined) report.current?.(version); }, [version]);
  return <ExecutionDetail e={e} />;
}

/** /dashboard/campaigns/execution: every saved campaign, then the selected one. */
export function OwnerExecutionPage() {
  const e = useExecution(true);
  const selected = e.view?.campaign.id;
  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-[65ch]">
        <h1 className="text-2xl font-bold text-ink">Eksekusi kampanye</h1>
        <p className="mt-1 text-base text-muted">Terbitkan kampanye yang rencananya sudah disetujui, centang tugas, dan salin caption.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/dashboard/campaigns" className={SECONDARY_BUTTON_CLASS}>Kembali ke Campaign AI</Link>
        <button id="execution-refresh" type="button" className={SECONDARY_BUTTON_CLASS} disabled={e.busy} onClick={() => void e.refresh()}>Muat ulang</button>
      </div>
    </div>
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card padded={false} className="self-start">
        <h2 className="px-4 pt-4 text-base font-semibold text-ink">Kampanye tersimpan</h2>
        {!e.campaigns.length ? <p className="p-4 text-base text-muted">Belum ada kampanye dengan rencana yang disetujui.</p>
          : <ul className="flex flex-col gap-1 p-2">{e.campaigns.map((entry) => <li key={entry.id}>
            <button type="button" data-campaign-select={entry.id} aria-current={selected === entry.id} disabled={e.busy} onClick={() => void e.select(entry.id)}
              className="flex w-full flex-col items-start gap-1 rounded-[10px] px-3 py-2 text-left transition-colors hover:bg-subtle aria-[current=true]:bg-[var(--ui-brand-soft)]">
              <span className="text-base font-semibold break-words text-ink">{entry.name}</span>
              <Badge tone={statusTone[entry.status] ?? "neutral"}>{campaignStatusLabel[entry.status] ?? entry.status}</Badge>
            </button></li>)}</ul>}
      </Card>
      <div className="min-w-0">{e.view ? <ExecutionDetail e={e} /> : <><OwnerMessages error={e.error} notice={e.notice} />
        <Card><p className="text-base text-muted">Pilih kampanye untuk meninjau jadwal dan menerbitkannya.</p></Card></>}</div>
    </div>
  </div>;
}
