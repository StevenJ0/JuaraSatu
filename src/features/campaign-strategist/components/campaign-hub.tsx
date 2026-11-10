"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Badge, type BadgeTone } from "@/components/owner/badge";
import { BusyLabel } from "@/components/owner/busy-label";
import { Card } from "@/components/owner/card";
import { InfoTip } from "@/components/owner/info-tip";
import { Modal } from "@/components/owner/modal";
import { PRIMARY_BUTTON_CLASS, ROW_ACTION_CLASS, SECONDARY_BUTTON_CLASS, TEXT_LINK_CLASS } from "@/components/form-message";
import { SelectField, TextAreaField, TextField } from "@/components/form-field";
import type { StrategyProposal } from "../contracts";
import { OWNER_FALLBACK, ownerMessages, useDiscussion, type DiscussionState } from "./use-discussion";
import { approvalLabel, campaignLabel, channelLabel, channels, choiceKey, contentLabel, costLabel, money, time, useBlueprint, type BlueprintChoice, type BlueprintState } from "@/features/campaign-blueprint/components/use-blueprint";
import { OwnerExecutionPanel, OwnerMessages } from "@/features/campaign-execution/components/owner-execution";
import { IntakeCard, IntakeQuestions, type PreorderFacts } from "./intake-form";
import { formatIdrInput } from "@/lib/format-idr";
import { plainText } from "@/lib/ai/plain-text";
import { anotherProposalMessage, budgetDigits, leverLabel, platformName } from "./intake";

export type { PreorderFacts } from "./intake-form";
type Option = StrategyProposal["options"][number];
type Tab = "diskusi" | "rencana" | "terbit";

const CampaignListSchema = z.object({ campaigns: z.array(z.object({ id: z.uuid(), preorder_id: z.uuid(), status: z.string() })) });
const CHECKBOX_CLASS = "mt-0.5 size-5 shrink-0 accent-[var(--ui-brand)]";
const dateLabel = (value: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(value));
const sessionLabel = (value: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value));
const approachLabel: Record<string, string> = { scheduled_reminder: "Pengingat terjadwal", value_content: "Konten keunggulan produk", limited_discount: "Diskon terbatas" };
const preorderBadge: Record<string, string> = { published: "Terbit", draft: "Draf", closed: "Ditutup", completed: "Selesai", cancelled: "Dibatalkan" };
const campaignTone: Record<string, BadgeTone> = { draft: "neutral", published: "success", closed: "warning", completed: "neutral", cancelled: "danger" };

/** Campaign status chip per preorder: the latest campaign wins, otherwise "Belum ada kampanye". */
function campaignChip(statuses: string[]): { label: string; tone: BadgeTone } {
  const status = statuses.includes("published") ? "published" : statuses[0];
  return status ? { label: `Kampanye ${campaignLabel[status] ?? status}`, tone: campaignTone[status] ?? "neutral" } : { label: "Belum ada kampanye", tone: "neutral" };
}

