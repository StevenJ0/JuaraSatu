# Campaign Lab MVP: P2-3 Buyer Checkout & P2-4 QRIS Sandbox

Tanggal: 8 November 2026. Pelaksana: Claude bersama Rafi (mengambil alih bagian Indro atas keputusan tim). Branch `feat/buyer-checkout` dari `merge/ai-campaign` (sudah memuat merge empat branch Indro).

## A. Ringkasan

**PASS (unit + Supabase sekali pakai + browser lokal dengan Midtrans tiruan).** Pembeli kini bisa memesan di `/p/[slug]`, melihat status di halaman privat `/o/[token]`, membayar QRIS Sandbox, dan status lunas diterapkan lewat webhook terverifikasi atau tombol cek status. Tidak ada perubahan schema, migration, RLS, atau RPC.

**Belum dijalankan:** Midtrans Sandbox sungguhan (server key tim belum ada di `.env.local`), webhook dari internet (butuh URL publik), dan pengiriman email (worker milik tugas terpisah, job sudah diantrekan atomik).

## B. Alur

1. `/p/[slug]` membaca kontrak C1 `findPublicPreorder` (harga sudah termasuk diskon C8, sisa dari reservasi yang berlaku). Loader Indro diganti agar hanya ada satu sumber harga dan sisa.
2. Form pesan (client) → ringkasan → `placeBuyerOrderAction` (server action) → `checkoutFormSchema` → `placePublicOrder` (C4). Token privat 32 byte dan kunci idempotensi dibuat browser (Web Crypto) dan disimpan di sessionStorage per slug, sesuai PRD §Token. Kirim ulang setelah respons hilang mendapat pesanan yang sama. `?ref=` disimpan per tab sebagai `attributionRef`.
3. `/o/[token]`: `findOrderByPrivateToken`, dinamis (no-store), `robots noindex`, `referrer no-referrer`. Token salah sama dengan tidak ada.
4. Tombol bayar → `continuePaymentAction(token)` → `continueQrisPayment`: `claimPaymentAttempt` → hanya `create_charge` memanggil `createQris` (adapter Indro, di luar transaksi DB) → `recordPaymentCharge`. `reuse_qr` memakai QR tersimpan, `wait` menunggu, `reconcile` membaca GET Status dengan referensi yang sama. Satu kali 404 tidak membuat tagihan baru.
5. Webhook `POST /api/payments/midtrans/notification`: verifikasi SHA-512 `order_id+status_code+gross_amount+server key` (timing-safe) → GET Status server-ke-server → `applyVerifiedPayment` dengan fakta dari status itu. Kunci event `transaction_id:status`, hash dari fakta kanonis, sehingga webhook dan cek manual untuk fakta sama tercatat `duplicate`.
6. Halaman status memuat ulang data DB tiap 5 detik saat QR tampil. Tidak memanggil Midtrans saat polling.

| Respons webhook | Arti |
|---|---|
| 200 `applied`/`duplicate`/`review`/`recorded`/`ignored`/`conflict` | Diproses, Midtrans berhenti mengirim |
| 401 | Signature salah, tidak ada tulisan |
| 400 | JSON rusak, atau nominal/referensi notifikasi beda dari GET Status |
| 404 | Referensi bukan milik aplikasi |
| 503 | Status provider tidak bisa dibaca atau server key belum diisi, Midtrans mengulang |

## C. Perubahan

| File | Isi |
|---|---|
| `src/features/preorders/{context,repository}.ts` | C1 publik ditambah `quotaUnits`, `isDemo`, `product.sku` (snapshot). Biaya dan data pelanggan tetap tidak ada |
| `src/features/public-preorder/read.ts` | Loader memakai C1, validasi slug sebelum DB |
| `src/features/public-preorder/{schemas,actions,checkout-intent,checkout-form}.ts(x)` | Form pesan, ringkasan, niat checkout, aksi server |
| `src/features/public-preorder/{order-view,payment-panel,payment-actions}.ts(x)` | Halaman status privat dan panel QRIS |
| `src/features/public-preorder/page-view.tsx`, CSS module | Harga diskon (dasar dicoret), status C1, `SandboxNotice` bersama |
| `src/features/payments/qris-checkout.server.ts` | Orkestrasi QRIS, rekonsiliasi, webhook, loader konfigurasi |
| `src/features/payments/midtrans-sandbox.ts` | `verifyMidtransNotification`, `sandboxQrImageUrl`. GET Status menerima kode `407` hanya untuk `expire` (kode Midtrans untuk kedaluwarsa); kode non-2xx lain tetap ditolak |
| `src/app/p/[slug]/page.tsx`, `src/app/o/[token]/*`, `src/app/api/payments/midtrans/notification/route.ts` | Route |
| `scripts/midtrans-spike.mjs` | `/private/tmp` (macOS) dilewati bila tidak ada, sehingga 5 uji spike lulus di Windows |

