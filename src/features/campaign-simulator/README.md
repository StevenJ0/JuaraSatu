# Campaign Simulator — Slice 2

Owner: Steven. Implementasi saat ini memakai typed development fixtures. Belum
terhubung C1 Rafi, C8 Indro, database, atau endpoint produksi.

## Development preview

Jalankan `npm run dev`, lalu buka `/dev/campaign-simulator`. Route hanya diizinkan
ketika `NODE_ENV=development`; production/test memanggil `notFound()` sebelum
dynamic import fixtures. Tidak ada API simulator yang menerima harga/biaya dari
browser. Preview memuat data sintetis dan waktu snapshot fixture secara eksplisit.
Loading Suspense berada di dalam cabang development, sesudah guard akses,
sehingga response production tidak lebih dahulu dikirim sebagai HTTP200.

Form mendukung diskon 0–99,99%, 0–10.000 additional units, biaya promosi integer
IDR, reset, rincian hasil, dan perbandingan harga normal/5%/skenario yang diisi.
Klik Bandingkan untuk mengatur unit dan biaya promosi secara independen pada
alternatif harga normal dan diskon 5%. Kolom Skenario Anda tetap memakai form
utama, termasuk diskon 0% jika ingin campaign harga normal. Tidak memilih pemenang.
Pada alternatif harga normal, biaya Rp0 secara eksplisit memodelkan baseline
hipotetis tanpa promosi tambahan; biaya >Rp0 memodelkan campaign harga normal.
Ini konvensi preview, bukan aturan bahwa setiap campaign harga normal pasti berbiaya.
Default 4/6/8 unit dan biaya 0/25k/50k adalah contoh asumsi pemilik, bukan hasil AI.
Default unit disesuaikan ke kapasitas snapshot jika lebih kecil. Input pengguna
yang melampaui min(orderableUnits,10.000) ditolak dengan error, tanpa clamp.
Input invalid dipertahankan dengan inline errors; hasil lama tidak ditampilkan
sebagai hasil baru. Reset mengembalikan ketiga asumsi. Tabel perbandingan dapat
digeser pada layar kecil. Warning DIFFERENT_ASSUMPTIONS ditampilkan ketika
unit/spend berbeda; selisih kontribusi tidak membuktikan efek promosi.

CSS memakai namespace `simulator-` agar cocok dengan custom CSS loader existing
yang memproses `.module.css` sebagai stylesheet biasa. Root styles/config tidak
diubah. Tidak ada stylesheet simulator yang memakai selector global tanpa scope.

## Public domain API

Import dari `@/features/campaign-simulator`:

- `simulateCampaign(facts: unknown, scenario: unknown)`:
  `SimulationOutcome<SimulationResult>`.
- `compareScenarios(facts: unknown, scenarios: unknown)`:
  `SimulationOutcome<{ scenarios: SimulationResult[]; warnings: SimulationMessage[] }>`.
- Input/output Zod schemas dan inferred TypeScript types tersedia dari entry
  point yang sama. Form parsing tersedia sebagai `SimulationFormSchema`.

Semua fungsi murni: tidak ada I/O, env, React, provider, atau clock real-time di
domain. UI memanggil domain yang sama untuk preview lokal. Production integration
kelak wajib memuat ulang facts dari authorized server readers dan menghitung ulang
di server sebelum dipakai planning; browser bukan authority atas facts.

`success=false` berarti input/source invalid atau hasil melampaui batas nominal;
hasil numerik tidak tersedia. Error berisi `{ code, field, message }`.
`success=true` berarti hasil dapat dihitung, **bukan** campaign layak dijalankan:
lihat `data.feasible`, `blockers`, dan `warnings`. Capacity excess dan financial
policy failures memblokir feasibility sambil tetap menampilkan angka what-if.
Estimated/unknown cost, biaya promosi yang tidak tertutup, dan C8 unavailable
ditampilkan sesuai warning/blocker masing-masing.

## Reuse C2 and arithmetic

Harga dan diskon selalu dihitung C2 melalui public module `pricing`:

- `calculateUnitPrice` memakai frozen base + hypothetical offer, termasuk q=0.
- q>0 memakai `calculateOrderPrice` untuk revenue dan batas subtotal Rp1 miliar.
- `validateCampaignDiscount` menyediakan financial guard planning; tidak
  mengubah atau menilai ulang eligibility current offer C8 berdasarkan biaya baru.

Aggregation variable cost/contribution memakai BigInt. Validated factors membatasi
intermediate di bawah safe integer range; output divalidasi lagi sebelum return.
Revenue/variable cost/promotion cost maksimal Rp1 miliar, signed contribution
di antara -Rp1 miliar dan Rp1 miliar. Overflow ditolak tanpa clamp.