export function CampaignHub({ facts }: { facts: Record<string, PreorderFacts> }) {
  const d = useDiscussion(true);
  const [campaigns, setCampaigns] = useState<z.infer<typeof CampaignListSchema>["campaigns"]>([]);
  const [campaignSignature, setCampaignSignature] = useState("");
  const sessionId = d.session?.id;
  const { refreshList } = d;
  useEffect(() => {
    let active = true;
    void fetch("/api/owner/campaigns", { cache: "no-store" }).then((response) => response.json()).then((raw: unknown) => {
      const parsed = CampaignListSchema.safeParse(raw); if (active && parsed.success) setCampaigns(parsed.data.campaigns);
    }).catch(() => { /* The chip is a hint only; the hub still works without it. */ });
    return () => { active = false; };
  }, [sessionId, campaignSignature]);
  useEffect(() => { if (campaignSignature) refreshList(); }, [campaignSignature, refreshList]);
  const preorder = d.list.preorders.find((row) => row.id === d.preorderId);
  const fact = preorder ? facts[preorder.id] : undefined;
  const sessions = d.list.sessions.filter((row) => row.preorder_id === d.preorderId);

  return <div className="flex flex-col gap-6" lang="id">
    <div className="max-w-[65ch]">
      <h1 className="text-2xl font-bold text-ink">Campaign AI</h1>
      <p className="mt-1 text-base text-muted">Rencanakan promosi dari data preorder Anda. AI mengusulkan, angka dihitung server, dan Anda yang memutuskan.</p>
    </div>
    {d.list.provider === "test-mock" && <p role="status" className="text-sm text-muted">Provider mock khusus pengujian integrasi. Fakta preorder dan penyimpanan berasal dari server nyata.</p>}
    <OwnerMessages error={d.error} notice={d.notice} />
    {!d.signedIn ? <Card><p className="text-base text-muted">Memuat data… Bila tidak berubah, <Link href="/login" className={TEXT_LINK_CLASS}>masuk kembali</Link>.</p></Card>
      : !d.list.preorders.length ? <Card className="flex flex-col items-start gap-3">
        <h2 className="text-lg font-semibold text-ink">Belum ada preorder terbit</h2>
        <p className="text-base text-muted">Campaign AI bekerja dari preorder yang sudah terbit, karena usulannya memakai harga, kuota, dan slot yang nyata.</p>
        <Link href="/dashboard/preorders" className={PRIMARY_BUTTON_CLASS}>Kelola preorder</Link></Card>
      : <div className="grid gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside aria-label="Preorder terbit" className="flex min-w-0 flex-col gap-3">
          <div className="lg:hidden">
            <SelectField name="discussion-preorder" label="Preorder" value={d.preorderId} disabled={d.busy} onChange={(event) => d.selectPreorder(event.target.value)}>
              {d.list.preorders.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </SelectField>
          </div>
          <Card padded={false} className="hidden lg:block">
            <h2 className="px-4 pt-4 pb-1 text-sm font-semibold text-muted">Preorder terbit</h2>
            {/* Capped so a long list never reaches the full-width proposals further down, which extend under this column. */}
            <ul className="flex flex-col gap-1 p-2 lg:max-h-[26rem] lg:overflow-y-auto">{d.list.preorders.map((row) => {
              // The execution list only holds approved or published campaigns; the discussion list also knows unapproved drafts.
              const statuses = campaigns.filter((entry) => entry.preorder_id === row.id).map((entry) => entry.status);
              const chip = campaignChip(statuses.length ? statuses : d.list.campaigns.some((entry) => entry.preorderId === row.id) ? ["draft"] : []);
              const rowFact = facts[row.id];
              return <li key={row.id}><button type="button" data-preorder-option={row.id} aria-current={row.id === d.preorderId} disabled={d.busy} onClick={() => d.selectPreorder(row.id)}
                className="flex w-full flex-col items-start gap-1 rounded-[10px] border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-subtle aria-[current=true]:border-brand aria-[current=true]:bg-[var(--ui-brand-soft)]">
                <span className="text-base font-semibold break-words text-ink">{row.name}</span>
                {rowFact && <span className="text-sm text-muted">Tutup {dateLabel(rowFact.endsAt)} · {rowFact.orderableUnits} slot tersisa</span>}
                <Badge tone={chip.tone}>{chip.label}</Badge>
              </button></li>;
            })}</ul>
          </Card>
        </aside>

        <section aria-label="Kampanye preorder" className="flex min-w-0 flex-col gap-4">
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-bold break-words text-ink">{preorder?.name}</h2>
                {fact && <p className="text-sm text-muted">{fact.productName} · tutup {dateLabel(fact.endsAt)}</p>}
              </div>
              {preorder && <Badge tone={preorder.status === "published" ? "success" : "neutral"}>{preorderBadge[preorder.status] ?? preorder.status}</Badge>}
            </div>
            {fact && <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><dt className="text-sm text-muted">Harga dasar</dt><dd className="text-lg font-bold text-ink">{money(fact.basePriceIdr)}</dd></div>
              <div><dt className="text-sm text-muted">Sudah dibayar</dt><dd className="text-lg font-bold text-ink">{fact.paidUnits} unit</dd></div>
              <div><dt className="text-sm text-muted">Target</dt><dd className="text-lg font-bold text-ink">{fact.targetUnits} unit</dd></div>
              <div><dt className="text-sm text-muted">Slot tersisa</dt><dd className="text-lg font-bold text-ink">{fact.orderableUnits} unit</dd></div>
            </dl>}
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <span className="text-sm font-semibold text-muted">Diskusi:</span>
              {sessions.map((row) => <button key={row.id} type="button" aria-current={d.session?.id === row.id ? "true" : undefined} disabled={d.busy} aria-busy={d.activeAction === `open:${row.id}`} onClick={() => void d.openSession(row.id)}
                className={`${ROW_ACTION_CLASS} aria-[current=true]:border-brand aria-[current=true]:bg-[var(--ui-brand-soft)]`}><BusyLabel busy={d.activeAction === `open:${row.id}`} label={sessionLabel(row.updated_at)} busyLabel="Membuka…" /></button>)}
              <button id="discussion-create" type="button" disabled={d.busy || !d.preorderId} aria-busy={d.activeAction === "create-session"} onClick={() => void d.createSession()} className={`gap-1.5 ${ROW_ACTION_CLASS}`}>
                <BusyLabel busy={d.activeAction === "create-session"} label={<><Plus aria-hidden size={16} strokeWidth={1.5} />Diskusi baru</>} busyLabel="Membuat diskusi…" /></button>
            </div>
          </Card>
          {d.session ? <SessionWorkspace key={d.session.id} d={d} onCampaignChange={setCampaignSignature} preorderName={preorder?.name ?? ""} fact={fact} /> : <Card className="flex flex-col items-start gap-3">
            <h2 className="text-lg font-semibold text-ink">Mulai diskusi dengan AI</h2>
            <p className="max-w-[65ch] text-base text-muted">Ceritakan tujuan promosi Anda. AI akan mengusulkan beberapa pilihan promosi lengkap dengan angka harga, biaya, dan perkiraan kontribusi dari data preorder ini.</p>
            <button type="button" disabled={d.busy || !d.preorderId} aria-busy={d.activeAction === "create-session"} onClick={() => void d.createSession()} className={PRIMARY_BUTTON_CLASS}>
              <BusyLabel busy={d.activeAction === "create-session"} label="Mulai diskusi" busyLabel="Membuat diskusi…" /></button>
          </Card>}
        </section>
      </div>}
  </div>;
}

function SessionWorkspace({ d, onCampaignChange, preorderName, fact }: { d: DiscussionState; onCampaignChange: (signature: string) => void; preorderName: string; fact: PreorderFacts | undefined }) {
  const session = d.session;
  const proposalCount = session ? session.messages.filter((item) => item.proposal).length : 0;
  const b = useBlueprint({ sessionId: session?.id ?? "", owner: true, proposalCount });
  const [chosenTab, setChosenTab] = useState<Tab | null>(null);
  const signature = b.view ? `${b.view.campaign.id}:${b.view.campaign.version}:${b.active?.approval_status ?? ""}` : "";
  useEffect(() => { if (signature) onCampaignChange(signature); }, [signature, onCampaignChange]);
  if (!session) return null;
  const approved = b.active?.approval_status === "approved";
  const published = !!b.view && ["published", "closed", "completed"].includes(b.view.campaign.status);
  // Follow the owner's progress until they pick a tab themselves. An approved plan stays on Rencana, whose
  // "Lanjut ke Terbit dan tugas" button is the explicit next step; only a published campaign opens on Terbit.
  const tab: Tab = chosenTab ?? (published ? "terbit" : b.view ? "rencana" : "diskusi");
  const steps = [
    { label: "Diskusi dimulai", done: true },
    { label: "Usulan AI", done: b.choices.proposals.length > 0 },
    { label: "Rencana dibuat", done: !!b.view },
    { label: "Rencana disetujui", done: approved },
    { label: "Kampanye terbit", done: published },
  ];
  const current = steps.findIndex((step) => !step.done);
  const tabs: { id: Tab; label: string }[] = [{ id: "diskusi", label: "Diskusi AI" }, { id: "rencana", label: "Rencana" }, { id: "terbit", label: "Terbit dan tugas" }];
  return <div className="flex flex-col gap-4">
    <ol aria-label="Tahap kampanye" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">{steps.map((step, index) =>
      <li key={step.label} aria-current={index === current ? "step" : undefined} className={`flex items-center gap-2 ${step.done ? "text-ink" : index === current ? "font-semibold text-brand" : "text-muted"}`}>
        <span aria-hidden className={`size-3 rounded-full border-2 ${step.done ? "border-brand bg-brand" : index === current ? "border-brand bg-surface ring-3 ring-[var(--ui-brand-soft)]" : "border-line bg-surface"}`} />
        {step.label}<span className="sr-only">{step.done ? " sudah" : " belum"}</span>
      </li>)}</ol>
    <div role="tablist" aria-label="Langkah Campaign AI" className="flex gap-1 overflow-x-auto border-b border-line">{tabs.map((entry) =>
      <button key={entry.id} type="button" role="tab" id={`campaign-tab-${entry.id}`} aria-selected={tab === entry.id} aria-controls={`campaign-panel-${entry.id}`} onClick={() => setChosenTab(entry.id)}
        className="-mb-px shrink-0 border-b-[3px] border-transparent px-4 py-2.5 text-base! font-semibold! text-muted transition-colors hover:text-ink aria-selected:border-brand aria-selected:text-brand">{entry.label}</button>)}</div>
    <div role="tabpanel" id={`campaign-panel-${tab}`} aria-labelledby={`campaign-tab-${tab}`}>
      {tab === "diskusi" && <DiscussionTab d={d} b={b} onCreated={() => setChosenTab(null)} preorderName={preorderName} fact={fact} />}
      {tab === "rencana" && <PlanTab b={b} onApproved={() => setChosenTab(null)} openExecution={() => setChosenTab("terbit")} goDiscussion={() => setChosenTab("diskusi")} />}
      {tab === "terbit" && (b.view && approved ? <OwnerExecutionPanel campaignId={b.view.campaign.id}
        onCampaignVersion={(version) => { if (b.view && b.view.campaign.version !== version) void b.reload(); }} />
        : <Card className="flex flex-col items-start gap-3"><h3 className="text-base font-semibold text-ink">Rencana belum disetujui</h3>
          <p className="text-base text-muted">Kampanye bisa diterbitkan setelah rencananya Anda setujui di tab Rencana.</p>
          <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => setChosenTab("rencana")}>Buka tab Rencana</button></Card>)}
    </div>
  </div>;
}

