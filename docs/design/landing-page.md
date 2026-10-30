# Landing Page Platform — A3-02

Status: **usulan visual untuk review tim**, bukan brand final.
Scope: route `/`, anggota 3, berdasarkan PRD §15 dan masterplan A3-02/§9.

## Arah visual dan alasan

Platform operasional untuk usaha makanan preorder: hijau hutan, putih hangat,
dan aprikot untuk penawaran. Visual utama adalah HTML kapasitas, penawaran,
dan laporan. Tidak ada foto stok yang menyiratkan pelanggan/usaha nyata.
`JuaraSatu` masih nama kerja, dikelola pada `src/config/site.ts` bersama metadata.

Skill **ui-ux-pro-max** dipakai melalui pencarian design-system dan panduan
stack Next.js serta navigasi keyboard. Hasil pertama cocok pada prinsip ruang,
hierarki, dan kontras, tetapi mengarah pada warna kategori makanan umum.
Retry yang lebih spesifik justru memberikan typography pernikahan dan carousel
testimoni: **tidak relevan dan tidak diterapkan/disimpan sebagai rekomendasi
terverifikasi**. Arahan warna/tipografi di sini adalah pilihan desain untuk brief,
bukan klaim bahwa hasil skill pasti cocok atau sudah disetujui pengguna.

Halaman memakai variasi: hero split, masalah editorial, proses berurutan,
contoh perhitungan split, laporan dengan sisi penjelas, lalu penutup. Tidak ada
pricing SaaS, carousel, testimoni, pendaftaran, maupun tombol transaksi palsu.

## Tokens bersama

Sumber: `src/app/globals.css`. Semantic variables `--ui-*` dipetakan ke theme
Tailwind agar dapat dipakai melalui utility (`bg-brand`, `text-ink`, dll.).
Layout landing tetap lokal pada `landing.module.css`; dashboard tidak perlu
mewarisi grid, ukuran judul, atau komposisi halaman ini.

| Semantic token | Nilai | Peran |
| --- | --- | --- |
| `--ui-canvas` | `#f8f9f5` | Latar utama |
| `--ui-surface` | `#ffffff` | Permukaan antarmuka |
| `--ui-subtle` | `#f0f3ed` | Permukaan pembanding |
| `--ui-ink` | `#24392f` | Teks utama |
| `--ui-muted` | `#59665d` | Teks sekunder |
| `--ui-brand` | `#285b43` | CTA, fokus, data tersedia |
| `--ui-brand-hover` | `#1c4632` | Feedback CTA |
| `--ui-on-brand` | `#ffffff` | Teks di atas brand |
| `--ui-brand-soft` | `#e6eee5` | Permukaan kapasitas/kendali |
| `--ui-accent` | `#f4c994` | Penanda penawaran |
| `--ui-accent-soft` | `#fcf1e3` | Permukaan penawaran |
| `--ui-on-accent` | `#654526` | Teks pada penawaran |
| `--ui-line` | `#dce2d9` | Batas permukaan/data |
| `--ui-allocated` | `#849182` | Petak alokasi lama, dengan label teks |

Typography memakai **font sistem yang sudah tersedia**: Georgia untuk heading
landing, Arial/Helvetica untuk isi dan UI. Tidak ada request font eksternal,
font baru yang diunduh, atau dependency dekorasi. Heading halaman 42–68px,
judul bagian 36–48px, isi utama 15–16px, label/data UI minimum 12px. Heading
serif hanya diterapkan pada landing, bukan heading dashboard.

Spacing: basis 4/8px; jarak umum 16/24/32/48/64px; section 72–112px.
Container maksimum 1224px, gutter 32px desktop, 20px mobile, 16px pada <360px.
Radius kontrol 8px, panel 16px, panggung hero 20px. Border 1px untuk data dan
permukaan; shadow hanya pada menu mobile. Fokus 3px dengan offset 5px.

## Komponen bersama

- `ButtonLink`: anchor untuk navigasi, varian primary/secondary/inverse,
  tinggi minimum 48px, hover dan fokus keyboard. Tidak menyerupai submit bisnis.
- `Icon`: SVG orisinal dengan stroke konsisten, selalu dekoratif di samping teks.
  Kontrol ikon tunggal harus diberi nama pada elemen kontrolnya.
- `Brand`: working wordmark dan mark J orisinal, tautan kembali ke awal.
- `.ui-container`: shared horizontal container tanpa mengatur isi/grid dashboard.

## Konten dan arsitektur

`LandingPage`, `ProductPreview`, `OfferBreakdown`, dan `ResultPreview` adalah
Server Components. Hanya `MobileNavigation` memakai client: native details
agar tetap berfungsi tanpa JS, ditambah Escape, close on link, dan outside click.
Native summary mengekspos expanded state ke accessibility tree.

Seluruh angka berasal dari fixture `demo-data.ts`, bukan database atau kalkulator
produksi. Nilai turunan hanya menyusun contoh presentasi yang sama:

