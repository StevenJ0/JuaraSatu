# Campaign Lab MVP: P2-1 Campaign Pricing & Attribution (C8)

Tanggal: 8 November 2026. Pelaksana: Claude bersama Rafi. Scope: resolver C8 dan publikasi owner. Kode Indro belum di-merge.

## A. Ringkasan

**PASS (disposable SQL + real PostgREST lokal).** Harga dan atribusi pesanan kini berasal dari campaign published yang aktif. `read_preorder_offer` dan `create_preorder_order` memakai resolver yang sama, sehingga harga tampil dan harga pesanan selalu sama. Owner sekarang bisa publish campaign lewat `publish_campaign` (penahan `C8_NOT_READY` dilepas). Ditemukan dan diperbaiki dua masalah konkurensi yang terbukti lewat reproduksi dua sesi.

## B. Kondisi awal

- Branch `merge/ai-campaign`, HEAD `d3541e4`. Working tree bersih kecuali `.claude/` lokal.
- P1-3 sudah PASS menurut `CAMPAIGN_LAB_MVP_P1_3_OWNER_AI_WORKFLOW_2026-11-08.md`. Di laptop ini diverifikasi ulang: kode owner ada, `npm test` 1.154 PASS, typecheck PASS. Implementasi P1-3 tidak diulang.
- Project MVP `cl-mvp-72e87c9aa2bc` tidak ada di laptop ini. Uji memakai Supabase sekali pakai `gtnic_test` (API `127.0.0.1:54421`, container `supabase_db_gtnic_test`), di-`db reset` dari migration repo.
- DB persisten `campaign-lab` tidak disentuh: tetap 10 migration lama, tidak ada migrate/reset/mutasi.

## C. Aturan yang dipakai

Sumber: PRD D-08, D-10, D-11, §9.4, TC-17 dan schema §7.1.

- Campaign **aktif** sama dengan `projectPublishedOffer` (C3, `campaign-execution/projections.ts`): status `published`, `closed_at` kosong, waktu server di `[max(starts_at, published_at), ends_at)`, preorder masih `published` dan belum lewat `ends_at`.
- Konfigurasi campaign dibaca dari tabel `campaigns`. Kolom offer dan jendela waktu dibekukan saat publish oleh trigger `campaign_guard` (`PUBLISHED_CAMPAIGN_IMMUTABLE`). Tidak membaca teks AI, draft Blueprint, atau harga produk yang bisa berubah.
- Diskon berlaku untuk semua checkout baru, termasuk pembeli tanpa link. Pesanan manual pemilik tetap harga dasar.
- `pricing_campaign_id` diisi hanya bila campaign mengubah harga (`percent_discount`). Campaign `normal_price` tidak mengklaim pesanan organik.
- `attribution_campaign_id` hanya dari ref = `campaigns.slug` (unik global) milik preorder yang sama dan sedang aktif. Ref palsu, milik preorder atau usaha lain, belum mulai, kedaluwarsa, atau ditutup memberi NULL. Atribusi tidak memengaruhi harga.
- Rumus diskon tetap `private.discount_per_unit` (floor, batas F1 Rp1 miliar, 0 sampai 9999 bps). Tidak ada rumus baru.

## D. Perubahan

**Migration baru forward-only:** `supabase/migrations/20261108100000_c8_campaign_offer_resolver.sql`. Tidak ada tabel atau kolom baru. 14 migration sebelumnya tidak diubah. **Belum di-deploy ke environment persisten mana pun.**

| Fungsi | Perubahan |
|---|---|
| `private.current_order_offer` | Dari stub 0/NULL menjadi diskon dan `pricing_campaign_id` campaign aktif |
| `private.resolve_attribution` | Dari stub NULL menjadi validasi slug campaign aktif pada preorder yang sama |
| `public.create_preorder_order` | Satu tambahan: `FOR SHARE` pada baris campaign published sebelum membaca offer, dikunci paling akhir. Isi lain identik |
| `private.lock_campaign_context` | Urutan kunci menjadi preorder lalu kapasitas (sebelumnya kapasitas lalu preorder). Isi lain identik |

**Aplikasi:**

