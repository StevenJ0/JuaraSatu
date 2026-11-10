"use client";

import { useState, type ReactNode } from "react";
import { TextAreaField, TextField } from "@/components/form-field";
import { PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { BusyLabel } from "@/components/owner/busy-label";
import { PromotionPlatformSchema, type OwnerIntake } from "../contracts";
import { diagnoseTarget, type TargetDiagnosis } from "../target-diagnosis";
import { formatIdrInput } from "@/lib/format-idr";
import { BUDGET_PRESETS, budgetDigits, causeLabel, dailyTimeLabel, intakeMessage, platformLabel } from "./intake";
import type { DiscussionState } from "./use-discussion";

/** Facts read on the server from the owner's preorders; the hub only displays them. */
export type PreorderFacts = { productName: string; basePriceIdr: number; targetUnits: number; paidUnits: number; orderableUnits: number; startsAt: string; endsAt: string };

const CHIP_CLASS = "inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-subtle has-checked:border-brand has-checked:bg-[var(--ui-brand-soft)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand";
const shortMoney = (value: number) => value === 0 ? "Rp0" : `Rp${new Intl.NumberFormat("id-ID").format(value)}`;
const decimal = (value: number) => String(value).replace(".", ",");

function Question({ legend, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
  return <fieldset className="flex min-w-0 flex-col gap-2">
    <legend className="mb-1 text-base font-semibold text-ink">{legend}</legend>
    {hint && <p className="text-sm text-muted">{hint}</p>}
    {children}
  </fieldset>;
}

function Choice({ type, name, checked, onChange, children }: { type: "radio" | "checkbox"; name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return <label className={CHIP_CLASS}><input type={type} name={name} className="sr-only" checked={checked} onChange={onChange} />{children}</label>;
}

function diagnosisText(diagnosis: TargetDiagnosis, orderableUnits: number) {
  if (diagnosis.pace === "target_met") return `Target ${diagnosis.targetUnits} unit sudah tercapai. Strategi bisa dipakai untuk mengisi ${orderableUnits} slot yang tersisa.`;
  const days = diagnosis.daysLeft > 0 ? `sisa ${diagnosis.daysLeft} hari` : "preorder ditutup hari ini";
  const pace = diagnosis.pace === "on_track" ? "Laju sejauh ini sudah cukup, jadi strategi membantu menjaga momentum."
    : diagnosis.pace === "behind" ? `Laju sejauh ini sekitar ${decimal(diagnosis.paidPerDaySoFar)} unit per hari, sedikit di bawah kebutuhan.`
      : `Laju sejauh ini sekitar ${decimal(diagnosis.paidPerDaySoFar)} unit per hari, jadi perlu menjangkau calon pembeli baru.`;
  return `Saat ini ${diagnosis.paidUnits} dari ${diagnosis.targetUnits} unit sudah dibayar. Kurang ${diagnosis.gapUnits} unit dan ${days}, jadi perlu sekitar ${diagnosis.unitsPerDayNeeded} unit per hari. ${pace}`;
}

/** Questions 2 to 6; budget and discount live in the intake card and in the message form. */
export function IntakeQuestions({ d, first = 2 }: { d: DiscussionState; first?: number }) {
  const intake = d.intake;
  const update = (change: Partial<OwnerIntake>) => d.setIntake({ ...intake, ...change });
  const toggle = (asset: OwnerIntake["assets"][number]) => update({ assets: intake.assets.includes(asset) ? intake.assets.filter((entry) => entry !== asset) : [...intake.assets, asset] });
  return <>
    <Question legend={`${first}. Di mana Anda sudah punya audiens?`} hint="Boleh pilih lebih dari satu. Kosongkan bila belum punya.">
      <div className="flex flex-wrap gap-2">{PromotionPlatformSchema.options.map((asset) =>
        <Choice key={asset} type="checkbox" name="intake-assets" checked={intake.assets.includes(asset)} onChange={() => toggle(asset)}>{platformLabel[asset]}</Choice>)}</div>
      <TextField name="intake-asset-notes" label="Ceritakan singkat (opsional)" value={intake.assetNotes} maxLength={300}
        placeholder="Misalnya grup alumni 200 orang, Instagram 800 pengikut" onChange={(event) => update({ assetNotes: event.target.value })} />
    </Question>
    <TextField name="intake-target-buyer" label={`${first + 1}. Siapa pembeli yang Anda incar?`} value={intake.targetBuyer} maxLength={200}
      placeholder="Misalnya mahasiswa di sekitar kampus Tembalang" onChange={(event) => update({ targetBuyer: event.target.value })} />
    <TextField name="intake-product-strength" label={`${first + 2}. Apa keunggulan produk Anda?`} value={intake.productStrength} maxLength={200}
      placeholder="Misalnya bahan katun tebal, desain lokal" hint="Dipakai untuk isi pesan promosi." onChange={(event) => update({ productStrength: event.target.value })} />
    <Question legend={`${first + 3}. Menurut Anda, kenapa belum banyak yang pesan?`}>
      <div className="flex flex-wrap gap-2">{(Object.keys(causeLabel) as Array<keyof typeof causeLabel>).map((cause) =>
        <Choice key={cause} type="radio" name="intake-cause" checked={intake.suspectedCause === cause} onChange={() => update({ suspectedCause: cause })}>{causeLabel[cause]}</Choice>)}</div>
      <TextField name="intake-cause-notes" label="Ceritakan singkat (opsional)" value={intake.causeNotes ?? ""} maxLength={300}
        placeholder="Misalnya banyak yang tanya tapi tidak jadi pesan, atau baru dibagikan di satu grup" onChange={(event) => update({ causeNotes: event.target.value })} />
    </Question>
    <Question legend={`${first + 4}. Berapa waktu yang bisa Anda pakai untuk promosi per hari?`} hint="Supaya jumlah tugas sesuai tenaga Anda.">
      <div className="flex flex-wrap gap-2">{(Object.keys(dailyTimeLabel) as Array<keyof typeof dailyTimeLabel>).map((time) =>
        <Choice key={time} type="radio" name="intake-time" checked={intake.dailyTime === time} onChange={() => update({ dailyTime: time })}>{dailyTimeLabel[time]}</Choice>)}</div>
    </Question>
  </>;
}

/** First screen of a discussion: a fixed greeting (no AI call) with the target gap, then one round of answers. */
export function IntakeCard({ d, preorderName, fact }: { d: DiscussionState; preorderName: string; fact: PreorderFacts | undefined }) {
  const [now] = useState(() => new Date().toISOString());
  const session = d.session;
  if (!session) return null;
  const diagnosis = fact ? diagnoseTarget({ targetUnits: fact.targetUnits, paidUnits: fact.paidUnits, startsAt: fact.startsAt, endsAt: fact.endsAt, now }) : null;
  const budgetValue = Number(d.budget);
  return <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); void d.send(false, intakeMessage(d.intake, budgetValue, d.allowDiscount, d.message)); }}>
    <div className="flex max-w-[70ch] flex-col gap-2 rounded-[14px] bg-subtle px-4 py-4">
      <h4 className="text-sm font-semibold text-muted">Asisten promosi</h4>
      <p className="text-base text-ink">Halo, saya bantu menyusun strategi promosi supaya <b>{preorderName}</b> mencapai target.</p>
      {diagnosis && fact && <p className="text-base text-ink">{diagnosisText(diagnosis, fact.orderableUnits)}</p>}
      <p className="text-base text-ink">Jawab pertanyaan di bawah. Semuanya boleh dikosongkan, tetapi makin lengkap makin sesuai usulannya. Jawaban Anda diingat untuk diskusi berikutnya pada preorder ini.</p>
    </div>
    {d.intakeRemembered && <p role="status" className="rounded-[10px] bg-[var(--ui-brand-soft)] px-3 py-2 text-base text-ink">Jawaban dari diskusi sebelumnya sudah terisi. Ubah bila ada yang berbeda, lalu tekan Susun strategi.</p>}
    <Question legend="1. Berapa anggaran promosi yang siap Anda keluarkan?" hint="Isi Rp0 bila hanya ingin promosi tanpa biaya.">
      <div className="flex flex-wrap gap-2">{BUDGET_PRESETS.map((preset) =>
        <Choice key={preset} type="radio" name="intake-budget" checked={d.budget !== "" && budgetValue === preset} onChange={() => d.setBudget(String(preset))}>{shortMoney(preset)}</Choice>)}</div>
      <TextField name="discussion-budget" label="Atau isi sendiri" inputMode="numeric" autoComplete="off" placeholder="Rp0" value={formatIdrInput(d.budget)} required
        onChange={(event) => d.setBudget(budgetDigits(event.target.value))} />
    </Question>
    <IntakeQuestions d={d} />
    <Question legend="7. Boleh memberi diskon?" hint="Diskon dihitung server dan tidak boleh membuat Anda rugi per unit.">
      <div className="flex flex-wrap gap-2">
        <Choice type="radio" name="intake-discount" checked={d.allowDiscount} onChange={() => d.setAllowDiscount(true)}>Boleh</Choice>
        <Choice type="radio" name="intake-discount" checked={!d.allowDiscount} onChange={() => d.setAllowDiscount(false)}>Tidak</Choice>
      </div>
    </Question>
    <TextAreaField name="discussion-message" label="Catatan tambahan (opsional)" rows={3} value={d.message} maxLength={2000}
      hint="Hal lain yang perlu AI tahu. Jumlah unit di usulan adalah asumsi, bukan prediksi." onChange={(event) => d.setMessage(event.target.value)} />
    <button id="discussion-send" type="submit" className={`w-full sm:w-fit ${PRIMARY_BUTTON_CLASS}`} disabled={d.busy || !!d.running || d.stale || session.status !== "active"}
      aria-busy={d.activeAction === "send"}><BusyLabel busy={d.activeAction === "send"} label="Susun strategi" busyLabel="Menyusun strategi…" /></button>
  </form>;
}