Unknown variable cost tetap null untuk unit contribution, scenario cost, dan
scenario contribution, termasuk q=0. Biaya terverifikasi Rp0 berbeda dari unknown.
Dengan biaya diketahui, q=0 menghasilkan revenue/cost Rp0 dan kontribusi sebesar
negatif biaya promosi. Checkout C2 tetap menolak quantity=0.

Semua diskon hipotetis berasal dari frozen base, bukan harga current offer:
base120k + current10%=108k + hypothetical5% menghasilkan114k, bukan102.600.

## Producer boundary before production

`SimulationFactsSchema` merupakan projection kebutuhan simulator, bukan implementasi
atau kontrak final C1/C8. Tidak ada reader/repository palsu yang mengklaim integrasi.

| Producer | Data yang wajib disediakan reader server |
|---|---|
| Rafi / C1 | Server-authorized businessId, preorderId, preorderItemId; preorderName/productName; status; startsAt/endsAt/intakeCutoffAt; `preorder_items.base_price_snapshot_idr` sebagai baseUnitPriceIdr; variableCostIdr + costQuality; orderableUnits setelah quota/capacity/hold; source versions dan calculatedAt. |
| Indro / C8 | Resolved offer + unitPriceIdr dari C2; preorderId/itemId/itemVersion yang sama; offerVersion dan calculatedAt. Normal price merupakan resolved offer eksplisit. null berarti reader belum tersedia, bukan klaim tidak ada promo. |

Snapshot berisi provenance (`server` atau `development_fixture`), calculatedAt,
preorderVersion, preorderItemVersion, capacityVersion, dan productVersion untuk
biaya. Result mempertahankan IDs, snapshot, current offer, dan asumsi.

Current offer diperiksa terhadap C1 item identity/version dan harga C2; mismatch
menghasilkan SOURCE_MISMATCH. C8 tetap pemilik time-window/offer eligibility.
Simulator tidak menjadi Offer Resolver. Deadline/status check menggunakan waktu
snapshot secara deterministik, bukan mengklaim ketersediaan live atau reserve.
Server reader kelak wajib mengecek freshness, tenant ownership, dan source status
ulang; failed reads jangan diganti fixture atau normal-price fallback.

Orderable adalah supplied domain fact; simulator tidak menghitung ulang SQL
reservations. Tidak ada perubahan order/payment/reservation/actual spend/campaign.

## Golden comparison

Base120k, variable cost75k, assumed8units dan promotion cost50k:

| Scenario | Price/unit | Revenue | Variable cost | Contribution after promotion |
|---|---:|---:|---:|---:|
| Normal |120.000|960.000|600.000|310.000|
|5%|114.000|912.000|600.000|262.000|
|10%|108.000|864.000|600.000|214.000|

Nilai ini bersyarat pada assumed volume; bukan forecast, laba bersih, atau efek
kausal promosi. Domain comparison memperingatkan bila asumsi unit/spend berbeda.

Contoh preview dengan asumsi independen (base120k, cost75k, tersedia8unit):

| Scenario | Price/unit | Assumed units | Promotion cost | Contribution after promotion |
|---|---:|---:|---:|---:|
| Baseline tanpa promosi tambahan |120.000|4|0|180.000|
| Diskon5% |114.000|6|25.000|209.000|
| Diskon10% |108.000|8|50.000|214.000|

Campaign harga normal dengan6unit dan biaya25k menghasilkan kontribusi245k;
harga normal tidak berarti biaya promosi selalu nol. Setiap alternatif memakai
kapasitas yang sama secara terpisah, bukan penjualan yang dijumlahkan antar kolom.
Domain tetap mempertahankan angka what-if over-capacity dengan feasible=false
dan blocker CAPACITY_EXCEEDED untuk diagnosis; UI menolak asumsi tersebut dan
menyembunyikan comparison hingga input valid. Tidak ada reservasi kapasitas.

## Verification

`npm run test:unit` mencakup pricing C2, simulator domain/form/comparison, SSR
empty/error states, dan preview production/test denial. Browser interaction check
dilakukan terpisah pada Chrome headless terhadap development server, termasuk
computed styles, reset, invalid inputs, dan viewport1440/390/320. Tidak ada browser
test framework baru yang ditambahkan. Database/provider E2E belum diintegrasikan.

Tes interaksi comparison disimpan di `tests/browser/campaign-simulator-comparison.mjs`.
Jalankan dev server dengan `npm run dev -- --port 3100`, lalu
`node tests/browser/campaign-simulator-comparison.mjs` (Node24+, Chrome lokal).
Opsional `CHROME_PATH` menunjuk executable Chrome, `SIMULATOR_BASE_URL` menunjuk
origin development lokal. Tes mencakup asumsi independen, baseline/campaign,
non-stacking, kapasitas setiap kolom, biaya invalid, error focus, nol unit,
warning, reset, dan viewport1440/390/320. Screenshot/profile hanya ditulis ke
`node_modules/.cache/campaign-simulator`, yang sudah diabaikan Git.