| File | Alasan |
|---|---|
| `src/features/campaign-execution/api.server.ts` | Hapus penahan `C8_NOT_READY` untuk owner |
| `src/features/campaign-strategist/owner-api.server.ts` | `publishingEnabled: true` untuk owner. Publish tetap lewat `validateCampaignPublication` dengan konteks asli P1-2 lalu `publish_campaign` (approval, versi, konteks, CAS) |
| `src/features/campaign-execution/components/execution-workspace.tsx` | Tombol publish owner aktif, teks C8 lama diganti |

**Uji:**

| File | Isi |
|---|---|
| `tests/supabase/campaign-offer.test.ts` (baru) | 14 uji C8 dan konkurensi |
| `tests/supabase/helpers.ts` | `functionDefinition()` dan ekspor `container` |
| `tests/supabase/payments.test.ts`, `owner-commands.test.ts` | Uji yang mengganti resolver sementara kini memulihkan definisi asli, bukan stub lama |
| `tests/integration/owner-ai-workflow.test.ts` | Ekspektasi `C8_NOT_READY` diganti: publish owner lewat perintah yang diperiksa |

## E. Bukti

**Disposable SQL + real PostgREST** (`tests/supabase/campaign-offer.test.ts`, 14 PASS):

- Tanpa campaign: harga dasar, `pricing` NULL.
- Diskon aktif 10%: tampil Rp108.000 dan pesanan 2 unit Rp216.000 dengan diskon Rp24.000 dan `pricing_campaign_id` sama di order dan item. Pembeli organik tanpa atribusi.
- Link sah: atribusi terisi, harga sama dengan organik (TC-17).
- Harga basi Rp120.000 saat diskon aktif: `OFFER_CHANGED`, 0 pesanan dan 0 reservasi.
- Campaign belum mulai, sudah lewat, dan ditutup: harga dasar dan link tidak memberi atribusi.
- Campaign `normal_price`: harga dasar, `pricing` NULL, link tetap memberi atribusi.
- Ref palsu, milik preorder lain, atau milik usaha lain: atribusi NULL, diskon tetap berlaku.
- Pembulatan C2: Rp101 dengan 500 bps menjadi Rp96, 3 unit Rp288. Batas 9999 bps menjadi Rp12, 1 bps menjadi Rp119.988.
- Pesanan lama tetap snapshot setelah campaign ditutup. Ulangan idempotency mengembalikan pesanan yang sama (`replayed`).
- Pesanan manual pemilik tetap harga dasar walau diskon aktif.

**Konkurensi dua sesi (bounded, `pg_sleep` sebagai penghalang):**

1. **Tutup campaign bersamaan dengan checkout.** Sesi A mengunci baris campaign untuk menutupnya dan menahan 2 detik. Sesi B checkout dengan harga diskon.
   - Kontrol negatif tanpa kunci baru: checkout **berhasil dengan diskon dari campaign yang sedang ditutup** (reproduksi race).
   - Dengan kunci: checkout menunggu sekitar 1,5 detik lalu `OFFER_CHANGED`, tanpa pesanan atau reservasi.
2. **Deadlock publish/tutup campaign vs checkout.** Sesi A memakai urutan kunci checkout (preorder `FOR SHARE`, jeda, kapasitas `FOR UPDATE`). Sesi B menjalankan `close_campaign` asli sebagai `service_role`.
   - Sebelum perbaikan: `ERROR: deadlock detected` (SQLSTATE 40P01), siklus pada tuple `preorders`.
   - Sesudah perbaikan `lock_campaign_context`: keduanya selesai, campaign `closed`, tanpa deadlock.

**Regresi:**

| Pemeriksaan | Hasil |
|---|---|
| `npm run test:integration` dari `db reset` bersih (15 migration, termasuk C8, A3 dan F1 Steven) | 180/180 PASS, 8 file |
| `npm test` | 1.154/1.154 PASS, 70 file |
| `npm run typecheck` | PASS |
| `eslint src tests` | PASS. `npm run lint` penuh hanya gagal di file lokal `.claude/` dan `docs/local/` yang tidak ikut git |
| `npm run build` | PASS |

