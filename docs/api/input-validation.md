# B01 — Validasi field dan katalog error

Status: implementasi bagian independen B01; **kontrak C1–C8 dan integrasi belum final**. Acuan: PRD v2.1 §13.2–14 dan schema target v2.1. Base branch ini berasal dari main sebelum sinkronisasi dokumentasi B00; PRD/schema bawaan base belum menjadi bukti target v2.1 sudah terintegrasi. Perubahan ini tidak mengedit keduanya.

## Lingkup yang tersedia

`src/lib/input-validation.ts` menerima `unknown`, melakukan runtime narrowing dan mengembalikan discriminated result `success/value` atau `success/issue`. Ini hasil helper internal, bukan envelope HTTP atau keputusan authorization. Kegagalan memakai `VALIDATION_ERROR` dan pesan statis yang tidak menyalin data pelanggan.

| Fungsi | Aturan |
|---|---|
| `validateCustomerName` | Wajib string, trim, 1–120 Unicode code points; menolak karakter kontrol/format tersembunyi |
| `validateCustomerEmail` | Wajib string pada public checkout, trim, maksimum254; satu alamat menurut sintaks email HTML |
| `validateQuantity` | Number safe integer1–10.000, tanpa coercion |
| `validateMoneyIdr` | Number safe integer0–1.000.000.000; zero cost sah, null/unknown tidak berubah menjadi0 |
| `validatePositiveMoneyIdr` | Number safe integer1–1.000.000.000 untuk field harga yang harus positif |
| `validateDiscountBps` | Number safe integer0–9.999; tidak memeriksa biaya/contribution |
| `validatePreorderSlug` | String3–160, huruf kecil/angka/tanda hubung; tidak trim/lowercase diam-diam |

Kontrol/format Unicode dan pemisah baris ditolak **sebelum trim**, termasuk CRLF, tab, zero-width dan bidi controls. Casing nama dan local part email tidak diubah. Rendering plain text tetap harus escaped oleh UI; helper ini bukan HTML sanitizer.

Email mengikuti [definisi single email pada HTML Standard](https://html.spec.whatwg.org/multipage/input.html#valid-e-mail-address), dengan batas254 dari kebijakan aplikasi PRD. Sintaks HTML bukan implementasi seluruh sintaks RFC email: local part Unicode/quoted tidak didukung di helper ini; domain internasional perlu representasi ASCII/punycode. Alamat seperti `buyer@localhost` memenuhi sintaks HTML, tetapi belum tentu dapat dikirim. Keberadaan mailbox, kepemilikan, dan delivery tidak dibuktikan oleh validasi bentuk.

Batas uang di atas untuk field input, bukan batas keseluruhan omzet/aggregate analytics. Jangan memakai batas ini untuk memotong laporan bisnis. Slug bisnis memiliki batas kolom berbeda; fungsi preorder tidak dipakai untuk slug bisnis.

`src/lib/error-codes.ts` mengekspor 17 kode PRD, union `AppErrorCode` dan guard `isAppErrorCode`. Tidak ada enum status DB baru atau pemetaan HTTP otomatis; respons private unknown/forbidden perlu privacy policy pada endpoint terkait.

## Batas penggunaan

Validator numerik menolak semua string termasuk `"12"`, `"12abc"`, `"12e3"`, boolean dan null. Input form masih perlu parsing tekstual yang eksplisit di boundary UI; jangan memanggil `Number`/`parseInt` dahulu sehingga input tidak valid tersamarkan. Setelah JSON sudah menjadi number, helper tidak membedakan penulisan angka asal, misalnya1000 versus1e3.

Belum ada parser object request/DTO public/checkout/tracking, allowlist field object, token encoding/hash, idempotency payload atau provider facts. Jangan menganggap pemanggilan satu field validator sudah menolak extra privileged fields pada seluruh request.

Pemeriksaan berikut tetap milik use case/backend: authorization/tenant, unique slug, current quote/price, available quantity, contribution positif, row version, atomic order/reservation/payment, audit dan email enqueue. Hasil valid di sini tidak mengizinkan operasi bisnis tersebut. Tidak ada Supabase/SDK/provider/env access, SQL, calculator harga atau side effect.

## Pengujian

```bash
node --test tests/input-validation.test.mjs
npm run lint
npx next typegen
npx tsc --noEmit --incremental false
```

Tests memakai runner bawaan Node dan TypeScript yang sudah tercantum dalam devDependencies. Modul pure ditranspile dalam memori agar tidak menambah framework, mengubah tsconfig, atau menghasilkan build files. Ini belum pengganti setup Vitest fondasi tim. Node yang benar-benar dipakai saat verifikasi dicatat di bawah.

Kasus mencakup batas min/max, non-finite/fractional/unsafe numbers, coercion trap, mandatory email, panjang/Unicode/control characters, no PII echo, perbedaan unknown dan known-zero cost, slug serta katalog kode. Data pengujian sintetis; tidak berhubungan dengan database/provider.

## Verifikasi aktual

Tanggal: 2 November 2026. Runtime yang digunakan: Node v24.11.0.

| Pemeriksaan | Hasil |
|---|---|
| `node --test tests/input-validation.test.mjs` | PASS: 171 tests, tanpa skipped/failure |
| `npm run lint` | PASS |
| `npx next typegen` | PASS: menghasilkan route types dan next-env lokal yang di-ignore |
| `npx tsc --noEmit --incremental false` | PASS setelah typegen |
| Whitespace file B01 | PASS |
| Scope dan privasi | Empat file baru saja; tanpa path laptop atau catatan individu; package/lock/config/SQL tidak berubah |

Typecheck pertama sebelum typegen menemukan `LayoutProps` belum tersedia pada starter yang baru di-checkout. Diselesaikan dengan generasi tipe Next.js, bukan edit komponen/tsconfig. File generated tidak masuk patch.

Tidak menjalankan build aplikasi, browser E2E, database atau provider pada tugas pure helpers ini. UI dan wiring aplikasi tidak berubah. Hasil unit test tidak membuktikan otorisasi tenant, atomic reservation/payment, delivery email atau query analytics.

Bagian independen B01 siap direview; B01 secara keseluruhan tetap menunggu kontrak producer/consumer dan fondasi yang dikonfirmasi. Tidak ada staging/commit/push/merge/deploy.

## Pembaruan kontrak C5 — 5 November 2026

Kesepakatan perilaku payment attempt, verified apply, tracking, dan durable email dicatat pada [C5 — kontrak pembayaran](payment-integration.md), berdasarkan konfirmasi pengguna bahwa Rafi dan Indro menyetujui usulan integrasi.

Ini penutupan bagian kesepakatan perilaku C5, bukan seluruh B01. Signature RPC/export/types final masih mengikuti R5; database/provider belum diuji. Kontrak C1–C4/C6–C8 dan perbedaan helper B01 dengan producer R4 tetap harus diperiksa saat integrasi; jangan menimpa validator producer secara otomatis.

Perubahan putaran ini hanya dokumentasi. Tidak mengubah schema/SQL, helper, dependency, atau konfigurasi; tidak membaca secret, menjalankan preview, atau memanggil API transaksi provider.
