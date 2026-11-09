"use client";

import Link from "next/link";
import { ScenarioSchema } from "../persistence-contracts";
import type { StrategyProposal } from "../contracts";
import { BlueprintPanel } from "@/features/campaign-blueprint/components/blueprint-panel";
import "./discussion.css";
import { OWNER_FALLBACK, ownerMessages, preorderStatus, useDiscussion } from "./use-discussion";

const money = (value: number | null) => value === null ? "Belum diketahui" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
function Proposal({ proposal, owner }: { proposal: StrategyProposal; owner: boolean }) {
  return <section className="discussion-proposal" aria-label="Alternatif strategi tersimpan">
    <p>{owner ? "Usulan AI · perlu Anda tinjau" : `Snapshot tersimpan · versi proposal ${proposal.proposalVersion} · perlu review pemilik`}</p>
    {proposal.options.length === 0 ? <p>{owner ? "Belum ada usulan yang lolos pemeriksaan." : "Tidak ada alternatif yang lolos validasi."}</p> : proposal.options.map((option) => <article key={option.proposalKey}>
      <h3>{option.title}</h3><p>{option.hypothesis}</p>
      <dl className="discussion-numbers">
        <div><dt>{owner ? "Diskon" : "Diskon hipotetis"}</dt><dd>{option.offer.discountBps / 100}%</dd></div>
        <div><dt>{owner ? "Harga per unit" : "Harga/unit hipotetis"}</dt><dd>{money(option.computedScenario.hypotheticalFinalUnitPriceIdr)}</dd></div>
        <div><dt>Asumsi unit tambahan</dt><dd>{option.assumedAdditionalUnits}</dd></div>
        <div><dt>Asumsi biaya promosi</dt><dd>{money(option.assumedPromotionCostIdr)}</dd></div>
        <div><dt>{owner ? "Perkiraan kontribusi" : "Kontribusi skenario"}</dt><dd>{money(option.computedScenario.scenarioContributionIdr)}</dd></div>
      </dl><p>{option.risks.join(" ")}</p>
    </article>)}
    <p>{owner ? "Jumlah unit dan biaya promosi adalah asumsi. Tidak ada yang disetujui atau diterbitkan otomatis." : "Semua volume dan biaya promosi bersifat hipotetis. Tidak ada approval atau publikasi otomatis."}</p>
  </section>;
}
/** Development workspace (/dev/discussion); owners use CampaignHub, which shares the same useDiscussion state. */
export function DiscussionWorkspace({ owner = false }: { owner?: boolean }) {
  const d = useDiscussion(owner);
  const { session, running, busy } = d;
  const Root = owner ? "div" : "main";
  return <Root className="discussion-workspace" lang="id"><div className="discussion-container">
    <header><Link href={owner ? "/dashboard" : "/dev/campaign-simulator"}>{owner ? "Kembali ke ringkasan" : "Campaign Lab · Simulator"}</Link><h1>Diskusi campaign</h1>
      <p className="discussion-mode">{owner ? "Strategi dari data preorder usaha Anda. Angka simulasi adalah asumsi. Menyetujui rencana belum mengaktifkan promosi untuk pembeli." : "Development: Auth Supabase dan penyimpanan PostgreSQL nyata. Context seed sintetis · Fake Gemini · KPI produksi belum terhubung."}</p>
      {owner && d.list.provider === "test-mock" && <p role="status">Provider mock khusus pengujian integrasi. Fakta preorder dan penyimpanan berasal dari server nyata.</p>}</header>
    {d.error && <p role="alert" className="discussion-error">{d.error}</p>}
    {d.notice && <p role="status">{d.notice}</p>}
    {!d.signedIn && owner ? <p>Sesi belum tersedia. <Link href="/login">Masuk kembali</Link></p> : !d.signedIn ? <form onSubmit={(event) => void d.login(event)} className="discussion-login"><h2>Masuk dengan Supabase lokal</h2>
      <label>Email<input id="discussion-email" name="email" type="email" autoComplete="username" required maxLength={254} /></label>
      <label>Password<input id="discussion-password" name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
      <button disabled={busy} type="submit">{busy ? "Memeriksa akun…" : "Masuk"}</button>
      <p>Akun sintetis disiapkan melalui setup lokal. Password tidak disimpan di browser.</p>
    </form> : <div className="discussion-layout"><aside aria-label="Navigasi diskusi">
      <h2>Preorder milik Anda</h2><label>Preorder<select id="discussion-preorder" value={d.preorderId} disabled={busy} onChange={(event) => d.selectPreorder(event.target.value)}>
        {d.list.preorders.map((preorder) => <option key={preorder.id} value={preorder.id}>{preorder.name} · {owner ? preorderStatus[preorder.status] ?? preorder.status : preorder.status}</option>)}
      </select></label>
      <button id="discussion-create" disabled={busy || !d.preorderId} onClick={() => void d.createSession()}>Diskusi baru</button>
      <h2>Buka kembali</h2><ul className="discussion-sessions">{d.list.sessions.filter((row) => row.preorder_id === d.preorderId).map((row) =>
        <li key={row.id}><button aria-current={session?.id === row.id ? "true" : undefined} disabled={busy} onClick={() => void d.openSession(row.id)}>
          {new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(row.updated_at))}{owner ? "" : ` · ${row.id.slice(0, 8)}`}</button></li>)}</ul>
      {owner ? <><h2>Kampanye tersimpan</h2>{d.list.campaigns.map(c => <p key={c.id}><Link href={`/dashboard/campaigns?sessionId=${c.sessionId}&campaignId=${c.id}`}>{c.name}</Link></p>)}{!d.list.preorders.length && <p>Belum ada preorder terbit. <Link href="/dashboard/preorders">Kelola preorder</Link></p>}</> : <button className="discussion-secondary" disabled={busy} onClick={() => void d.signOut()}>Keluar</button>}
    </aside><section aria-label="Percakapan" className="discussion-conversation">
      {!session ? <p>Pilih preorder lalu buat atau buka kembali diskusi.</p> : <>
        <div className="discussion-toolbar"><h2>Riwayat diskusi</h2><button className="discussion-secondary" disabled={busy} onClick={() => void d.reloadSession()}>Muat ulang</button></div>
        {!owner && <p className="discussion-meta">Sesi {session.id} · versi {session.version} · {session.status}</p>}
        {!owner && <><p data-discussion-memory>{d.historicalMemory.status==="cold_start"?"Cold-start: belum ada memory approved yang eligible; strategi memakai fakta preorder terbaru.":d.historicalMemory.status==="unavailable"?"Riwayat memory sedang tidak tersedia. Fakta preorder terbaru tetap digunakan.":d.historicalMemory.status==="no_match"?"Tidak ada memory yang cocok untuk konteks ini.":d.historicalMemory.status==="available"?"Strategi menerima sumber historis approved yang dapat ditelusuri.":"Riwayat memory belum diminta."} <Link href="/dev/memories">Tinjau Business Memory</Link></p>
        {d.historicalMemory.memories.map((m)=><p key={m.memoryId}><Link href={`/dev/memories?campaignId=${m.campaignId}`}>Sumber {m.memoryId.slice(0,8)} · v{m.sourceVersion}</Link>: {m.summary}</p>)}
        </>}{session.truncated && <p>Menampilkan pesan terbaru; history lengkap tetap tersimpan di database.</p>}
        <ol className="discussion-messages">{session.messages.map((item) => <li key={item.id} data-role={item.role}>
          <h3>{item.role === "user" ? "Anda" : owner ? "AI" : "Fake Gemini"} · pesan {item.sequence}</h3><p>{item.content}</p>
          {item.proposal && <Proposal proposal={item.proposal} owner={owner} />}
        </li>)}</ol>
        {session.generations.filter((row) => row.status === "failed" || row.status === "invalid_output").slice(0, 3).map((row) =>
          <p key={row.id} className="discussion-error">{owner ? `Jawaban AI gagal. ${ownerMessages[row.error_code ?? "INVALID_RESPONSE"] ?? OWNER_FALLBACK}`
            : `Generation gagal: ${row.error_code ?? "INVALID_RESPONSE"}. Tidak ada assistant sukses untuk request ini.`}</p>)}
        {running && <div role="status"><p>{owner ? "AI sedang menyusun jawaban. Bila terhenti, pemulihan bisa dilakukan setelah dua menit." : "Generation sedang berjalan atau menunggu pemulihan. Pemulihan baru diizinkan setelah dua menit."}</p>
          <button disabled={busy || !running.started_at} onClick={() => void d.recover()}>{owner ? "Pulihkan jawaban yang terputus" : "Pulihkan generation terputus"}</button></div>}
        {d.stale && <p role="status">{owner ? "Data preorder berubah. Tekan Perbarui data preorder sebelum mengirim pesan baru." : "Context berubah atau belum tersedia. Perbarui secara eksplisit sebelum request baru."}</p>}
        <button className="discussion-secondary" disabled={busy || !!running} onClick={() => void d.refreshContext()}>{owner ? "Perbarui data preorder" : "Perbarui context"}</button>
        <form className="discussion-compose" onSubmit={(event) => { event.preventDefault(); void d.send(); }}>
          {!owner && <label>Skenario Fake Gemini<select id="discussion-scenario" value={d.scenario} onChange={(event) => d.setScenario(ScenarioSchema.parse(event.target.value))}>
            <option value="normal">A · Pengingat harga normal</option><option value="discount">B · Diskon persentase</option>
            <option value="revision">C · Revisi multi-turn</option><option value="failure">D · Provider gagal</option><option value="invalid">E · Output tidak valid</option>
          </select></label>}
          <label>{owner ? "Batas biaya promosi (Rp)" : "Batas asumsi biaya promosi (Rp)"}<input id="discussion-budget" type="number" min="0" max="1000000000" step="1" value={d.budget} onChange={(event) => d.setBudget(event.target.value)} required /></label>
          <label className="discussion-check"><input type="checkbox" checked={d.allowDiscount} onChange={(event) => d.setAllowDiscount(event.target.checked)} />Izinkan alternatif diskon</label>
          <label>Pesan Anda<textarea id="discussion-message" rows={4} value={d.message} maxLength={4000} required onChange={(event) => d.setMessage(event.target.value)} /></label>
          <p>{owner ? "Tuliskan tujuan, batas anggaran, dan asumsi volume Anda. Volume simulasi bukan prediksi penjualan." : "Revisi deterministik: tulis “diskon 5% unit 8 biaya 20000”. Volume adalah asumsi, bukan prediksi."}</p>
          <div className="discussion-toolbar"><button id="discussion-send" disabled={busy || !!running || d.stale || session.status !== "active" || !d.message.trim()} type="submit">{busy ? "Memproses…" : "Kirim pesan"}</button>
            <button id="discussion-replay" className="discussion-secondary" disabled={busy || !d.hasLastRequest} type="button" onClick={() => void d.send(true)}>{owner ? "Kirim ulang pesan terakhir" : "Ulangi request terakhir"}</button></div>
        </form>
        <BlueprintPanel key={session.id} sessionId={session.id} owner={owner} proposalCount={session.messages.filter((item) => item.proposal).length} />
      </>}
    </section></div>}
  </div></Root>;
}
