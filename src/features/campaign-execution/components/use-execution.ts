"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ExecutionViewSchema, LifecycleCampaignSchema, type ExecutionView } from "../contracts";

const ListSchema = z.object({ campaigns: z.array(LifecycleCampaignSchema), synthetic: z.boolean() });
export type ExecutionCampaign = z.infer<typeof ListSchema>["campaigns"][number];
export const executionTime = (value: string) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export const executionMoney = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
export const taskLabels: Record<string, string> = { completed: "Selesai", overdue: "Terlambat", upcoming: "Akan datang" };
export const campaignStatusLabel: Record<string, string> = { draft: "Draf", published: "Terbit", closed: "Ditutup", completed: "Selesai", cancelled: "Dibatalkan" };
export const offerLabel: Record<string, string> = { none: "Belum ada penawaran", scheduled: "Terjadwal, belum berlaku", active: "Sedang berlaku untuk pembeli",
  expired: "Periode sudah lewat", closed: "Sudah ditutup", invalid: "Tidak valid", unavailable: "Belum bisa dibaca" };
export const executionChannelLabel: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", offline: "Offline" };
export const executionContentLabel: Record<string, string> = { headline: "Judul", caption: "Caption", cta: "Ajakan" };
export const executionErrors: Record<string, string> = {
  UNAUTHENTICATED: "Sesi login berakhir. Masuk kembali lalu buka kampanye ini lagi.",
  NOT_FOUND: "Kampanye tidak ditemukan untuk akun ini.", FORBIDDEN: "Akses ditolak.",
  INVALID_INPUT: "Isian atau konfirmasi tidak valid. Muat ulang lalu tinjau lagi.",
  VERSION_CONFLICT: "Kampanye berubah di tab lain. Muat ulang lalu coba lagi.",
  STALE_CONTEXT: "Data preorder berubah sejak rencana disetujui. Kampanye belum diterbitkan. Buat usulan dan rencana baru dengan data terkini.",
  BLUEPRINT_NOT_APPROVED: "Kampanye baru bisa diterbitkan setelah rencananya disetujui.",
  CAMPAIGN_CONFLICT: "Masih ada kampanye yang terbit pada preorder ini. Tutup kampanye tersebut dahulu.",
  CAMPAIGN_WINDOW_INVALID: "Kampanye hanya bisa diterbitkan di dalam periode kampanye dan sebelum preorder ditutup.",
  CONTEXT_UNAVAILABLE: "Data preorder belum bisa dibaca. Penerbitan diblokir sampai data bisa diperiksa.",
  INVALID_CAMPAIGN_STATE: "Aksi ini tidak sesuai status kampanye saat ini. Muat ulang untuk melihat status terbaru.",
  INVALID_CAMPAIGN_CONFIGURATION: "Pengaturan kampanye berbeda dari rencana yang disetujui. Penerbitan diblokir.",
  INVALID_EXECUTION_PLAN: "Tugas atau caption tersimpan berbeda dari rencana yang disetujui. Perubahan diblokir.",
  SYNTHETIC_PUBLISHING_DISABLED: "Mode publikasi sintetis belum diaktifkan pada server development.",
  DATABASE_BUSY: "Ada perubahan lain yang belum selesai. Muat ulang lalu ulangi aksi yang sama.",
  CAMPAIGN_NOT_PUBLISHABLE: "Kampanye belum bisa diterbitkan dengan kondisi terbaru. Muat ulang lalu coba lagi.",
  DISCOUNT_POLICY_BLOCKER: "Diskon membuat kontribusi tidak positif atau biaya belum diketahui. Penerbitan diblokir.",
  CLIPBOARD_UNAVAILABLE: "Browser belum mengizinkan salin otomatis. Pilih teks caption lalu salin secara manual.",
};
async function api(base: string, query = "", body?: unknown) {
  const response = await fetch(`${base}${query}`, { method: body ? "POST" : "GET", cache: "no-store",
    headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const raw: unknown = await response.json();
  if (!response.ok) { const parsed = z.object({ code: z.string() }).safeParse(raw); throw new Error(parsed.success ? parsed.data.code : "PERSISTENCE_UNAVAILABLE"); }
  return raw;
}

/** Execution state and commands. `campaignId` pins one campaign (owner hub); without it the URL's campaignId is used. */
export function useExecution(owner: boolean, campaignId?: string) {
  const call = useCallback((query = "", body?: unknown) => api(owner ? "/api/owner/campaigns" : "/api/dev/campaigns", query, body), [owner]);
  const [campaigns, setCampaigns] = useState<ExecutionCampaign[]>([]);
  const [view, setView] = useState<ExecutionView | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [publishConfirm, setPublishConfirm] = useState(false); const [closeConfirm, setCloseConfirm] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const lock = useRef(false);
  const failed = useCallback((value: unknown) => { const code = value instanceof Error ? value.message : "PERSISTENCE_UNAVAILABLE";
    setError(executionErrors[code] ?? "Hasil penyimpanan belum bisa dipastikan. Muat ulang untuk melihat status terakhir."); }, []);
  const load = useCallback(async (id: string) => {
    const next = ExecutionViewSchema.parse(await call(`?campaignId=${encodeURIComponent(id)}`)); setView(next); setPublishConfirm(false); setCloseConfirm(false);
    const url = new URL(location.href); url.searchParams.set("campaignId", id); history.replaceState(null, "", url);
  }, [call]);
  const list = useCallback(async () => { setCampaigns(ListSchema.parse(await call()).campaigns); }, [call]);
  useEffect(() => {
    let mounted = true;
    void call().then(async (raw) => { if (!mounted) return; setCampaigns(ListSchema.parse(raw).campaigns);
      const id = campaignId ?? new URL(location.href).searchParams.get("campaignId"); if (id) await load(id);
    }).catch((error: unknown) => { if (mounted) failed(error); });
    return () => { mounted = false; };
  }, [load, failed, call, campaignId]);
  /** `action` names the running command so its button can show progress while every other button stays locked. */
  async function run(work: () => Promise<void>, action = "other") {
    if (lock.current) return; lock.current = true; setBusy(true); setActiveAction(action); setError(""); setNotice("");
    try { await work(); } catch (error) { failed(error); } finally { lock.current = false; setBusy(false); setActiveAction(null); }
  }
  async function mutate(body: unknown, message: string) {
    const saved = ExecutionViewSchema.parse(await call("", body)); await load(saved.campaign.id); await list(); setNotice(saved.replayed ? "Aksi ini sudah tersimpan sebelumnya. Tidak ada perubahan ganda." : message);
  }
  const c = view?.campaign; const bp = view?.blueprint;
  const refresh = () => run(async () => { await list(); if (c) await load(c.id); }, "refresh");
  const select = (id: string) => run(() => load(id), `select:${id}`);
  const publish = () => run(async () => {
    if (!c || !bp) return; await mutate({ action: "publish", campaignId: c.id, blueprintId: bp.id, expectedBlueprintVersion: bp.version,
      expectedCampaignVersion: c.version, expectedContextHash: bp.context_hash, confirm: true },
      owner ? "Kampanye terbit. Diskon berlaku untuk pembeli selama periode kampanye." : "Campaign published dan baseline tersimpan atomik. Diskon berlaku di checkout selama periode campaign.");
  }, "publish");
  const close = () => run(async () => {
    if (!c) return; await mutate({ action: "close", campaignId: c.id, expectedCampaignVersion: c.version, confirm: true },
      owner ? "Kampanye ditutup. Riwayat dan checklist tetap tersimpan." : "Campaign closed. Riwayat dan checklist tetap tersimpan.");
  }, "close");
  const toggleTask = (task: ExecutionView["calendar"]["days"][number]["tasks"][number], completed: boolean) => run(async () => {
    if (!c) return; await mutate({ action: "task", campaignId: c.id, blueprintId: task.blueprint_id, taskId: task.id, expectedTaskVersion: task.version, completed },
      completed ? "Checklist selesai tersimpan." : "Checklist dibuka kembali.");
  }, `task:${task.id}`);
  const copy = (text: string, id = "") => run(async () => {
    try { await navigator.clipboard.writeText(text); setNotice("Caption disalin. Menyalin tidak menandakan konten sudah diposting."); }
    catch { throw new Error("CLIPBOARD_UNAVAILABLE"); }
  }, `copy:${id}`);
  return { campaigns, view, busy, activeAction, error, notice, publishConfirm, setPublishConfirm, closeConfirm, setCloseConfirm, refresh, select, publish, close, toggleTask, copy };
}
export type ExecutionState = ReturnType<typeof useExecution>;
