# Campaign Lab MVP: P2-2 Payment Integrity (A6-09 + U01)

Tanggal: 8 November 2026. Pelaksana: Claude bersama Rafi. Scope: persistence pembayaran yang sudah ada, bukan adapter Midtrans atau checkout.

## A. Ringkasan

**PASS (disposable SQL + real PostgREST, dua sesi berpenghalang).** R1 dan R2 sama-sama **terbukti** sebelum diperbaiki, lalu diperbaiki dengan perubahan terkecil pada dua fungsi. Tidak ada state machine, tabel, atau kolom baru. Regresi penuh lulus.

## B. Lingkungan

- Supabase sekali pakai `gtnic_test` (API `127.0.0.1:54421`, container `supabase_db_gtnic_test`), di-`db reset` dari 16 migration repo.
- DB persisten `campaign-lab` tidak disentuh: tetap 10 migration (`20261106160000`), `current_order_offer` masih stub lama.
- Sesi kedua memakai `psql` terpisah. Penghalang memakai `pg_sleep` 1,5 sampai 4,5 detik, semua uji selesai di bawah 6 detik.

## C. R1 / A6-09: settlement tertahan kunci melewati tenggat

**Reproduksi** (`tests/supabase/payment-integrity.test.ts`, grup R1). Pesanan 2 unit dengan hold 2 detik. Sesi lain memegang `FOR UPDATE` pada pesanan selama 3,5 detik. Settlement dimulai sekitar 0,6 detik, sebelum tenggat, lalu tertahan sampai sesudah tenggat.

| Kasus | Sebelum perbaikan | Sesudah perbaikan |
|---|---|---|
| Slot masih kosong | **`applied`**, hold kedaluwarsa dialokasikan dan email lunas diantrekan | `review`, pesanan `requires_review`, reservasi `released`, 0 email |
| Slot sudah diambil pembeli lain setelah tenggat (kapasitas 2) | **Galat `CAPACITY_EXCEEDED` (SQLSTATE 23514)** dari trigger reservasi, settlement rollback dan webhook gagal | `review`. Pembeli lain tetap `held`. Kapasitas terpakai tetap 2, tidak overbooking |
| Kontrol: settlement normal sebelum tenggat | `applied` | `applied`, 1 email |

**Akar masalah:** `apply_verified_payment` memeriksa `reservation.expires_at > now()`. `now()` adalah waktu mulai transaksi, bukan saat hold benar-benar diterapkan.

**Perbaikan:** pemeriksaan hold memakai `clock_timestamp()`, dievaluasi setelah kunci pesanan dan pembayaran didapat. Jalur lain di fungsi itu tidak berubah. Settlement yang hold-nya sudah lewat masuk jalur tinjauan yang sudah ada (`hold_expired`), tanpa email lunas.

## D. R2 / U01: urutan kunci terima pembayaran terlambat vs settlement

**Urutan sebelum perbaikan:**
- `accept_late_payment`: preorder, **kapasitas**, **pesanan**, pembayaran, reservasi.
- Settlement dan `expire_or_cancel_order`: **pesanan**, pembayaran, reservasi, lalu kapasitas lewat trigger `reservation_guard`.

**Reproduksi:** pesanan pending dengan hold kedaluwarsa. Sesi A memegang kunci pertama `accept_late_payment` (kapasitas) lalu memanggil fungsi asli setelah jeda. Sesi B mengirim settlement pesanan yang sama, yang jalur rilis hold-nya mengunci kapasitas lewat trigger.
- Sebelum perbaikan: **`ERROR: deadlock detected` (SQLSTATE 40P01)**. Siklusnya `accept_late_payment` menunggu tuple `orders` di `private.lock_order`, sementara settlement menunggu kapasitas.

**Percobaan pertama yang ditolak:** settlement dibuat mengunci preorder dan kapasitas lebih dulu. Uji baru membuktikan perubahan itu **menimbulkan deadlock 40P01 baru** antara `expire_or_cancel_order` dan settlement pada pesanan yang sama. Pendekatan ini dibatalkan.

**Perbaikan akhir:** `accept_late_payment` mengunci pesanan (`lock_order`, dengan CAS versi) sebelum preorder dan kapasitas. Kini semua fungsi yang mengubah pesanan yang sudah ada (settlement, expire atau cancel, accept) mengunci pesanan lebih dulu. Fungsi yang membuat pesanan baru (checkout, pesanan manual) tetap preorder lalu kapasitas, karena belum ada pesanan untuk dikunci. Pemeriksaan ulang status, `assert_orderable`, ownership, CAS, dan idempotency tidak berubah.

**Matriks sesudah perbaikan, tanpa deadlock:**

| Skenario | Hasil |
|---|---|
| Accept pada pesanan pending (status tidak sah) vs settlement pesanan yang sama | Accept `ORDER_STATE_INVALID`, settlement `review` |
| Accept pesanan A (status sah) vs settlement pesanan B, kapasitas sama | Keduanya `applied`, masing-masing 1 email, kapasitas terpakai 4 dari 4 |
| `expire_or_cancel_order` vs settlement pesanan yang sama | Expire berhasil, settlement `review` |

**Batas cakupan:** kombinasi di atas tidak lagi deadlock, dan urutan kunci yang memicu 40P01 tidak lagi ada di fungsi yang diubah. Ini **tidak membuktikan deadlock mustahil** untuk semua kombinasi fungsi lain. Kombinasi yang belum diuji antara lain accept vs `advance_fulfillment`, dan banyak settlement berbeda di kapasitas yang sama dengan beban tinggi.

## E. Kontrak lain yang tetap dijaga (regresi `payments.test.ts`)

