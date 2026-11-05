# B05 — Midtrans QRIS Sandbox spike

Tanggal: 5 November 2026. Branch: `feat/indro-midtrans-qris`.

**Status: adapter dan tes lokal tersedia; live Sandbox belum diuji.** Pengguna menyatakan akun Midtrans tim belum siap dan meminta melanjutkan adapter/tes lokal saja. Tidak membuat transaksi provider, mengubah callback merchant, mengirim email, atau menjalankan preview pada implementasi ini.

## Baseline dan batas scope

Base: `origin/feat/core-preorder` commit `e47da8057043ebf1e955b41580690e5a8b826b6c`. Worktree B05 terpisah dari landing page dan B01; tidak melakukan merge/cherry-pick, staging, commit, push, atau deploy. Tidak menambah dependency atau mengubah lockfile.

Target produk menggunakan PRD/schema v2.1 pada branch `docs/indro-baseline-contracts`. PRD/schema bawaan base Rafi masih berlabel v1.0. Kontrak perilaku C5 dicatat pada B01 (`docs/api/payment-integration.md`, belum diintegrasikan ke branch ini); signature API R5 belum tersedia saat implementasi. Dokumen ini tidak menyelesaikan schema drift atau mengubah kontrak database.

R4 menyediakan atomic order/hold. `job_runs` ada di migration awal. `payments`, `payment_events`, `claim_payment_attempt`, command penyimpanan hasil charge, dan `apply_verified_payment` belum tersedia pada base. Karena itu spike tidak menyediakan endpoint charge publik, checkout UI, reuse attempt aplikasi, webhook, job reconciliation, worker email, atau update order/reservation. Semua itu tetap mengikuti R5 dan B04–B08.

## File dan API

| File | Tanggung jawab |
|---|---|
| `src/features/payments/midtrans-sandbox.ts` | Adapter server-only, config Sandbox, runtime validation, create QRIS, dan GET Status |
| `src/features/payments/midtrans-sandbox.test.ts` | Uji request, amount/reference, timestamp, expiry, QR URL, timeout, dan privasi dengan fetch tiruan |
| `src/features/payments/midtrans-spike.test.ts` | Uji CLI dengan fetch tiruan pada child process, journal-before-HTTP, dan pencegahan POST ulang |
| `scripts/midtrans-spike.mjs` | Probe manual sintetis dengan local journal sebelum HTTP, tanpa app server/DB |
| `.env.example` | Placeholder konfigurasi Midtrans server-only |
| `package.json` | Command manual `spike:midtrans` |

`parseMidtransSandboxConfig(source)` membaca `MIDTRANS_SERVER_KEY`, `MIDTRANS_MERCHANT_ID`, dan `MIDTRANS_QRIS_ACQUIRER`. Key harus berprefix Sandbox `SB-Mid-server-`; acquirer `gopay` (default) atau `airpay shopee`. Tidak memakai Client Key, tidak menerima base URL dari caller, dan tidak menambah konfigurasi provider ke env publik Supabase.

`createMidtransSandboxClient(config, options?)` menyediakan:

- `createQris(input)` dengan `providerOrderId`, integer `amountIdr` positif, dan `paymentDueAt` ISO dengan offset. **Caller aplikasi wajib sudah mengotorisasi order dan claim/persist attempt melalui Rafi sebelum memanggil adapter.** Validasi bentuk di adapter bukan otorisasi atau validasi harga bisnis.
- `getStatus(input)` dengan reference, expected amount dan optional expected transaction ID. Hasil `found` memuat DTO fakta provider; `not_found` merupakan observasi 404, bukan izin membuat attempt baru.

Adapter tidak menghitung harga/diskon, tidak memanggil database, tidak menetapkan `paid_sandbox`, dan tidak mengirim email. Fakta `settlement` dari adapter masih perlu pemeriksaan kebijakan status/fraud serta atomic apply C5; redirect/browser bukan bukti pembayaran.

## Perilaku penting