function DiscussionTab({ d, b, onCreated, preorderName, fact }: { d: DiscussionState; b: BlueprintState; onCreated: () => void; preorderName: string; fact: PreorderFacts | undefined }) {
  const session = d.session;
  if (!session) return null;
  const options = new Map<string, Option>(session.messages.flatMap((item) => item.proposal
    ? item.proposal.options.map((option): [string, Option] => [`${item.proposal?.proposalVersion}:${option.proposalKey}`, option]) : []));
  // The answers come first; free chat starts once the first message is stored.
  const intakeFirst = session.messages.length === 0;
  // One AI command at a time across the discussion and plan hooks, so no button can start a second request.
  const locked = d.busy || b.busy;
  return <div className="flex flex-col gap-6">
    <Card className="flex min-w-0 flex-col gap-4">
      <h3 className="text-base font-semibold text-ink">{intakeFirst ? "Mulai dari sini" : "Percakapan"}</h3>
      {d.stale && <div className="flex flex-col items-start gap-2 rounded-[10px] bg-[var(--owner-warning-bg)] px-3 py-3 text-base text-[color:var(--owner-warning-fg)]">
        <p>Data preorder berubah sejak diskusi dibuka. Perbarui dulu sebelum mengirim pesan.</p>
        <button type="button" className={ROW_ACTION_CLASS} disabled={locked || !!d.running} aria-busy={d.activeAction === "refresh"} onClick={() => void d.refreshContext()}>
          <BusyLabel busy={d.activeAction === "refresh"} label="Perbarui data preorder" busyLabel="Memperbarui…" /></button>
      </div>}
      {session.truncated && <p className="text-sm text-muted">Menampilkan pesan terbaru. Riwayat lengkap tetap tersimpan.</p>}
      {intakeFirst ? <IntakeCard d={d} preorderName={preorderName} fact={fact} />
        : <ol className="flex max-h-[520px] flex-col gap-3 overflow-y-auto">{session.messages.map((item) => <li key={item.id} data-role={item.role}
          className={`flex max-w-[92%] flex-col gap-1 rounded-[14px] px-4 py-3 ${item.role === "user" ? "self-end bg-[var(--ui-brand-soft)]" : "self-start bg-subtle"}`}>
          <h4 className="text-sm font-semibold text-muted">{item.role === "user" ? "Anda" : "AI"}</h4>
          <p className="text-base whitespace-pre-wrap break-words text-ink">{item.role === "assistant" ? plainText(item.content) : item.content}</p>
          {item.proposal && <p className="text-sm text-muted">{item.proposal.options.length ? "Usulannya ada di bagian Usulan AI." : "Belum ada usulan yang lolos pemeriksaan."}</p>}
        </li>)}</ol>}
      {session.generations.filter((row) => row.status === "failed" || row.status === "invalid_output").slice(0, 3).map((row) =>
        <p key={row.id} className="rounded-[10px] bg-[var(--owner-danger-bg)] px-3 py-2 text-sm text-[color:var(--owner-danger-fg)]">Jawaban AI gagal. {ownerMessages[row.error_code ?? "INVALID_RESPONSE"] ?? OWNER_FALLBACK}</p>)}
      {d.running && <div role="status" className="flex flex-col items-start gap-2 rounded-[10px] bg-subtle px-3 py-3 text-base text-ink">
        <p>AI sedang menyusun jawaban. Bila terhenti, pemulihan bisa dilakukan setelah dua menit.</p>
        <button type="button" className={ROW_ACTION_CLASS} disabled={locked || !d.running.started_at} aria-busy={d.activeAction === "recover"} onClick={() => void d.recover()}>
          <BusyLabel busy={d.activeAction === "recover"} label="Pulihkan jawaban yang terputus" busyLabel="Memulihkan…" /></button>
      </div>}
      {!intakeFirst && <form className="flex flex-col gap-3 border-t border-line pt-4" onSubmit={(event) => { event.preventDefault(); void d.send(); }}>
        <TextAreaField name="discussion-message" label="Pesan untuk AI" rows={3} value={d.message} maxLength={4000} required onChange={(event) => d.setMessage(event.target.value)}
          hint="Minta revisi, misalnya fokus ke Instagram saja atau tanpa diskon. Jumlah unit di usulan adalah asumsi, bukan prediksi." />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <TextField name="discussion-budget" label="Batas biaya promosi" inputMode="numeric" autoComplete="off" placeholder="Rp0" value={formatIdrInput(d.budget)} required
            onChange={(event) => d.setBudget(budgetDigits(event.target.value))} />
          <label className="discussion-check flex min-h-11 items-center gap-3 text-base text-ink"><input type="checkbox" className={CHECKBOX_CLASS} checked={d.allowDiscount} onChange={(event) => d.setAllowDiscount(event.target.checked)} />Boleh usulkan diskon</label>
        </div>
        <details className="rounded-[10px] border border-line px-3 py-2">
          <summary className="cursor-pointer py-1 text-base font-semibold text-brand">Jawaban awal Anda</summary>
          <div className="mt-2 flex flex-col gap-5">
            <p className="text-sm text-muted">Dipakai di setiap pesan dan diingat untuk preorder ini. Perubahan berlaku mulai pesan berikutnya.</p>
            <IntakeQuestions d={d} first={1} />
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <button id="discussion-send" type="submit" className={PRIMARY_BUTTON_CLASS} disabled={locked || !!d.running || d.stale || session.status !== "active" || !d.message.trim()}
            aria-busy={d.activeAction === "send"}><BusyLabel busy={d.activeAction === "send"} label="Kirim pesan" busyLabel="Mengirim…" /></button>
          <button id="discussion-replay" type="button" className={SECONDARY_BUTTON_CLASS} disabled={locked || !d.hasLastRequest} aria-busy={d.activeAction === "replay"} onClick={() => void d.send(true)}>
            <BusyLabel busy={d.activeAction === "replay"} label="Kirim ulang pesan terakhir" busyLabel="Mengirim ulang…" /></button>
        </div>
      </form>}
    </Card>
    <ProposalColumn b={b} options={options} onCreated={onCreated} locked={locked} asking={d.activeAction === "another"}
      onAskAnother={(wish) => void d.send(false, anotherProposalMessage(wish), "another")} askDisabled={locked || !!d.running || d.stale || session.status !== "active"} />
  </div>;
}

