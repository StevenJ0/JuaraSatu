# Keputusan dan gap — Campaign Lab v2.1

Tanggal audit B00: 2 November 2026. **BASELINE** berarti tercantum pada dokumen pengguna/instruksi sesi; bukan bukti semua anggota sudah review atau implementasi berjalan. **OPEN** berarti belum ada keputusan/bukti final. PIC/reviewer di bawah adalah penugasan yang diusulkan dari ownership task, bukan persetujuan yang telah diterima. B00 tidak mengirim pesan ke anggota tim.

## Baseline yang dipertahankan

| ID | Keputusan/batas | Dasar |
|---|---|---|
| D01 | Preorder operasional mandiri, AI/campaign opsional untuk membuka penjualan; satu SKU, satu fulfillment date, satu item/public order | PRD §3–4; schema §1.1 |
| D02 | Target paid units bukan MOQ; order valid tetap dipenuhi meski target tidak tercapai | PRD §3; schema §1.1 |
| D03 | Campaign aktif memberi diskon ke semua checkout baru; attribution link terpisah dari pricing campaign; order lama frozen | PRD §3/9; schema §1.1 |
| D04 | Harga/kapasitas/payment/KPI deterministik; AI menyarankan/menjelaskan, manusia memilih, approve dan publish sebagai tindakan terpisah | PRD §0/3/8–9 |
| D05 | Satu merchant Midtrans Sandbox tim, tanpa uang nyata/payout/submerchant; payment berbeda dari fulfillment | PRD §3/8/12 |
| D06 | Public checkout wajib email; verified applied payment + audit + enqueue email atomik; delivery sesudah commit | PRD FR-EMAIL-01, §12/14; schema §11/16/19 |
| D07 | Private campaign memories saja, vector 768; global knowledge tables dikeluarkan dari target; cold start tidak mengaku RAG | PRD §15; schema §1.1/15 |
| D08 | Satu aplikasi Next.js modular monolith, strict TypeScript; consume core Rafi dan calculator/AI Steven | PRD §10/21; kontrak integrasi |
| D09 | Satu branch/slice; staging/commit/amend milik pengembang pemilik task; tidak ada operasi Git integrasi/deploy otomatis | Aturan kerja pengguna |
| D10 | B00 memakai PRD kanonik `docs/requirements/PRD.md`, schema `docs/schema.md`, peta `docs/README.md`; file lama menjadi pointer | Scope B00 yang diminta pengguna |

Promosi schema v2.1 pada D10 adalah salinan target yang sudah diberikan pengguna, **tanpa perubahan definisi**. Ini bukan tugas membuat/mengubah constraint atau menerapkan schema. Requirement PRD dipertahankan; catatan sinkronisasi, path lokal dan rujukan catatan individu dirapikan tanpa mengubah keputusan produk.

## Keputusan/review terbuka

### O01 — Konflik capacity constraint (blok tugas migration terkait)

**Fakta:** PRD §11.2 menyebut unique business/product/date dan unique business/date pada `production_capacity`; §12.2 mengulangi business/date capacity guard. Schema §24.1 justru melarang otomatis unique business/date pada capacity, sebab beberapa produk perlu dapat direncanakan pada tanggal sama. Kedua sumber setuju satu preorder published per business/fulfillment date.

**Rekomendasi untuk review:** capacity unik business/product/date; publication guard pada preorder business/date; atomic lock/guard saat publish. Alasan: memisahkan rencana kapasitas produk dari pembatasan event published. **Belum diterapkan/disetujui tim.** Alternatif unique business/date capacity lebih sederhana tetapi membatasi draft beberapa produk. Jangan menganggap perbedaan ini selesai karena schema sudah disalin.

PIC usulan: Rafi; reviewers: Steven dan Indro. Bukti penutupan: keputusan eksplisit, PRD/schema selaras melalui tugas terotorisasi, migration valid dan uji concurrent publish/draft capacity. B00 tidak membuat SQL.

### O02 — Foundation dan chain DB belum terverifikasi

Referensi lokal `origin/feat/foundation-supabase` menyimpan fondasi env/SSR/proxy/Zod/Vitest pada `b7917eb`. Pemeriksaan langsung remote 2 November 2026 hanya mencantumkan `main` dan `landing-page`; ref foundation lokal tidak membuktikan branch aktif di remote. Commit foundation belum masuk main, belum direview/diintegrasikan atau diuji pada B00. Checkout baseline `main` belum berisi migration Supabase. Jumlah applied tabel/policy/RPC lokal/cloud **tidak diketahui**. Alasan branch foundation tidak tercantum di remote belum dikonfirmasi; jangan menebaknya.

