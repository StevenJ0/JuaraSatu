# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Pemilik UMKM (utama):** satu pemilik per usaha, menjual produk standar lewat preorder (contoh demo: kaos satu SKU). Mengelola usaha, produk, kapasitas produksi, preorder, pesanan, dan promosi. Banyak bekerja dari HP. Tidak diasumsikan paham istilah marketing atau teknis.
- **Pembeli (tamu):** memesan tanpa akun lewat halaman preorder publik, membayar QRIS Sandbox, melacak pesanan lewat tautan privat.
- **Juri dan penonton demo GTNIC 2026:** menilai fungsi dan batas klaim dalam demo singkat.

## Product Purpose

Juara Satu (nama internal repo: Campaign Lab) membantu UMKM membuka preorder, merencanakan promosi berbasis data, dan memahami hasilnya. Campaign AI membantu pemilik menyusun strategi promosi dari fakta preorder sungguhan, menyetujui rencana, lalu menerbitkan kampanye yang langsung memengaruhi harga checkout. Sukses: pemilik sampai ke kampanye yang terbit tanpa bimbingan developer, dengan angka yang benar.

## Positioning

Promosi diputuskan dari data preorder milik usaha itu sendiri (harga beku, biaya, kuota, kapasitas, pembayaran terverifikasi), dengan angka keuangan dan kapasitas dihitung kode server, bukan AI. AI hanya mengusulkan dan menjelaskan, pemilik yang memutuskan. Diskon kampanye berlaku untuk semua checkout baru selama periode, dan hasilnya diukur dari pembayaran yang benar-benar diterapkan.

## Operating Context

- Alur pemilik: profil usaha → produk dan biaya → kapasitas → preorder terbit → diskusi AI → pilih usulan → rencana kampanye (blueprint) → setujui → terbitkan → bagikan tautan manual → pantau hasil.
- Demo kompetisi GTNIC 2026, deadline 10 November 2026 23.59 WIB.
- Pembayaran memakai satu akun Midtrans Sandbox tim; semua transaksi simulasi, tidak ada uang nyata.

## Capabilities and Constraints

- Satu preorder = satu produk/SKU; satu kampanye untuk satu preorder; hanya satu kampanye terbit per preorder pada satu waktu.
- Penawaran hanya harga normal atau diskon persen; pendekatan: pengingat terjadwal, konten nilai produk, diskon terbatas.
- Kampanye hanya bisa terbit bila periodenya sudah mulai; tanggal mulai usulan disetel ke saat terbit.
- Tidak ada pembuatan gambar, poster, atau posting otomatis. Caption disalin manual oleh pemilik.
- Usulan AI wajib ditinjau dan disetujui pemilik; memilih usulan ≠ menyetujui rencana ≠ menerbitkan.
- Volume dan biaya promosi adalah asumsi, bukan prediksi; tidak ada klaim hasil pasti atau sebab-akibat.
- Kuota Gemini gratis terbatas (20 request per hari per model saat ini).
- Evaluasi kampanye dan Business Memory baru tersedia di mode pengembangan, belum untuk pemilik.

## Brand Commitments

- Nama produk di UI: **Juara Satu**. Bahasa UI: Indonesia (`id-ID`).
- Teks UI tanpa em dash dan tanpa titik koma.
- Label simulasi atau sintetis wajib tampil di mana pun data bisa dikira nyata.

## Evidence on Hand

- PRD: `docs/requirements/PRD.md` (v2.1). Kontrak database: `docs/schema.md`.
- Data demo lokal: usaha "Kaos Juara Demo", preorder "Preorder Kaos Juara".
- Belum ada pengguna nyata, testimoni, atau angka penjualan nyata; jangan mengarang.

## Product Principles

1. Fakta dari server, keputusan dari pemilik, AI hanya membantu.
2. Setiap angka yang tampil bisa ditelusuri ke data atau ditandai sebagai asumsi.
3. Jalur dari preorder ke kampanye terbit harus jelas tanpa istilah teknis.
4. Jujur soal batas: simulasi diberi label, kegagalan dijelaskan dengan bahasa biasa.
