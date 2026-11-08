# C5 — Kontrak pembayaran Rafi ↔ Indro

Tanggal pencatatan: 5 November 2026. Versi kontrak perilaku: 1.

**Status:** arah dan pembagian tanggung jawab disepakati menurut konfirmasi Indro bahwa Rafi dan Indro menyetujui usulan pada percakapan. Implementasi R5, signature RPC, DTO TypeScript final, migration yang diterapkan, dan integrasi provider **belum diverifikasi**. Dokumen ini bukan bukti semua B01/C1–C8 sudah selesai.

## 1. Acuan dan kondisi aktual

- Target: Campaign Lab PRD v2.1; schema v2.1 §10–11, §16.1, dan §19. Salinan target tersedia pada branch `docs/indro-baseline-contracts` di `docs/requirements/PRD.md` dan `docs/schema.md`.
- Checkout B01 dan `feat/core-preorder` pada saat audit masih membawa PRD/schema berlabel v1.0. Jangan memperlakukan dokumen lama sebagai target v2.1; sinkronisasi dokumen dilakukan terpisah tanpa menimpa perubahan tim.
- Producer yang dibaca: `feat/core-preorder` commit `e47da8057043ebf1e955b41580690e5a8b826b6c`.
- R4 menyediakan `src/features/orders/service.ts`: `placePublicOrder`, hashing token, TTL sementara 900 detik, dan `expireOrder`.
- `supabase/migrations/20261104120000_order_lifecycle.sql` mendefinisikan `create_preorder_order` dan `expire_or_cancel_order`. Harga saat ini masih normal; C2/C8 untuk campaign belum terintegrasi ke jalur ini.
- `supabase/migrations/20261102091442_core_preorder.sql` mendefinisikan `job_runs`, termasuk `UNIQUE(job_type, dedupe_key)`; keberadaan tabel belum membuktikan claim/worker berfungsi.
- `payments`, `payment_events`, `claim_payment_attempt`, dan `apply_verified_payment` belum ditemukan pada source/migration producer tersebut. Database remote tidak diaudit pada tugas ini.
- Tidak ditemukan migration pembayaran atau `orders` tambahan milik Indro pada B00/B01 yang diperiksa. Periksa ulang sebelum mengintegrasikan R5.

Dokumen ini menjelaskan perilaku layanan, bukan mengubah schema atau memberi izin menjalankan migration. Rafi menyediakan perubahan SQL melalui tugas schema tersendiri; Indro mereview dan mengonsumsi hasilnya.

## 2. Ownership dan satu jalur penulisan

| Area | PIC | Batas |
|---|---|---|
| Schema pembayaran, atomic attempt, apply, audit, enqueue | Rafi; review Indro | Migration baru berdasarkan v2.1 dan migration aktual; jangan mengedit applied migration |
| Midtrans Sandbox, create QRIS, verifikasi, reconciliation | Indro | Memanggil command Rafi; tidak menulis order/reservation/payment secara langsung |
| Token lookup untuk checkout/tracking | Rafi; consumer Indro | Server-only, whitelist, tanpa akses anonim langsung ke tabel privat |
| Email adapter, template, delivery/retry | Indro | Membaca job committed; tidak mengubah fakta pembayaran |
| Shared claim/lease/scheduler | Dukungan DB Rafi; koordinasi Indro dan Steven | Kontrak eksekusi bersama; detail export dan operator scheduler belum ditetapkan |

`payments.status` ditulis melalui command domain Rafi: inisialisasi attempt, penyimpanan hasil create-QR, serta apply notifikasi/reconciliation. Istilah satu writer tidak berarti hanya satu fungsi untuk semua operasi; tidak ada update ad hoc dari adapter Indro. Seluruh command mencegah downgrade dan berbagi aturan concurrency.

## 3. Token dan data tracking

- Mulai pembayaran memerlukan token privat buyer; nomor order atau UUID saja bukan otorisasi. Lookup dilakukan server, meng-hash token lalu mencari order terkait.
- Browser mempertahankan token dan idempotency key yang sama saat retry C4. Token mentah tidak disimpan di database, job, atau log; hash tidak dapat diubah kembali menjadi token.
- Projection buyer: nomor order; nama bisnis; produk/SKU dan quantity; snapshot harga normal/diskon/harga final/total; payment status; order status; fulfillment status; payment due time; waktu pembayaran terverifikasi jika ada; tanggal dan petunjuk pickup; kontak publik yang disetujui; apakah pembayaran masih dapat dilanjutkan.
- Jika snapshot SKU atau data lain belum tersedia pada producer, laporkan gap; jangan mengambil nilai katalog terbaru lalu menyebutnya snapshot historis.
- QR hanya disajikan pada checkout privat yang valid. Pisahkan projection ini dari daftar pesanan owner dan dari projection worker email.
- Jangan expose biaya produksi, owner/internal notes, daftar pelanggan, hash token, atau row database penuh. Token tidak valid/unknown memakai respons generik yang tidak mengungkap order lain.
- Tracking menggunakan no-store, noindex, dan kebijakan referrer aman; polling membaca database tanpa membuat charge atau memanggil Midtrans pada setiap poll. Tidak memasang third-party analytics pada halaman bertoken.