PIC usulan: Rafi/integrator; consumer reviewers Steven/Indro. Bukti penutupan: branch/commit integrasi yang dipilih, chain SQL aktual, generated types, hasil local migration/RLS/atomic tests. Jangan membangun foundation kedua.

### O03 — C1–C8 belum menjadi API/DTO yang disepakati

Lihat [kontrak integrasi](architecture/integration-contracts.md). B00 menetapkan ownership, kebutuhan dan acceptance; B01 merancang tipe/error/runtime validation yang konkret. Nama operasi target bukan bukti function/RPC telah ada. Reviewer belum memberikan sign-off pada B00.

Bukti penutupan per kontrak: lokasi producer+consumer/export, versi request/response/error, runtime validation, test dan review consumer. Satu writer per command.

### O04 — Queue, lease dan makna status email

`job_runs` memiliki state queued/running/succeeded/retryable_failed/dead, sedangkan requirement email memakai sent/failed/dead sebagai bahasa hasil pengiriman. Jangan menambah enum/table untuk menyamakan istilah. Usulan: state job mengatur eksekusi; accepted oleh provider dicatat terpisah dari bukti delivered/received. Tanpa delivery event/bukti penerimaan, jangan menyebut email diterima hanya karena HTTP provider sukses.

Entity order + dedupe orderId/templateVersion, provider reference/idempotency, retry/timeout ambigu, satu claim/lease contract dan scheduler/PIC harus direview bersama. Worker email/payment milik Indro; indexing memory milik Steven; dukungan atomic DB milik Rafi. Lease harus mencegah double-claim; tidak menjamin exactly-once side effect HTTP universal.

Bukti penutupan: kontrak agreed, atomic claim/retry tests, satu logical email job pada replay, dan email aktual diterima untuk acceptance P0.

### O05 — Email saat owner menerima late payment

PRD menuntut email setelah payment benar-benar applied. Deskripsi `accept_late_payment` belum sejelas enqueue di `apply_verified_payment`. C5 harus mencakup first-applied melalui jalur owner tersebut, bukan webhook saja. Saat masih review/unapplied, tidak mengirim email sukses.

Rekomendasi review Rafi + Indro: application payment pertama, audit dan email dedupe dilakukan satu transaksi pada seluruh jalur sukses. Perubahan SQL hanya pada tugas terpisah. Bukti: jalur late-accept menghasilkan satu logical email job; reject/replay tidak menambah efek.

### O06 — Provider, sender, scheduling dan embedding profile

Kemampuan QRIS/expiry/callback URL merchant Sandbox; email provider/sender/domain/recipient uji; scheduler cadence/lease timeout; model embedding yang kompatibel 768 belum diverifikasi pada akun. Jangan mengarang provider/model/plan hosting atau membaca nilai `.env` untuk tugas dokumentasi.

PIC usulan: Indro payment/email; Steven AI/profile embedding; satu integrator hosting. Bukti penutupan: konfigurasi tanpa secret, hasil spike/provider yang nyata dan koordinasi endpoint. Daftar ini bukan izin mengubah remote atau mengirim email uji otomatis.

## Koreksi dokumentasi yang selesai di B00

- Path PRD lama sekarang berisi v2.1; nama file sumber menjadi pointer.
- Schema target v2.1 disalin utuh pada path kanonik; root pointer tidak menjadi schema kedua.
- Root AGENTS dipulihkan dari `main` dan diberi baseline v2.1; blok Next.js dipertahankan.
- Rujukan open-review dikoreksi lewat peta: **schema §24**, bukan §18.
- Database rules membedakan local-first dari klaim CLI/migration applied yang belum terbukti.
- Baseline dokumentasi dari `main` lokal; perubahan yang belum di-commit pada branch lain tidak dipindahkan. Tidak ada merge/commit.

## Menutup keputusan

Catat keputusan pengguna/tim, tanggal, PIC/reviewer, alternatif dan alasan, dokumen yang diubah, serta bukti test/commit bila ada. Jangan mengubah OPEN menjadi APPROVED hanya karena agent memberi rekomendasi. Tugas docs tidak mengotorisasi migration/deploy; prerequisite yang belum siap memblokir bagian dependent, bukan pekerjaan independen.

## Privasi dokumentasi bersama

Dokumen bersama hanya merujuk file yang akan tersedia dalam repository. Catatan kerja individu disimpan lokal dan diabaikan Git; bukan dependensi pembaca PRD, schema atau kontrak integrasi. Nama penanggung jawab pada kontrak dipertahankan karena diperlukan untuk koordinasi tim. Perapian privasi tidak menyelesaikan keputusan OPEN di atas.
