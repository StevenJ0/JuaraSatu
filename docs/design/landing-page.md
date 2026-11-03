# Campaign Lab — komposisi landing mengacu Owner

Revisi 3 November 2026. Route `/`, branch `landing-page`.

## Keputusan produk dan arah visual

Pemilik proyek menyetujui Owner.com sebagai acuan komposisi visual landing, dengan isi Campaign Lab dan pemisahan desain landing dari layar aplikasi. Revisi ini menggantikan komposisi hero editorial sebelumnya.

Referensi publik yang ditinjau pada desktop dan mobile: [Owner.com](https://www.owner.com/). Implementasi memakai markup, CSS, diagram kapasitas dan ilustrasi produk milik proyek. Font, kode, screenshot aplikasi, foto, logo, ulasan, statistik pelanggan dan hasil penjualan Owner tidak dipindahkan.

Campaign Lab tetap platform preorder untuk usaha produk standar yang meninjau promosi berdasarkan kapasitas dan biaya. Satu preorder satu SKU, bisa beberapa unit dalam satu order, satu jadwal pengambilan. Promosi opsional. Ini bukan platform restoran, SEO, POS, layanan pengantaran atau situs penjualan kaos contoh.

Hero: **Kelola preorder dan promosi sesuai kapasitas usahamu.**

Deskripsi: Bagikan halaman pesanan ke pelanggan. Rencanakan penawaran dengan melihat sisa kuota dan biaya produk.

## Pemetaan komposisi

| Pola referensi | Implementasi Campaign Lab |
|---|---|
| Navigasi sederhana dan CTA di kanan | Brand, tiga anchor alur, CTA ke contoh preorder |
| Headline sans-serif besar dan terpusat | Pesan spesifik preorder/kapasitas, tanpa slogan pertumbuhan |
| Satu aksi utama di hero | “Lihat contoh preorder”, bukan form pencarian restoran atau signup palsu |
| Mockup ponsel di bidang hijau lebar | Ringkasan kapasitas Campaign Lab berupa HTML/CSS, dalam bingkai perangkat orisinal |
| Panel produk dengan bidang warna luas | Penawaran dan laporan memakai radius, tipografi dan skala ruang yang selaras |
| Bukti pelanggan | Tidak dibuat jika belum ada; diganti demonstrasi alur yang dilabel data contoh |
| CTA penutup | Navigasi kembali ke contoh, bukan permintaan demo yang tidak memiliki alur |

## Konsistensi visual

- Seluruh landing memakai sans-serif. Heading hero besar, tebal, rata tengah; bagian penting berwarna hijau. Pemenggalan alami dengan `text-wrap: balance`; tanpa `<br>` yang memaksa baris.
- Latar landing putih memakai token surface yang ada. Bidang hijau memakai gradient CSS dari token brand/brand-soft dan garis dekoratif CSS, bukan aset Owner.
- Radius konsisten: tombol14–16px, panel24–32px, bingkai ponsel36–44px. Elemen data tetap ringkas dan terbaca.
- Hero memiliki satu CTA utama. Header dan CTA penutup mengikuti tujuan yang sama. Menu mobile tetap native disclosure dengan enhancement client yang sudah ada.
- Seluruh data preview adalah teks/struktur HTML yang terbaca. Bingkai perangkat dan ilustrasi kaos bersifat dekoratif dengan `aria-hidden`.
- Foto/ulasan/statistik adopsi tidak ditambahkan. Tidak ada carousel autoplay, parallax, headline bergerak atau dependency/font eksternal.
- Global CSS, token global, Brand, ButtonLink dan Icon tidak diubah. Seluruh komposisi dan radius baru dibatasi pada CSS Module marketing.

Skill **brand** dipakai untuk menjaga positioning dan arsitektur pesan. **ui-ux-pro-max** dipakai untuk hierarki heading, pembungkusan teks dan responsivitas; rekomendasi otomatis mengenai palet indigo, social proof, parallax dan video tidak diterapkan karena tidak cocok dengan identitas/bukti proyek. Implementasi server/client dan CSS Modules mengikuti dokumentasi Next.js terbundel.

## Cerita yang dipertahankan

1. `#contoh-penggunaan`: kapasitas40−paid30−held2=available8. Angka tersedia8 dominan; mockup tidak berisi kontrol checkout palsu.
2. `#cara-kerja`: dua reservasi dilepas sebelum promosi, sehingga available10. Harga120.000, diskon10%, final108.000, variable cost75.000, contribution33.000/unit. Pilih ide, setujui rencana dan terbitkan tetap terpisah.
3. `#contoh-hasil`: final paid38/40=95%; campaign paid8, linked5/unattributed3. Rincian biaya dibuka melalui dua disclosure laporan.
4. `#manfaat`: batas satu SKU/banyak unit, status bayar/penyerahan terpisah dan promosi opsional.
5. FAQ, CTA penutup dan footer status prototipe.

Target40 bukan minimum produksi. Diskon aktif berlaku bagi seluruh checkout baru, bukan hanya link campaign; harga order sebelumnya tetap. Data contoh akhir mengasumsikan38unit paid sudah fulfilled, tanpa menyamakan kedua status.

Campaign revenue864.000−production600.000−promo50.000=contribution214.000. Seluruh preorder revenue4.464.000−production2.850.000−promo50.000=contribution1.564.000. Kedua laporan tidak dijumlahkan. Contribution bukan laba bersih atau bukti sebab-akibat promosi.

Sumber angka `src/features/marketing/demo-data.ts` dan checker22golden assertion tidak diubah. Fixture tidak boleh menjadi kalkulator checkout atau transaksi produksi.

## Batas landing dan aplikasi

Komposisi Owner menjadi acuan halaman pengenalan. Dashboard, checkout, tracking dan laporan operasional tetap mengikuti tugas, status dan guard PRD. Pedoman bersama ada pada [website-guidelines.md](website-guidelines.md). Tidak ada modul backend, tabel/migration, provider, auth atau transaksi yang ditambahkan oleh revisi ini.

Pemesanan, AI, pembayaran dan email pada landing belum terhubung. Pembayaran yang direncanakan tetap Midtrans Sandbox. Tidak ada klaim hasil pengguna atau validasi bisnis yang belum dilakukan.

## Verifikasi revisi ini

Hasil aktual 3 November 2026 setelah komposisi Owner diterapkan:

| Pemeriksaan | Hasil |
|---|---|
| ESLint dan TypeScript tanpa emit | Lulus |
| Golden fixture | 22 assertion lulus, sumber angka tidak diubah |
| Build produksi Webpack | Lulus; route utama statis |
| Referensi kelas CSS Module | Seluruh kelas yang digunakan tersedia |
| HTML offline320/360/375/390/768/900/901/1024/1440px | Tanpa overflow horizontal |
| Anchor, skip link, offset sticky header | Lulus; CTA hero menuju preview preorder |
| Delapan disclosure isi | Buka/tutup keyboard dan expanded state lulus |
| Seluruh disclosure terbuka | Tidak overflow; semua nominal contoh sesuai fixture |
| Menu mobile native tanpa script | Buka/tutup keyboard lulus |
| Landscape844×390 dan reduced motion | Lulus |
| Reflow CSS zoom200% | Lulus; bukan sertifikasi zoom OS/browser |
| Tinjauan visual | Hero desktop, mockup ponsel mobile dan panel penawaran diperiksa |
| Console/jaringan pada HTML offline | Tidak ada error teramati; bukan pengujian HTTP |

HTML hasil build diperiksa melalui file lokal dengan stylesheet produksi inline dan script aplikasi dihapus. Tidak ada server preview yang dijalankan. Hydration, enhancement menu client dan routing HTTP belum diuji pada revisi ini; tidak ada verifikasi backend/provider atau uji pengguna.

Hasil uji/screenshot versi editorial, Inviro dan landing terdahulu bukan validasi revisi ini. Penghapusan screenshot oleh pengguna dipertahankan; bukti baru hanya disimpan sementara di luar repo.

Server preview tidak dijalankan sesuai preferensi pengguna. Jika HTML hasil build diperiksa offline, itu tidak membuktikan hydration menu, routing HTTP, database atau pembayaran. Uji dengan calon pengguna tetap belum dilakukan.

## Menjalankan sendiri

```bash
npm run dev
```

Pemeriksaan kode: `npm run lint`, `npx tsc --noEmit --incremental false`, `node scripts/check-landing-demo.mjs`, `npm run build -- --webpack`.

Tidak ada staging, commit, push atau deployment otomatis.

## Footer platform — 3 November 2026

Footer diadaptasi dari komposisi footer publik Owner: brand dan dua CTA di baris atas, kelompok navigasi, lalu informasi bawah. Implementasi berada pada Server Component `src/features/marketing/platform-footer.tsx` dan CSS Module marketing. Tidak ada dependency baru.

Empat kelompok: Kelola preorder, Rencanakan promosi, Pahami hasil, Tentang platform. Tautan menunjuk contoh, lingkup penggunaan, simulasi, alur persetujuan, masing-masing laporan, FAQ dan status produk. Anchor fokus ditambahkan pada alur persetujuan serta dua figure laporan. Tidak ada tautan dashboard, kontak, sosial, pricing atau kebijakan yang belum tersedia. Status prototipe/Sandbox tetap terlihat, disusul copyright2026 dan konteks GTNIC.

Layout empat kolom pada desktop dan dua pada tablet/mobile. Menu tautan dan CTA memiliki target minimum44px. Lint, TypeScript, build produksi Webpack, referensi kelas CSS dan `git diff --check` lulus. Pemeriksaan footer dari HTML offline pada320/375/768/1024/1440px lulus tanpa overflow, tanpa ID duplikat, dengan empat landmark navigasi bernama dan seluruh tujuan anchor tersedia. Semua tautan footer diuji melalui keyboard pada375px. Screenshot desktop/mobile ditinjau, disimpan sementara di luar repo.

Verifikasi bagian sebelumnya adalah pemeriksaan komposisi sebelum penambahan footer; hasil footer terbaru terbatas pada pemeriksaan di paragraf ini. Tidak ada server preview, pengujian hydration/HTTP/backend atau commit. Penghapusan screenshot dan perubahan pengguna di luar scope tetap dipertahankan.

## Penutup sesuai gambar pengguna — 3 November 2026

Keputusan terbaru menggantikan footer empat kolom di bagian sebelumnya. Bagian yang dimaksud pengguna adalah panel CTA hijau dengan headline putih, dua tombol, dan perangkat miring. Panel kini memakai lebar penuh, sudut atas besar, gradient hijau berbasis token brand, serta tekstur SVG prosedural. Teks kiri tetap “Mulai dari preorder yang bisa kamu penuhi.” Tombol menuju contoh preorder dan cara kerja yang sudah tersedia.

Mockup kanan memakai `PreorderPhone` bersama dari `product-preview.tsx`, dengan ID judul unik pada setiap penempatan. Kontennya ilustrasi Campaign Lab, bukan aset/foto restoran Owner. Salinan dekoratif di penutup memiliki `aria-hidden`, tanpa kontrol interaktif. Perangkat menonjol di atas panel dan bagian bawahnya terpotong oleh lapisan putih, mengikuti komposisi gambar. Pada tablet/mobile, teks dan tombol berada di atas ponsel untuk mencegah tumpang tindih.

`PlatformFooter` kini strip putih ringkas dengan brand, copyright/GTNIC, FAQ, kembali ke atas, serta status prototipe/Sandbox. Navigasi empat kolom dihapus. CSS global, token dan modul transaksi tidak diubah.

Verifikasi revisi akhir: lint, TypeScript, dua build Webpack (setelah perbaikan posisi ponsel),22golden assertion dan `git diff --check` lulus. HTML offline pada320/375/768/900/901/1024/1440px tidak overflow, tidak memiliki ID duplikat dan semua anchor valid. Dua CTA berukuran minimal52px pada mobile/56px desktop, bisa diaktifkan dengan keyboard dan tidak tertutup visual. Posisi atas perangkat desktop berada di dalam area panel setelah ruang protrusi ditambahkan. Reflow CSS zoom200% lulus. Screenshot desktop/mobile dan breakpoint901 ditinjau; bukti tetap sementara di luar repo. Tidak ada server preview, commit, atau pengujian hydration/HTTP/backend pada revisi ini.

## Proporsi ponsel pertama — 3 November 2026

Mockup hero kini memakai rasio desain9:19,5 dan ukuran desktop420×910CSSpx. Tinggi tidak lagi mengikuti jumlah konten. Bezel, sudut, cutout kamera serta indikator bawah disesuaikan; teks dan ruang layar dibesarkan pada desktop. Susunan flex membagi ruang antarkonten agar tidak menyisakan blok kosong besar. Pada layar kecil, lebar mengikuti ruang yang tersedia dengan rasio tetap dan teks tetap terbaca.

Seluruh aturan baru dibatasi pada turunan `.productPreview`, sehingga ukuran/transform mockup miring pada panel penutup tidak berubah. Tidak ada perubahan komponen TSX, fixture angka, CSS global atau dependency.

Build produksi Webpack (termasuk TypeScript) dan `git diff --check` lulus. Pemeriksaan HTML offline pada320/375/768/1024/1440px: rasio perangkat sesuai, tidak ada overflow halaman/isi layar, ledger tidak menutupi catatan, dan indikator bawah tampil. Ukuran yang terukur:276×598px pada viewport320,311×673,83px pada375, dan420×910px pada tablet/desktop. Screenshot desktop/mobile ditinjau, tetap disimpan sementara di luar repo. Tidak ada server preview, commit atau verifikasi hydration/HTTP/backend pada revisi ini.

## Panel horizontal penuh — 3 November 2026

Bidang latar preview ponsel, penawaran, laporan dan FAQ kini membentang sampai kedua tepi viewport, selaras dengan panel penutup/footer. Lapisan luar dipisahkan dari container isi; isi tetap memakai lebar maksimum1224px dan gutter global yang sama dengan footer. Radius permukaan luar56px pada desktop dan32px pada mobile. Kartu data di dalam panel tetap memiliki padding sendiri. Tidak ada pengubahan token/container global atau penggunaan100vw/negative margin untuk memaksa lebar.

Ukuran dan rasio ponsel pertama dipertahankan dengan penyesuaian max-width berdasarkan viewport baru. Semua anchor, angka, interaksi disclosure dan batas prototype tetap.

Lint, build produksi Webpack (termasuk TypeScript), referensi kelas CSS dan `git diff --check` lulus. Verifikasi HTML offline pada320/375/768/900/901/1024/1440/1920px memastikan empat bidang luar mulai padax0 dan selebar viewport, serta container isi penawaran/laporan/FAQ persis sejajar dengan container footer. Tidak ada overflow horizontal, termasuk ketika semua rincian dibuka. Mockup tetap276px pada viewport320,311px pada375 dan420px pada tablet/desktop, dengan rasio9:19,5. Screenshot desktop/mobile ditinjau dan tetap sementara di luar repo. Tidak ada server preview, commit atau pengujian hydration/HTTP/backend pada revisi ini.