- Seluruh HTTP ke `https://api.sandbox.midtrans.com`, Basic Auth server-only, `no-store`, timeout 10 detik, redirect ditolak. Tidak retry POST otomatis.
- Error berisi kode/operation/reconciliation flag tanpa raw body, header, secret, PII, atau underlying cause. Setelah POST gagal/ambigu, caller memakai reference yang sama untuk reconcile. Bahkan error HTTP tidak otomatis membuktikan transaksi belum dibuat.
- Response harus QRIS/IDR dan cocok dengan order reference, merchant, transaction ID bila diketahui, serta nominal. Rupiah desimal nonnol, exponent, unsafe integer dan coercion string pada input ditolak. Field tambahan provider diabaikan dan tidak diteruskan ke DTO.
- Waktu provider tanpa offset dibaca sebagai GMT+7 dan dinormalisasi UTC; tanggal tidak valid ditolak. Paid time yang tidak ada tetap null, bukan diganti waktu lokal.
- Custom expiry diikat ke waktu request server yang eksplisit dan sisa deadline, dibulatkan ke detik tanpa melewati hold. Retry tidak memperoleh TTL baru dari adapter. Input deadline harus tersisa minimal satu detik dan tidak lebih dari 24 jam, mengikuti batas service hold R4.
- QR baru hanya dikembalikan jika provider memberi expiry yang masih hidup dan tidak melewati deadline. Expiry hilang/tidak sesuai menghasilkan `EXPIRY_UNCONFIRMED` dan memerlukan reconcile, bukan mengarang expiry lokal. Perilaku akun yang sebenarnya masih perlu spike live.
- Menggunakan action `generate-qr-code` (v2): URL harus HTTPS Sandbox dan path transaction ID yang sama, tanpa credential/query/fragment. Format action lain memerlukan review capability; adapter tidak menggambar QR palsu atau mengikuti URL tak dikenal.
- GET Status menjaga status provider termasuk expire/deny/cancel/refund; tidak otomatis memetakannya ke status aplikasi atau menyimpulkan fulfillment selesai.

## Menjalankan tes lokal sekarang

```bash
npm ci
npm run test -- src/features/payments
npm run lint
npm run typecheck
npm run spike:midtrans -- --help
```

Semua test di folder payments memakai transport tiruan. Tes CLI memasang fake fetch melalui preload sebelum adapter diimpor, memakai key sintetis dan direktori temporary yang dibuat/dihapus oleh test. Tidak membutuhkan akun Midtrans, Docker, DB, email provider, atau preview server.

CLI membutuhkan Node >=22.6 dengan native TypeScript stripping; verifikasi lokal memakai Node 24. Node dapat menampilkan warning `MODULE_TYPELESS_PACKAGE_JSON` ketika mengimpor file `.ts` pada package ini; tidak mengubah package global menjadi ESM hanya untuk menghilangkan warning tersebut.

## Prosedur live setelah akun siap — belum dijalankan

1. Pastikan menggunakan akun merchant **Sandbox**. Isi `.env.local` pada worktree B05, bukan file tracked, dengan `MIDTRANS_SERVER_KEY` dan `MIDTRANS_MERCHANT_ID`; acquirer opsional. Jangan mengirim key ke chat, log, screenshot, atau repo. CLI memuat `.env.local` dari worktree script; variabel proses yang sudah terisi memiliki prioritas.
2. Koordinasikan callback yang sudah terpasang pada akun tim. CLI tidak mengubah konfigurasi dashboard/callback. Transaksi probe tidak mempunyai order aplikasi; jangan menganggapnya bisa diaplikasikan ke DB C5.
3. Buat satu probe melalui command berikut dengan **path state baru**. Nilai Rp216.000 adalah fixture 2 × Rp108.000, bukan nominal dari buyer atau penjualan aktual.

```bash
npm run spike:midtrans -- create --state /private/tmp/campaignlab-midtrans-spike.json
```

Command menyimpan reference unik, nominal, deadline 15 menit sementara, serta fase `charge_requested` ke file mode 0600 dan melakukan sync **sebelum HTTP**. Exclusive file creation menolak dua create pada file yang sama. Hasil sukses menyimpan DTO dan QR URL; timeout/error mempertahankan journal dengan fase ambiguous. State dibatasi ke direktori temporary agar tidak masuk repo.

Journal ini bukti probe lokal, **bukan** implementasi durable payment attempt produksi. Direktori temporary dapat dibersihkan OS; jangan menggunakannya untuk checkout atau menghapus state saat transaksi masih ambigu. Jika kehilangan reference, periksa merchant dashboard sebelum membuat probe lain. Tidak ada claim lintas reference untuk pesanan bisnis pada CLI.

4. Baca transaksi yang sama, termasuk setelah timeout. Tidak mengulang `create` atau menghapus file untuk mendapatkan reference baru.

```bash
npm run spike:midtrans -- status --state /private/tmp/campaignlab-midtrans-spike.json
```