const PAGE_SIZE = 3;
/** Plain-language meaning of each proposal number, shown behind an (i) next to its label. */
const NUMBER_HELP = {
  price: "Harga yang dibayar pembeli bila usulan ini dipakai. Dihitung server dari harga dasar preorder dikurangi diskon usulan.",
  units: "Perkiraan Anda berapa unit tambahan terjual berkat promosi ini. Dipakai untuk menghitung angka, bukan prediksi penjualan.",
  cost: "Perkiraan uang yang dikeluarkan untuk promosi ini, misalnya iklan atau cetak. Tidak melebihi anggaran Anda.",
  contribution: "Sisa uang dari penjualan tambahan: harga per unit dikurangi biaya produksi per unit, dikali unit tambahan, lalu dikurangi biaya promosi. Belum termasuk biaya tetap seperti sewa.",
} as const;
const leverOf = (option: Option) => option.lever ? leverLabel[option.lever] : approachLabel[option.marketingApproach] ?? option.marketingApproach;
const platformsOf = (option: Option) => option.tactics ? [...new Set(option.tactics.map((tactic) => platformName[tactic.platform]))].join(", ") : null;
const STALE_PROPOSAL = "Data preorder sudah berubah sejak usulan ini dibuat. Kirim pesan baru untuk usulan terkini.";

/**
 * Card version: one row per number. Rows follow the card's own width (container query): a narrow three-column card
 * stacks label over amount, a wider card puts them side by side, so nothing wraps awkwardly or overflows.
 */
function CompactProposalNumbers({ option }: { option: Option }) {
  const row = "flex flex-col gap-0.5 py-1.5 @[17rem]:flex-row @[17rem]:items-baseline @[17rem]:justify-between @[17rem]:gap-2";
  const label = "flex items-center gap-0.5 text-sm whitespace-nowrap text-muted";
  const value = "font-semibold whitespace-nowrap text-ink @[17rem]:text-right";
  return <dl className="flex flex-col divide-y divide-line rounded-[10px] border border-line px-3">
    <div className={row}><dt className={label}>Harga per unit<InfoTip label="harga per unit" align="center">{NUMBER_HELP.price}</InfoTip></dt>
      <dd className={value}><span className="text-lg font-bold">{money(option.computedScenario.hypotheticalFinalUnitPriceIdr)}</span>
        {option.offer.discountBps > 0 && <span className="ml-1.5 text-xs font-semibold text-muted @[17rem]:ml-0 @[17rem]:block">diskon {option.offer.discountBps / 100}%</span>}</dd></div>
    <div className={row}><dt className={label}>Unit tambahan<InfoTip label="asumsi unit tambahan">{NUMBER_HELP.units}</InfoTip></dt><dd className={value}>{option.assumedAdditionalUnits} unit</dd></div>
    <div className={row}><dt className={label}>Biaya promosi<InfoTip label="biaya promosi">{NUMBER_HELP.cost}</InfoTip></dt><dd className={value}>{money(option.assumedPromotionCostIdr)}</dd></div>
    <div className={row}><dt className={label}>Kontribusi<InfoTip label="perkiraan kontribusi" align="center">{NUMBER_HELP.contribution}</InfoTip></dt><dd className={value}>{money(option.computedScenario.scenarioContributionIdr)}</dd></div>
  </dl>;
}

