"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { BlueprintRowSchema, CampaignRowSchema, BlueprintPlanSchema, BlueprintEditsSchema, SelectionSchema, type BlueprintEdits, type CampaignBlueprint } from "../contracts";

const ViewSchema = z.object({ campaign: CampaignRowSchema, active: BlueprintRowSchema.nullable(), history: z.array(BlueprintRowSchema), currentHash: z.string().nullable().optional(),
  materialized: z.object({ tasks: z.array(z.object({ id: z.uuid() })), contents: z.array(z.object({ id: z.uuid() })) }), replayed: z.boolean().optional() });
const ChoicesSchema = z.object({ proposals: z.array(z.object({ selection: SelectionSchema, title: z.string(), eligible: z.boolean() })), currentHash: z.string().nullable() });
export type BlueprintView = z.infer<typeof ViewSchema>;
export type BlueprintChoice = z.infer<typeof ChoicesSchema>["proposals"][number];
export const money = (value: number | null) => value === null ? "Belum diketahui" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
export const time = (value: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value));
const errorMessages: Record<string, string> = {
  STALE_CONTEXT: "Data preorder berubah sejak usulan dibuat. Kirim pesan baru di diskusi untuk mendapat usulan terkini.",
  VERSION_CONFLICT: "Rencana berubah di tab lain. Muat ulang lalu coba lagi.",
  IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dipakai dengan isi berbeda. Muat ulang lalu coba lagi.",
  INVALID_BLUEPRINT: "Rencana ditolak. Periksa diskon, tanggal, tugas, dan caption.",
  INVALID_CONTENT: "Teks rencana tidak boleh berisi janji hasil, klaim sebab-akibat, atau penawaran gratis, voucher, dan ongkir.",
  INVALID_SCHEDULE: "Jadwal tugas harus berada dalam periode preorder dan sebelum kampanye berakhir.",
  INVALID_PROPOSAL: "Usulan sumber tidak valid atau belum tersimpan.", INVALID_PROVENANCE: "Sumber rencana tidak cocok. Perubahan dibatalkan.",
  FINANCIAL_OR_CAPACITY_BLOCKER: "Angka ini membuat kontribusi tidak positif atau melebihi kapasitas. Ubah diskon, anggaran, atau jumlah unit.",
  CONTEXT_UNAVAILABLE: "Data preorder belum bisa dibaca. Pastikan preorder masih terbuka, lalu muat ulang.",
  SYNTHETIC_APPROVAL_DISABLED: "Aktifkan CAMPAIGN_BLUEPRINT_APPROVAL=synthetic pada server lokal untuk approval demo.",
  CONFIGURATION_ERROR: "Layanan AI belum diatur oleh pengelola.",
  PROVIDER_UNAVAILABLE: "Layanan AI sedang sibuk. Coba lagi dalam beberapa saat. Versi tersimpan sebelumnya tetap ada.",
  PROVIDER_RATE_LIMITED: "Layanan AI sedang ramai. Tunggu sebentar lalu coba lagi.",
  PROVIDER_TIMEOUT: "AI terlalu lama menyusun rencana. Coba lagi.",
  INVALID_RESPONSE: "Jawaban AI tidak lolos pemeriksaan. Coba lagi.",
  OUTPUT_TRUNCATED: "Rencana dari AI terpotong karena terlalu panjang. Coba lagi dengan catatan revisi yang lebih singkat. Versi tersimpan sebelumnya tetap ada.",
  MODEL_UNAVAILABLE: "Model AI yang diatur tidak tersedia. Hubungi pengelola.",
  AI_RATE_LIMIT_EXCEEDED: "Batas pemakaian AI hari ini sudah tercapai. Coba lagi besok.",
  CAMPAIGN_EXISTS: "Kampanye untuk preorder ini sudah ada. Buka kampanye tersimpan dari daftar diskusi.",
  CAMPAIGN_TITLE_READ_ONLY: "Nama kampanye tidak bisa diubah setelah rencana dibuat.",
  INVALID_DISCOUNT: "Isi diskon 0 sampai 99,99 persen, misalnya 10 atau 12,5.",
  NOT_FOUND: "Kampanye atau usulan tidak ditemukan untuk akun ini.", FORBIDDEN: "Akses ditolak.",
  PERSISTENCE_UNAVAILABLE: "Penyimpanan belum bisa dipastikan. Muat ulang untuk melihat hasil terakhir.",
};
export const channelLabel: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram" };
export const contentLabel: Record<string, string> = { headline: "Judul", caption: "Caption", cta: "Ajakan" };
export const costLabel: Record<string, string> = { unknown: "belum diketahui", estimated: "perkiraan", verified: "terverifikasi" };
export const approvalLabel: Record<string, string> = { proposed: "Menunggu persetujuan", approved: "Disetujui", discarded: "Tidak dipakai" };
export const campaignLabel: Record<string, string> = { draft: "draf", published: "terbit", closed: "ditutup", completed: "selesai", cancelled: "dibatalkan" };
export const channels = (values: string[]) => values.map((value) => channelLabel[value] ?? value).join(", ");
/** Owner types a percentage ("10" or "12,5"); the domain keeps integer basis points (D-18). */
function percentToBps(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}
const bpsToPercent = (bps: number) => String(bps / 100).replace(".", ",");
/** The server answered with an error code (as opposed to a lost or unreadable response). */
export class BlueprintApiError extends Error {}
async function api(base: string, query = "", body?: unknown) {
  const response = await fetch(`${base}${query}`, { method: body ? "POST" : "GET", cache: "no-store",
    headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value: unknown = await response.json();
  if (!response.ok) { const parsed = z.object({ code: z.string() }).safeParse(value); throw new BlueprintApiError(parsed.success ? parsed.data.code : "PERSISTENCE_UNAVAILABLE"); }
  return value;
}
/** Answers that may hide a result the server still holds or is still producing. */
const UNCONFIRMED_CODES = new Set(["PERSISTENCE_UNAVAILABLE", "GENERATION_IN_PROGRESS"]);
/**
 * The server replays the stored outcome of a request id, failures included. After a definite error a retry must use a
 * new id, or it only replays that error. A lost response or an unconfirmed save keeps the id so the retry can replay
 * a plan that may already be saved instead of generating a duplicate.
 */
export function keepsRequestId(error: unknown): boolean {
  return !(error instanceof BlueprintApiError) || UNCONFIRMED_CODES.has(error.message);
}
function editable(body: CampaignBlueprint): BlueprintEdits {
  return { title: body.campaignTitle, marketingApproach: body.marketingApproach, discountBps: body.offer.discountBps,
    budgetCapIdr: body.budgetCapIdr, targetAdditionalUnits: body.targetAdditionalUnits, startsAt: body.executionWindow.startsAt,
    endsAt: body.executionWindow.endsAt, channels: body.channels, notes: "", plan: BlueprintPlanSchema.strip().parse(body) };
}

/**
 * Blueprint state and commands shared by the owner hub and the /dev panel.
 * `proposalCount` changes when the discussion saves a new answer, so new choices appear without a manual reload.
 */
export function useBlueprint({ sessionId, owner, proposalCount }: { sessionId: string; owner: boolean; proposalCount: number }) {
  const call = useCallback((query = "", body?: unknown) => api(owner ? "/api/owner/blueprints" : "/api/dev/blueprints", query, body), [owner]);
  const [choices, setChoices] = useState<z.infer<typeof ChoicesSchema>>({ proposals: [], currentHash: null });
  const [view, setView] = useState<BlueprintView | null>(null); const [edits, setEdits] = useState<BlueprintEdits | null>(null);
  const [discountText, setDiscountText] = useState("");
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false); const [scenario, setScenario] = useState<"valid" | "failure" | "invalid">("valid");
  const locked = useRef(false); const pending = useRef<{ signature: string; payload: unknown } | null>(null);
  const loadView = useCallback(async (id: string) => {
    const loaded = ViewSchema.parse(await call(`?campaignId=${encodeURIComponent(id)}`));
    if (loaded.active?.blueprint_json.source.sessionId !== sessionId) throw new Error("INVALID_PROVENANCE");
    setView(loaded); setEdits(loaded.active ? editable(loaded.active.blueprint_json) : null); setConfirm(false);
    setDiscountText(loaded.active ? bpsToPercent(loaded.active.blueprint_json.offer.discountBps) : "");
    const url = new URL(window.location.href); url.searchParams.set("campaignId", id); window.history.replaceState(null, "", url);
  }, [sessionId, call]);
  const failure = useCallback((value: unknown) => { const code = value instanceof Error ? value.message : "PERSISTENCE_UNAVAILABLE";
    setError(errorMessages[code] ?? "Proses belum dapat dipastikan. Muat ulang untuk melihat hasil terakhir."); }, []);
  useEffect(() => {
    let active = true;
    void call(`?sessionId=${encodeURIComponent(sessionId)}`).then(async (raw) => {
      if (!active) return; setChoices(ChoicesSchema.parse(raw));
      const id = new URL(window.location.href).searchParams.get("campaignId"); if (id) await loadView(id);
    }).catch((error: unknown) => { if (active) failure(error); });
    return () => { active = false; };
  }, [sessionId, loadView, failure, call, proposalCount]);
  async function run(work: () => Promise<void>) {
    if (locked.current) return; locked.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (error) { if (!keepsRequestId(error)) pending.current = null; failure(error); } finally { locked.current = false; setBusy(false); }
  }
  function stable(signature: string, make: () => unknown) {
    if (pending.current?.signature === signature) return pending.current.payload;
    const payload = make(); pending.current = { signature, payload }; return payload;
  }
  const active = view?.active; const body = active?.blueprint_json;
  const stale = !!body && (view?.currentHash === null || (view?.currentHash !== undefined && view.currentHash !== body.contextHash));
  const discountInvalid = owner && !!edits && percentToBps(discountText) === null;
  const reload = () => run(async () => { setChoices(ChoicesSchema.parse(await call(`?sessionId=${sessionId}`))); if (view) await loadView(view.campaign.id); });
  const create = (entry: BlueprintChoice) => run(async () => {
    const payload = stable(JSON.stringify({ selection: entry.selection, scenario }), () => ({ action: "create", selection: entry.selection, campaignId: crypto.randomUUID(), requestId: crypto.randomUUID(), scenario }));
    const saved = ViewSchema.parse(await call("", payload)); await loadView(saved.campaign.id);
    setNotice(owner ? saved.replayed ? "Rencana yang sama sudah tersimpan sebelumnya." : "Rencana kampanye tersimpan sebagai draf. Belum disetujui dan belum diterbitkan."
      : saved.replayed ? "Draft dan blueprint tersimpan diputar ulang." : "Draft dan blueprint awal tersimpan atomik; belum approved atau published.");
  });
  const revise = () => run(async () => {
    if (!view || !active) return;
    if (discountInvalid) throw new Error("INVALID_DISCOUNT");
    const valid = BlueprintEditsSchema.parse(edits);
    const signature = JSON.stringify({ campaign: view.campaign.id, parent: active.id, version: view.campaign.version, valid, scenario });
    const payload = stable(signature, () => ({ action: "revise", campaignId: view.campaign.id, requestId: crypto.randomUUID(), expectedCampaignVersion: view.campaign.version,
      expectedBlueprintId: active.id, expectedBlueprintVersion: active.version, edits: valid, scenario }));
    const saved = ViewSchema.parse(await call("", payload)); await loadView(saved.campaign.id);
    setNotice(owner ? saved.replayed ? "Revisi yang sama sudah tersimpan sebelumnya." : "Revisi tersimpan sebagai versi baru. Persetujuan versi lama tidak berlaku lagi."
      : saved.replayed ? "Revisi sebelumnya diputar ulang tanpa versi ganda." : "Versi revisi tersimpan; approval lama sudah tidak aktif.");
  });
  const approve = () => run(async () => {
    if (!view || !active) return;
    const saved = ViewSchema.parse(await call("", { action: "approve", campaignId: view.campaign.id, blueprintId: active.id, expectedBlueprintVersion: active.version,
      expectedCampaignVersion: view.campaign.version, confirm: true })); await loadView(saved.campaign.id);
    setNotice(owner ? "Rencana disetujui. Tugas dan caption siap di tab Terbit dan tugas. Kampanye belum diterbitkan." : "Blueprint approved dan tugas/konten termaterialisasi atomik. Campaign belum dipublikasikan.");
  });
  function changeDiscount(text: string) {
    setDiscountText(text); const bps = percentToBps(text);
    if (bps !== null && edits) setEdits({ ...edits, discountBps: bps, marketingApproach: bps ? "limited_discount" : "scheduled_reminder", plan: undefined });
  }
  /** Manual plan edits keep the rest of the generated plan; the first edit copies it from the active version. */
  function editPlan(change: (plan: z.infer<typeof BlueprintPlanSchema>) => z.infer<typeof BlueprintPlanSchema>) {
    if (!edits || !body) return;
    setEdits({ ...edits, plan: change(edits.plan ?? BlueprintPlanSchema.strip().parse(body)) });
  }
  function setReplan(replan: boolean) { if (edits && body) setEdits({ ...edits, plan: replan ? undefined : BlueprintPlanSchema.strip().parse(body) }); }
  return { choices, view, active, body, edits, setEdits, discountText, discountInvalid, error, notice, busy, confirm, setConfirm, scenario, setScenario, stale,
    reload, create, revise, approve, changeDiscount, editPlan, setReplan };
}
export type BlueprintState = ReturnType<typeof useBlueprint>;
