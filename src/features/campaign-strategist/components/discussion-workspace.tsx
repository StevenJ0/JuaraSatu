"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { DiscussionViewSchema, ScenarioSchema, type DiscussionView, type DevelopmentScenario, type SendDiscussion } from "../persistence-contracts";
import type { StrategyProposal } from "../contracts";
import { BlueprintPanel } from "@/features/campaign-blueprint/components/blueprint-panel";
import { CampaignContextV1Schema } from "@/features/ai-context/contracts";
import "./discussion.css";
import { acceptDiscussionResponse, type DiscussionSelection } from "./discussion-response";

const ListSchema = z.object({ preorders: z.array(z.object({ id: z.uuid(), name: z.string(), status: z.string() })),
  sessions: z.array(z.object({ id: z.uuid(), preorder_id: z.uuid(), status: z.string(), updated_at: z.string() })),
  campaigns: z.array(z.object({ id: z.uuid(), name: z.string(), preorderId: z.uuid(), sessionId: z.uuid() })).default([]), provider: z.string().optional() });
const ViewResponseSchema = z.object({ session: DiscussionViewSchema, currentHash: z.string().nullable(),historicalMemory:CampaignContextV1Schema.shape.history });
class ApiError extends Error { constructor(readonly code: string) { super(code); } }
async function api(base: string, path = "", body?: unknown, method?: string): Promise<unknown> {
  let response: Response;
  try { response = await fetch(`${base}${path}`, { method: method ?? (body ? "POST" : "GET"), credentials: "same-origin",
    cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new ApiError("PERSISTENCE_UNAVAILABLE"); }
  const data: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ code: z.string() }).safeParse(data);
    throw new ApiError(parsed.success ? parsed.data.code : "PERSISTENCE_UNAVAILABLE");
  }
  return data;
}
const messages: Record<string, string> = {
  UNAUTHENTICATED: "Sesi login berakhir atau kredensial salah. Masuk kembali dengan akun Supabase lokal.",
  FORBIDDEN: "Akses ditolak untuk akun ini.", NOT_FOUND: "Diskusi tidak ditemukan atau bukan milik akun ini.",
  CONFIGURATION_ERROR: "Aktifkan CAMPAIGN_DISCUSSION_PROVIDER=fake dan CAMPAIGN_DISCUSSION_CONTEXT=seeded pada server development.",
  CONTEXT_UNAVAILABLE: "Context seed tidak tersedia. Gunakan preorder demo tanpa order, hold, atau campaign aktif; producer produksi belum terhubung.",
  STALE_CONTEXT: "Fakta context berubah. Muat ulang lalu perbarui context sebelum mengirim request baru.",
  VERSION_CONFLICT: "Versi diskusi berubah. Muat ulang diskusi sebelum mencoba request baru.",
  IDEMPOTENCY_CONFLICT: "Request ID sudah dipakai dengan isi berbeda. Kirim sebagai request baru.",
  TURN_IN_PROGRESS: "Generation masih berjalan. Muat ulang; pemulihan tersedia setelah dua menit.",
  PROVIDER_TIMEOUT: "Fake provider gagal sesuai skenario pengujian. Kegagalan tersimpan; pilih skenario lain lalu kirim request baru.",
  INVALID_RESPONSE: "Output provider ditolak oleh validasi. Tidak ada proposal sukses tambahan yang disimpan.",
  INVALID_INPUT: "Input tidak valid atau terlalu panjang. Periksa pesan dan batas form.",
  PERSISTENCE_UNAVAILABLE: "Penyimpanan belum dapat dipastikan. Muat ulang, atau ulangi request yang sama untuk memeriksa hasil tersimpan.",
};
const ownerMessages: Record<string, string> = { CONFIGURATION_ERROR: "Konfigurasi Gemini belum tersedia. Hubungi pengelola untuk mengaktifkan layanan AI.", CONTEXT_UNAVAILABLE: "Fakta preorder belum tersedia atau ada campaign published yang menunggu integrasi penawaran. Muat ulang preorder.", UNAUTHENTICATED: "Sesi berakhir. Masuk kembali melalui halaman login.", PROVIDER_TIMEOUT: "Layanan AI melewati batas waktu. Coba kembali.", AI_QUOTA_CONFIGURATION_REQUIRED: "Layanan AI belum dikonfigurasi oleh pengelola.", NO_FEASIBLE_OPTIONS: "Preorder belum terbuka atau slotnya habis. Pilih preorder lain." };
const money = (value: number | null) => value === null ? "Belum diketahui" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
function Proposal({ proposal }: { proposal: StrategyProposal }) {
  return <section className="discussion-proposal" aria-label="Alternatif strategi tersimpan">
    <p>Snapshot tersimpan · versi proposal {proposal.proposalVersion} · perlu review pemilik</p>
    {proposal.options.length === 0 ? <p>Tidak ada alternatif yang lolos validasi.</p> : proposal.options.map((option) => <article key={option.proposalKey}>
      <h3>{option.title}</h3><p>{option.hypothesis}</p>
      <dl className="discussion-numbers">
        <div><dt>Diskon hipotetis</dt><dd>{option.offer.discountBps / 100}%</dd></div>
        <div><dt>Harga/unit hipotetis</dt><dd>{money(option.computedScenario.hypotheticalFinalUnitPriceIdr)}</dd></div>
        <div><dt>Asumsi unit tambahan</dt><dd>{option.assumedAdditionalUnits}</dd></div>
        <div><dt>Asumsi biaya promosi</dt><dd>{money(option.assumedPromotionCostIdr)}</dd></div>
        <div><dt>Kontribusi skenario</dt><dd>{money(option.computedScenario.scenarioContributionIdr)}</dd></div>
      </dl><p>{option.risks.join(" ")}</p>
    </article>)}
    <p>Semua volume dan biaya promosi bersifat hipotetis. Tidak ada approval atau publikasi otomatis.</p>
  </section>;
}
export function DiscussionWorkspace({ owner = false }: { owner?: boolean }) {
  const call = useCallback((path = "", body?: unknown, method?: string) => api(owner ? "/api/owner/discussions" : "/api/dev/discussions", path, body, method), [owner]);
  const [signedIn, setSignedIn] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [list, setList] = useState<z.infer<typeof ListSchema>>({ preorders: [], sessions: [], campaigns: [] });
  const [preorderId, setPreorderId] = useState(""); const [session, setSession] = useState<DiscussionView | null>(null);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [historicalMemory,setHistoricalMemory]=useState<z.infer<typeof CampaignContextV1Schema>["history"]>({status:"not_requested",reason:null,memories:[]});
  const [scenario, setScenario] = useState<DevelopmentScenario>("normal"); const [message, setMessage] = useState("");
  const [budget, setBudget] = useState("50000"); const [allowDiscount, setAllowDiscount] = useState(true);
  const [hasLastRequest, setHasLastRequest] = useState(false);
  const lock = useRef(false); const lastRequest = useRef<SendDiscussion | null>(null);
  const selection = useRef<DiscussionSelection>({ id: null, epoch: 0, version: 0 });
  const loadSession = useCallback(async (id: string, polling = false) => {
    if (!polling && selection.current.id !== id) selection.current = { id, epoch: selection.current.epoch + 1, version: 0 };
    const request = { id, epoch: selection.current.epoch };
    const data = ViewResponseSchema.parse(await call(`?sessionId=${encodeURIComponent(id)}`));
    if (!acceptDiscussionResponse(selection.current, request, data.session.version)) return;
    selection.current.version = data.session.version;
    setSession(data.session);
    setCurrentHash(data.currentHash);setHistoricalMemory(data.historicalMemory); setPreorderId(data.session.preorderId);
    const url = new URL(window.location.href); if (url.searchParams.get("sessionId") !== id) url.searchParams.delete("campaignId");
    url.searchParams.set("sessionId", id); window.history.replaceState(null, "", url);
  }, [call]);
  const loadList = useCallback(async () => {
    const data = ListSchema.parse(await call()); setList(data); setSignedIn(true);
    setPreorderId((old) => old || data.preorders[0]?.id || "");
  }, [call]);
  const handleError = useCallback((failure: unknown) => {
    const code = failure instanceof ApiError ? failure.code : "PERSISTENCE_UNAVAILABLE";
    setError((owner ? ownerMessages[code] : undefined) ?? messages[code] ?? "Proses gagal. Muat ulang sebelum mencoba lagi.");
    if (code === "UNAUTHENTICATED") { setSignedIn(false); setSession(null); }
  }, [owner]);
  const run = useCallback(async (work: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (failure) { handleError(failure); }
    finally { lock.current = false; setBusy(false); }
  }, [handleError]);
  useEffect(() => {
    let active = true;
    void call().then(async (raw) => {
      if (!active) return;
      const data = ListSchema.parse(raw); setList(data); setSignedIn(true); setPreorderId(data.preorders[0]?.id ?? "");
      const id = new URL(window.location.href).searchParams.get("sessionId"); if (id) await loadSession(id);
    }).catch((failure: unknown) => { if (active) handleError(failure); });
    return () => { active = false; };
  }, [loadSession, handleError, call]);
  const running = session?.generations.find((generation) => generation.status === "running");
  useEffect(() => {
    if (!running || !session) return;
    const timer = setInterval(() => { void loadSession(session.id, true).catch(handleError); }, 2000);
    return () => clearInterval(timer);
  }, [running, session, loadSession, handleError]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await run(async () => { await call("/auth", { email: form.get("email"), password: form.get("password") }); await loadList();
      const id = new URL(window.location.href).searchParams.get("sessionId"); if (id) await loadSession(id); });
  }
  async function send(replay = false) {
    if (!session) return;
    await run(async () => {
      const command: SendDiscussion | null = replay ? lastRequest.current : { sessionId: session.id, requestKey: crypto.randomUUID(), expectedVersion: session.version,
        expectedContextHash: session.contextHash, message, preferences: { budgetCapIdr: Number(budget), allowDiscount, channels: ["whatsapp"] }, scenario };
      if (!command) return;
      lastRequest.current = command;
      setHasLastRequest(true);
      try {
        const result = z.object({ status: z.enum(["completed", "running"]), replayed: z.boolean().optional() }).parse(await call("", { action: "send", ...command }));
        setNotice(result.status === "running" ? "Request yang sama masih berjalan." : result.replayed ? "Hasil tersimpan diputar ulang; provider tidak dipanggil lagi." : "Pesan dan proposal tersimpan di PostgreSQL.");
        if (result.status === "completed") setMessage("");
      } finally { await loadSession(session.id); }
    });
  }
  const stale = !!session && (!currentHash || session.contextHash !== currentHash);
  const Root = owner ? "div" : "main";
  return <Root className="discussion-workspace" lang="id"><div className="discussion-container">
    <header><Link href={owner ? "/dashboard" : "/dev/campaign-simulator"}>{owner ? "Kembali ke ringkasan" : "Campaign Lab · Simulator"}</Link><h1>Diskusi campaign</h1>
      <p className="discussion-mode">{owner ? "Strategi berdasarkan fakta preorder usaha Anda. Angka simulasi adalah asumsi; approval rencana belum mengaktifkan promosi untuk pembeli." : "Development: Auth Supabase dan penyimpanan PostgreSQL nyata. Context seed sintetis · Fake Gemini · KPI produksi belum terhubung."}</p>
      {owner && list.provider === "test-mock" && <p role="status">Provider mock khusus pengujian integrasi. Fakta preorder dan penyimpanan berasal dari server nyata.</p>}</header>
    {error && <p role="alert" className="discussion-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!signedIn && owner ? <p>Sesi belum tersedia. <Link href="/login">Masuk kembali</Link></p> : !signedIn ? <form onSubmit={login} className="discussion-login"><h2>Masuk dengan Supabase lokal</h2>
      <label>Email<input id="discussion-email" name="email" type="email" autoComplete="username" required maxLength={254} /></label>
      <label>Password<input id="discussion-password" name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
      <button disabled={busy} type="submit">{busy ? "Memeriksa akun…" : "Masuk"}</button>
      <p>Akun sintetis disiapkan melalui setup lokal. Password tidak disimpan di browser.</p>
    </form> : <div className="discussion-layout"><aside aria-label="Navigasi diskusi">
      <h2>Preorder milik Anda</h2><label>Preorder<select id="discussion-preorder" value={preorderId} disabled={busy} onChange={(event) => {
        setPreorderId(event.target.value); setSession(null); setCurrentHash(null);
        selection.current = { id: null, epoch: selection.current.epoch + 1, version: 0 };
        lastRequest.current = null; setHasLastRequest(false);
        const url = new URL(location.href); url.searchParams.delete("sessionId"); url.searchParams.delete("campaignId"); history.replaceState(null, "", url);
      }}>
        {list.preorders.map((preorder) => <option key={preorder.id} value={preorder.id}>{preorder.name} · {preorder.status}</option>)}
      </select></label>
      <button id="discussion-create" disabled={busy || !preorderId} onClick={() => void run(async () => {
        const data = z.object({ session: DiscussionViewSchema }).parse(await call("", { action: "create", preorderId }));
        lastRequest.current = null; setHasLastRequest(false); await loadSession(data.session.id); await loadList();
      })}>Diskusi baru</button>
      <h2>Buka kembali</h2><ul className="discussion-sessions">{list.sessions.filter((row) => row.preorder_id === preorderId).map((row) =>
        <li key={row.id}><button aria-current={session?.id === row.id ? "true" : undefined} disabled={busy} onClick={() => void run(async () => {
          lastRequest.current = null; setHasLastRequest(false); await loadSession(row.id);
        })}>{new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(row.updated_at))} · {row.id.slice(0, 8)}</button></li>)}</ul>
      {owner ? <><h2>Campaign tersimpan</h2>{list.campaigns.map(c => <p key={c.id}><Link href={`/dashboard/campaigns?sessionId=${c.sessionId}&campaignId=${c.id}`}>{c.name}</Link></p>)}{!list.preorders.length && <p>Belum ada preorder terbit. <Link href="/dashboard/preorders">Kelola preorder</Link></p>}</> : <button className="discussion-secondary" disabled={busy} onClick={() => void run(async () => { await call("/auth", undefined, "DELETE"); setSignedIn(false); setSession(null); })}>Keluar</button>}
    </aside><section aria-label="Percakapan" className="discussion-conversation">
      {!session ? <p>Pilih preorder lalu buat atau buka kembali diskusi.</p> : <>
        <div className="discussion-toolbar"><h2>Riwayat diskusi</h2><button className="discussion-secondary" disabled={busy} onClick={() => void run(() => loadSession(session.id))}>Muat ulang</button></div>
        <p className="discussion-meta">Sesi {session.id} · versi {session.version} · {session.status}</p>
        {!owner && <><p data-discussion-memory>{historicalMemory.status==="cold_start"?"Cold-start: belum ada memory approved yang eligible; strategi memakai fakta preorder terbaru.":historicalMemory.status==="unavailable"?"Riwayat memory sedang tidak tersedia. Fakta preorder terbaru tetap digunakan.":historicalMemory.status==="no_match"?"Tidak ada memory yang cocok untuk konteks ini.":historicalMemory.status==="available"?"Strategi menerima sumber historis approved yang dapat ditelusuri.":"Riwayat memory belum diminta."} <Link href="/dev/memories">Tinjau Business Memory</Link></p>
        {historicalMemory.memories.map((m)=><p key={m.memoryId}><Link href={`/dev/memories?campaignId=${m.campaignId}`}>Sumber {m.memoryId.slice(0,8)} · v{m.sourceVersion}</Link>: {m.summary}</p>)}
        </>}{session.truncated && <p>Menampilkan pesan terbaru; history lengkap tetap tersimpan di database.</p>}
        <ol className="discussion-messages">{session.messages.map((item) => <li key={item.id} data-role={item.role}>
          <h3>{item.role === "user" ? "Anda" : owner ? "AI · hasil tersimpan" : "Fake Gemini"} · pesan {item.sequence}</h3><p>{item.content}</p>
          {item.proposal && <Proposal proposal={item.proposal} />}
        </li>)}</ol>
        {session.generations.filter((row) => row.status === "failed" || row.status === "invalid_output").slice(0, 3).map((row) =>
          <p key={row.id} className="discussion-error">Generation gagal: {row.error_code ?? "INVALID_RESPONSE"}. Tidak ada assistant sukses untuk request ini.</p>)}
        {running && <div role="status"><p>Generation sedang berjalan atau menunggu pemulihan. Pemulihan baru diizinkan setelah dua menit.</p>
          <button disabled={busy || !running.started_at} onClick={() => void run(async () => {
            await call("", { action: "recover", sessionId: session.id, generationId: running.id, expectedVersion: session.version }); await loadSession(session.id);
          })}>Pulihkan generation terputus</button></div>}
        {stale && <p role="status">Context berubah atau belum tersedia. Perbarui secara eksplisit sebelum request baru.</p>}
        <button className="discussion-secondary" disabled={busy || !!running} onClick={() => void run(async () => {
          await call("", { action: "refresh", sessionId: session.id, expectedVersion: session.version }); await loadSession(session.id);
        })}>Perbarui context</button>
        <form className="discussion-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          {!owner && <label>Skenario Fake Gemini<select id="discussion-scenario" value={scenario} onChange={(event) => setScenario(ScenarioSchema.parse(event.target.value))}>
            <option value="normal">A · Pengingat harga normal</option><option value="discount">B · Diskon persentase</option>
            <option value="revision">C · Revisi multi-turn</option><option value="failure">D · Provider gagal</option><option value="invalid">E · Output tidak valid</option>
          </select></label>}
          <label>Batas asumsi biaya promosi (Rp)<input id="discussion-budget" type="number" min="0" max="1000000000" step="1" value={budget} onChange={(event) => setBudget(event.target.value)} required /></label>
          <label className="discussion-check"><input type="checkbox" checked={allowDiscount} onChange={(event) => setAllowDiscount(event.target.checked)} />Izinkan alternatif diskon</label>
          <label>Pesan Anda<textarea id="discussion-message" rows={4} value={message} maxLength={4000} required onChange={(event) => setMessage(event.target.value)} /></label>
          <p>{owner ? "Tuliskan tujuan, batas anggaran, dan asumsi volume Anda. Volume simulasi bukan prediksi penjualan." : "Revisi deterministik: tulis “diskon 5% unit 8 biaya 20000”. Volume adalah asumsi, bukan prediksi."}</p>
          <div className="discussion-toolbar"><button id="discussion-send" disabled={busy || !!running || stale || session.status !== "active" || !message.trim()} type="submit">{busy ? "Memproses…" : "Kirim pesan"}</button>
            <button id="discussion-replay" className="discussion-secondary" disabled={busy || !hasLastRequest} type="button" onClick={() => void send(true)}>Ulangi request terakhir</button></div>
        </form>
        <BlueprintPanel key={session.id} sessionId={session.id} owner={owner} />
      </>}
    </section></div>}
  </div></Root>;
}