function ProposalNumbers({ option }: { option: Option }) {
  const cell = "rounded-[10px] border border-line bg-surface px-3 py-2";
  const label = "flex flex-wrap items-center gap-0.5 text-sm text-muted";
  return <dl className="grid grid-cols-2 gap-2">
    <div className={`col-span-2 ${cell}`}><dt className={label}>Harga per unit untuk pembeli<InfoTip label="harga per unit" align="center">{NUMBER_HELP.price}</InfoTip></dt>
      <dd className="text-xl font-bold text-ink">{money(option.computedScenario.hypotheticalFinalUnitPriceIdr)}{option.offer.discountBps > 0 && <span className="ml-2 text-base font-semibold text-muted">diskon {option.offer.discountBps / 100}%</span>}</dd></div>
    <div className={cell}><dt className={label}>Asumsi unit tambahan<InfoTip label="asumsi unit tambahan">{NUMBER_HELP.units}</InfoTip></dt><dd className="font-semibold text-ink">{option.assumedAdditionalUnits} unit</dd></div>
    <div className={cell}><dt className={label}>Biaya promosi<InfoTip label="biaya promosi" align="end">{NUMBER_HELP.cost}</InfoTip></dt><dd className="font-semibold text-ink">{money(option.assumedPromotionCostIdr)}</dd></div>
    <div className={`col-span-2 ${cell}`}><dt className={label}>Perkiraan kontribusi<InfoTip label="perkiraan kontribusi" align="center">{NUMBER_HELP.contribution}</InfoTip></dt><dd className="font-semibold text-ink">{money(option.computedScenario.scenarioContributionIdr)}</dd></div>
  </dl>;
}

function ProposalDetail({ entry, option }: { entry: BlueprintChoice; option: Option }) {
  const heading = "text-sm font-semibold text-muted";
  return <div className="flex flex-col gap-4 text-base text-ink">
    <div className="flex flex-wrap items-center gap-2"><Badge tone={option.offer.offerType === "percent_discount" ? "warning" : "neutral"}>{leverOf(option)}</Badge>
      {platformsOf(option) && <span className="text-sm text-muted">Lewat {platformsOf(option)}</span>}</div>
    {!entry.eligible && <p className="rounded-[10px] bg-[var(--owner-warning-bg)] px-3 py-2 text-sm text-[color:var(--owner-warning-fg)]">{STALE_PROPOSAL}</p>}
    {option.targetAudience && <section className="flex flex-col gap-1"><h3 className={heading}>Sasaran</h3><p>{plainText(option.targetAudience)}</p></section>}
    <section className="flex flex-col gap-1"><h3 className={heading}>Kenapa usulan ini</h3><p className="whitespace-pre-wrap">{plainText(option.hypothesis)}</p></section>
    <ProposalNumbers option={option} />
    {option.tactics && <section className="flex flex-col gap-1.5"><h3 className={heading}>Langkah</h3>
      <ol className="flex flex-col gap-2">{option.tactics.map((tactic, index) => <li key={index} className="flex flex-col gap-0.5 rounded-[10px] bg-subtle px-3 py-2">
        <span className="text-sm font-semibold text-ink">{platformName[tactic.platform]}</span><span className="whitespace-pre-wrap">{plainText(tactic.action)}</span></li>)}</ol></section>}
    {option.hashtags && option.hashtags.length > 0 && <section className="flex flex-col gap-1.5"><h3 className={heading}>Saran tagar, cek dulu sebelum dipakai</h3>
      <p className="flex flex-wrap gap-1.5">{option.hashtags.map((tag) => <span key={tag} className="rounded-full bg-subtle px-2.5 py-1 text-sm">{tag}</span>)}</p></section>}
    <section className="flex flex-col gap-1"><h3 className={heading}>Asumsi</h3><ul className="list-disc pl-5">{option.assumptions.map((item) => <li key={item}>{plainText(item)}</li>)}</ul></section>
    <section className="flex flex-col gap-1"><h3 className={heading}>Risiko</h3><ul className="list-disc pl-5">{option.risks.map((item) => <li key={item}>{plainText(item)}</li>)}</ul></section>
    <p className="text-sm text-muted">Angka dihitung server. Unit dan biaya promosi adalah asumsi, bukan prediksi.</p>
  </div>;
}

function ProposalColumn({ b, options, onCreated, locked, asking, onAskAnother, askDisabled }: { b: BlueprintState; options: Map<string, Option>; onCreated: () => void;
  locked: boolean; asking: boolean; onAskAnother: (wish: string) => void; askDisabled: boolean }) {
  // Newest answer first: the owner reviews what the AI just proposed.
  const entries = [...b.choices.proposals].reverse();
  // On large screens the proposals widen leftwards over the preorder column (264px + the hub grid's 1.5rem gap),
  // so three cards get the full width of the hub instead of the narrow discussion column.
  return <section aria-label="Usulan AI" className="flex min-w-0 flex-col gap-3 lg:-ml-[calc(264px+1.5rem)] lg:w-[calc(100%+264px+1.5rem)]">
    <div><h3 className="text-lg font-semibold text-ink">Usulan AI</h3><p className="text-sm text-muted">Angka dihitung server. Unit dan biaya promosi adalah asumsi.</p></div>
    <OwnerMessages error={b.error} notice={b.view ? "" : b.notice} />
    {b.view && <p className="rounded-[10px] bg-subtle px-3 py-2 text-sm text-ink">Rencana sudah dibuat dari salah satu usulan. Buka tab Rencana untuk meninjaunya.</p>}
    {!entries.length ? <Card><p className="text-base text-muted">Usulan muncul di sini setelah AI menjawab pesan Anda.</p></Card>
      // Keyed by count so a new answer resets the carousel to the first page, where the newest proposal is.
      : <ProposalCarousel key={`carousel-${entries.length}`} entries={entries} options={options} b={b} locked={locked} onCreated={onCreated} />}
    {/* Keyed by count too: the wish field clears once the requested proposal has arrived. */}
    {entries.length > 0 && !b.view && <AskAnother key={`ask-${entries.length}`} disabled={askDisabled} asking={asking} onAsk={onAskAnother} />}
  </section>;
}

