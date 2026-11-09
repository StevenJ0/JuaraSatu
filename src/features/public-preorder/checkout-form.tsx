"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatIdr } from "@/lib/format-idr";
import { sanitizeUnitsInput } from "@/lib/units-input";
import { placeBuyerOrderAction, type CheckoutResult } from "@/features/public-preorder/actions";
import { finishCheckoutIntent, loadCheckoutIntent, loadLastOrderToken, rememberAttributionRef, type CheckoutIntent } from "@/features/public-preorder/checkout-intent";
import type { CheckoutField } from "@/features/public-preorder/schemas";
import styles from "./public-preorder.module.css";

type CheckoutFormProps = {
  slug: string;
  unitPriceIdr: number;
  orderableUnits: number;
  /** Slug kampanye dari tautan `?ref=`. Hanya mencatat asal pesanan; harga tetap dari server. */
  attributionRef: string | null;
};

type Values = { customerName: string; customerEmail: string; customerContact: string; quantity: string };
const EMPTY: Values = { customerName: "", customerEmail: "", customerContact: "", quantity: "1" };
type Rejected = Extract<CheckoutResult, { status: "rejected" }>;

// sessionStorage tidak memberi kabar perubahan dari tab yang sama, dan halaman pindah setelah pesanan dibuat.
const subscribeNothing = () => () => {};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Cek ringan sebelum ringkasan, agar pembeli tidak menunggu server untuk kesalahan yang jelas. Aturan final tetap di server. */
function checkLocally(values: Values, orderableUnits: number): Partial<Record<CheckoutField, string[]>> {
  const errors: Partial<Record<CheckoutField, string[]>> = {};
  if (values.customerName.trim() === "") errors.customerName = ["Nama pemesan wajib diisi"];
  if (!EMAIL_PATTERN.test(values.customerEmail.trim())) errors.customerEmail = ["Isi email yang valid untuk menerima konfirmasi"];
  const quantity = Number(values.quantity);
  if (!/^[1-9]\d*$/.test(values.quantity)) errors.quantity = ["Isi jumlah dengan angka bulat, minimal 1"];
  else if (quantity > orderableUnits) errors.quantity = [`Sisa saat ini ${orderableUnits} unit`];
  return errors;
}

