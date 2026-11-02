# Aturan database dan batas verifikasi

Baseline dokumentasi B00 — 2 November 2026. Kontrak data: [schema v2.1](../schema.md). Konflik terbuka: [DECISIONS](../DECISIONS.md).

## Izin dan sumber kebenaran

- Untuk tugas biasa, schema/SQL/migration/RLS/RPC/index/grants adalah read-only. Tugas B00 hanya menempatkan dokumen target pengguna pada path kanonik; tidak membuat definisi data baru, SQL atau perubahan database.
- Perubahan struktur/kontrak memerlukan tugas schema terpisah yang eksplisit dan reviewer tim, sesuai root AGENTS. Prosedur di sini tidak memberi izin menjalankan perintah.
- Git migration chain yang benar-benar tersedia + metadata DB yang diperiksa menjadi bukti implementasi. Schema v2.1 adalah **target 26 tabel**, bukan bukti seluruhnya telah dibuat/diterapkan.
- Migration yang sudah diterapkan tidak diedit/di-rename/dihapus. Koreksi memakai migration baru setelah audit drift dan review.

## Local-first dan integrasi tim

1. Setiap developer menggunakan Supabase lokal sendiri; tidak tersinkron otomatis dengan lokal anggota lain atau cloud.
2. Periksa branch fondasi, dependency, `supabase/config.toml`, migration chain dan Docker aktual dahulu. Jangan menyatakan CLI terpasang/config committed dari dokumen lama. B00 tidak menjalankan init/start/reset.
3. Dalam tugas schema terotorisasi: usulkan perubahan, audit semua consumer, buat migration baru dan selaraskan dokumentasi/types/test. Minimal satu reviewer anggota lain; payment/reservation memerlukan Rafi.
4. Uji chain lengkap pada DB lokal terisolasi, termasuk RLS/tenant, race capacity, replay payment, audit dan email enqueue. Reset lokal menghapus data dan bukan tindakan otomatis.
5. Integrasikan melalui workflow tim. Satu PIC remote ditunjuk; applied schema/history diverifikasi sebelum rencana deploy. Merge Git bukan bukti migration sukses.

Tidak menjalankan reset remote, `db push`, SQL Dashboard atau eksperimen di shared cloud pada tugas biasa. Deploy migration dan perubahan konfigurasi provider memerlukan instruksi spesifik. Contoh prosedur dalam PRD bukan otorisasi operasi.

## Batas domain yang tidak boleh dilemahkan

- Akses privat berdasarkan tenant yang diotorisasi server dan RLS, bukan `business_id` browser. Public buyer hanya menerima DTO whitelist dan akses order dengan token yang sesuai; jangan membuka tabel order ke anon.
- Uang IDR integer, diskon bps, rounding konsisten melalui calculator bersama; snapshot transaksi immutable. Reservasi/order/payment apply harus atomik dan idempotent, bukan beberapa insert dari UI.
- Payment Sandbox satu merchant tim; redirect client bukan bukti paid. Applied payment + audit + job `send_paid_email` satu transaksi, delivery sesudah commit.
- Jobs memakai dedupe dan lease bersama. Raw token tracking dan secret tidak masuk jobs, log, source atau screenshot. Provider accepted tidak otomatis berarti email diterima.
- Memory hanya `campaign_memories` privat, vector 768, tenant filter sebelum limit; tidak menambah `knowledge_documents`/`knowledge_chunks` target dari baseline lama.
- Seed/fixture sintetis berlabel dan tanpa PII. Jangan mengubah data agar demo tampak berhasil. Secret tetap server/environment; `.env` tidak dibaca pada tugas dokumen.

## Hal yang belum diputuskan

Capacity constraint, detail shared job lease/scheduler, late-payment email path dan embedding/provider profile tetap mengikuti daftar OPEN di decision log. Jangan menulis migration berdasarkan rekomendasi yang belum disepakati. Baseline 17/19 tabel yang disebut aturan lama harus direkonsiliasi dengan **file dan metadata aktual** sebelum menjadi dasar pekerjaan berikutnya.
