# B03 — Halaman preorder publik (harga normal)

Tanggal: 5 November 2026. Branch `feat/indro-public-preorder`, base Rafi `e47da8057043ebf1e955b41580690e5a8b826b6c`.

**Status: kode dan tes lokal tersedia; integrasi database nyata serta review producer C1 belum diverifikasi.** Slice ini membuka `/p/[slug]` dengan harga normal. Campaign link `/c/[slug]`, discount/current-offer C2/C8, guest submit B04, pembayaran, dan tracking belum termasuk. Jangan menandai seluruh B03 campaign-aware atau alur buyer-to-paid selesai.

## Acuan

Target PRD/schema v2.1 tersedia pada branch `docs/indro-baseline-contracts`; dokumen bawaan base Rafi masih berlabel v1.0. Implementasi mengikuti field yang benar-benar didefinisikan dalam migration core, product photos, dan preorder/order lifecycle Rafi. Tidak mengedit schema/migration/RLS/RPC/grants atau dokumen target.

## Alur baca dan privasi

1. `/p/[slug]` memvalidasi slug sebelum membuat client server. Halaman dynamic dan tidak di-cache statis; robots noindex/nofollow selama tahap demo.
2. Service-role client existing melakukan SELECT field terbatas berdasarkan slug, lifecycle non-draft, dan `published_at IS NOT NULL`. Tidak ada anonymous SELECT langsung dari browser.
3. Query mengambil bisnis publik, snapshot nama/SKU/harga item, deskripsi/foto katalog, snapshot pickup, total kapasitas, dan fakta quantity/state/expiry reservasi. Tidak mengambil customer data, biaya produksi, membership, token atau detail payment.
4. Row divalidasi dengan Zod. Relasi tenant/product/capacity diperiksa lagi sebelum mapping; draft/unpublished/unknown menjadi not-found. Error schema/database memakai pesan statis tanpa raw data.
5. `summarizeCapacity` existing digunakan untuk kapasitas dan kuota item. Availability adalah minimum keduanya setelah allocated dan hold yang belum expired; nilai minus diklem nol. Alokasi bukan otomatis paid dan tidak ditampilkan sebagai penjualan.
6. Query HEAD `count: exact` mengecek seluruh reservasi held/allocated untuk capacity + tenant yang sama. Jika nested rows terpotong oleh `max_rows` atau jumlah berubah antarkueri, pembaca gagal tertutup; tidak mengarang stok dari daftar yang tidak lengkap.
7. DTO baru hanya memuat data untuk buyer. Harga/nama/SKU dan pickup memakai snapshot; deskripsi dan foto memakai katalog saat ini. Foto harus berada di prefix bisnis terkait. Biaya dan raw reservation rows tidak masuk props halaman/response browser.

Availability ini **advisory**, bukan snapshot transaksi atomik. Dua query baca dapat berselisih saat concurrent update; count guard hanya mendeteksi ketidaklengkapan jumlah, bukan menjamin isolation semua nilai. C4/RPC Rafi tetap sumber keputusan kapasitas dan harga saat checkout. Untuk volume reservasi melampaui batas Data API, diperlukan agregat server/SQL yang disetujui melalui tugas schema tersendiri; bukan mengambil daftar terpotong diam-diam.

## UI dan route

- Foto produk (atau state foto belum ada), usaha, produk/SKU, harga per unit, kuota tersedia, batas pesan dan tanggal pickup.
- State `open`, `scheduled`, `full`, `closed`, `completed`, `cancelled`; deadline efektif minimum `ends_at` dan intake cutoff. Equality pada deadline sudah closed dan equality pada hold expiry sudah tidak ditahan.
- Loading, generic not-found, dan retry error state; tidak mengungkap private error.
- Informasi pickup/kontak diambil dari snapshot publik yang terkunci saat publish. Tidak otomatis membuat link WhatsApp/URL dari teks kontak yang belum tervalidasi.
- CTA hanya anchor pengambilan yang benar-benar tersedia. Form/charge belum ada pada B03; notice jujur menyebut pemesanan online sedang disiapkan. B04 dapat mengisi slot children di view tanpa menggandakan layout.
- Dashboard owner pada preorder non-draft kini memiliki link untuk membuka halaman buyer; preview draft tetap privat.
- Shared Campaign Lab tokens/Brand/format IDR/WIB tetap digunakan. Komposisi product detail terpisah dari landing marketing; tidak menambah font/icon package atau mengubah global theme. Skill UI/UX dipakai sebagai rekomendasi, bukan mengganti warna/fonts proyek secara otomatis.

## File terkait

- `src/features/public-preorder/read.ts`: server projection dan availability.
- `src/features/public-preorder/read.test.ts`: actual Supabase SDK dengan transport tiruan, projection/privacy/lifecycle/SSR tests.
- `src/features/public-preorder/page-view.tsx` dan `public-preorder.module.css`: buyer shell dan product detail.
- `src/app/p/[slug]/{page,loading,error,not-found}.tsx`: entry dan route states.
- `src/app/dashboard/preorders/[id]/page.tsx`: link owner ke public page.

## Verifikasi aktual

| Pemeriksaan | Hasil |
|---|---|
| `npm run test -- src/features/public-preorder/read.test.ts` | PASS, 27 tes |
| `npm run test` | PASS, 28 file / 336 tes pada baseline core + B03 |
| `npm run lint` | PASS setelah tautan internal diperbaiki ke Next Link |
| `npm run typecheck` | PASS |
| `npm run build -- --webpack` | PASS; route `/p/[slug]` dynamic, build memakai env Supabase sintetis |
| Browser offline | PASS pada 320/375/768/1024/1440/1920 px; tanpa overflow, anchor hilang, atau runtime exception; panjang nama/deskripsi/kontak diuji |
| State UI offline | Scheduled/full/closed/completed/cancelled diperiksa; desktop dan mobile screenshots dilihat |
| Database nyata / RLS / actual PostgREST embedding / service role deployment | NOT RUN |
| Browser hydration / HTTP route / buyer submit / payment / email | NOT RUN |

Browser QA menggunakan render SSR dengan fixture sintetis dan CSS build pada file URL. Tidak menjalankan server preview, tidak menghasilkan order, dan tidak menghubungi database/provider. Gambar kaos untuk QA adalah ilustrasi SVG fixture di temporary directory, bukan fallback produk dalam aplikasi. Screenshot/report disimpan di luar repo.

Typecheck/build dan mock-SDK tests tidak membuktikan foreign-key embedding atau deployment grants berjalan di database tim. Rafi perlu review projection C1 ini, dan pembaca harus diuji terhadap migration yang benar-benar diterapkan sebelum disebut integration verified.

## Handoff B04 dan keputusan yang belum selesai

1. Commit B03 dilakukan manual oleh Indro, lalu branch B04 dibuat dari commit tersebut. Jangan membuat commit otomatis atau mencampur perubahan B04 ke commit B03.
2. B04 memanggil `placePublicOrder` existing; tidak melakukan INSERT order/reservation sendiri. Token/idempotency harus tetap sama untuk retry respons hilang.
3. R5, akun Sandbox, token lookup/tracking dan durable public-checkout rate limiter belum tersedia pada baseline ini. Audit kesiapan sebelum membuka submit ke publik; UI tidak boleh menjanjikan pembayaran/email yang belum ada.
4. Campaign discount/resolver tidak boleh ditambahkan hanya di frontend. C2/C8 dan consumption atomik C4 perlu diselaraskan saat modul campaign tersedia.

Pesan commit yang disarankan: `feat(preorders): add public preorder storefront with safe server projection`.