export function CheckoutForm({ slug, unitPriceIdr, orderableUnits, attributionRef }: CheckoutFormProps) {
  const router = useRouter();
  const lastOrderToken = useSyncExternalStore(subscribeNothing, () => loadLastOrderToken(slug), () => null);
  const [conflictToken, setConflictToken] = useState<string | null>(null);
  const [values, setValues] = useState<Values>(EMPTY);
  const [step, setStep] = useState<"form" | "review">("form");
  const [rejected, setRejected] = useState<Rejected | null>(null);
  const [isPending, startTransition] = useTransition();
  const activeIntent = useRef<{ slug: string; intent: CheckoutIntent } | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (activeIntent.current?.slug !== slug) activeIntent.current = { slug, intent: loadCheckoutIntent(slug) };
  }, [slug]);

  // Ref dari tautan kampanye disimpan untuk tab ini, sehingga tetap terbawa bila pembeli kembali lewat tautan biasa.
  useEffect(() => {
    rememberAttributionRef(slug, attributionRef);
  }, [slug, attributionRef]);

  const quantity = /^[1-9]\d*$/.test(values.quantity) ? Number(values.quantity) : 0;
  const fieldErrors = rejected?.fieldErrors ?? {};
  const update = (field: keyof Values, value: string) => {
    setValues((current) => ({ ...current, [field]: field === "quantity" ? sanitizeUnitsInput(value) : value }));
  };

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = checkLocally(values, orderableUnits);
    if (Object.keys(errors).length > 0) {
      setRejected({ status: "rejected", code: "VALIDATION_ERROR", message: "Periksa lagi isian yang ditandai.", fieldErrors: errors });
      return;
    }
    setRejected(null);
    setStep("review");
  };

  const submit = () => {
    if (submitting.current) return;
    submitting.current = true;
    // Niat yang sama dipakai sampai pesanan tercatat, jadi kirim ulang setelah respons hilang tidak membuat pesanan kedua.
    if (activeIntent.current?.slug !== slug) activeIntent.current = { slug, intent: loadCheckoutIntent(slug) };
    const intent = activeIntent.current.intent;
    const ref = rememberAttributionRef(slug, attributionRef);
    const formData = new FormData();
    formData.set("slug", slug);
    formData.set("idempotencyKey", intent.idempotencyKey);
    formData.set("privateToken", intent.token);
    formData.set("customerName", values.customerName);
    formData.set("customerEmail", values.customerEmail);
    formData.set("customerContact", values.customerContact);
    formData.set("quantity", values.quantity);
    formData.set("expectedUnitPriceIdr", String(unitPriceIdr));
    formData.set("attributionRef", ref ?? "");
    startTransition(async () => {
      let result: CheckoutResult;
      try {
        result = await placeBuyerOrderAction(formData);
      } catch {
        // Respons hilang: token dan kunci tetap sama, jadi kirim ulang aman.
        result = { status: "rejected", code: "FAILED", message: "Koneksi terputus. Kirim lagi, pesananmu tidak akan tercatat dua kali." };
      }
      if (result.status === "ok") {
        activeIntent.current = { slug, intent: finishCheckoutIntent(slug, intent.token) };
        router.push(`/o/${intent.token}`);
        return;
      }
      setRejected(result);
      setConflictToken(result.code === "IDEMPOTENCY_CONFLICT" ? intent.token : null);
      if (result.fieldErrors) setStep("form");
      // Harga atau sisa berubah: muat ulang data server, isian pembeli tetap.
      if (result.code === "OFFER_CHANGED" || result.code === "CAPACITY_UNAVAILABLE") {
        setStep("form");
        router.refresh();
      }
      submitting.current = false;
    });
  };

  const errorFor = (field: CheckoutField) => fieldErrors[field]?.join(" ");
  const fieldProps = (field: keyof Values) => ({
    id: field,
    name: field,
    value: values[field],
    onChange: (event: { target: { value: string } }) => update(field, event.target.value),
    className: styles.input,
    "aria-invalid": errorFor(field) ? true : undefined,
    "aria-describedby": errorFor(field) ? `${field}-error` : undefined,
  });

  return (
    <div className={styles.checkout}>
      <p className={styles.orderTitle}>Pesan sekarang</p>
      {lastOrderToken && (
        <p className={styles.lastOrder}>
          Pesananmu di tab ini sudah tercatat. <Link href={`/o/${lastOrderToken}`}>Lihat pesanan terakhir</Link>
        </p>
      )}
      {rejected && (
        <div role="alert" className={styles.alert}>
          <p>{rejected.message}</p>
          {conflictToken && <Link href={`/o/${conflictToken}`} className={styles.textLink}>Lihat pesanan yang sudah tercatat</Link>}
        </div>
      )}

      {step === "form" ? (
        <form onSubmit={review} noValidate className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="quantity">Jumlah (unit)</label>
            <input {...fieldProps("quantity")} inputMode="numeric" autoComplete="off" required />
            <p className={styles.hint}>Sisa saat ini {orderableUnits} unit.</p>
            {errorFor("quantity") && <p id="quantity-error" className={styles.error}>{errorFor("quantity")}</p>}
          </div>
          <div className={styles.field}>
            <label htmlFor="customerName">Nama pemesan</label>
            <input {...fieldProps("customerName")} autoComplete="name" maxLength={160} required />
            {errorFor("customerName") && <p id="customerName-error" className={styles.error}>{errorFor("customerName")}</p>}
          </div>
          <div className={styles.field}>
            <label htmlFor="customerEmail">Email</label>
            <input {...fieldProps("customerEmail")} type="email" autoComplete="email" maxLength={254} required />
            <p className={styles.hint}>Rincian pesanan dikirim ke email ini setelah pembayaran terverifikasi.</p>
            {errorFor("customerEmail") && <p id="customerEmail-error" className={styles.error}>{errorFor("customerEmail")}</p>}
          </div>
          <div className={styles.field}>
            <label htmlFor="customerContact">Kontak pengambilan (opsional)</label>
            <input {...fieldProps("customerContact")} autoComplete="tel" maxLength={120} />
            <p className={styles.hint}>Contoh: WhatsApp 0812-xxxx.</p>
            {errorFor("customerContact") && <p id="customerContact-error" className={styles.error}>{errorFor("customerContact")}</p>}
          </div>
          <p className={styles.totalLine}>
            <span>Perkiraan total</span>
            <strong>{formatIdr(quantity * unitPriceIdr)}</strong>
          </p>
          <button type="submit" className={styles.primary}>Lanjut ke ringkasan</button>
        </form>
      ) : (
        <div className={styles.review}>
          <dl className={styles.summary}>
            <div><dt>Jumlah</dt><dd>{quantity} unit × {formatIdr(unitPriceIdr)}</dd></div>
            <div><dt>Nama</dt><dd>{values.customerName.trim()}</dd></div>
            <div><dt>Email</dt><dd>{values.customerEmail.trim()}</dd></div>
            {values.customerContact.trim() !== "" && <div><dt>Kontak</dt><dd>{values.customerContact.trim()}</dd></div>}
            <div className={styles.summaryTotal}><dt>Total</dt><dd>{formatIdr(quantity * unitPriceIdr)}</dd></div>
          </dl>
          <p className={styles.hint}>Total final dihitung server saat pesanan dibuat. Setelah itu kamu punya waktu terbatas untuk membayar.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={submit} disabled={isPending}>
              {isPending ? "Membuat pesanan…" : "Buat pesanan"}
            </button>
            <button type="button" className={styles.secondary} onClick={() => setStep("form")} disabled={isPending}>Ubah isian</button>
          </div>
        </div>
      )}
    </div>
  );
}
