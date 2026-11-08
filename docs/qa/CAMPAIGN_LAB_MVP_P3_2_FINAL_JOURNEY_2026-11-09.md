# Campaign Lab MVP: Email Lunas, Pembatas Pembeli, dan P3-2 Uji Akhir

Tanggal: 9 November 2026. Pelaksana: Claude bersama Rafi. Branch `feat/mvp-final-gaps` (lanjutan `feat/campaign-results`).

## A. Ringkasan

| Bagian | Status |
|---|---|
| Email konfirmasi lunas (FR-EMAIL-01/02) | **PASS** lokal, termasuk kirim sungguhan ke Mailpit. Provider produksi (Resend) belum diuji karena butuh akun tim |
| Pembatas pembeli tanpa akun | **PASS**, memakai `take_rate_limit` yang sudah ada di schema |
| P3-2 uji akhir 14 langkah (rencana §H) | **24/24 PASS** dengan AI tiruan dan Midtrans tiruan. **Belum** dengan Gemini dan Midtrans Sandbox sungguhan |

Tidak ada perubahan schema, migration, RLS, atau RPC.

## B. Email konfirmasi lunas

- Job `send_paid_email` sudah dibuat atomik oleh `apply_verified_payment`. Worker baru `runPaidEmailJobs` (`src/features/paid-email/service.ts`) mengklaim job dengan sewa (`claim_jobs`), memeriksa ulang bahwa pembayaran benar-benar `paid_sandbox` dan diterapkan, menyusun email, mengirim, lalu `complete_job` dengan referensi provider. Gagal kirim memakai `fail_job` (percobaan ulang bertahap, maksimal 5, lalu `dead`). Status pembayaran tidak pernah diubah.
- Isi (`template.ts`): nomor pesanan, usaha, preorder, produk/SKU, jumlah, harga normal, diskon, harga final, subtotal, total, tanggal dan batas pengambilan, petunjuk, kontak, label simulasi Sandbox. Tanpa tautan atau token privat (PRD §942). Isi dari pengguna di-escape di HTML, subjek tanpa baris baru.
- Pengirim (`sender.server.ts`), dipilih lewat `EMAIL_PROVIDER`:
  - `resend`: HTTP API dengan `Idempotency-Key` = `<orderId>:paid-v1`, tanpa dependency baru. Butuh `RESEND_API_KEY` dan `EMAIL_FROM` dengan domain terverifikasi.
  - `mailpit`: hanya alamat lokal, untuk pengembangan.
  - Kosong: email tetap mengantre, tidak hilang.
- Pemicu: `after()` setelah webhook atau cek status menerapkan pembayaran, dan setelah pemilik menerima pembayaran terlambat. Route `GET /api/jobs/run` (header `Authorization: Bearer <CRON_SECRET>`) menjalankan merapikan pesanan kedaluwarsa dan mengirim ulang email tertunda, cocok untuk Vercel Cron.

## C. Pembatas pembeli

`src/features/public-preorder/rate-limit.server.ts` memakai `public.take_rate_limit` (penghitung atomik per jendela tetap). Kunci = HMAC-SHA256 dengan `RATE_LIMIT_HMAC_KEY`, jadi IP dan token tidak tersimpan mentah.

| Aksi | Batas | Kunci |
|---|---|---|
| Buat pesanan publik | 6 per 10 menit | IP (`x-forwarded-for` pertama) |
| Tombol cek status pembayaran (memanggil Midtrans) | 10 per 10 menit | token pesanan |

Tanpa `RATE_LIMIT_HMAC_KEY` (atau galat database) pembatas tidak aktif dan peringatan dicatat. Kuota dan pembayaran tetap dijaga database. Tombol bayar tidak dibatasi karena tagihan hanya dibuat sekali per pesanan. Baris `rate_limit_buckets` yang kedaluwarsa belum dibersihkan otomatis.

## D. P3-2 uji akhir

Lingkungan: salinan app sementara (port 3302) dengan provider AI pemilik diganti `tests/fixtures/owner-ai-provider.server.ts` hanya di salinan, Midtrans tiruan lewat preload `NODE_OPTIONS`, email ke Mailpit stack uji, Supabase sekali pakai `gtnic_test`. Salinan dihapus setelahnya. Skrip lokal: `docs/local/e2e/verify-p32-final.cjs`.

| Langkah | Hasil |
|---|---|
| S1: 1 login, 2 onboarding usaha, 3 produk harga/biaya/foto, 4 kapasitas, 5 terbitkan preorder | PASS (UI) |
| S2: 6 AI membaca preorder asli (audit provider: id usaha, id preorder, harga, kuota cocok), 7 rekomendasi, 8 edit diskon 10% dan setujui, 9 publish kampanye | PASS |
| S3: 10 harga promo Rp108.000 lewat tautan kampanye, 11 pesanan 2 unit Rp216.000 dengan atribusi, 12 webhook bertanda tangan + GET Status diterapkan, 13 slot dialokasikan sekali, email diterima di Mailpit tanpa tautan privat, job tercatat terkirim, angka preorder 2 unit | PASS |
| S4: 14 hasil kampanye 1 pesanan, Rp216.000, 2 unit, lewat tautan 1, potongan Rp24.000 | PASS |
| Negatif: pemilik lain tidak bisa membuka preorder, notifikasi palsu 401 tanpa perubahan, token salah tidak membuka pesanan, cron tanpa rahasia 401, HP 390px tanpa geser horizontal, tanpa error halaman | PASS |

## E. Pemeriksaan

| Pemeriksaan | Hasil |
|---|---|
| `npm test` | 1.298/1.298 PASS (baru: paid-email 15, rate-limit 3) |
| `npm run test:integration` dari `db reset` bersih | 208/208 PASS, 13 file (baru: `paid-email.test.ts` 4 termasuk Mailpit sungguhan, `rate-limit.test.ts` 3) |
| `eslint src tests`, `npm run typecheck`, `npm run build` | PASS |
| Browser P3-2 | 24/24 PASS |

## F. Belum, dan butuh keputusan atau akun tim

1. Gemini sungguhan untuk langkah 6 sampai 8 (`GEMINI_API_KEY`, `GEMINI_MODEL`). PRD meminta demo tanpa AI tiruan.
2. Midtrans Sandbox sungguhan (`MIDTRANS_SERVER_KEY`, `MIDTRANS_MERCHANT_ID`) dan URL webhook publik.
3. Provider email produksi: akun Resend (atau provider lain yang disepakati dengan Indro), domain pengirim, `RESEND_API_KEY`, `EMAIL_FROM`. Juga SMTP Supabase Cloud untuk email daftar dan reset password.
4. `CRON_SECRET` dan jadwal cron di hosting untuk `/api/jobs/run`.