## 4. Claim attempt dan hasil create-QR

`claim_payment_attempt` hanya untuk backend. Order, nominal, tenant, deadline, dan eligibilitas diambil dari data tersimpan yang telah diotorisasi, bukan klaim browser.

1. Periksa order public Sandbox masih dapat dibayar dan hold masih valid.
2. Kunci sesuai urutan domain yang konsisten; pakai ulang attempt aktif atau buat attempt `initiating` beserta `provider_order_id` unik dan nominal snapshot.
3. Commit attempt sebelum request HTTP ke Midtrans. Jangan menahan transaksi database selama request provider.
4. Hasil claim harus membedakan izin membuat charge, reuse QR aktif, menunggu/reconcile in-flight attempt, serta penolakan order tidak eligible. Ini kebutuhan semantik, **bukan nama enum/RPC yang diklaim sudah tersedia**.
5. Pemanggil kedua tidak boleh mendapat izin membuat charge hanya karena menemukan attempt `initiating` yang sama. Claim/lease dan pemulihan crash perlu diuji pada R5/B05.
6. Rafi menyediakan command penyimpanan hasil create-QR; nama/export belum ditentukan. Command ini memvalidasi reference/amount, menyimpan transaction ID dan QR/expiry, serta tidak mengubah `paid_sandbox` kembali menjadi `pending` jika webhook lebih dahulu masuk.
7. Timeout/network error sesudah request provider mungkin berarti transaksi sudah dibuat. Pertahankan reference, lakukan GET Status/reconciliation, dan jangan blind retry dengan reference/attempt baru. Hasil tidak pasti tidak disamakan dengan kegagalan definitif.
8. Attempt baru hanya setelah attempt sebelumnya dipastikan tidak aktif melalui aturan reconcile dan order masih eligible. GET checkout/tracking/QR tidak membuat charge.

## 5. Verifikasi dan input apply

Indro memvalidasi payload eksternal dari `unknown`, signature dengan string `gross_amount` asli, reference, nominal, status, dan konteks merchant Sandbox. Untuk settlement, konfirmasi melalui GET Status menggunakan konfigurasi Sandbox sebelum meneruskan fakta untuk apply. Panggilan GET Status yang gagal/ambigu tidak berubah menjadi paid; webhook meminta retry atau menggunakan jalur reconciliation durable yang memang sudah tersedia, bukan janji proses in-memory setelah respons.

Signature salah ditolak sebelum apply. Tidak menulis event tersebut ke `payment_events` berdasarkan payment ID yang belum tepercaya; log keamanan minimal tanpa raw payload/PII/token. Input bertipe valid atau boolean dari client bukan bukti verifikasi. Akses command apply dibatasi pada backend/service role tepercaya.

| Field layanan | Makna |
|---|---|
| `paymentId` | UUID attempt tersimpan, ditemukan dari reference provider |
| `providerOrderId` | Dicocokkan lagi dengan `payments.provider_order_id` |
| `providerEventKey` | `transaction_id:transaction_status` untuk cakupan QRIS ini |
| `payloadHash` | Hash payload untuk audit; bukan bukti autentikasi atau satu-satunya dedupe guard |
| `providerStatus` | Fakta status provider tervalidasi: pending, settlement, expire, deny, atau cancel |
| `providerTransactionId` | Identitas transaksi provider; tidak boleh menautkan dua order berbeda |
| `amountIdr` | Integer rupiah positif tanpa float/coercion longgar; persis sesuai attempt dan total order |
| `providerPaidAt` | Timestamp paid provider dinormalisasi UTC; nullable untuk non-settlement; jangan mengarang waktu paid |

`verified_at`/`processed_at` adalah waktu server yang dipercaya, bukan timestamp browser. Mapping parameter SQL, tipe timestamp final, export layanan, dan katalog error harus dicocokkan dengan implementasi R5 sebelum consumer dihubungkan; tabel ini tidak mengklaim signature RPC sudah ada.

