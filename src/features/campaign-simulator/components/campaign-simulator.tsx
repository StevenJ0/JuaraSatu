"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import {
  SimulationFactsSchema, SimulationFormSchema,
  type SimulationFacts, type SimulationFormValues, type SimulationResult,
} from "../contracts";
import { compareScenarios, simulateCampaign } from "../simulate";
import "./simulator.css";

const initialValues: SimulationFormValues = {
  discountPercent: "10", assumedAdditionalUnits: "8", assumedPromotionCostIdr: "50000",
};
const initialComparisonValues: SimulationFormValues[] = [
  { discountPercent: "0", assumedAdditionalUnits: "4", assumedPromotionCostIdr: "0" },
  { discountPercent: "5", assumedAdditionalUnits: "6", assumedPromotionCostIdr: "25000" },
];
const money = new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
});
const dateTime = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
});
function formatMoney(value: number | null) {
  return value === null ? "Belum diketahui" : money.format(value);
}
function percent(bps: number) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(bps / 100);
}

export function CampaignSimulator({ facts: factsInput }: { facts: unknown }) {
  if (factsInput === null) {
    return <main className="simulator-workspace" lang="id"><h1>Data preorder belum tersedia</h1>
      <p>Simulator memerlukan snapshot harga, biaya, dan slot dari sumber server.</p></main>;
  }
  const parsed = SimulationFactsSchema.safeParse(factsInput);
  if (!parsed.success) {
    return <main className="simulator-workspace" lang="id"><h1>Data simulator tidak dapat dibaca</h1>
      <p role="alert">Snapshot tidak valid. Muat ulang data sebelum mencoba simulasi.</p></main>;
  }
  return <SimulationEditor facts={parsed.data} />;
}

