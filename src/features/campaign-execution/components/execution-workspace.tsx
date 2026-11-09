"use client";
import Link from "next/link";
import "../../campaign-strategist/components/discussion.css";
import "./execution.css";
import { campaignStatusLabel as campaignLabel, executionChannelLabel as channelLabel, executionContentLabel as contentLabel, executionErrors as errors,
  executionMoney as money, executionTime as time, offerLabel, taskLabels as labels, useExecution } from "./use-execution";

/** Development execution page (/dev/campaigns); owners use OwnerExecution, which shares the same useExecution state. */
export function ExecutionWorkspace({ owner = false }: { owner?: boolean }) {
  const e = useExecution(owner);
  const { campaigns, view, busy } = e;
  const c = view?.campaign; const bp = view?.blueprint;
  const Root = owner ? "div" : "main";
  return <Root className="discussion-workspace execution-workspace" lang="id"><div className="discussion-container">
    <header><Link href={owner ? "/dashboard/campaigns" : "/dev/discussion"}>{owner ? "Kembali ke diskusi" : "Kembali ke diskusi & blueprint"}</Link><h1>{owner ? "Eksekusi kampanye" : "Eksekusi campaign"}</h1>
      <p className="discussion-mode">{owner ? "Rencana dari preorder usaha Anda. Setelah diterbitkan, diskon berlaku untuk semua pembeli selama periode kampanye." : "Development sintetis · Auth, publikasi, checklist dan persistence Supabase nyata. Harga checkout membaca campaign published yang aktif (C8)."}</p></header>
    {e.error && <p role="alert" className="discussion-error">{e.error}</p>}{e.notice && <p role="status">{e.notice}</p>}
    <div className="discussion-layout"><aside aria-label="Kampanye milik Anda"><h2>{owner ? "Kampanye tersimpan" : "Campaign tersimpan"}</h2>
      <button className="discussion-secondary" id="execution-refresh" disabled={busy} onClick={() => void e.refresh()}>Muat ulang</button>
      <ul className="discussion-sessions">{campaigns.map((entry) => <li key={entry.id}><button data-campaign-select={entry.id} disabled={busy} aria-current={c?.id === entry.id}
        onClick={() => void e.select(entry.id)}>{owner ? `${entry.name} · ${campaignLabel[entry.status] ?? entry.status}` : `${entry.name} · ${entry.status} · ${entry.id.slice(0, 8)}`}</button></li>)}</ul>
      {!campaigns.length && <p>{owner ? "Belum ada kampanye dengan rencana yang disetujui. Setujui rencana di halaman diskusi." : "Belum ada campaign approved untuk ditinjau. Masuk dan setujui blueprint melalui halaman diskusi."}</p>}
    </aside><section className="execution-detail" aria-label="Rencana eksekusi">
      {!view && <p>{owner ? "Pilih kampanye untuk meninjau jadwal dan menerbitkannya." : "Pilih campaign tersimpan untuk meninjau kelayakan publikasi dan jadwalnya."}</p>}
      {view && c && <>
        <h2>{c.name}</h2><p className="execution-state" data-campaign-state data-status={c.status}>{owner
          ? `Status: ${campaignLabel[c.status] ?? c.status}${bp ? ` · rencana versi ${bp.version}` : ""}`
          : `${c.status} · campaign v${c.version} · blueprint v${bp?.version ?? "—"}`}</p>
        {!owner && ["closed", "completed"].includes(c.status) && <p><Link id="campaign-open-evaluation" href={`/dev/evaluations?campaignId=${c.id}`}>Tinjau KPI, biaya & evaluasi</Link></p>}
        <p>Periode: {time(c.starts_at)} sampai {time(c.ends_at)} WIB</p>
        {c.published_at && <p>{owner ? "Diterbitkan" : "Dipublikasikan"}: {time(c.published_at)} WIB{c.closed_at && ` · Ditutup: ${time(c.closed_at)} WIB`}</p>}
        {bp && <p>{owner ? `Target rencana: ${bp.blueprint_json.targetAdditionalUnits} unit terbayar tambahan.` : `KPI rencana: ${bp.blueprint_json.primaryKpi}, target ${bp.blueprint_json.targetAdditionalUnits} unit.`} Ini target, bukan hasil aktual.</p>}
        {bp && <p>Anggaran rencana: {money(bp.blueprint_json.budgetCapIdr)}</p>}
        {c.status === "draft" && <div className="execution-action"><h3>{owner ? "Terbitkan kampanye" : "Publikasi oleh pemilik"}</h3>
          <p>{view.eligibility.eligible ? owner ? "Rencana sudah disetujui dan data preorder terbaru lolos pemeriksaan." : "Blueprint approved dan fakta terkini lolos pemeriksaan publikasi."
            : errors[view.eligibility.code ?? ""] ?? (owner ? "Kampanye belum memenuhi syarat untuk diterbitkan." : "Campaign belum memenuhi syarat publikasi.")}</p>
          <label><input id="campaign-publish-confirm" type="checkbox" checked={e.publishConfirm} disabled={busy} onChange={(event) => e.setPublishConfirm(event.target.checked)} /> {owner ? "Saya sudah meninjau rencana ini dan ingin menerbitkan kampanye sekarang." : "Saya sudah meninjau versi ini dan ingin mempublikasikan campaign sekarang."}</label>
          <button id="campaign-publish" disabled={busy || !e.publishConfirm || !view.eligibility.eligible || !bp} onClick={() => void e.publish()}>{owner ? "Terbitkan kampanye" : "Publikasikan campaign"}</button></div>}
        <h3>{owner ? "Penawaran kampanye" : "Konfigurasi offer C3"}</h3><p data-c3-state>{owner ? offerLabel[view.c3.state] ?? view.c3.state : `${view.c3.state} · ${view.c3.eligible ? "Eligible menurut konfigurasi dan waktu" : "Tidak eligible"}`}</p>
        {view.c3.configuration && <p>{owner
          ? `${view.c3.configuration.offer.discountBps ? `Diskon ${view.c3.configuration.offer.discountBps / 100}%` : "Harga normal"} · harga dasar ${money(view.c3.configuration.frozenBaseUnitPriceIdr)} menjadi ${money(view.c3.configuration.unitPriceIdr)}`
          : `${view.c3.configuration.offer.offerType} · diskon ${view.c3.configuration.offer.discountBps / 100}% · harga frozen ${money(view.c3.configuration.frozenBaseUnitPriceIdr)} → ${money(view.c3.configuration.unitPriceIdr)}`}</p>}
        <p>Harga checkout dihitung ulang oleh database saat pesanan dibuat. Pembeli dengan atau tanpa link kampanye mendapat harga yang sama.</p>
        <h3>{owner ? "Kemajuan checklist" : "Progress checklist manual"}</h3><p data-execution-progress>{view.calendar.progress.completed} dari {view.calendar.progress.total} tugas selesai · {view.calendar.progress.percent}% · {view.calendar.progress.overdue} terlambat</p>
        {owner && c.status === "draft" && <p>Checklist bisa diperbarui setelah kampanye diterbitkan.</p>}
        <progress aria-label="Kemajuan tugas" max={100} value={view.calendar.progress.percent} />
        <p>Menandai tugas selesai merupakan konfirmasi pemilik, bukan bukti posting atau keberhasilan penjualan. Jadwal tidak digeser otomatis.</p>
        <h3>Kalender aktivitas · WIB</h3>
        {!view.calendar.days.length && <p>{owner ? "Tugas muncul setelah rencana disetujui." : "Belum ada tugas termaterialisasi dari blueprint approved."}</p>}
        <ol className="execution-days">{view.calendar.days.map((day) => <li key={day.date}><h4>{new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "Asia/Jakarta" }).format(new Date(`${day.date}T12:00:00+07:00`))}</h4>
          <ul>{day.tasks.map((task) => <li key={task.id} className="execution-task"><label><input data-execution-task={task.id} type="checkbox" checked={task.completed_at !== null}
            disabled={busy || !["published", "closed"].includes(c.status)} onChange={(event) => void e.toggleTask(task, event.target.checked)} /> {task.title}</label>
            <p>{time(task.due_at)} WIB · {task.channel ? owner ? channelLabel[task.channel] ?? task.channel : task.channel : owner ? "Tanpa kanal" : "Tanpa channel"} · {labels[task.executionStatus]}</p><p>{task.description}</p>
            {task.completed_at && <p>Selesai dikonfirmasi: {time(task.completed_at)} WIB</p>}</li>)}</ul>
        </li>)}</ol>
        <h3>{owner ? "Caption yang disetujui" : "Caption & konten approved"}</h3><p>{owner ? "Caption tidak terikat ke satu tugas atau tanggal tertentu." : "Konten terkait blueprint dan channel; schema tidak menyimpan relasi ke satu task/tanggal tertentu."}</p>
        {view.contents.map((content) => <article className="execution-content" key={content.id}><h4>{owner ? `${channelLabel[content.channel] ?? content.channel} · ${contentLabel[content.content_type] ?? content.content_type}` : `${content.channel} · ${content.content_type}`}</h4><p>{content.body}</p>
          <button data-caption-copy={content.id} disabled={busy} className="discussion-secondary" onClick={() => void e.copy(content.body)}>{owner ? "Salin caption" : "Salin konten"}</button></article>)}
        {c.status === "published" && <div className="execution-action"><h3>{owner ? "Tutup kampanye" : "Tutup publikasi campaign"}</h3>
          <p>{owner ? "Menutup kampanye menghentikan diskon untuk pesanan baru. Pesanan lama, riwayat, tugas, dan caption tetap tersimpan." : "Penutupan menonaktifkan offer C3 dan mempertahankan riwayat, tugas, konten serta baseline. Tidak membuat evaluasi atau mengubah status menjadi completed."}</p>
          <label><input id="campaign-close-confirm" type="checkbox" checked={e.closeConfirm} disabled={busy} onChange={(event) => e.setCloseConfirm(event.target.checked)} /> {owner ? "Saya ingin menutup kampanye ini." : "Saya ingin menutup publikasi campaign ini."}</label>
          <button id="campaign-close" disabled={busy || !e.closeConfirm} onClick={() => void e.close()}>{owner ? "Tutup kampanye" : "Tutup campaign"}</button>
        </div>}
        {c.status === "closed" && <p className="execution-state">{owner ? "Kampanye sudah ditutup. Checklist masih bisa diselesaikan atau dibuka kembali." : "Publikasi telah ditutup. Checklist manual masih dapat diselesaikan atau dibuka kembali. Buka evaluasi untuk meninjau snapshot dan prasyarat finalisasi."}</p>}
        {c.status === "completed" && <p className="execution-state">{owner ? "Kampanye selesai. Checklist dan biaya dibekukan." : "Campaign completed. Checklist dan biaya dibekukan; tinjau provenance serta audit penyelesaian pada evaluasi tersimpan."}</p>}
      </>}
    </section></div>
  </div></Root>;
}
