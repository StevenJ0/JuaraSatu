"use client";

import { useActionState, useState } from "react";
import { SelectField, TextField, UnitsField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { initialFormState, type FormState } from "@/lib/form-state";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import { describeCapacitySchedule, suggestCapacitySchedule } from "@/features/capacity/schedule-form";

type CapacityScheduleValues = {
  totalUnits: string;
  intakeCutoff: string;
  fulfillmentWindowEndTime: string;
};

type CapacityFormProps = {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  totalUnitsHint: string;
  initialValues?: CapacityScheduleValues;
  /** Diisi saat membuat kapasitas; produk dan tanggal tidak bisa diubah setelah dibuat. */
  products?: { id: string; name: string }[];
  /** Tanggal paling awal yang bisa dipilih saat membuat kapasitas. */
  minDate?: string;
  /** Diisi saat mengubah kapasitas yang sudah ada. */
  existing?: { capacityId: string; version: number; fulfillmentDate: string };
};

export function CapacityForm({ action, submitLabel, totalUnitsHint, initialValues, products, minDate, existing }: CapacityFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialFormState);
  const values = state.values ?? initialValues;
  const [date, setDate] = useState(existing?.fulfillmentDate ?? "");
  const [cutoff, setCutoff] = useState(initialValues?.intakeCutoff ?? "");
  const [endTime, setEndTime] = useState(initialValues?.fulfillmentWindowEndTime ?? "");
  // Saran jadwal hanya mengisi kolom yang belum disentuh, agar isian pemilik tidak tertimpa saat tanggal diganti.
  const [hasEditedCutoff, setHasEditedCutoff] = useState(false);
  const [hasEditedEndTime, setHasEditedEndTime] = useState(false);

  function handleDateChange(value: string) {
    setDate(value);
    const suggestion = suggestCapacitySchedule(value, new Date());
    if (!hasEditedCutoff) setCutoff(suggestion.intakeCutoff);
    if (!hasEditedEndTime) setEndTime(suggestion.endTime);
  }

  const summary = describeCapacitySchedule(date, cutoff, endTime);
  // Pemilik bisa tidak sadar dua kolom jadwal terisi otomatis, jadi diberi tahu selama saran itu belum diubah.
  const showsSuggestion = !existing && date !== "" && ((!hasEditedCutoff && cutoff !== "") || (!hasEditedEndTime && endTime !== ""));

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {existing && (
        <>
          <input type="hidden" name="capacityId" value={existing.capacityId} />
          <input type="hidden" name="version" value={existing.version} />
          <input type="hidden" name="fulfillmentDate" value={existing.fulfillmentDate} />
        </>
      )}
      {products && (
        <>
          <SelectField
            name="productId"
            label="Produk"
            required
            defaultValue={state.values?.productId ?? ""}
            errors={state.fieldErrors?.productId}
          >
            <option value="">Pilih produk</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </SelectField>
          <TextField
            name="fulfillmentDate"
            label="Tanggal pengambilan"
            type="date"
            required
            min={minDate}
            hint="Hari pembeli mengambil pesanan. Batas melakukan pemesanan dan jam terakhir pengambilan terisi otomatis dan bisa diubah."
            value={date}
            onChange={(event) => handleDateChange(event.target.value)}
            errors={state.fieldErrors?.fulfillmentDate}
          />
        </>
      )}
      <UnitsField
        name="totalUnits"
        label="Jumlah unit yang bisa diproduksi"
        required
        hint={totalUnitsHint}
        defaultValue={values?.totalUnits}
        errors={state.fieldErrors?.totalUnits}
      />
      {showsSuggestion && (
        <p role="status" className="rounded-[10px] bg-[var(--ui-brand-soft)] px-3 py-2 text-base text-ink">
          Batas melakukan pemesanan dan jam terakhir pengambilan sudah diisi otomatis. Periksa dan ubah bila jadwal Anda berbeda.
        </p>
      )}
      <TextField
        name="intakeCutoff"
        label="Batas melakukan pemesanan (WIB)"
        type="datetime-local"
        required
        max={date ? `${date}T23:59` : undefined}
        hint={existing ? "Setelah waktu ini, pembeli tidak bisa memesan lagi."
          : "Terisi otomatis pukul 20.00 WIB sehari sebelum pengambilan dan bisa Anda ubah. Setelah waktu ini, pembeli tidak bisa memesan lagi."}
        value={cutoff}
        onChange={(event) => {
          setHasEditedCutoff(true);
          setCutoff(event.target.value);
        }}
        errors={state.fieldErrors?.intakeCutoff}
      />
      <TextField
        name="fulfillmentWindowEndTime"
        label="Jam terakhir pengambilan (WIB)"
        type="time"
        required
        hint={existing ? "Berlaku pada tanggal pengambilan." : "Terisi otomatis pukul 17.00 WIB dan bisa Anda ubah. Berlaku pada tanggal pengambilan."}
        value={endTime}
        onChange={(event) => {
          setHasEditedEndTime(true);
          setEndTime(event.target.value);
        }}
        errors={state.fieldErrors?.fulfillmentWindowEnd}
      />
      {summary && (
        <p className="rounded-[10px] bg-[var(--owner-highlight)] px-3 py-2 text-base text-ink">{summary}</p>
      )}
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Menyimpan…" : submitLabel}
      </button>
    </form>
  );
}