Untuk jalur reconciliation, status berasal dari respons server-to-server Midtrans yang tervalidasi. Rafi dan Indro perlu menetapkan representasi audit `signature_valid` untuk fakta ini berdasarkan respons provider; jangan memberi nilai true sekadar karena fungsi dipanggil atau karena browser mengatakan sudah membayar.

## 6. Apply, hasil, dan urutan status

Transaksi database Rafi memeriksa ulang reference, transaction identity, amount terhadap attempt **dan** order, status order/hold, serta apakah ada applied payment lain. Tenant diturunkan dari attempt/order tersimpan.

| Hasil perilaku | Makna untuk consumer |
|---|---|
| `applied` | Settlement valid pertama benar-benar diterapkan: payment/order/reservation/audit/email job committed bersama |
| `duplicate` | Fakta sama sudah diproses; tidak mengalokasikan atau enqueue ulang |
| `requires_review` | Fakta pembayaran butuh penanganan, misalnya hold tidak valid, order cancelled/expired, atau settlement attempt tambahan; tidak auto-allocate/email |
| `ignored` | Tidak menerapkan pembayaran ke fulfillment; dapat mencakup non-settlement yang statusnya dicatat atau notifikasi usang. Sertakan alasan yang membedakan kedua kondisi |

Response harus membedakan pembayaran yang applied dari sekadar event tersimpan/status berubah, dan memberi reason yang aman. Nama field reason/result final mengikuti R5; Indro tidak membuat enum database sendiri.

- Pending tidak mengalokasikan kapasitas. Provider `expire`, `deny`, dan `cancel` dipetakan ke status payment yang memang ada di schema (`expired`, `failed`, `cancelled`), bukan menambah enum.
- Settlement applied: `held → allocated` sekali tanpa menambah quantity; order `pending_payment → awaiting_confirmation`. Payment tidak otomatis menandakan fulfillment selesai.
- `requires_review` adalah outcome/review state; bukan status payment baru. Settlement sah tetap dicatat sebagai fakta `paid_sandbox` meski `applied_at` null dan memerlukan review; mismatch/invalid amount tidak dijadikan fakta paid yang sah.
- Nominal/reference tidak cocok tidak melanjutkan order atau email. Catat/return penolakan secara aman sesuai error R5; bukan rollback diam-diam lalu mengaku applied.
- Notifikasi pending/terminal lama tidak menurunkan pembayaran yang telah settled/applied. Konflik terminal lain direkonsiliasi, bukan diurutkan hanya dari waktu kedatangan.
- Key sama dengan payload hash berbeda memerlukan pemeriksaan fakta tervalidasi; perubahan format JSON/field tambahan tidak otomatis berarti pembayaran kedua. Hash bukan sumber kebenaran status.
- Expiry pesanan menggunakan jalur bersama `expire_or_cancel_order`, bukan direct update dari webhook. Pembayaran terlambat tetap review jika hold sudah tidak valid, termasuk webhook terlambat untuk pembayaran sebelum deadline.
- Jika kelak owner menerima late payment melalui `accept_late_payment`, revalidasi kapasitas dan first-application/email memakai invariant yang sama. Callback duplicate tidak menggantikan keputusan owner.

**Review lock wajib sebelum implementasi:** R4 mengambil lock preorder lalu kapasitas, sementara schema target v2.1 §19.1 menulis kapasitas lalu preorder. Rafi perlu menetapkan satu urutan konsisten lintas R4/R5/expiry; jangan mencampur dua urutan yang berpotensi deadlock. Dokumen ini tidak mengubah SQL atau memutuskan urutan baru sepihak.

## 7. Hold dan expiry — OG-02 masih terbuka

- Nilai sementara `ORDER_HOLD_TTL_SECONDS = 900`; bukan angka final yang sudah terbukti pada akun Midtrans tim.
- Target: provider QR expiry tidak melewati `orders.payment_due_at` dan expiry hold. Gunakan deadline yang sama dengan konversi timezone/rounding yang aman; retry tidak memperpanjang deadline.
- Mengisi `qr_expires_at` lokal saja tidak mengakhiri QR di provider. B05 harus mengirim custom expiry dan memverifikasi perilaku/expiry aktual provider. Bila provider tidak dapat memenuhi deadline, jangan menampilkan QR seolah aman; tentukan penanganan setelah bukti spike tersedia.
- Sama expiry tidak menjamin notifikasi datang tepat waktu. Late settlement tetap memiliki jalur review; tidak merebut slot yang sudah digunakan pesanan lain.

