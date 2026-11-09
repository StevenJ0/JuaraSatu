"use client";
import Link from "next/link";
import { z } from "zod";
import "./blueprint.css";
import { approvalLabel, campaignLabel, channelLabel, channels, contentLabel, costLabel, money, time, useBlueprint } from "./use-blueprint";

/** Development panel (/dev/discussion); owners use the Campaign hub, which shares the same useBlueprint state. */
export function BlueprintPanel({ sessionId, owner = false, proposalCount = 0 }: { sessionId: string; owner?: boolean; proposalCount?: number }) {
  const b = useBlueprint({ sessionId, owner, proposalCount });
  const { view, active, body, edits, busy, stale } = b;
  return <section className="blueprint-panel" aria-label={owner ? "Rencana kampanye" : "Campaign Blueprint"}><h2>{owner ? "Rencana kampanye" : "Campaign Blueprint"}</h2>
    <p className="blueprint-notice">{owner ? "Rencana disusun dari data preorder Anda. Menyetujui rencana belum mengaktifkan promosi untuk pembeli." : "Blueprint · context sintetis · Auth dan persistence nyata. Approval demo tidak mempublikasikan campaign."}</p>
    {b.error && <p role="alert" className="blueprint-error">{b.error}</p>}{b.notice && <p role="status">{b.notice}</p>}
    <button className="discussion-secondary" disabled={busy} onClick={() => void b.reload()}>{owner ? "Muat ulang usulan" : "Muat ulang blueprint/sumber"}</button>
    <div className="blueprint-choices">{b.choices.proposals.map((entry) => <div key={`${entry.selection.generationId}:${entry.selection.proposalKey}`}>
      <p>{owner ? <>{entry.title}{!entry.eligible && " · data preorder sudah berubah, minta usulan baru"}</> : <>{entry.title} · proposal {entry.selection.proposalVersion}{!entry.eligible && " · context stale"}</>}</p>
      <button data-blueprint-create disabled={busy || !entry.eligible || !!view} onClick={() => void b.create(entry)}>{owner ? "Buat rencana dari usulan ini" : "Buat campaign draft & blueprint"}</button></div>)}</div>
    {!b.choices.proposals.length && <p>{owner ? "Kirim pesan di diskusi. Usulan AI yang lolos pemeriksaan akan muncul di sini." : "Kirim strategi lalu muat ulang sumber. Hanya alternatif dari proposal yang benar-benar tersimpan dapat dipilih."}</p>}
    {view && active && body && edits && <>
      <div className="blueprint-status" data-blueprint-status data-approval={active.approval_status} data-version={active.version}>{owner
        ? `${approvalLabel[active.approval_status] ?? active.approval_status} · versi ${active.version} · kampanye ${campaignLabel[view.campaign.status] ?? view.campaign.status}`
        : `${active.approval_status} · blueprint v${active.version} · campaign v${view.campaign.version} · ${view.campaign.status}`}</div>
      {owner && body.provider === "development-fake-blueprint" && <p role="status">Rencana ini dibuat dengan provider mock untuk pengujian integrasi.</p>}
      {body.provider === "manual" && <p>{owner ? "Versi ini hasil edit manual Anda, tanpa AI." : "Revisi manual tanpa generasi AI. Sumber rencana sebelumnya tetap tersedia pada riwayat versi induk."}</p>}
      {active.approval_status === "approved" && <p><Link id="blueprint-open-execution" href={`${owner ? "/dashboard/campaigns/execution" : "/dev/campaigns"}?campaignId=${view.campaign.id}`}>{owner ? "Buka halaman eksekusi untuk menerbitkan" : "Tinjau publikasi & kalender eksekusi"}</Link></p>}
      {stale && <p role="status">{owner ? "Data preorder berubah. Persetujuan diblokir sampai Anda membuat usulan baru." : "Context sumber berubah atau belum tersedia; approval diblokir sampai strategi dan fakta tervalidasi ulang."}</p>}
      <h3>{body.campaignTitle}</h3><p>{body.goal}</p><p>Hipotesis: {body.hypothesis}</p><p>{body.rationale}</p><p>Audiens: {body.audienceHypothesis}</p>
      <dl className="discussion-numbers">
        <div><dt>{owner ? "Harga dasar preorder" : "Harga preorder frozen"}</dt><dd>{money(body.financial.frozenBasePriceIdr)}</dd></div>
        <div><dt>{owner ? "Harga yang berlaku saat rencana dibuat" : "Harga efektif saat snapshot"}</dt><dd>{money(body.financial.calculation.currentOffer?.unitPriceIdr ?? null)}</dd></div>
        <div><dt>{owner ? "Biaya per unit / status data" : "Biaya variabel / kualitas data"}</dt><dd>{money(body.financial.variableCostIdr)} / {owner ? costLabel[body.financial.costQuality] : body.financial.costQuality}</dd></div>
        <div><dt>{owner ? "Diskon / harga promo" : "Diskon / harga hipotetis"}</dt><dd>{body.offer.discountBps / 100}% / {money(body.financial.calculation.hypotheticalFinalUnitPriceIdr)}</dd></div>
        <div><dt>{owner ? "Asumsi unit / anggaran" : "Asumsi unit / budget"}</dt><dd>{body.targetAdditionalUnits} / {money(body.budgetCapIdr)}</dd></div>
        <div><dt>{owner ? "Perkiraan pendapatan / kontribusi" : "Revenue / kontribusi skenario"}</dt><dd>{money(body.financial.calculation.scenarioRevenueIdr)} / {money(body.financial.calculation.scenarioContributionIdr)}</dd></div>
      </dl>
      <p>{time(body.executionWindow.startsAt)} sampai {time(body.executionWindow.endsAt)} WIB · {owner ? channels(body.channels) : body.channels.join(", ")}</p>
      <h3>{owner ? "Target, bukan hasil aktual" : "KPI target, bukan hasil aktual"}</h3><p>{owner ? `Target ${body.kpiPlan.target} unit terbayar.` : `${body.primaryKpi}: target ${body.kpiPlan.target} unit.`} {body.kpiPlan.definition} {body.kpiPlan.baselineNote}</p>
      <h3>Seluruh rencana tugas ({body.tasks.length})</h3><ol>{body.tasks.map((task) => <li key={task.key}><strong>{task.title}</strong><p>{time(task.dueAt)} WIB · {task.channel === null ? owner ? "Platform lain" : "other" : owner ? channelLabel[task.channel] : task.channel}</p><p>{task.description}</p></li>)}</ol>
      <h3>{owner ? `Seluruh caption (${body.contents.length})` : `Seluruh caption/konten (${body.contents.length})`}</h3>{body.contents.map((content) => <article key={content.key}><h4>{owner ? `${channelLabel[content.channel]} · ${contentLabel[content.type]}` : `${content.channel} · ${content.type}`}</h4><p>{content.body}</p></article>)}
      <h3>Asumsi dan batas evaluasi</h3><ul>{body.assumptions.map((item) => <li key={item}>{item}</li>)}</ul><p>{body.evaluationPlan}</p>
      <h3>{owner ? "Risiko, kebutuhan, dan daftar periksa" : "Risiko, dependensi dan checklist review"}</h3><ul>{[...body.risks, ...body.dependencies, ...body.ownerChecklist].map((item, index) => <li key={index}>{item}</li>)}</ul>
      <h3>Riwayat versi</h3><ul>{view.history.map((row) => <li key={row.id}>{owner
        ? `Versi ${row.version} · ${approvalLabel[row.approval_status] ?? row.approval_status}${row.blueprint_json.provider === "manual" ? " · edit manual" : ""}${row.approved_at ? ` · disetujui ${time(row.approved_at)} WIB` : ""}`
        : <>Blueprint v{row.version} · {row.approval_status}{row.blueprint_json.provider === "manual" && " · revisi manual"}{row.approved_at && ` · approved ${time(row.approved_at)} WIB`}</>}</li>)}</ul>
      <p>{owner ? `Versi aktif berisi ${view.materialized.tasks.length} tugas dan ${view.materialized.contents.length} caption. Versi lama tetap tersimpan.`
        : `Materialisasi versi aktif: ${view.materialized.tasks.length} tugas, ${view.materialized.contents.length} konten. Riwayat versi lama dipertahankan.`}</p>
      <form onSubmit={(event) => { event.preventDefault(); void b.revise(); }}>
        <h3>Edit atau minta revisi</h3><label>{owner ? "Nama kampanye" : "Nama campaign"}<input id="blueprint-title" value={edits.title} readOnly /></label>
        {owner ? <label>Diskon (%)<input id="blueprint-discount" type="text" inputMode="decimal" value={b.discountText} aria-invalid={b.discountInvalid} aria-describedby="blueprint-discount-hint"
          onChange={(event) => b.changeDiscount(event.target.value)} />
          <span id="blueprint-discount-hint" className={b.discountInvalid ? "blueprint-error" : undefined}>{b.discountInvalid ? "Isi diskon 0 sampai 99,99 persen, misalnya 10 atau 12,5." : "Isi 0 untuk harga normal tanpa diskon."}</span></label>
          : <label>Diskon (basis points)<input id="blueprint-discount" type="number" min="0" max="9999" step="1" value={edits.discountBps} onChange={(event) => b.setEdits({ ...edits, discountBps: Number(event.target.value), marketingApproach: Number(event.target.value) ? "limited_discount" : "scheduled_reminder", plan: undefined })} /></label>}
        <label>{owner ? "Anggaran promosi (Rp)" : "Budget hipotetis (Rp)"}<input id="blueprint-budget" type="number" min="0" max="1000000000" step="1" value={edits.budgetCapIdr} onChange={(event) => b.setEdits({ ...edits, budgetCapIdr: Number(event.target.value) })} /></label>
        <label>Asumsi tambahan unit<input id="blueprint-units" type="number" min="1" max="10000" step="1" value={edits.targetAdditionalUnits} onChange={(event) => b.setEdits({ ...edits, targetAdditionalUnits: Number(event.target.value) })} /></label>
        <label>Tujuan<textarea id="blueprint-goal" value={edits.plan?.goal ?? body.goal} maxLength={500} onChange={(event) => b.editPlan((plan) => ({ ...plan, goal: event.target.value }))} /></label>
        <label>{owner ? "Caption pertama" : "Caption pertama (tanpa angka/harga bebas)"}<textarea id="blueprint-caption" value={edits.plan?.contents[0]?.body ?? body.contents[0].body} maxLength={2200}
          onChange={(event) => b.editPlan((plan) => ({ ...plan, contents: plan.contents.map((content, index) => index === 0 ? { ...content, body: event.target.value } : content) }))} /></label>
        <label>Catatan revisi<textarea id="blueprint-notes" value={edits.notes} maxLength={500} onChange={(event) => b.setEdits({ ...edits, notes: event.target.value })} /></label>
        <label><input id="blueprint-replan" type="checkbox" checked={!edits.plan} onChange={(event) => b.setReplan(event.target.checked)} /> {owner ? "Susun ulang tugas dan caption dengan AI berdasarkan catatan. Edit manual di atas akan diganti." : "Susun ulang tugas/konten dari strategi dan catatan; mengganti edit manual plan"}</label>
        <button id="blueprint-save" type="submit" disabled={busy || stale || b.discountInvalid}>Simpan revisi baru</button>
      </form>
      <div className="blueprint-approval"><h3>{owner ? "Persetujuan pemilik" : "Approval pemilik"}</h3>
        {active.approval_status === "approved" ? <p>{owner ? `Versi ${active.version} disetujui pada ${active.approved_at ? time(active.approved_at) : "-"} WIB. Kampanye masih draf sampai Anda terbitkan.`
          : <>Blueprint v{active.version} approved oleh {active.approved_by_user_id} pada {active.approved_at && time(active.approved_at)} WIB. Campaign tetap draft.</>}</p>
          : <><label><input id="blueprint-confirm" type="checkbox" checked={b.confirm} onChange={(event) => b.setConfirm(event.target.checked)} /> Saya sudah meninjau seluruh versi ini dan menyetujui rencana ini.</label>
            <button id="blueprint-approve" disabled={busy || stale || !b.confirm} onClick={() => void b.approve()}>{owner ? `Setujui versi ${active.version}` : `Approve versi ${active.version}`}</button></>}
      </div>
    </>}
    {!owner && <label className="blueprint-scenario">Skenario provider blueprint<select id="blueprint-scenario" value={b.scenario} onChange={(event) => b.setScenario(z.enum(["valid", "failure", "invalid"]).parse(event.target.value))}>
      <option value="valid">Valid</option><option value="failure">Failure sintetis</option><option value="invalid">Output invalid sintetis</option></select></label>}
  </section>;
}