function AskAnother({ disabled, asking, onAsk }: { disabled: boolean; asking: boolean; onAsk: (wish: string) => void }) {
  const [wish, setWish] = useState("");
  return <form className="flex flex-col gap-3 rounded-[14px] border border-dashed border-line px-4 py-4" onSubmit={(event) => { event.preventDefault(); onAsk(wish); }}>
    <div><h4 className="text-base font-semibold text-ink">Belum cocok? Minta usulan lain</h4>
      <p className="text-sm text-muted">AI memberi satu usulan per jawaban dan menghindari pendekatan yang sudah diusulkan.</p></div>
    <TextField name="another-wish" label="Usulan seperti apa yang Anda inginkan? (opsional)" value={wish} maxLength={300}
      placeholder="Misalnya fokus ke TikTok, tanpa diskon, atau sasar pekerja kantoran" onChange={(event) => setWish(event.target.value)}
      hint="Bila dikosongkan, AI memilih pendekatan atau platform yang belum diusulkan." />
    <div className="flex flex-wrap items-center gap-3">
      <button id="discussion-another" type="submit" className={SECONDARY_BUTTON_CLASS} disabled={disabled} aria-busy={asking}>
        <BusyLabel busy={asking} label="Minta usulan lain" busyLabel="Meminta usulan…" /></button>
      <p className="text-sm text-muted">Setiap permintaan memakai satu jatah AI harian.</p>
    </div>
  </form>;
}

/** Up to three proposals per page, centred whatever their number; arrows appear only when there are more. */
function ProposalCarousel({ entries, options, b, locked, onCreated }: { entries: BlueprintChoice[]; options: Map<string, Option>; b: BlueprintState; locked: boolean; onCreated: () => void }) {
  const [page, setPage] = useState(0);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const optionOf = (entry: BlueprintChoice) => options.get(`${entry.selection.proposalVersion}:${entry.selection.proposalKey}`);
  const pageCount = Math.ceil(entries.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const visible = entries.slice(start, start + PAGE_SIZE);
  const detail = entries.find((entry) => choiceKey(entry) === detailKey);
  const detailOption = detail ? optionOf(detail) : undefined;
  const create = (entry: BlueprintChoice) => { onCreated(); void b.create(entry); };
  const createButton = (entry: BlueprintChoice, label: string, extra?: { "data-blueprint-create": true }) => {
    const creating = b.activeAction === `create:${choiceKey(entry)}`;
    return <button type="button" {...extra} disabled={locked || !entry.eligible || !!b.view} aria-busy={creating} onClick={() => create(entry)} className={`w-full ${PRIMARY_BUTTON_CLASS}`}>
      <BusyLabel busy={creating} label={label} busyLabel="Membuat rencana…" /></button>;
  };
  const arrow = "inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface text-ink transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40";
  return <div className="flex flex-col gap-3">
    <ul aria-label="Daftar usulan AI" className="blueprint-choices flex flex-wrap justify-center gap-3">{visible.map((entry, index) => {
      const option = optionOf(entry);
      const newest = start + index === 0;
      return <li key={choiceKey(entry)} className="w-full sm:w-[calc((100%-0.75rem)/2)] lg:w-[calc((100%-1.5rem)/3)]">
        <article className={`@container flex h-full flex-col gap-3 rounded-[14px] border bg-surface p-4 ${newest ? "border-brand shadow-[0_12px_28px_-18px_rgba(40,91,67,.6)]" : "border-line"}`}>
          {(newest || option) && <div className="flex flex-wrap items-center gap-1.5">{newest && <Badge tone="success">Terbaru</Badge>}
            {option && <Badge tone={option.offer.offerType === "percent_discount" ? "warning" : "neutral"}>{leverOf(option)}</Badge>}</div>}
          <h4 className="text-base font-semibold break-words text-ink">{plainText(entry.title)}</h4>
          {option && platformsOf(option) && <p className="text-sm text-muted">Lewat {platformsOf(option)}</p>}
          {!entry.eligible && <p className="text-sm text-[color:var(--owner-warning-fg)]">{STALE_PROPOSAL}</p>}
          {option ? <CompactProposalNumbers option={option} /> : <p className="text-sm text-muted">Rincian angka usulan ini ada di diskusi lain.</p>}
          <div className="mt-auto flex flex-col gap-2 pt-1">
            {option && <button type="button" className={`w-full ${SECONDARY_BUTTON_CLASS}`} onClick={() => setDetailKey(choiceKey(entry))}>Lihat detail</button>}
            {createButton(entry, "Buat rencana", { "data-blueprint-create": true })}
          </div>
        </article>
      </li>;
    })}</ul>
    {pageCount > 1 && <div className="flex items-center justify-center gap-3">
      <button type="button" className={arrow} aria-label="Usulan sebelumnya" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft aria-hidden size={20} strokeWidth={2} /></button>
      <p aria-live="polite" className="min-w-36 text-center text-sm text-muted">
        Usulan {visible.length === 1 ? start + 1 : `${start + 1}–${start + visible.length}`} dari {entries.length}</p>
      <button type="button" className={arrow} aria-label="Usulan berikutnya" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}><ChevronRight aria-hidden size={20} strokeWidth={2} /></button>
    </div>}
    <Modal open={!!detail && !!detailOption} onClose={() => setDetailKey(null)} title={plainText(detail?.title ?? "")}
      footer={detail && <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <div className="sm:w-fit">{createButton(detail, "Buat rencana dari usulan ini")}</div>
        <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => setDetailKey(null)}>Tutup</button></div>}>
      {detail && detailOption && <ProposalDetail entry={detail} option={detailOption} />}
    </Modal>
  </div>;
}

