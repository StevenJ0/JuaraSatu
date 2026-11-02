# Landing platform — Campaign Lab v2.1

Scope B02: route `/`, identity/copy, static presentation fixture and accessible navigation. Acuan produk: PRD v2.1 §16.5 dan §17.

## Perilaku dan posisi produk

Landing menjelaskan platform untuk UMKM produk standar berbasis preorder, dengan contoh kaos. Preorder dapat dibuka tanpa AI/campaign; promosi memakai preorder yang sama. Target adalah paid units, bukan MOQ. Status dibayar tidak sama dengan pemenuhan.

Alur yang dijelaskan: buka preorder → kelola pesanan/pembayaran/email/pemenuhan → tinjau strategi dan simulasi, pilih proposal, approve blueprint, publish campaign → baca laporan dan evaluasi. AI menyarankan; kode menentukan uang/kapasitas/KPI; pemilik mengambil keputusan.

Halaman masih pratinjau. Semua CTA menuju anchor yang benar-benar ada. Tidak ada auth/checkout/order/payment/email/Gemini/database request atau kontrol transaksi palsu. Label data sintetis dan keterbatasan integrasi selalu terlihat. Tidak ada testimoni, klaim kenaikan omzet, atau kesan data usaha nyata.

## Visual dan komponen

Fondasi yang ada dipertahankan: hijau hutan `#285b43`, putih hangat `#f8f9f5`, aprikot `#f4c994`, semantic tokens `--ui-*`, heading Georgia khusus landing dan body Arial/Helvetica. Tidak menambah dependency, font/image eksternal atau library chart. Logo SVG bekerja sebagai monogram C/L dan icon produk; favicon starter dihapus agar tidak menampilkan identitas Next.js.

Komposisi: split hero dengan preview preorder, masalah operasional, empat langkah, simulasi penawaran, dua laporan, CTA penutup. Petak kapasitas tetap motif utama; held dibedakan dengan warna/border serta label teks, bukan warna saja. Dua laporan disusun vertikal agar tetap terbaca di mobile; bukan KPI pelangi atau grafik dekoratif.

`LandingPage`, `ProductPreview`, `OfferBreakdown`, dan `ResultPreview` memakai Server Components. Hanya `MobileNavigation` client untuk Escape/outside close; native details tetap berfungsi tanpa JS. Semantic figure/dl/progress illustration, satu h1, skip link, sticky-header scroll offset, focus visible dan reduced motion dipertahankan.

Skill ui-ux-pro-max dipakai untuk panduan Next.js server-component boundary dan focus tidak tertutup sticky UI. Hasil relevan pada web; panduan native app tidak dipaksakan. Dokumen Next.js terbundel diperiksa untuk Server Components dan metadata. Tidak mengganti tokens dari rekomendasi generik.

## Sumber tunggal angka sintetis

`src/features/marketing/demo-data.ts` hanya fixture presentasi, bukan calculator produksi. Jangan digunakan oleh checkout/payment/analytics bisnis. Calculator bersama dan DTO nyata dikerjakan pada modul integrasi terpisah.

| Tahap | Angka dan arti |
|---|---|
| Awal preorder mandiri | Kapasitas/kuota/target40, paid30, held2 → target gap10 tetapi available8; harga normal120.000 |
| Sebelum campaign | Dua hold dilepas, sehingga available10. Target tambahan10; diskon10% berlaku untuk semua checkout baru |
| Penawaran | Harga108.000 setelah diskon12.000 per unit; biaya75.000 → kontribusi33.000/unit |
| Periode campaign | Tambahan paid8, di antaranya5 attributed dan3 unattributed; semua8 mendapat diskon |
| Akhir preorder | Paid38/40=95%, held0, tersedia2. Snapshot ini mengasumsikan seluruh38 sudah diserahkan; paid dan fulfilled tetap metrik berbeda |
| Lingkup campaign | Revenue864.000−production600.000−actual promotion50.000=contribution214.000 |
| Seluruh preorder | Revenue4.464.000−production2.850.000−actual promotion50.000=contribution1.564.000 |

Biaya contoh diasumsikan lengkap; kontribusi sebelum biaya lain bukan laba bersih. Laporan periode merupakan bagian dari laporan preorder, jangan dijumlahkan. Tambahan dalam window/attribution tidak membuktikan efek kausal diskon. Tidak ada pembayaran nyata.

## Menjalankan dan memeriksa

Gunakan dependency sesuai lockfile aktual. Command relevan:

```bash
npm run lint
npx tsc --noEmit --incremental false
node scripts/check-landing-demo.mjs
npm run build -- --webpack
npm run start -- --hostname 127.0.0.1 --port 3002
```

Build memakai Webpack untuk jalur verifikasi ini; bukan pernyataan hasil Turbopack. Fixture test memeriksa 22 golden assertions presentasi saja, bukan financial engine/SQL/provider.

Target browser: mobile320/375/390, tablet768, desktop1440; landscape dan zoom200%; overflow, semua anchor, keyboard menu/skip, reduced motion, no-JS, metadata, status/label dan console/network errors. Screenshot/checks pada `docs/screenshots/landing/` adalah bukti versi lama; tidak boleh diklaim sebagai pengujian ulang B02. Bukti B02, jika berhasil dijalankan, disimpan pada `docs/screenshots/landing-v2/`.

## Verifikasi B02 — 2 November 2026

| Pemeriksaan | Hasil aktual |
|---|---|
| `npm run lint` | PASS |
| `npx tsc --noEmit --incremental false` | PASS; build juga menyelesaikan TypeScript |
| `node scripts/check-landing-demo.mjs` | PASS, 22 golden assertions pada data sintetis |
| `npm run build -- --webpack` | PASS; `/` dan `/icon.svg` statis |
| `git diff --check` | PASS |
| Browser produksi | PASS pada 320/360/375/390/768/1440px, tanpa horizontal overflow |
| Navigation | PASS: semua anchor tersedia/diuji dan tidak tertutup sticky header; skip link memindah fokus ke main; menu keyboard/Enter/Escape/expanded state |
| Resilience UI | PASS: reduced motion, native menu tanpa JavaScript, landscape844×390 dan CSS zoom200% |
| Runtime/network | Tidak ada console exception atau response error selama skenario browser |
| Kontras | Tujuh pasangan token teks/latar ≥4,5:1; minimum5,09:1 |
| Visual | Screenshot hero desktop/mobile, penawaran, dua laporan dan menu ditinjau langsung |

Bukti mesin: [browser checks](../screenshots/landing-v2/browser-checks.json) dan [token contrast checks](../screenshots/landing-v2/contrast-checks.json).
Screenshot: [hero desktop](../screenshots/landing-v2/1440-fold.png), [hero mobile](../screenshots/landing-v2/375-section-1.png), [dua laporan desktop](../screenshots/landing-v2/1440-section-5.png), [dua laporan mobile](../screenshots/landing-v2/375-section-5.png).

Browser headless memakai profil sementara baru, tidak memakai profil pengguna. CSS zoom200% adalah pemeriksaan reflow CSS, bukan sertifikasi zoom OS/browser. Pemeriksaan token bukan audit keseluruhan WCAG. Tidak ada uji pemahaman UMKM atau bukti dampak bisnis dari data sintetis.

Database/auth/order/payment/email/AI/provider/deployment tidak diimplementasikan atau diuji pada B02. Fitur tersebut masih memerlukan kontrak dan integrasi modul berikutnya. Tidak ada staging/commit/push/merge/deploy yang dilakukan oleh agent.
