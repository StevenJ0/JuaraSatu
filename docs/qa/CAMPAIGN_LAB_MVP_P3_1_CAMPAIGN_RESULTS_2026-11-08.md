# Campaign Lab MVP: P3-1 Hasil Kampanye

Tanggal: 8 November 2026. Pelaksana: Claude bersama Rafi. Branch `feat/campaign-results` (lanjutan `feat/buyer-checkout`).

## A. Ringkasan

**PASS (unit + Supabase sekali pakai + browser lokal).** Detail preorder pemilik kini punya bagian "Hasil kampanye" untuk setiap kampanye yang pernah terbit di preorder itu. Angka dihitung kode deterministik dari pembayaran Sandbox terverifikasi, bukan dari AI atau Evaluation. Tidak ada perubahan schema.

Tampilan dipasang di halaman detail preorder (milik core), bukan di workspace kampanye Steven, agar tidak bentrok. Steven bisa memakai `listPreorderCampaignResults` yang sama di halaman kampanye nanti.

## B. Definisi (rencana MVP §D)

| Angka | Aturan |
|---|---|
| Pesanan lunas | Pesanan publik dengan pembayaran `paid_sandbox` dan `applied_at` terisi, `applied_at` di periode kampanye, tidak dibatalkan |
| Periode | `[max(starts_at, published_at), min(ends_at, closed_at))`, setengah terbuka |
| Nilai pesanan | Jumlah `orders.total_idr` sekali per pesanan, BigInt |
| Unit terbayar | Jumlah unit item pesanan lunas, dibandingkan dengan `target_additional_units` dan diberi label target kampanye |
| Lewat tautan kampanye | Subset dengan `attribution_campaign_id` = kampanye ini (sudah divalidasi server saat pesan) |
| Mendapat harga promo | Subset dengan `pricing_campaign_id` = kampanye ini, plus total potongan |
| Lunas di luar aplikasi | Pesanan manual `external_payment_status = confirmed` dengan waktu konfirmasi di periode, terpisah dari angka Sandbox |
| Dibatalkan setelah dibayar | Dikeluarkan dari angka utama dan disebut terpisah |

Ditinjau (`requires_review`), menunggu bayar, kedaluwarsa, dan gagal tidak dihitung. Label halaman menyebut simulasi Sandbox dan bahwa pesanan di periode kampanye belum tentu karena kampanye.

## C. Perubahan

| File | Isi |
|---|---|
| `src/features/campaign-results/metrics.ts` | `campaignWindow`, `summarizeCampaign` (murni) |
| `src/features/campaign-results/repository.ts` | `listPreorderCampaignResults(client, businessId, preorderId)` lewat client bersesi pemilik (RLS `owner_read`). Gagal tertutup bila daftar pesanan terpotong batas baris API |
| `src/features/campaign-results/components/campaign-results.tsx` | Kartu hasil per kampanye dan tautan kampanye `/p/<preorder>?ref=<kampanye>` untuk dibagikan |
| `src/app/dashboard/preorders/[id]/page.tsx` | Memuat hasil kampanye. Bila gagal dibaca, halaman tetap tampil dengan pemberitahuan |
| `src/lib/format-idr.ts` | `formatIdr` menerima `bigint` |

## D. Bukti

| Pemeriksaan | Hasil |
|---|---|
| `metrics.test.ts` | 10 PASS: periode efektif, batas setengah terbuka, belum diterapkan tidak dihitung, batal dan manual terpisah, kampanye lain tidak diklaim, total di atas batas Number tepat, fase |
| `tests/supabase/campaign-results.test.ts` | 4 PASS: dua pesanan dibayar lewat webhook asli (satu lewat tautan), satu belum bayar, satu manual lunas. Lunas 2 pesanan / 3 unit / Rp324.000, tautan 1 / 2 unit / Rp216.000, promo 2 dengan potongan Rp36.000, manual terpisah Rp120.000. Pemilik lain tidak melihat apa pun. Kampanye ditutup lebih awal tidak menghitung pembayaran sesudahnya |
| `npm test` | 1.280/1.280 PASS |
| `npm run test:integration` dari `db reset` bersih | 201/201 PASS, 11 file |
| `eslint src tests`, `npm run typecheck`, `npm run build` | PASS |
| Browser lokal | 11/11 PASS: bagian hasil kampanye, label simulasi, target, diskon, tautan kampanye di 1280px dan 390px tanpa geser horizontal dan tanpa error. Halaman pembeli lewat tautan menampilkan Rp108.000 dengan Rp120.000 dicoret. Kampanye cek sementara dihapus setelahnya |

## E. Batasan

- Angka hanya untuk preorder satu per satu. Ringkasan lintas preorder di beranda belum dibuat.
- Biaya kampanye (`budget_cap_idr`) dan laba tidak dihitung. Kualitas biaya produksi belum dipakai di sini.
- Tidak ada pembanding (baseline) untuk mengklaim tambahan karena kampanye. Itu ranah Evaluation Steven.