**Runtime nyata: owner browser + HTTP + publish asli** (21/21 PASS).

Lingkungan: salinan app sementara di scratchpad (port 3302) dengan `NEXT_PUBLIC_SUPABASE_URL` diarahkan ke Supabase sekali pakai lewat environment proses. Provider owner diganti `tests/fixtures/owner-ai-provider.server.ts` lewat `NormalModuleReplacementPlugin` **hanya di `next.config.ts` salinan**, seperti seam P1-3. `src` salinan identik dengan repo. Setelah uji, salinan dihapus. `.env.local`, `next.config.ts`, dan `config.toml` repo tidak diubah. Chrome headless memakai `playwright-core`.

- Login pemilik lewat Supabase Auth, lalu Campaign AI.
- Strategist memakai konteks asli P1-2 dari preorder milik sendiri. Audit provider: `contextBinding` berprovenance `server`, satu panggilan strategi dan satu panggilan Blueprint per run.
- Blueprint v1, lalu edit manual diskon 10% menjadi v2 tanpa panggilan provider, approve, reload, dan approval tetap tersimpan. Sebelum publish harga masih Rp120.000.
- Penolakan sebelum publish asli:
  - Tamu: 401/403.
  - Versi campaign basi: 409.
  - Pemilik usaha lain: baca dan publish keduanya 4xx.

  Status tetap `draft`.
- Publish lewat halaman eksekusi pemilik memanggil `publish_campaign` asli. Campaign `published`, `percent_discount`, 1000 bps. Proyeksi C3 di UI `active` Rp120.000 menjadi Rp108.000, sama dengan resolver SQL. Tanpa scroll horizontal di 390px.
- Readback:
  - `read_preorder_offer` 1000 bps, Rp108.000, `pricing_campaign_id` = campaign itu.
  - Harga Rp120.000 basi menjadi `OFFER_CHANGED`.
  - Pesanan lewat slug: Rp216.000, pricing dan atribusi = campaign.
  - Pesanan organik: Rp216.000, atribusi NULL.
- Tutup campaign lewat halaman pemilik: harga kembali Rp120.000, pesanan lama tetap snapshot diskon.
- Run ini juga menjalankan ulang alur P1-3 (login, AI, Blueprint, edit, approve, reload, eksekusi) dengan kode di laptop ini.

**NOT EXECUTED:**

- `tests/integration/owner-ai-workflow.test.ts`. Setup-nya memverifikasi manifest container `cl-mvp-72e87c9aa2bc` yang tidak ada di laptop ini. Ekspektasinya sudah diperbarui, dan alur yang sama dibuktikan lewat runtime di atas.
- Gemini live, Midtrans, dan email: tidak dipanggil.

## F. Keterbatasan

- Konteks AI (`owned-preorder-context.server.ts`) masih menganggap C8 `unavailable` bila preorder sudah punya campaign published. Ini fail-closed. Alur owner memang menolak campaign kedua pada preorder yang sama. Menyambungkan offer aktif ke konteks AI belum dikerjakan.
- `now()` (waktu mulai transaksi) dipakai untuk jendela campaign, sama dengan pemeriksaan jendela preorder di checkout.
- Uji runtime memakai provider mock. Strategi dari Gemini sungguhan belum dicoba karena butuh izin terpisah.

## G. Serah terima untuk Indro (P2-3)

- Harga tampil: `findPublicPreorder` (`src/features/preorders/repository.ts`) mengembalikan `unitPriceIdr` dan `discountBps` dari `read_preorder_offer`.
- Checkout: `placePublicOrder(client, input, holdTtlSeconds)` (`src/features/orders/service.ts`) memanggil `create_preorder_order`. Kirim `expectedUnitPriceIdr` = `unitPriceIdr` yang ditampilkan. Bila basi, hasilnya `{ kind: "rejected", violation: "OFFER_CHANGED" }` dan pembeli harus melihat harga baru.
- Atribusi: kirim `attributionRef` = slug campaign dari link (`/api/public/campaigns/:slug` di PRD). Ref tidak sah tidak menggagalkan pesanan, hanya atribusinya NULL.