function SimulationEditor({ facts }: { facts: SimulationFacts }) {
  function withinCapacity(values: SimulationFormValues) {
    return { ...values, assumedAdditionalUnits: String(Math.min(Number(values.assumedAdditionalUnits), facts.orderableUnits)) };
  }
  const [values, setValues] = useState<SimulationFormValues>(() => withinCapacity(initialValues));
  const [comparisonValues, setComparisonValues] = useState(() => initialComparisonValues.map(withinCapacity));
  const [showComparison, setShowComparison] = useState(false);
  const errorSummary = useRef<HTMLDivElement>(null);
  const comparisonErrorSummary = useRef<HTMLDivElement>(null);
  const maxUnits = Math.min(facts.orderableUnits, 10_000);
  const formSchema = SimulationFormSchema.refine((scenario) => scenario.assumedAdditionalUnits <= maxUnits, {
    path: ["assumedAdditionalUnits"], message: `Asumsi unit tidak boleh melebihi ${maxUnits} slot pada snapshot ini.`,
  });
  const form = formSchema.safeParse(values);
  const result = form.success ? simulateCampaign(facts, form.data) : null;
  const comparisonForms = comparisonValues.map((values) => formSchema.safeParse(values));
  const comparisonInputs = comparisonForms.flatMap((parsed) => parsed.success ? [parsed.data] : []);
  const comparison = showComparison && form.success && comparisonInputs.length === comparisonValues.length
    ? compareScenarios(facts, [...comparisonInputs, form.data]) : null;

  function fieldError(field: keyof SimulationFormValues, parsed = form) {
    if (parsed.success) return null;
    const issue = parsed.error.issues.find((issue) => issue.path[0] === field);
    if (!issue) return null;
    if (field === "discountPercent") return "Isi diskon 0–99,99%, maksimal dua angka desimal.";
    if (field === "assumedAdditionalUnits" && issue.code === "custom") return issue.message;
    if (field === "assumedAdditionalUnits") return "Isi bilangan bulat 0–10.000, tanpa pemisah ribuan.";
    return "Isi biaya Rp0–Rp1 miliar dengan angka bulat, tanpa pemisah ribuan.";
  }
  const fields = [
    { name: "discountPercent", label: "Diskon hipotetis (%)", hint: "0% untuk harga normal. Gunakan koma atau titik untuk desimal.", inputMode: "decimal" },
    { name: "assumedAdditionalUnits", label: "Asumsi tambahan unit", hint: `Tersedia ${facts.orderableUnits} slot pada snapshot. Ini bukan prediksi pembeli.`, inputMode: "numeric" },
    { name: "assumedPromotionCostIdr", label: "Asumsi biaya promosi (Rp)", hint: "Contoh: 50000. Belum dicatat sebagai biaya aktual.", inputMode: "numeric" },
  ] satisfies ReadonlyArray<{
    name: keyof SimulationFormValues; label: string; hint: string; inputMode: "decimal" | "numeric";
  }>;

  function inputField(
    field: (typeof fields)[number], inputValues: SimulationFormValues, parsed: typeof form,
    prefix: string, onChange: (values: SimulationFormValues) => void,
  ) {
    const id = `${prefix}${field.name}`;
    const error = fieldError(field.name, parsed);
    return <div className="simulator-field" key={field.name}>
      <label htmlFor={id}>{field.label}</label>
      <input id={id} name={id} type="text" inputMode={field.inputMode}
        autoComplete="off" value={inputValues[field.name]} aria-invalid={Boolean(error)}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        onChange={(event) => onChange({ ...inputValues, [field.name]: event.target.value })} />
      <p id={`${id}-hint`} className="simulator-hint">{field.hint}</p>
      {error && <p id={`${id}-error`} className="simulator-fieldError">{error}</p>}
    </div>;
  }

  function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.success) { errorSummary.current?.focus(); return; }
    if (showComparison && comparisonInputs.length !== comparisonValues.length) {
      comparisonErrorSummary.current?.focus(); return;
    }
    setShowComparison(true);
  }

  return <main className="simulator-workspace" lang="id">
    <a className="simulator-skipLink" href="#scenario-form">Langsung ke asumsi skenario</a>
    <div className="simulator-container">
      <div className="simulator-previewNotice">
        <strong>{facts.snapshot.provenance === "development_fixture" ? "Preview development · Data sintetis" : "Simulasi dari snapshot server"}</strong>
        <span>Perhitungan lokal. Tidak mengubah preorder, campaign, atau transaksi.</span>
      </div>
      <header className="simulator-header">
        <Link className="simulator-brand" href="/">Campaign Lab</Link>
        <h1>Simulator campaign</h1>
        <p>Bandingkan konsekuensi penawaran sebelum membuat keputusan promosi.</p>
      </header>

      <section className="simulator-facts" aria-labelledby="facts-title">
        <div className="simulator-sectionHeading">
          <div><h2 id="facts-title">Fakta preorder</h2><p>{facts.preorderName} · {facts.productName}</p></div>
          <span className="simulator-readOnly">Sumber data · tidak dapat diedit</span>
        </div>
        <dl className="simulator-factsGrid">
          <div><dt>Harga dasar preorder</dt><dd>{formatMoney(facts.baseUnitPriceIdr)}</dd><p>Dibekukan saat publish preorder</p></div>
          <div><dt>Penawaran saat ini</dt><dd>{facts.currentOffer ? formatMoney(facts.currentOffer.unitPriceIdr) : "Belum tersedia"}</dd>
            <p>{facts.currentOffer ? `Diskon ${percent(facts.currentOffer.offer.discountBps)}% dari harga dasar` : "Menunggu data Offer Resolver C8"}</p></div>
          <div><dt>Biaya variabel / unit</dt><dd>{formatMoney(facts.variableCostIdr)}</dd>
            <p>{facts.costQuality === "verified" ? "Biaya terverifikasi pada sumber" : facts.costQuality === "estimated" ? "Biaya masih berupa estimasi" : "Kontribusi belum dapat dihitung"}</p></div>
          <div><dt>Slot dapat dipesan</dt><dd>{facts.orderableUnits} unit</dd><p>Setelah alokasi dan hold efektif</p></div>
        </dl>
        <p className="simulator-snapshot">Snapshot: {dateTime.format(new Date(facts.snapshot.calculatedAt))} WIB.
          {facts.snapshot.provenance === "development_fixture" && " Waktu fixture, bukan kondisi terkini."}
          {" "}Intake berakhir {dateTime.format(new Date(facts.endsAt))} WIB.</p>
      </section>

      <div className="simulator-editorGrid">
        <section className="simulator-formPanel" aria-labelledby="form-title">
          <h2 id="form-title">Asumsi skenario</h2>
          <p className="simulator-intro">Ubah asumsi. Hasil dihitung ulang tanpa memanggil AI.</p>
          <form id="scenario-form" onSubmit={compare} noValidate>
            {!form.success && <div className="simulator-errorSummary" tabIndex={-1} ref={errorSummary} role="alert">
              <strong>Periksa input skenario</strong>
              <ul>{fields.filter((field) => fieldError(field.name)).map((field) =>
                <li key={field.name}><a href={`#${field.name}`}>{fieldError(field.name)}</a></li>)}</ul>
            </div>}
            {fields.map((field) => inputField(field, values, form, "", setValues))}
            <div className="simulator-actions">
              <button className="simulator-primaryButton" type="submit">Bandingkan 3 skenario</button>
              <button className="simulator-secondaryButton" type="button" onClick={() => {
                setValues(withinCapacity(initialValues));
                setComparisonValues(initialComparisonValues.map(withinCapacity)); setShowComparison(false);
              }}>Reset input</button>
            </div>
          </form>
        </section>

        <section className="simulator-resultPanel" aria-labelledby="result-title">
          <h2 id="result-title">Rincian skenario</h2>
          {!form.success && <p role="status">Perbaiki input untuk melihat perhitungan terbaru.</p>}
          {result && !result.success && <div role="alert" className="simulator-errorSummary">
            <strong>Skenario belum dapat dihitung</strong>
            <ul>{result.errors.map((error, index) => <li key={index}>{error.message}</li>)}</ul>
          </div>}
          {result?.success && <>
            <p className="simulator-intro">Diskon {percent(result.data.hypotheticalOffer.discountBps)}% dihitung dari harga dasar
              {" "}{formatMoney(result.data.frozenBaseUnitPriceIdr)}, bukan dari harga promo aktif.</p>
            <dl className="simulator-unitPrices">
              <div><dt>Harga hipotetis / unit</dt><dd data-testid="hypothetical-price">{formatMoney(result.data.hypotheticalFinalUnitPriceIdr)}</dd></div>
              <div><dt>Diskon / unit</dt><dd>{formatMoney(result.data.discountPerUnitIdr)}</dd></div>
              <div><dt>Kontribusi / unit</dt><dd>{formatMoney(result.data.contributionPerUnitIdr)}</dd></div>
            </dl>
            <dl className="simulator-breakdown">
              <div><dt>Pendapatan skenario · {result.data.assumedAdditionalUnits} unit</dt><dd>{formatMoney(result.data.scenarioRevenueIdr)}</dd></div>
              <div><dt>Biaya variabel skenario</dt><dd>{formatMoney(result.data.scenarioVariableCostIdr)}</dd></div>
              <div><dt>Asumsi biaya promosi</dt><dd>{formatMoney(result.data.assumedPromotionCostIdr)}</dd></div>
              <div className="simulator-contribution"><dt>Kontribusi setelah promosi</dt>
                <dd data-testid="scenario-contribution" aria-live="polite" aria-atomic="true">{formatMoney(result.data.scenarioContributionIdr)}</dd></div>
            </dl>
            <p className="simulator-hint">Estimasi kontribusi sebelum biaya lain, bukan laba bersih atau pendapatan nyata.</p>
            {result.data.blockers.length > 0 && <div className="simulator-blockers" role="alert">
              <h3>Skenario memiliki blocker</h3><ul>{result.data.blockers.map((item, index) => <li key={index}>{item.message}</li>)}</ul>
            </div>}
            {result.data.warnings.length > 0 && <div className="simulator-warnings">
              <h3>Hal yang perlu diperhatikan</h3><ul>{result.data.warnings.map((item, index) => <li key={index}>{item.message}</li>)}</ul>
            </div>}
            <p className="simulator-status">{result.data.feasible ? "Tidak ada blocker pada snapshot ini." : "Perbaiki blocker sebelum memakai skenario untuk perencanaan."}</p>
            <ul className="simulator-assumptions">{result.data.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
          </>}
        </section>
      </div>

      {showComparison && <section className="simulator-comparison" aria-labelledby="comparison-title">
        <h2 id="comparison-title">Perbandingan skenario</h2>
        <p>Atur unit tambahan dan biaya promosi masing-masing alternatif. Semuanya asumsi hipotetis, bukan prediksi permintaan.</p>
        <p>Kolom harga normal dengan biaya Rp0 memodelkan baseline tanpa promosi tambahan. Isi biaya di atas Rp0 untuk memodelkan campaign harga normal.</p>
        <div className="simulator-comparisonInputs">
          {comparisonValues.map((inputValues, index) => {
            const parsed = comparisonForms[index];
            if (!parsed) return null;
            return <fieldset key={index}>
              <legend>{index === 0 ? "Harga normal (0%)" : "Diskon 5%"}</legend>
              {fields.filter((field) => field.name !== "discountPercent").map((field) =>
                inputField(field, inputValues, parsed, `comparison-${index}-`, (next) =>
                  setComparisonValues((current) => current.map((value, i) => i === index ? next : value))))}
            </fieldset>;
          })}
        </div>
        <p>Kolom Skenario Anda memakai input pada <a href="#scenario-form">form asumsi skenario</a> di atas, termasuk diskon 0% untuk campaign harga normal.</p>
        {comparisonInputs.length !== comparisonValues.length && <div className="simulator-errorSummary" ref={comparisonErrorSummary} tabIndex={-1} role="alert">
          <strong>Periksa asumsi perbandingan</strong>
          <ul>{comparisonForms.flatMap((parsed, index) => fields.filter((field) => fieldError(field.name, parsed)).map((field) =>
            <li key={`${index}-${field.name}`}><a href={`#comparison-${index}-${field.name}`}>
              {index === 0 ? "Harga normal" : "Diskon 5%"}: {fieldError(field.name, parsed)}</a></li>))}</ul>
        </div>}
        {comparison?.success && comparison.data.warnings.map((warning) =>
          <p className="simulator-warnings" role="status" key={warning.code}>{warning.message} Perbedaan hasil tidak membuktikan efek promosi.</p>)}
        <p className="simulator-mobileHint">Geser tabel untuk melihat semua skenario pada layar kecil.</p>
        {comparison?.success ? <Comparison scenarios={comparison.data.scenarios} />
          : <p role="status">Perbaiki input agar semua skenario dapat dibandingkan dalam batas nominal.</p>}
      </section>}
    </div>
  </main>;
}

