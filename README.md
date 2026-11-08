# Campaign Lab

Platform manajemen preorder dan perencanaan promosi berbasis data untuk UMKM, proyek GTNIC 2026.

Alur target: produk/kapasitas → preorder mandiri → order/pembayaran Sandbox/email → rencana promosi dengan AI → persetujuan pemilik → campaign → dua analytics dan evaluasi privat.

**Status:** B00 menyelaraskan dokumentasi. Checkout branch B00 berasal dari starter pada `main` lokal; fitur bisnis, database, payment, email dan AI belum diverifikasi berjalan di sini. Landing tersedia pada branch terpisah. Referensi lokal foundation belum terintegrasi dan branch-nya tidak tercantum pada remote saat audit; lihat [keputusan terbuka](docs/DECISIONS.md).

## Mulai membaca

1. [Instruksi agent](AGENTS.md) dan [peta dokumen](docs/README.md).
2. [PRD v2.1](docs/requirements/PRD.md), [schema target v2.1](docs/schema.md), [keputusan terbuka](docs/DECISIONS.md).
3. [Kontrak tim](docs/architecture/integration-contracts.md) dan pembagian kerja PRD §21–22.
4. [Aturan database](docs/requirements/database-rules.md), lalu kode/config/migrations yang benar-benar ada pada branch kerja.

## Development aplikasi

Gunakan versi Node/npm yang sesuai dependency dan lockfile aktual, lalu `npm ci` dan `npm run dev`. Script tambahan dibaca dari `package.json`; jangan mengarang script test. B00 tidak menginstal dependency, menjalankan provider, atau memverifikasi aplikasi melalui build.

Setup Supabase mengikuti foundation tim setelah review/integrasi; jangan membuat ulang client/config atau menjalankan init/reset/migration dari asumsi dokumentasi. Secret hanya dalam environment lokal/server, tidak pernah di source atau output chat.

## Cara bekerja

Kerjakan satu slice pada branch khusus, verifikasi sesuai scope, lalu serahkan diff. **Pengembang pemilik task melakukan staging dan commit sendiri.** Tidak ada push, merge, deployment atau perubahan schema otomatis. Perubahan schema memerlukan tugas terpisah dan review tim. Data sintetis/Sandbox harus diberi label; tidak membuktikan dampak bisnis nyata.
