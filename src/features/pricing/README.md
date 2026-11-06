# Shared Pricing Calculator — C2

Owner: Steven. Consumers: Campaign Simulator, campaign planning/approval, order
services Rafi, dan checkout Indro. Import melalui `@/features/pricing`.

## Public functions

```ts
calculateUnitPrice(input: unknown): PricingResult<UnitPricingResult>
calculateOrderPrice(input: unknown): PricingResult<OrderPricingResult>
validateCampaignDiscount(input: unknown): PricingResult<DiscountPolicyResult>
```

Functions menerima `unknown` agar input runtime selalu diperiksa. Caller dapat
menggunakan tipe input yang diekspor dengan `satisfies`; tipe dan Zod schemas
tersedia dari public entry point yang sama.

Input unit: `{ baseUnitPriceIdr, offer }`. Input order menambahkan `quantity`.
Offer merupakan discriminated union:

- `{ offerType: "normal_price", discountBps: 0 }`
- `{ offerType: "percent_discount", discountBps: 1..9999 }`

Input policy menambahkan `variableCostIdr` dan `costQuality`:

- `unknown`: biaya wajib `null`.
- `estimated` atau `verified`: biaya berupa integer IDR, termasuk nol.

Semua object strict; field ekstra, coercion string/boolean, NaN, Infinity,
pecahan, dan unsafe integers ditolak. Harga dasar wajib positif, harga/biaya
maksimal Rp1 miliar, quantity order 1..10.000. Quantity skenario nol merupakan
urusan simulator; jangan menggunakannya sebagai quantity order.

## Results and errors

Semua functions mengembalikan union `{ success: true, data }` atau
`{ success: false, errors: [{ code, field, message }] }`. Input bisnis invalid
tidak dilempar sebagai exception, di-clamp, atau diganti nol. Pesan Zod dapat
berubah; consumer memakai `code` dan `field`, bukan mencocokkan teks pesan atau
jumlah error per field.

- Unit result: `baseUnitPriceIdr`, `discountPerUnitIdr`, `finalUnitPriceIdr`.
- Order result: seluruh unit fields, `quantity`, `subtotalIdr`,
  `discountTotalIdr`, `totalIdr`.
- Policy result: seluruh unit fields, `costQuality`, `variableCostIdr`,
  `contributionPerUnitIdr`, `warnings` berisi `{ code, message }`.

Error codes: `INVALID_INPUT`, `AMOUNT_OUT_OF_RANGE`, `COST_UNKNOWN`,
`NONPOSITIVE_CONTRIBUTION`. Warning codes: `COST_UNKNOWN`, `COST_ESTIMATED`,
`NONPOSITIVE_CONTRIBUTION`.

Result schemas dan `PricingFailureSchema` juga diekspor untuk validation pada
boundary consumer. Tidak ada dependency React, database, provider, atau env.

## Rounding and bounds

`discountPerUnitIdr = floor(baseUnitPriceIdr * discountBps / 10000)`.
Harga final = base − diskon/unit. Subtotal = quantity × base; total diskon =
quantity × diskon/unit; total = quantity × harga final. Intermediate arithmetic
memakai BigInt, hasil DTO berupa number setelah batas terbukti aman.

Subtotal **sebelum diskon** juga dibatasi Rp1 miliar; subtotal di atas batas
ditolak walaupun total sesudah diskon masih kecil. Bps positif pada harga sangat
kecil dapat membulat menjadi potongan Rp0; calculator tetap mengikuti floor.

## Authority and integration

Rafi menyediakan `preorder_items.base_price_snapshot_idr` sebagai
`baseUnitPriceIdr`. Calculator tidak dapat membuktikan provenance angka tersebut.
Jangan memasukkan harga katalog terbaru atau harga yang sudah didiskon.

Indro menentukan offer aktif lewat C8, lalu memanggil `calculateOrderPrice` satu
kali dengan base snapshot dan offer tersebut. C2 tidak melakukan authorization,
offer resolution, reservation, atau publish. Order/hold lama tetap menggunakan
snapshot yang sudah tersimpan; jangan repricing berdasarkan katalog baru.

`validateCampaignDiscount` adalah guard planning/approval, bukan guard otomatis
terhadap biaya terbaru untuk checkout campaign yang sudah disetujui. Kalkulasi
checkout tidak menerima biaya sehingga perubahan estimasi biaya tidak mengubah
nominal atau membatalkan offer. Diskon usulan membutuhkan biaya diketahui dan
kontribusi/unit positif. Harga normal dengan biaya unknown diperbolehkan dengan
kontribusi null dan warning; kontribusi harga normal nol/negatif diberi warning.
Estimated cost juga menghasilkan warning. Kontribusi bukan laba bersih.

Rafi/Indro perlu mereview nama field, batas subtotal, representasi offer dan
mapping error sebelum mengintegrasikan caller. Tidak ada caller bisnis yang
diubah pada Slice 1.

## Shared contract fixtures

Reuse `tests/fixtures/pricing.ts` pada contract tests consumer:

| Base | Bps | Quantity | Discount/unit | Final/unit | Total |
|---|---:|---:|---:|---:|---:|
| 120.000 | 1000 | 2 | 12.000 | 108.000 | 216.000 |
| 101 | 500 | 3 | 5 | 96 | 288 |
| 120.000 | 0 | 2 | 0 | 120.000 | 240.000 |

Jalankan `npm run test:unit`. Checkout dan simulator harus memakai import C2 yang
sama dan memenuhi fixtures ini; jangan menyalin rumus ke service masing-masing.