- Event sama diulang 3 kali atau dikirim 8 kali bersamaan: satu efek, satu job email.
- Kunci event sama dengan hash beda: `duplicate` dengan `payloadChanged`. Status atau nominal beda: `conflict` tanpa perubahan.
- Nominal salah: `amount_mismatch`, tidak mengubah pesanan. Status tak dikenal: `ignored`.
- Settlement terlambat: tinjauan, lalu accept atau decline. Dua accept bersamaan di slot terakhir: tepat satu berhasil.
- Batal vs bayar bersamaan, dan pesanan lunas tidak bisa diklaim lagi.
- Verifikasi signature HTTP Midtrans **bukan** bagian dari uji ini. Itu tugas Indro di P2-4.

## F. Perubahan

**Migration baru forward-only:** `supabase/migrations/20261108110000_payment_settlement_clock_and_accept_lock_order.sql`, setelah migration C8 `20261108100000`. Hanya `CREATE OR REPLACE` dua fungsi. **Belum di-deploy ke environment persisten mana pun.**

| Fungsi | Perubahan |
|---|---|
| `public.apply_verified_payment` (versi 7 parameter teks milik core) | Satu kondisi: `expires_at > clock_timestamp()` |
| `public.accept_late_payment` | `lock_order` dipindah sebelum kunci preorder dan kapasitas |

**Uji baru:** `tests/supabase/payment-integrity.test.ts` (6 uji).

## G. Hasil pemeriksaan

| Pemeriksaan | Hasil |
|---|---|
| `npm run test:integration` dari `db reset` bersih (16 migration) | **186/186 PASS**, 9 file |
| `tests/supabase/payment-integrity.test.ts` sebelum perbaikan | 3 gagal sesuai reproduksi R1 dan R2, 2 kontrol lulus |
| `npm test` | 1.154/1.154 PASS |
| `npx tsc --noEmit`, `eslint src tests` | PASS |
| `npm run build` | PASS |
| Midtrans, signature HTTP, email provider | **NOT EXECUTED** (bukan scope) |

## H. Serah terima kontrak untuk Indro (P2-3, P2-4)

Semua nama dan signature dicek dari source. Panggil dengan client **service role** di server, jangan dari browser.

| Langkah | Fungsi | Catatan |
|---|---|---|
| Halaman preorder | `findPublicPreorder(client, slug)` di `src/features/preorders/repository.ts` | `unitPriceIdr`, `discountBps`, `orderableUnits` dari server |
| Checkout | `placePublicOrder(client, input, holdTtlSeconds)` di `src/features/orders/service.ts`, input `publicOrderSchema` | Kirim `expectedUnitPriceIdr` dari harga tampil dan `attributionRef` (slug campaign) bila ada. `OFFER_CHANGED` berarti tampilkan harga baru. `IDEMPOTENCY_CONFLICT` berarti kunci sama dengan isi beda |
| Token pembeli | `createPrivateOrderToken()` di browser, server hanya menyimpan hash (`hashPrivateOrderToken`) | Status privat: `findOrderByPrivateToken(client, token)` |
| Mulai bayar | `claimPaymentAttempt(client, token)` di `src/features/payments/service.ts` | `action`: `create_charge` (hanya satu pemanggil boleh membuat charge), `reuse_qr`, `wait`, `reconcile` (cek status memakai `providerOrderId` yang sama, jangan membuat referensi baru) |
| Setelah charge dibuat | `recordPaymentCharge(client, { paymentId, providerTransactionId, qrContent, qrExpiresAt })` | |
| Webhook terverifikasi | `applyVerifiedPayment(client, fact)` dengan `verifiedPaymentFactSchema` | `payloadHash` wajib SHA-256 hex 64 karakter. Nominal dihitung server, jangan dari client. Hasil: `applied`, `review`, `duplicate` (+`payloadChanged`), `conflict`, `recorded`, `ignored`, `amount_mismatch` |

- Signature Midtrans wajib diverifikasi adapter sebelum memanggil `applyVerifiedPayment`. Fungsi ini menganggap fakta yang masuk sudah terverifikasi.
- Retry persistence aman: memanggil ulang `applyVerifiedPayment` dengan event yang sama tidak membuat efek kedua. **Jangan membuat charge Midtrans baru saat retry.** Gunakan `claimPaymentAttempt`, dengan `reconcile` untuk penagih yang terputus.
- Ada fungsi lain bernama `apply_verified_payment` (milik baseline Steven, parameter `p_payment_id`). **Jangan dipakai.** Aplikasi memakai versi core di atas.

## I. Status lingkungan dan langkah berikutnya

- **Project `cl-mvp-72e87c9aa2bc` tidak ada di laptop Rafi.** Seluruh bukti P2-1 dan P2-2 memakai Supabase sekali pakai `gtnic_test`, yang sudah dimatikan. Untuk memakai C8 dan perbaikan pembayaran di instance MVP Steven, perlu (1) sync source dan (2) menerapkan `20261108100000` dan `20261108110000` sebagai keputusan terpisah, dengan backup dan verifikasi kompatibilitas sesuai handoff. Belum dilakukan.
- **DB persisten `campaign-lab` (laptop Rafi) tidak dimutasi:** tetap 10 migration, resolver masih stub lama. 14 migration lama di repo tidak diubah. Hanya dua file migration baru yang ditambahkan.
- **Belum commit atau push**, sesuai handoff.
- **Tugas berikutnya:** merge dan integrasi Indro (P2-3 buyer UI/checkout, P2-4 adapter Midtrans Sandbox), lalu P3-1 dan P3-2. Tidak dikerjakan dalam handoff ini.
