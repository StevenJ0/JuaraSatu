# Pedoman UI Campaign Lab

Acuan desain lintas modul, 3 November 2026. PRD v2.1 dan kontrak integrasi tetap menjadi sumber aturan bisnis. Dokumen ini tidak mengubah scope atau mengimplementasikan modul transaksi.

## Identitas yang dipakai bersama

Gunakan token warna, tipografi, focus dan spacing yang sudah tersedia. Hijau menunjukkan identitas/aksi, netral untuk isi dan pembatas, aprikot untuk perhatian yang dijelaskan dengan teks. Status juga memiliki label; warna tidak menjadi satu-satunya penanda. Pertahankan satu keluarga ikon dan komponen interaksi yang konsisten.

Landing mengikuti komposisi Owner.com: hero sans-serif besar terpusat, preview produk dominan, panel beradius luas dan satu CTA utama. Ini acuan halaman pengenalan. Formulir, tabel, dashboard dan data operasional memakai hierarki berdasarkan tugas pengguna; tidak meniru komposisi marketing. Angka memakai tabular numerals. Identitas warna/ikon dapat dipakai bersama, sementara skala heading, kepadatan dan ukuran panel disesuaikan konteks layar. Font serta CSS global tetap.

## Layar dimulai dari tugas pemilik usaha

| Layar | Pertanyaan utama | Informasi/tindakan prioritas |
|---|---|---|
| Ringkasan usaha | Apa yang perlu saya tangani sekarang? | Pesanan perlu konfirmasi, siap diserahkan, kapasitas tersedia |
| Detail preorder | Masih bisa menerima berapa unit? | Available quantity, held/allocated, cutoff, pickup date, link publik |
| Pesanan | Apa tindakan berikutnya untuk pesanan ini? | Payment dan fulfillment terpisah; CTA sesuai transisi yang diizinkan |
| Penawaran | Apakah rencana ini dapat dijalankan? | Kapasitas, cost quality, harga, contribution, alasan guard, persetujuan |
| Laporan | Angka ini mencakup transaksi yang mana? | Scope preorder/campaign, periode, data missing, rincian biaya dan atribusi |

Jangan mengisi dashboard dengan angka agregat yang tidak menunjang keputusan. Gunakan tabel untuk membandingkan pesanan, form berlabel untuk input, dan kartu ringkasan bila pengguna memang perlu membandingkan beberapa angka.

## Teks dan hierarki

- Judul menerangkan isi atau tugas, misalnya “Pesanan menunggu konfirmasi”.
- Tombol menyebut tindakan, misalnya “Konfirmasi penyerahan”, dengan syarat akses/transisi mengikuti PRD.
- Pisahkan istilah target, kuota, kapasitas tersedia, unit dibayar dan unit diserahkan.
- Jelaskan kontribusi sebelum menyebutnya; jangan mengganti label menjadi laba bersih.
- Kontribusi unknown tidak dirender sebagai0. Harga/biaya otoritatif berasal dari kalkulator bersama dan database, bukan fixture landing.
- Uraian pendek lebih dahulu. Rincian historis/finansial tersedia melalui disclosure dengan nama yang jelas.
- Satu aksi dominan per konteks; hindari beberapa tombol utama untuk tujuan serupa.

## Status yang perlu dirancang di setiap modul

Siapkan keadaan awal/kosong, loading, error validasi, kegagalan jaringan, sukses terverifikasi, kapasitas habis, dan akses tidak tersedia. Gunakan teks yang menjelaskan langkah berikutnya. Jangan menampilkan sukses hanya karena tombol ditekan atau browser diarahkan kembali dari pembayaran.

Pertahankan input saat terjadi error yang dapat diperbaiki. Kelompokkan error dengan field terkait, dan arahkan fokus bila diperlukan. Aksi sibuk harus mencegah pengiriman berulang pada UI; idempotency server tetap wajib. Status transaksi dan angka finansial tidak boleh dibuat oleh AI.

## Responsif dan aksesibilitas

Pastikan urutan baca tetap masuk akal ketika kolom ditumpuk. Utamakan informasi dan tindakan yang diperlukan; rincian tetap dapat ditemukan. Sediakan keyboard/focus terlihat, nama kontrol, label field, kontras yang memadai dan pengurangan gerak. Jangan menghilangkan data penting untuk mengejar tampilan bersih.

## Bukti sebelum klaim

Fixture hanya untuk demonstrasi yang diberi label. Jangan mengarang wawancara, nama pengguna, testimoni, statistik dampak atau hasil transaksi. Uji alur nyata sesuai gate modul. Penilaian visual dan pengujian pengguna dilaporkan terpisah dari lint, build, golden assertions dan pemeriksaan database/provider.
