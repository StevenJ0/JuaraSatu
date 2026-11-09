"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { DiscussionViewSchema, type DiscussionView, type DevelopmentScenario, type SendDiscussion } from "../persistence-contracts";
import { CampaignContextV1Schema } from "@/features/ai-context/contracts";
import { acceptDiscussionResponse, type DiscussionSelection } from "./discussion-response";
import type { OwnerIntake } from "../contracts";
import { EMPTY_INTAKE, rememberedPreferences } from "./intake";

const ListSchema = z.object({ preorders: z.array(z.object({ id: z.uuid(), name: z.string(), status: z.string() })),
  sessions: z.array(z.object({ id: z.uuid(), preorder_id: z.uuid(), status: z.string(), updated_at: z.string() })),
  campaigns: z.array(z.object({ id: z.uuid(), name: z.string(), preorderId: z.uuid(), sessionId: z.uuid() })).default([]), provider: z.string().optional() });
export type DiscussionList = z.infer<typeof ListSchema>;
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
  OUTPUT_TRUNCATED: "Output provider terpotong karena batas token output. Tidak ada proposal yang disimpan.",
  INVALID_INPUT: "Input tidak valid atau terlalu panjang. Periksa pesan dan batas form.",
  PERSISTENCE_UNAVAILABLE: "Penyimpanan belum dapat dipastikan. Muat ulang, atau ulangi request yang sama untuk memeriksa hasil tersimpan.",
};
// Owner-facing wording: plain Indonesian, and a busy AI is told apart from an answer that failed the server checks.
const AI_REJECTED = "Jawaban AI tidak lolos pemeriksaan. Ubah sedikit permintaan Anda lalu kirim lagi.";
const AI_BUSY = "Layanan AI sedang sibuk. Coba lagi dalam beberapa saat.";
const AI_NOT_SET_UP = "Layanan AI belum diatur oleh pengelola. Coba lagi nanti.";
export const ownerMessages: Record<string, string> = {
  UNAUTHENTICATED: "Sesi berakhir. Masuk kembali melalui halaman login.", BUSINESS_REQUIRED: "Lengkapi profil usaha terlebih dahulu.",
  FORBIDDEN: "Akses ditolak untuk akun ini.", NOT_FOUND: "Diskusi tidak ditemukan atau bukan milik akun ini.",
  CONFIGURATION_ERROR: AI_NOT_SET_UP, AI_QUOTA_CONFIGURATION_REQUIRED: AI_NOT_SET_UP,
  AI_RATE_LIMIT_EXCEEDED: "Batas pemakaian AI hari ini sudah tercapai. Coba lagi besok.",
  CONTEXT_UNAVAILABLE: "Data preorder belum bisa dibaca. Pastikan preorder masih terbit dan produknya aktif, lalu muat ulang halaman.",
  STALE_CONTEXT: "Data preorder berubah sejak diskusi dibuka. Tekan Perbarui data preorder lalu kirim lagi.",
  VERSION_CONFLICT: "Diskusi berubah di tab lain. Muat ulang lalu coba lagi.",
  IDEMPOTENCY_CONFLICT: "Pesan ini sudah pernah dikirim dengan isi berbeda. Kirim sebagai pesan baru.",
  TURN_IN_PROGRESS: "AI masih menyusun jawaban pesan sebelumnya. Tunggu sebentar lalu muat ulang.",
  GENERATION_INTERRUPTED: "Jawaban AI terputus. Kirim pesan Anda lagi.",
  PROVIDER_TIMEOUT: "AI terlalu lama menjawab. Coba kirim lagi.", PROVIDER_UNAVAILABLE: AI_BUSY, UNKNOWN_PROVIDER_CODE: AI_BUSY,
  PROVIDER_RATE_LIMITED: "Layanan AI sedang ramai. Tunggu sebentar lalu coba lagi.", MODEL_UNAVAILABLE: "Model AI yang diatur tidak tersedia. Hubungi pengelola.",
  PROVIDER_REFUSED: "AI menolak permintaan ini. Ubah isi pesan lalu coba lagi.", INVALID_RESPONSE: AI_REJECTED, UNSAFE_TEXT: AI_REJECTED,
  OUTPUT_TRUNCATED: "Jawaban AI terpotong karena terlalu panjang. Kirim lagi dengan permintaan yang lebih singkat, misalnya minta satu atau dua usulan saja.",
  INVALID_INPUT: "Pesan tidak valid atau terlalu panjang. Periksa isian lalu coba lagi.",
  PERSISTENCE_UNAVAILABLE: "Penyimpanan belum bisa dipastikan. Muat ulang halaman untuk melihat hasil terakhir.",
  NO_FEASIBLE_OPTIONS: "Preorder belum dibuka atau slotnya habis. Pilih preorder lain.",
};
export const OWNER_FALLBACK = "Terjadi kendala. Muat ulang halaman lalu coba lagi.";
export const preorderStatus: Record<string, string> = { published: "terbit", draft: "draf", closed: "ditutup", completed: "selesai", cancelled: "dibatalkan" };