function Comparison({ scenarios }: { scenarios: SimulationResult[] }) {
  const rows = [
    { label: "Harga hipotetis / unit", value: (s: SimulationResult) => formatMoney(s.hypotheticalFinalUnitPriceIdr) },
    { label: "Tambahan unit (asumsi)", value: (s: SimulationResult) => `${s.assumedAdditionalUnits} unit` },
    { label: "Pendapatan skenario", value: (s: SimulationResult) => formatMoney(s.scenarioRevenueIdr) },
    { label: "Biaya variabel skenario", value: (s: SimulationResult) => formatMoney(s.scenarioVariableCostIdr) },
    { label: "Asumsi biaya promosi", value: (s: SimulationResult) => formatMoney(s.assumedPromotionCostIdr) },
    { label: "Kontribusi setelah promosi", value: (s: SimulationResult) => formatMoney(s.scenarioContributionIdr) },
  ];
  return <div className="simulator-tableScroll" role="region" aria-label="Tabel perbandingan skenario, dapat digeser" tabIndex={0}>
    <table>
      <caption>Hasil bersyarat dari asumsi, bukan prediksi penjualan. Tidak ada skenario dipilih otomatis.</caption>
      <thead><tr><th scope="col">Komponen</th>{scenarios.map((scenario, index) =>
        <th scope="col" key={index}>{index === 0
          ? scenario.assumedPromotionCostIdr === 0 ? "Tanpa promosi (baseline hipotetis)" : "Campaign harga normal (0%)"
          : index === 1 ? "Diskon 5%" : `Skenario Anda (${percent(scenario.hypotheticalOffer.discountBps)}%)`}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>
        {scenarios.map((scenario, index) => <td key={index}>{row.value(scenario)}</td>)}</tr>)}
        <tr><th scope="row">Batasan dan perhatian</th>{scenarios.map((scenario, index) => <td key={index}>
          {scenario.blockers.length + scenario.warnings.length === 0 ? "Tidak ada blocker pada snapshot." : <ul>
            {scenario.blockers.map((item, i) => <li key={`b${i}`}>Blocker: {item.message}</li>)}
            {scenario.warnings.map((item, i) => <li key={`w${i}`}>{item.message}</li>)}
          </ul>}
        </td>)}</tr>
      </tbody>
    </table>
  </div>;
}