function PlanTab({ b, onApproved, openExecution, goDiscussion }: { b: BlueprintState; onApproved: () => void; openExecution: () => void; goDiscussion: () => void }) {
  const { view, active, body, edits } = b;
  if (!view || !active || !body || !edits) return <Card className="flex flex-col items-start gap-3">
    <OwnerMessages error={b.error} notice={b.notice} />
    <h3 className="text-base font-semibold text-ink">Belum ada rencana</h3>
    <p className="text-base text-muted">Pilih usulan di tab Diskusi AI, lalu tekan Buat rencana. AI akan menyusun tugas dan caption.</p>
    <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={goDiscussion}>Buka tab Diskusi AI</button>
  </Card>;
  const approved = active.approval_status === "approved";
  const calc = body.financial.calculation;
  return <div className="flex flex-col gap-4">
    <OwnerMessages error={b.error} notice={b.notice} />
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="text-lg font-semibold break-words text-ink">{body.campaignTitle}</h3>
          <p className="text-sm text-muted">{time(body.executionWindow.startsAt)} sampai {time(body.executionWindow.endsAt)} WIB · {channels(body.channels)}</p></div>
        <span data-blueprint-status data-approval={active.approval_status} data-version={active.version}
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${approved ? "bg-[var(--owner-success-bg)] text-[color:var(--owner-success-fg)]" : "bg-[var(--owner-warning-bg)] text-[color:var(--owner-warning-fg)]"}`}>
          {approvalLabel[active.approval_status] ?? active.approval_status} · versi {active.version} · kampanye {campaignLabel[view.campaign.status] ?? view.campaign.status}</span>
      </div>
      {body.provider === "development-fake-blueprint" && <p role="status" className="text-sm text-muted">Rencana ini dibuat dengan provider mock untuk pengujian integrasi.</p>}
      {body.provider === "manual" && <p className="text-sm text-muted">Versi ini hasil edit manual Anda, tanpa AI.</p>}
      {b.stale && <p role="status" className="rounded-[10px] bg-[var(--owner-warning-bg)] px-3 py-2 text-base text-[color:var(--owner-warning-fg)]">Data preorder berubah. Persetujuan diblokir sampai Anda membuat usulan baru.</p>}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-line bg-[var(--ui-line)] sm:grid-cols-3">
        <div className="bg-surface px-3 py-2"><dt className="text-sm text-muted">Harga dasar</dt><dd className="font-semibold text-ink">{money(body.financial.frozenBasePriceIdr)}</dd></div>
        <div className="bg-surface px-3 py-2"><dt className="text-sm text-muted">Diskon / harga promo</dt><dd className="font-semibold text-ink">{body.offer.discountBps / 100}% / {money(calc.hypotheticalFinalUnitPriceIdr)}</dd></div>
        <div className="bg-surface px-3 py-2"><dt className="text-sm text-muted">Biaya per unit</dt><dd className="font-semibold text-ink">{money(body.financial.variableCostIdr)} <span className="text-sm font-normal text-muted">({costLabel[body.financial.costQuality]})</span></dd></div>
        <div className="bg-surface px-3 py-2"><dt className="text-sm text-muted">Asumsi unit / anggaran</dt><dd className="font-semibold text-ink">{body.targetAdditionalUnits} unit / {money(body.budgetCapIdr)}</dd></div>
        <div className="bg-surface px-3 py-2"><dt className="text-sm text-muted">Perkiraan pendapatan</dt><dd className="font-semibold text-ink">{money(calc.scenarioRevenueIdr)}</dd></div>
        <div className="bg-surface px-3 py-2"><dt className="text-sm text-muted">Perkiraan kontribusi</dt><dd className="font-semibold text-ink">{money(calc.scenarioContributionIdr)}</dd></div>
      </dl>
      <div className="flex max-w-[70ch] flex-col gap-2 text-base text-ink">
        <p className="font-semibold">{plainText(body.goal)}</p>
        <p><span className="text-muted">Hipotesis:</span> {plainText(body.hypothesis)}</p>
        <p><span className="text-muted">Audiens:</span> {plainText(body.audienceHypothesis)}</p>
        <p><span className="text-muted">Alasan:</span> {plainText(body.rationale)}</p>
        <p className="text-sm text-muted">Target {body.kpiPlan.target} unit terbayar, bukan hasil aktual. {body.kpiPlan.definition}</p>
      </div>
    </Card>

    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card className="flex flex-col gap-3"><h3 className="text-base font-semibold text-ink">Tugas ({body.tasks.length})</h3>
        <ol className="flex flex-col divide-y divide-line">{body.tasks.map((task) => <li key={task.key} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
          <p className="font-semibold text-ink">{plainText(task.title)}</p><p className="text-sm text-muted">{time(task.dueAt)} WIB · {task.channel ? channelLabel[task.channel] : "Platform lain"}</p><p className="text-base whitespace-pre-wrap text-ink">{plainText(task.description)}</p></li>)}</ol></Card>
      <Card className="flex flex-col gap-3"><h3 className="text-base font-semibold text-ink">Caption ({body.contents.length})</h3>
        <ul className="flex flex-col gap-3">{body.contents.map((content) => <li key={content.key} className="rounded-[12px] bg-subtle p-3">
          <p className="text-sm font-semibold text-muted">{channelLabel[content.channel]} · {contentLabel[content.type]}</p><p className="text-base whitespace-pre-wrap break-words text-ink">{plainText(content.body)}</p></li>)}</ul></Card>
    </div>

    <Card className="flex flex-col gap-1">
      <details><summary className="cursor-pointer py-1 text-base font-semibold text-brand">Asumsi dan batas evaluasi</summary>
        <ul className="mt-2 list-disc pl-5 text-base text-ink">{body.assumptions.map((item) => <li key={item}>{item}</li>)}</ul><p className="mt-2 text-sm text-muted">{body.evaluationPlan}</p></details>
      <details className="border-t border-line pt-1"><summary className="cursor-pointer py-1 text-base font-semibold text-brand">Risiko, kebutuhan, dan daftar periksa</summary>
        <ul className="mt-2 list-disc pl-5 text-base text-ink">{[...body.risks, ...body.dependencies, ...body.ownerChecklist].map((item, index) => <li key={index}>{item}</li>)}</ul></details>
      <details className="border-t border-line pt-1"><summary className="cursor-pointer py-1 text-base font-semibold text-brand">Riwayat versi</summary>
        <ul className="mt-2 flex flex-col gap-1 text-base text-ink">{view.history.map((row) => <li key={row.id}>Versi {row.version} · {approvalLabel[row.approval_status] ?? row.approval_status}
          {row.blueprint_json.provider === "manual" && " · edit manual"}{row.approved_at && ` · disetujui ${time(row.approved_at)} WIB`}</li>)}</ul>
        <p className="mt-2 text-sm text-muted">Versi aktif berisi {view.materialized.tasks.length} tugas dan {view.materialized.contents.length} caption. Versi lama tetap tersimpan.</p></details>
    </Card>

    <Card>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void b.revise(); }}>
        <div><h3 className="text-base font-semibold text-ink">Ubah rencana</h3><p className="text-sm text-muted">Setiap simpanan menjadi versi baru dan perlu disetujui lagi.</p></div>
        <TextField name="blueprint-title" label="Nama kampanye" value={edits.title} readOnly hint="Nama tidak bisa diubah setelah rencana dibuat." />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField name="blueprint-discount" label="Diskon (%)" type="text" inputMode="decimal" value={b.discountText} onChange={(event) => b.changeDiscount(event.target.value)}
            errors={b.discountInvalid ? ["Isi 0 sampai 99,99, misalnya 10 atau 12,5."] : undefined} hint={b.discountInvalid ? undefined : "Isi 0 untuk harga normal."} />
          <TextField name="blueprint-budget" label="Anggaran promosi (Rp)" type="number" min="0" max="1000000000" step="1" value={edits.budgetCapIdr} onChange={(event) => b.setEdits({ ...edits, budgetCapIdr: Number(event.target.value) })} />
          <TextField name="blueprint-units" label="Asumsi unit tambahan" type="number" min="1" max="10000" step="1" value={edits.targetAdditionalUnits} onChange={(event) => b.setEdits({ ...edits, targetAdditionalUnits: Number(event.target.value) })} />
        </div>
        <TextAreaField name="blueprint-goal" label="Tujuan" value={edits.plan?.goal ?? body.goal} maxLength={500} onChange={(event) => b.editPlan((plan) => ({ ...plan, goal: event.target.value }))} />
        <TextAreaField name="blueprint-caption" label="Caption pertama" rows={4} value={edits.plan?.contents[0]?.body ?? body.contents[0].body} maxLength={2200}
          hint="Boleh menulis tanggal, harga, dan detail produk. Janji hasil seperti pasti laku tetap ditolak."
          onChange={(event) => b.editPlan((plan) => ({ ...plan, contents: plan.contents.map((content, index) => index === 0 ? { ...content, body: event.target.value } : content) }))} />
        <TextAreaField name="blueprint-notes" label="Catatan revisi" value={edits.notes} maxLength={500} onChange={(event) => b.setEdits({ ...edits, notes: event.target.value })} />
        <label className="flex items-start gap-3 text-base text-ink"><input id="blueprint-replan" type="checkbox" className={CHECKBOX_CLASS} checked={!edits.plan} onChange={(event) => b.setReplan(event.target.checked)} />
          Susun ulang tugas dan caption dengan AI berdasarkan catatan. Edit manual di atas akan diganti.</label>
        <button id="blueprint-save" type="submit" className={`w-full sm:w-fit ${SECONDARY_BUTTON_CLASS}`} disabled={b.busy || b.stale || b.discountInvalid}
          aria-busy={b.activeAction === "revise"}><BusyLabel busy={b.activeAction === "revise"} label="Simpan sebagai versi baru" busyLabel="Menyimpan versi…" /></button>
      </form>
    </Card>

    <Card className="flex flex-col items-start gap-3">
      <h3 className="text-base font-semibold text-ink">Persetujuan</h3>
      {approved ? <>
        <p className="text-base text-ink">Versi {active.version} disetujui pada {active.approved_at ? time(active.approved_at) : "-"} WIB. Kampanye masih draf sampai Anda terbitkan.</p>
        <button id="blueprint-open-execution" type="button" className={PRIMARY_BUTTON_CLASS} onClick={openExecution}>Lanjut ke Terbit dan tugas</button>
      </> : <>
        <label className="flex items-start gap-3 text-base text-ink"><input id="blueprint-confirm" type="checkbox" className={CHECKBOX_CLASS} checked={b.confirm} onChange={(event) => b.setConfirm(event.target.checked)} />
          Saya sudah meninjau angka, tugas, dan caption versi ini dan menyetujui rencananya.</label>
        <button id="blueprint-approve" type="button" className={PRIMARY_BUTTON_CLASS} disabled={b.busy || b.stale || !b.confirm} aria-busy={b.activeAction === "approve"}
          onClick={() => { onApproved(); void b.approve(); }}><BusyLabel busy={b.activeAction === "approve"} label={`Setujui versi ${active.version}`} busyLabel="Menyetujui…" /></button>
        <p className="text-sm text-muted">Menyetujui belum menerbitkan kampanye. Pembeli belum melihat perubahan apa pun.</p>
      </>}
    </Card>
  </div>;
}
