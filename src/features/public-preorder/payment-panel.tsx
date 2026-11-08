"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { formatIdr } from "@/lib/format-idr";
import { formatWibDateTime } from "@/lib/wib-time";
import { continuePaymentAction, type PaymentPanelView } from "@/features/public-preorder/payment-actions";
import styles from "./public-preorder.module.css";

const SIMULATOR_URL = "https://simulator.sandbox.midtrans.com/qris/index";
// Hanya membaca database lewat halaman ini, tidak memanggil Midtrans (kontrak C5 §3).
const REFRESH_MS = 5_000;

const MESSAGES: Partial<Record<PaymentPanelView["kind"], string>> = {
  processing: "Pembayaran sedang disiapkan atau dicek. Coba lagi sebentar lagi.",
  provider_unavailable: "Layanan pembayaran Sandbox sedang tidak bisa dihubungi. Coba lagi sebentar lagi.",
  not_configured: "Pembayaran Sandbox belum diaktifkan oleh tim. Hubungi usaha untuk informasi pembayaran.",
  failed: "Pembayaran belum bisa diproses. Coba lagi sebentar lagi.",
  rate_limited: "Status sudah dicek beberapa kali. Halaman ini tetap memperbarui sendiri, coba cek lagi beberapa menit lagi.",
};

export function PaymentPanel({ token, totalIdr, paymentDueAt }: { token: string; totalIdr: number; paymentDueAt: string }) {
  const router = useRouter();
  const [view, setView] = useState<PaymentPanelView | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (checkStatus: boolean) => {
    startTransition(async () => {
      let next: PaymentPanelView;
      try {
        next = await continuePaymentAction(token, checkStatus);
      } catch {
        next = { kind: "failed" };
      }
      // Status final ada di database, jadi halaman dimuat ulang dan panel ini ikut hilang bila pesanan sudah tidak menunggu bayar.
      if (next.kind === "paid" || next.kind === "updated" || next.kind === "closed" || next.kind === "not_found") router.refresh();
      setView(next);
    });
  };

  const showingQr = view?.kind === "qr";
  useEffect(() => {
    if (!showingQr) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [showingQr, router]);

  if (view?.kind === "qr") {
    return (
      <div className={styles.checkout}>
        <p className={styles.orderTitle}>Bayar dengan QRIS Sandbox</p>
        <div className={styles.qrBox}>
          <Image src={view.qrImageUrl} alt="Kode QRIS untuk membayar pesanan ini" width={240} height={240} unoptimized className={styles.qrImage} />
        </div>
        <label className={styles.hint} htmlFor="qr-image-url">Alamat gambar QR untuk simulator</label>
        <input id="qr-image-url" readOnly value={view.qrImageUrl} className={styles.input} onFocus={(event) => event.currentTarget.select()} />
        <dl className={styles.summary}>
          <div className={styles.summaryTotal}><dt>Total</dt><dd>{formatIdr(view.amountIdr)}</dd></div>
          <div><dt>Bayar sebelum</dt><dd>{formatWibDateTime(view.expiresAt ?? paymentDueAt)}</dd></div>
        </dl>
        <p className={styles.hint}>
          Ini simulasi. Buka <a href={SIMULATOR_URL} target="_blank" rel="noopener noreferrer" className={styles.inlineLink}>simulator QRIS Midtrans Sandbox</a>, tempel alamat gambar QR di atas, lalu bayar di sana. Jangan memakai aplikasi pembayaran sungguhan.
        </p>
        <p className={styles.hint}>Halaman ini memperbarui status sendiri setelah pembayaran terverifikasi.</p>
        <button type="button" className={styles.secondary} onClick={() => run(true)} disabled={isPending}>
          {isPending ? "Mengecek…" : "Saya sudah bayar, cek status"}
        </button>
      </div>
    );
  }

  const message = view ? MESSAGES[view.kind] : undefined;
  return (
    <div className={styles.checkout}>
      <p className={styles.orderTitle}>Selesaikan pembayaran</p>
      <p className={styles.hint}>Total {formatIdr(totalIdr)}. Bayar sebelum {formatWibDateTime(paymentDueAt)}, setelah itu slot dilepas untuk pembeli lain.</p>
      {message && <div role="alert" className={styles.alert}><p>{message}</p></div>}
      <button type="button" className={styles.primary} onClick={() => run(false)} disabled={isPending}>
        {isPending ? "Menyiapkan QRIS…" : "Bayar dengan QRIS"}
      </button>
    </div>
  );
}