5. Untuk settlement sintetis, masukkan QR image URL ke simulator Sandbox resmi yang ditautkan pada dokumentasi Midtrans. Jangan menggunakan aplikasi pembayaran nyata. Lalu jalankan `status` lagi; catat status, amount, expiry UTC/WIB, dan reference tanpa key/PII. Untuk menguji expiry, gunakan transaksi probe tersendiri dan biarkan melewati deadline; jangan menilai expiry hanya dari countdown lokal.
6. Verifikasi expiry provider yang sebenarnya tidak melewati hold, status settle/expire dapat dibaca, serta tidak ada charge tambahan akibat GET. Sampai itu terbukti, `ORDER_HOLD_TTL_SECONDS=900` adalah nilai sementara dan OG-02 **OPEN**. Settlement tepat waktu dengan webhook terlambat tetap memerlukan aturan review C5 jika hold sudah tidak valid.

## Handoff ke R5 dan B06

- Aplikasi: token lookup → C4 order/hold → Rafi claim/persist attempt → adapter create QR → Rafi persist result. Dua tab harus memakai attempt yang sama; command persist tidak boleh menimpa settlement yang lebih dulu datang.
- Webhook/reconciliation B06: verifikasi fakta provider → Rafi apply payment/order/reservation/audit/email job atomik. Tidak membuat writer SQL kedua pada adapter ini.
- Atomic claim, crash recovery, state transition, lease/reconcile jobs, expiry race dan email enqueue harus diuji pada DB nyata bersama Rafi. Unit test adapter bukan bukti concurrency database.
- R4 mengambil lock preorder sebelum kapasitas, sementara schema v2.1 menuliskan urutan sebaliknya. Rafi perlu menutup review konsistensi lock lintas R4/R5 sebelum integrasi; spike transport tidak mengubah urutan tersebut.

## Referensi resmi

- [QRIS Core API](https://docs.midtrans.com/reference/qris)
- [QRIS acquirer](https://docs.midtrans.com/reference/qris-object)
- [Custom expiry](https://docs.midtrans.com/reference/custom-expiry-object)
- [GET transaction status](https://docs.midtrans.com/reference/get-transaction-status)
- [Testing payment on Sandbox](https://docs.midtrans.com/docs/testing-payment-on-sandbox)

Dokumentasi diperiksa 5 November 2026; bukan bukti QRIS/expiry akun tim sudah aktif. Hasil verifikasi implementasi dicatat setelah pemeriksaan akhir di bawah.

## Hasil verifikasi lokal — 5 November 2026

Runtime Node v24.11.0. Semua status di bawah berasal dari eksekusi pada worktree B05.

| Pemeriksaan | Hasil |
|---|---|
| `npm ci --no-audit --no-fund` | PASS, dependency sesuai lockfile; tanpa package baru |
| `npm run test -- src/features/payments` | PASS, 82 tes adapter/CLI dengan transport tiruan |
| `npm run test` | PASS, 29 file dan 391 tes keseluruhan |
| `npm run lint` | PASS tanpa warning setelah koreksi parameter mock yang tidak terpakai |
| `npm run typecheck` | PASS |
| `npm run build -- --webpack` | PASS dengan env Supabase sintetis khusus build; tanpa kredensial akun nyata |
| `npm run spike:midtrans -- --help` | PASS; hanya help, tidak ada request transaksi |
| `git diff --check` dan whitespace file baru | PASS |
| Midtrans Sandbox live / expiry akun / settlement provider | NOT RUN — akun tim belum siap; pengguna memilih lokal saja |
| Database payment attempts / webhook C5 / email / buyer E2E | NOT RUN — di luar slice spike ini dan menunggu R5/integrasi |

Build menggunakan URL `https://build-fixture.supabase.co` dan nilai placeholder sintetis untuk public/service-role key. Itu hanya memastikan aplikasi dapat dibuild pada baseline ini, bukan bukti Supabase terhubung atau halaman dashboard berjalan terhadap data nyata.

Tidak menjalankan preview, membaca nilai secret asli, mengubah schema/migration/SQL, atau mengonfigurasi provider. B01 yang belum di-commit tetap berada di worktree asal; tidak dibawa ke B05. Status handoff: **local adapter verified / provider dan database integration pending**.

Pesan commit manual yang disarankan: `feat(payments): add Midtrans sandbox QRIS adapter and local spike tests`.