## 8. Durable email dan worker

Pada first applied payment, dalam transaksi database yang sama:

| Field job | Nilai |
|---|---|
| `job_type` | `send_paid_email` |
| `entity_id` | ID order |
| `business_id` | Tenant dari order tersimpan |
| `dedupe_key` | `<orderId>:paid-v1` |
| `status` | `queued` |

Gunakan uniqueness `(job_type, dedupe_key)`. Tidak membutuhkan kolom payload: worker mengambil penerima dari order yang sah dan rincian harga/produk dari snapshot item. Nama bisnis, petunjuk pickup, dan kontak publik mengikuti data yang tersedia; jangan mengklaim historis jika field tersebut tidak disnapshot.

Worker Indro memeriksa payment benar-benar applied, menggunakan atomic job claim dengan lease, retry terbatas, dan provider reference/idempotency bila tersedia. Kontrak claim/completion dan scheduler final belum tersedia. Provider accepted tidak sama dengan inbox received; timeout email tidak menjamin exactly-once delivery. Kegagalan email tidak rollback payment.

Email menyebut Sandbox/simulasi, nomor order, usaha, produk/SKU jika snapshot tersedia, qty, harga normal/diskon/final/total, tanggal/petunjuk pickup dan kontak publik. Pending/invalid/late-unapplied tidak menghasilkan email sukses. Tidak menyimpan raw tracking token pada job/log; email awal boleh tanpa private tracking link.

## 9. Gate pengujian dan urutan kerja

Seluruh baris berikut **belum dijalankan** pada pencatatan kontrak ini.

| Kasus | Bukti yang diperlukan | PIC |
|---|---|---|
| Dua POST bayar bersamaan | Satu active attempt dan satu izin create-charge | Rafi + Indro |
| Create-QR timeout/crash | Reference tersimpan; reconcile, tanpa blind charge baru | Rafi + Indro |
| Webhook sebelum respons charge | Settlement tidak ditimpa pending/QR response | Rafi + Indro |
| Settlement pertama | Satu applied payment, allocated reservation, audit, dan job dalam satu commit | Rafi |
| Replay dan pending setelah settlement | Tidak double-allocate, enqueue ulang, atau downgrade | Rafi + Indro |
| Key sama, payload berubah | Fakta dibandingkan; tidak silently menerima konflik atau menggandakan efek | Rafi + Indro |
| Signature/reference/amount salah | Tidak melanjutkan pesanan/email; penolakan aman | Indro + Rafi |
| Expiry dan settlement bersamaan | Tidak overbook; late/unavailable masuk review | Rafi + Indro |
| Settlement attempt tambahan | Fakta tercatat untuk review; maksimum satu applied payment | Rafi |
| Token salah/cross-order | Tidak membaca atau memulai pembayaran order lain | Rafi + Indro |
| QR deadline/retry | Expiry provider terbukti sesuai hold; retry tidak memperpanjang | Indro |
| Worker bersamaan dan email timeout | Claim/lease aman, retry terbatas, satu logical job | Rafi + Indro |
| Sandbox dan email aktual | Provider terverifikasi, order applied, email benar-benar diterima | Indro |

Urutan: catat C5 pada B01 → spike provider B05 paralel dengan R5 → B03/B04 untuk buyer/order → integrasi B05/B06 sesudah R5 → B07/B08 email/tracking. Spike tidak dinyatakan checkout end-to-end selesai. B09–B13 tetap mengikuti dependensi masterplan.

Setiap modul memakai branch terkait dan commit manual oleh pengembang. Dokumen C5 ini dilanjutkan pada branch B01 yang sudah ada; jangan menyalin seluruh B00 atau membawa catatan pribadi ke branch lain. Tidak memulai preview otomatis.

## 10. Referensi provider

- [Midtrans QRIS](https://docs.midtrans.com/reference/qris): kontrak charge/response dan notifikasi QRIS.
- [Midtrans HTTP notifications](https://docs.midtrans.com/docs/https-notification-webhooks): signature, verifikasi status, duplicate/out-of-order, dan respons webhook.
- [Midtrans Custom Expiry](https://docs.midtrans.com/reference/custom-expiry-object): parameter expiry dan titik awal perhitungannya.

Referensi diperiksa 5 November 2026. Dokumentasi provider tidak membuktikan kapabilitas akun tim, hasil live Sandbox, atau nilai OG-02 final. Bukti tersebut harus berasal dari spike B05.