- Awal: kapasitas 40, alokasi lama 25, tersedia 15 kotak.
- Penawaran: 50.000 − 10% = 45.000; 45.000 − 30.000 = 15.000/kotak.
- Akhir: target 15, selesai diserahkan 10, capaian 66,7%, sisa kapasitas 5.
- 450.000 nilai penjualan simulasi − 300.000 biaya variabel − 50.000 biaya
  promosi aktual contoh = 100.000 estimasi kontribusi sebelum biaya lain.

UI membedakan kondisi awal dan akhir. Kontribusi bukan laba bersih; data tidak
membuktikan efek kausal diskon. Semua contoh berlabel **Contoh data sintetis**.
AI menyarankan teks; owner menyetujui. Demo pembayaran direncanakan melalui
satu akun Midtrans Sandbox tim tanpa uang nyata. Tidak ada QR palsu.

Tidak ada auth, API, simulator interaktif, checkout, form preorder, AI call,
pembayaran, database, atau `/c/[slug]`. Semua CTA menuju anchor yang ada.
Jangan sambungkan CTA onboarding sampai route dan fiturnya benar-benar tersedia.

## Aset dan lisensi

SVG mark, ikon, dan diagram dibuat langsung dalam kode. Tidak mengambil foto,
logo pelanggan, ilustrasi, atau font pihak ketiga. Tidak perlu atribusi aset
pihak ketiga pada halaman ini. `src/app/icon.svg` memakai working mark yang sama.

## Cara preview

`npm ci` untuk dependency yang sudah ada di lockfile, lalu `npm run dev`.
Jika worker Turbopack diblokir lingkungan, gunakan `npm run dev -- --webpack`.
Build alternatif: `npm run build -- --webpack`, lalu `npm run start`.
Script package tetap. Pipeline CSS memakai adapter resmi `@tailwindcss/postcss`
4.3.3 (seversi dengan Tailwind terpasang) melalui `postcss.config.mjs`. Satu
devDependency ini diperlukan agar utility CTA terbentuk pada kedua bundler,
bukan untuk dekorasi. Rule loader khusus Turbopack pada `next.config.ts`
dihapus untuk menghindari pemrosesan Tailwind dua kali; dependency lama tidak
dicopot. TypeScript dan ESLint tidak dilemahkan.

## Verifikasi final — 30 Oktober 2026

| Pemeriksaan | Hasil aktual |
| --- | --- |
| `npm run lint` | Lulus, tanpa perubahan aturan ESLint |
| `npx tsc --noEmit` | Lulus, strict tetap aktif |
| `npm run build` | Terblokir binding port worker Turbopack di sandbox, termasuk percobaan dengan eskalasi |
| `npm run build -- --webpack` | Lulus; `/` diprerender statis, `/icon.svg` tersedia |
| Golden-case fixture | 8 assertion sesuai PRD §15 lulus |
| `git diff --check` | Lulus |
| Kontras token | 8 pasangan teks/latar >=4,5:1; minimum yang diperiksa 5,09:1 |

Browser **Brave headless** memakai profil sementara, tanpa memakai profil/tab
pribadi. Alat native capture awalnya gagal; screenshot dan tes akhir diambil
langsung melalui browser headless pada build produksi, bukan dev server.
Hasil mesin: `docs/screenshots/landing/browser-checks.json`.

- 320/360/768/1440px: tidak ada horizontal overflow; satu h1; lang id; metadata
  produk; semua tujuan anchor tersedia; nilai sintetis golden case tampil.
- CSS CTA pada hasil produksi diperiksa (flex layout, tinggi minimum 48px,
  background brand dan foreground putih), bukan hanya keberadaan class source.
- Menu mobile: Enter buka, expanded state pada accessibility tree, Escape tutup
  dengan fokus kembali ke summary, memilih link menutup menu.
- Semua CTA/anchor diuji; target tidak tertutup sticky header. Skip link dengan
  keyboard memindahkan fokus ke main. Tidak ada form atau kontrol transaksi palsu.
- Reduced motion: tidak ada animasi aktif dan smooth scrolling mati.
- JavaScript nonaktif: konten server tetap terbaca dan menu disclosure native
  tetap dapat dibuka. Tidak ada console exception atau network response error.
- Screenshot setiap bagian, fold, menu, dan footer pada 360/768/1440px dibuka
  untuk review visual. Nama file memuat lebar dan bagian terkait.

Kontras pasangan utama: ink/canvas 11,67:1; muted/surface 6,03:1;
muted/brand-soft 5,09:1; muted/accent-soft 5,41:1; on-brand/brand 7,87:1;
on-accent/accent 5,60:1; brand/brand-soft 6,64:1; accent/brand 5,11:1.
Ini pemeriksaan pasangan token, bukan sertifikasi seluruh WCAG.

Batas: belum ada uji pemahaman dengan pemilik UMKM atau pengukuran dampak bisnis.
Tidak menguji auth, AI, transaksi, database, dan payment karena di luar modul ini.
PRD, schema, migration/RPC/RLS, AGENTS.md dan nilai secret tidak diubah/ditampilkan.
Tidak ada commit, push, atau deploy.