/** Discussion state and commands shared by the owner hub and the /dev workspace; behaviour is identical in both. */
export function useDiscussion(owner: boolean) {
  const call = useCallback((path = "", body?: unknown, method?: string) => api(owner ? "/api/owner/discussions" : "/api/dev/discussions", path, body, method), [owner]);
  const [signedIn, setSignedIn] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [list, setList] = useState<DiscussionList>({ preorders: [], sessions: [], campaigns: [] });
  const [preorderId, setPreorderId] = useState(""); const [session, setSession] = useState<DiscussionView | null>(null);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [historicalMemory,setHistoricalMemory]=useState<z.infer<typeof CampaignContextV1Schema>["history"]>({status:"not_requested",reason:null,memories:[]});
  const [scenario, setScenario] = useState<DevelopmentScenario>("normal"); const [message, setMessage] = useState("");
  const [budget, setBudget] = useState("50000"); const [allowDiscount, setAllowDiscount] = useState(true);
  const [hasLastRequest, setHasLastRequest] = useState(false);
  const [intake, setIntake] = useState<OwnerIntake>(EMPTY_INTAKE); const [intakeRemembered, setIntakeRemembered] = useState(false);
  const lock = useRef(false); const lastRequest = useRef<SendDiscussion | null>(null);
  const sessionsRef = useRef<DiscussionList["sessions"]>([]);
  const selection = useRef<DiscussionSelection>({ id: null, epoch: 0, version: 0 });
  const loadSession = useCallback(async (id: string, polling = false) => {
    if (!polling && selection.current.id !== id) selection.current = { id, epoch: selection.current.epoch + 1, version: 0 };
    const request = { id, epoch: selection.current.epoch };
    const data = ViewResponseSchema.parse(await call(`?sessionId=${encodeURIComponent(id)}`));
    // Owner answers are asked once per preorder: a new session reuses the answers sent in the latest earlier session.
    let remembered = owner && !polling ? rememberedPreferences(data.session) : null;
    const previous = owner && !polling && !remembered ? sessionsRef.current.filter((row) => row.preorder_id === data.session.preorderId && row.id !== id)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] : undefined;
    if (previous) remembered = await call(`?sessionId=${encodeURIComponent(previous.id)}`)
      .then((raw) => rememberedPreferences(ViewResponseSchema.parse(raw).session)).catch(() => null);
    if (!acceptDiscussionResponse(selection.current, request, data.session.version)) return;
    selection.current.version = data.session.version;
    if (owner && !polling) {
      setIntake(remembered?.intake ?? EMPTY_INTAKE); setIntakeRemembered(remembered !== null);
      if (remembered) { if (remembered.budgetCapIdr !== null) setBudget(String(remembered.budgetCapIdr)); setAllowDiscount(remembered.allowDiscount); }
    }
    setSession(data.session);
    setCurrentHash(data.currentHash);setHistoricalMemory(data.historicalMemory); setPreorderId(data.session.preorderId);
    const url = new URL(window.location.href); if (url.searchParams.get("sessionId") !== id) url.searchParams.delete("campaignId");
    url.searchParams.set("sessionId", id); window.history.replaceState(null, "", url);
  }, [call, owner]);
  const loadList = useCallback(async () => {
    const data = ListSchema.parse(await call()); setList(data); sessionsRef.current = data.sessions; setSignedIn(true);
    setPreorderId((old) => old || data.preorders[0]?.id || "");
  }, [call]);
  const handleError = useCallback((failure: unknown) => {
    const code = failure instanceof ApiError ? failure.code : "PERSISTENCE_UNAVAILABLE";
    setError(owner ? ownerMessages[code] ?? OWNER_FALLBACK : messages[code] ?? "Proses gagal. Muat ulang sebelum mencoba lagi.");
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
      const data = ListSchema.parse(raw); setList(data); sessionsRef.current = data.sessions; setSignedIn(true); setPreorderId(data.preorders[0]?.id ?? "");
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
  /** `text` overrides the typed message, e.g. the readable summary of the owner's first answers. */
  async function send(replay = false, text?: string) {
    if (!session) return;
    await run(async () => {
      // Owners get both caption channels and the AI picks per audience; /dev keeps its deterministic WhatsApp-only fixture.
      const preferences: SendDiscussion["preferences"] = owner ? { budgetCapIdr: Number(budget), allowDiscount, channels: ["whatsapp", "instagram"], intake }
        : { budgetCapIdr: Number(budget), allowDiscount, channels: ["whatsapp"] };
      const command: SendDiscussion | null = replay ? lastRequest.current : { sessionId: session.id, requestKey: crypto.randomUUID(), expectedVersion: session.version,
        expectedContextHash: session.contextHash, message: text ?? message, preferences, scenario };
      if (!command) return;
      lastRequest.current = command;
      setHasLastRequest(true);
      try {
        const result = z.object({ status: z.enum(["completed", "running"]), replayed: z.boolean().optional() }).parse(await call("", { action: "send", ...command }));
        setNotice(owner ? result.status === "running" ? "Pesan yang sama masih diproses." : result.replayed ? "Hasil tersimpan ditampilkan ulang tanpa memanggil AI lagi." : "Pesan dan usulan AI tersimpan."
          : result.status === "running" ? "Request yang sama masih berjalan." : result.replayed ? "Hasil tersimpan diputar ulang; provider tidak dipanggil lagi." : "Pesan dan proposal tersimpan di PostgreSQL.");
        if (result.status === "completed") setMessage("");
      } finally { await loadSession(session.id); }
    });
  }
  function selectPreorder(id: string) {
    setPreorderId(id); setSession(null); setCurrentHash(null); setIntake(EMPTY_INTAKE); setIntakeRemembered(false);
    selection.current = { id: null, epoch: selection.current.epoch + 1, version: 0 };
    lastRequest.current = null; setHasLastRequest(false);
    const url = new URL(location.href); url.searchParams.delete("sessionId"); url.searchParams.delete("campaignId"); history.replaceState(null, "", url);
  }
  const createSession = () => run(async () => {
    const data = z.object({ session: DiscussionViewSchema }).parse(await call("", { action: "create", preorderId }));
    lastRequest.current = null; setHasLastRequest(false); await loadSession(data.session.id); await loadList();
  });
  const openSession = (id: string) => run(async () => { lastRequest.current = null; setHasLastRequest(false); await loadSession(id); });
  const reloadSession = () => run(async () => { if (session) await loadSession(session.id); });
  const refreshContext = () => run(async () => {
    if (!session) return; await call("", { action: "refresh", sessionId: session.id, expectedVersion: session.version }); await loadSession(session.id);
  });
  const recover = () => run(async () => {
    if (!session || !running) return;
    await call("", { action: "recover", sessionId: session.id, generationId: running.id, expectedVersion: session.version }); await loadSession(session.id);
  });
  const signOut = () => run(async () => { await call("/auth", undefined, "DELETE"); setSignedIn(false); setSession(null); });
  /** Background refresh (no busy lock) so the saved-campaign list follows changes made in the plan or publish tabs. */
  const refreshList = useCallback(() => { void loadList().catch(handleError); }, [loadList, handleError]);
  const stale = !!session && (!currentHash || session.contextHash !== currentHash);
  return { signedIn, busy, error, notice, list, preorderId, session, historicalMemory, scenario, setScenario, message, setMessage,
    budget, setBudget, allowDiscount, setAllowDiscount, hasLastRequest, running, stale, intake, setIntake, intakeRemembered,
    login, send, selectPreorder, createSession, openSession, reloadSession, refreshContext, recover, signOut, refreshList };
}
export type DiscussionState = ReturnType<typeof useDiscussion>;