## D. Bukti

| Pemeriksaan | Hasil |
|---|---|
| `npm test` | 1.270/1.270 PASS (termasuk 5 uji spike yang sebelumnya gagal di Windows) |
| `npm run test:integration` dari `db reset` bersih (16 migration) | 197/197 PASS, 10 file. Baru: `buyer-checkout.test.ts` 11 uji |
| `npm run typecheck`, `eslint src tests`, `npm run build` | PASS |
| Browser lokal (`docs/local/e2e/verify-buyer-checkout.cjs`, Chrome headless) | 27/27 PASS |

`buyer-checkout.test.ts` (Supabase asli, transport Midtrans tiruan): satu tagihan dan QR dipakai ulang; tiga tab bersamaan satu tagihan; respons charge hilang lalu rekonsiliasi tanpa tagihan kedua; token salah dan pesanan kedaluwarsa tanpa tagihan; signature palsu dan JSON rusak tanpa tulisan; settlement sekali dengan satu email, ulangan 3× `duplicate`; nominal palsu 400 tanpa tulisan; provider mati 503 lalu berhasil setelah pulih; referensi asing 404; expire tidak mengalokasikan slot; cek status manual lalu webhook belakangan `duplicate`.

Browser: validasi form, ringkasan Rp240.000, pesanan tercatat dengan total dari server, hanya hash token tersimpan, header no-store, meta noindex dan no-referrer, QR dari host Sandbox, muat ulang tidak membuat tagihan baru, cek status mengubah halaman menjadi lunas, tab yang sama menawarkan tautan pesanan terakhir, webhook palsu 401 dan sah `applied` lalu `duplicate`, halaman memperbarui sendiri, token salah tidak membocorkan apa pun, 390px tanpa geser horizontal, pemilik melihat "Lunas (sandbox)" dan tombol konfirmasi, tanpa error konsol. Dev server dijalankan sementara dengan preload Midtrans tiruan lewat `NODE_OPTIONS`, tanpa mengubah kode atau `.env.local`. Pesanan uji dihapus.

## E. Risiko dan langkah berikutnya

1. **Midtrans Sandbox sungguhan belum diuji.** Isi `MIDTRANS_SERVER_KEY` dan `MIDTRANS_MERCHANT_ID` tim di `.env.local`, lalu daftarkan URL publik `/api/payments/midtrans/notification` (misalnya lewat tunnel) di dashboard Sandbox. Tanpa webhook, tombol cek status tetap bisa menerapkan pembayaran. Perlu izin terpisah karena memanggil layanan eksternal.
2. **Belum ada rate limit checkout publik.** Pesanan menahan slot selama `ORDER_HOLD_TTL_SECONDS` (900 detik). Spam bisa menahan kuota sementara. Limiter tahan lama butuh keputusan tim (schema atau layanan).
3. **URL QR untuk rekonsiliasi** dibentuk dari pola URL `generate-qr-code` Sandbox yang sama dengan yang divalidasi adapter. Perlu dikonfirmasi di Sandbox sungguhan.
4. **Email lunas** sudah diantrekan atomik oleh `apply_verified_payment`. Worker pengirim belum ada.
5. **Tautan kampanye** `?ref=<slug kampanye>` sudah diterima, tetapi dashboard belum menampilkan tautan itu ke pemilik.
6. Lanjutan: P3-1 (hasil kampanye) dan P3-2 (uji demo akhir).
