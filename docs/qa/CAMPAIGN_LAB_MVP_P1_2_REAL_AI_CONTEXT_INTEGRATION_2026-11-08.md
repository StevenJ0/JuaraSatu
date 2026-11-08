# Campaign Lab MVP — P1-2 Real Core → AI Context Integration

Tanggal: 8 November 2026, Asia/Jakarta. Branch `merge/ai-campaign`; HEAD `5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762`.

## A. Executive Summary

**PASS untuk integrasi data dan service P1-2.** Context dari real Supabase P1-1 diterima `buildBusinessContext`, masuk ke prompt dan simulator Strategist existing, serta diterima validator facts Blueprint. Tidak ada fallback fixture. Auth, owner scope, frozen price, biaya unknown/zero, kapasitas/kuota, commitments, versi dan hash diuji.

Bukti baru: **1.143 unit PASS**, **69 selected AI mock PASS**, **5 real isolated integration PASS**, TypeScript/lint/build PASS. Dua HTTP GET bersesi ke halaman preorder yang memakai shared reader juga PASS setelah source-sync. Generasi memakai provider mock; ini **bukan** bukti live Gemini, owner AI UI, persistence diskusi/Blueprint nyata, approval, atau publication campaign. Hal tersebut tetap P1-3/later tasks.

Instance yang digunakan tetap `cl-mvp-72e87c9aa2bc`, API `http://127.0.0.1:56321`, app `http://127.0.0.1:3301`. Delapan container ID/network/volume/binding dicocokkan dengan manifest P1-1 sebelum fixture write. Read-only catalog akhir: **14 migration / 26 tabel / 352 kolom / 50 public RPC signatures**. DB normal tidak diakses.

## B. Existing Context Problem

`campaign-strategist/development-context.server.ts:seededDevelopmentContext` memang fixture-only: dua business demo, kuota/target/kapasitas 40, tanpa orders/reservations/published campaign. Batas itu dipertahankan, bukan dibuka untuk data nyata.

Core `findPreorderContext`/`toPreorderContext` sebelumnya belum membawa biaya numerik, source item/version dan kapasitas lengkap. Selain itu, `toPreorderReservationFact` menganggap external payment selain `unpaid`, termasuk **NULL**, sebagai paid. Alokasi saja bukan bukti pembayaran; classifier diperbaiki pada shared reader agar core dan AI konsisten.

Kontrak AI sudah mempunyai `provenance: server`, dependency `loadContext` dan hash/revalidation. Karena itu tidak diperlukan pipeline, repository framework, RPC, atau provider baru.

## C. Changed Files

Path source di bawah berawal dari `src/features/`.

| File | Perubahan dan alasan |
|---|---|
| `preorders/repository.ts` | Enrich satu query C1 dengan business ID, biaya/katalog/version produk, item/version, capacity/version; aggregate tetap memakai helper existing. Shared reservation query membaca status/verified/applied payment untuk classifier paid yang benar |
| `preorders/context.ts` | DTO owner C1 membawa biaya, catalog price, item/capacity identity dan revisions. Projection publik terpisah tidak ditambah field privat |
| `ai-context/owned-preorder-context.server.ts` — baru | `loadOwnedPreorderContext`: real verified session → owned business → owned published preorder → adapter schema C1/C8, tanpa service-role reads/fallback |
| `ai-context/contracts.ts` | Tambahan **optional** kategori lengkap dan bounded capacity projection; optional mempertahankan kontrak fixture lama, producer real selalu mengisinya |
| `ai-context/build-business-context.ts` | Meneruskan kapasitas, mengecek versi/availability konsisten sebelum membangun context |
| `ai-context/context-hash.ts` | Kapasitas yang tersedia ikut existing canonical hash; representasi fixture tanpa field baru tetap sama |
| `campaign-strategist/prompt.ts` | Memasukkan kategori lengkap dan kapasitas real bila tersedia; redaction dan batas prompt existing tetap |
| `campaign-strategist/owned-strategy.server.ts` — baru | `generateOwnedCampaignStrategies`: seam server yang memanggil generator existing memakai loader owner-scoped. Bukan endpoint atau admission/persistence replacement |
| `src/features/preorders/context.test.ts` | Sesuaikan projection owner yang sekarang memang diizinkan membawa cost; kontak/token/public projection tetap terlindungi |
| `tests/supabase/preorder-context.test.ts` | Kontrak cost privat owner diperbarui. Fixture paid sekarang memakai existing owner-confirmed manual-order RPC, bukan menganggap public allocation tanpa payment sebagai paid. Public denylist tetap dipertahankan; suite normal ini tidak dieksekusi |
| `tests/unit/owned-preorder-context.test.ts` — baru | 24 kasus mapping, cost, commitments, ownership, failure, hash, downstream finance dan stale source |
| `tests/integration/owned-preorder-context.test.ts` — baru | Lima opt-in tests pada instance P1-1; guard identity/resource/URL sebelum writes, actual SDK/service consumers, synthetic fixture RPC dan owner CAS edits |
| Laporan ini | Mapping, bukti eksekusi dan batas cakupan |

Tidak ada dependency baru atau perubahan SQL/schema/types/env/config. Tidak mengubah Strategist generator, Blueprint/execution workflow, buyer/payment module, Evaluation, atau Memory.

## D. Real Context Architecture

```text
Session-bound Supabase client
  → loadOwnedPreorderContext
      → auth.getUser (verified identity)
      → findOwnedBusinessId (owner membership)
      → findPreorderContext (owned nested PostgREST query)
          → toPreorder + summarizePreorder / summarizeCapacity
          → toPreorderContext (private owner DTO)
      → BuildBusinessContextInputSchema.parse
  → generateOwnedCampaignStrategies
      → generateCampaignStrategies (existing)
          → buildBusinessContext / hashContext
          → buildStrategyPrompt
          → mocked provider during tests
          → existing simulator / financial and narrative validation
          → fresh owned source reload + hash comparison
```

`blueprint-domain.ts:blueprintFacts` juga diuji dengan context real. Existing `revalidateStrategyProposal` menolak proposal setelah actual product edit. Tidak memanggil `generateBlueprint` dengan data real yang kemudian dilabeli synthetic oleh kontrak Blueprint lama.

Jalur `/dev/*` dan `/api/dev/*` tetap fixture-only dengan auth/dev guards semula. Entry point baru berupa **server-only use case**, dapat dipanggil dengan client bersesi; belum ada owner route/nav baru. P1-3 harus memasang loader pada orchestration diskusi/Blueprint existing serta mempertahankan admission, persistence, CAS dan quota guards; generator seam bukan pengganti boundary tersebut.

## E. Data Mapping

| Core fact | Database source | AI field | Mapping rule |
|---|---|---|---|
| Business identity/profile | `business_members`, `businesses.id/name/categories/description` | `business.businessId/name/category/categories/description` | Membership owner menentukan business; kategori pertama array menjadi primary category, seluruh array tetap dibawa. Free-form, bukan enum buatan |
| Location/category produk | Tidak ada trusted location/product category pada projection ini | `business.locationContext`, `product.category` | NULL, tanpa menebak lokasi atau kategori produk dari field lain |
| Product/offer name | `preorder_items.product_id/product_name_snapshot`, `products.description` | `product.productId/name/description` | ID produk nyata; nama offer menggunakan snapshot preorder, deskripsi dari produk saat dibaca |
| Frozen base price | `preorder_items.base_price_snapshot_idr` | `preorder.baseUnitPriceIdr` | Sumber kalkulasi harga promo; tidak diganti catalog mutable |
| Mutable catalog price | `products.base_price_idr` | C1 input `product.catalogUnitPriceIdr` | Tetap terpisah dari frozen base; bukan override harga preorder |
| Cost/quality | `products.variable_cost_idr/cost_quality` | `product.variableCostIdr/costQuality` | Unknown = NULL; known zero tetap 0; estimated/verified hanya sesuai record. Kombinasi tak konsisten ditolak schema |
| Capacity | `production_capacity.id/total_units/version`, seluruh reservations capacity | `capacity.capacityId/totalUnits/version/allocatedUnits/heldUnits/availableUnits` | `summarizeCapacity`, termasuk commitments di luar preorder yang memakai kapasitas sama |
| Quota/target | `preorder_items.quota_units/target_units` | `preorder.quotaUnits/targetUnits` | Tidak disamakan dengan kapasitas total |
| Allocation/hold/orderable | Reservation state/quantity/expiry, preorder item binding | `preorder.allocatedUnits/heldUnits/orderableUnits` | Existing `summarizePreorder`: min sisa kapasitas dan kuota; expired held/released tidak aktif; satu state tidak dihitung dua kali |
| Paid facts | Joined `orders.order_status/external_payment_status`, `payments.status/verified_at/applied_at` | `preorder.paidUnits/paidTargetGapUnits` | Allocated + manual confirmed atau verified applied paid_sandbox; NULL/unpaid/verified-unapplied bukan paid. Cancelled/expired/voided bukan penjualan walau slot tetap allocated |
| Schedule | `preorders.starts_at/ends_at/fulfillment_date`, frozen pickup cutoff | `preorder.startsAt/endsAt/intakeCutoffAt/fulfillmentDate` | Actual source values, normalized UTC dengan `supabaseUtcTimestamp`, termasuk presisi microsecond; tidak memakai tanggal fixture sebagai default |
| Source identity/version | Preorder/item/product/capacity IDs dan `version` masing-masing | IDs pada facts, `metadata.sources.c1` | Empat actual revisions; tidak mengarang business version yang tidak ada pada snapshot contract |
| Provenance/freshness | Waktu server sebelum query C1 | `sources.c1.provenance/calculatedAt` | `server`, freshness existing 60 detik; hash memakai facts/versions, bukan waktu read semata |
| Analytics/history | C6 belum diintegrasikan; Memory tidak diminta | `analytics`, `history` | C6 unavailable/not_implemented; history not_requested, bukan revenue/memory buatan |
| Current offer C8 | Owned `campaigns` query status published | `effectiveOffer`, `sources.c8` | Hanya jika ketiadaan published campaign terbukti, normal offer memakai frozen base. Bila ada published campaign, C8 unavailable dan builder/generator gagal tertutup sampai resolver nyata tersedia |

Paid manual adalah konfirmasi owner, **bukan** verifikasi provider. C1 paid units mengikuti eligible-paid semantics core; tidak disajikan sebagai revenue provider terverifikasi. Tidak ada fulfilled revenue/profit aktual yang dibuat dari data simulasi.

## F. Ownership and Authorization

Loader memakai `auth.getUser()`, bukan mempercayai session payload/browser business ID. Business di-resolve lewat existing `findOwnedBusinessId`, kemudian scope request dibandingkan. Query preorder difilter business milik owner dan ID yang diminta; RLS tetap berlaku pada nested data. Client service-role tanpa user session tidak lolos identity check.

Scope asing gagal sebelum source preorder dibaca; foreign preorder dengan business owner B sendiri menghasilkan NOT_FOUND; anonymous menghasilkan UNAUTHENTICATED. Tidak ada privileged read atau service key pada loader. Service-role client hanya dipakai **test fixture internal** untuk existing public-order RPC, sesudah identity/target checks.

Projection C1 privat sekarang sengaja membawa cost untuk AI owner. Projection publik dan denylist data pelanggan/token tidak diperlebar. Prompt tetap memperlakukan profile/deskripsi/user text sebagai untrusted dan melakukan redaction.

## G. Integration Test Results

Instance identity dicocokkan sebelum mutation; actual owner A/B login menggunakan real Auth. Test tidak mengimpor normal `tests/supabase/helpers`.

| Real isolated test | Bukti aktual | Status |
|---|---|---|
| Owned C1/schema/Blueprint facts | P1-1 preorder `44c12f52-1eb5-4b7f-82d5-1fa2a514d5c2`; source row price/cost/quota/target dibandingkan langsung; server provenance dan item revision cocok | PASS |
| Commitments/availability | Lima order sintetis lewat RPC existing: manual confirmed 3, manual unpaid 4, standalone allocated 12, public held 2, held 5 dengan TTL 1 detik. Setelah expiry: DB readback total capacity 60, allocated 19, held 2, paid manual 3; orderable 39, bukan 40 atau 50 | PASS |
| Auth/RLS | Owner B/forged business scope, foreign preorder dengan business B sendiri, unknown UUID, anonymous ditolak | PASS |
| Frozen price/unknown cost | Owner CAS edit catalog price dan unknown/NULL cost: frozen price tetap 25000, cost NULL, revision/hash berubah; fields produk dikembalikan ke nilai awal | PASS |
| Actual downstream + freshness | Real producer → actual prompt/Strategist/simulator, provider mock; computed price dari frozen source. Product edit saat provider mock berlangsung dan proposal lama ditolak STALE_CONTEXT | PASS |

Semua **5/5**, exit 0. Assertions mapping/availability memakai DB readback, bukan menganggap angka historis P1-1 sebagai sumber kebenaran. Angka 60/50/30/25000/12000 pada hasil ini adalah nilai actual fixture yang dibaca, tidak dimasukkan sebagai konstanta loader.

Tambahan protected app HTTP: source executable disinkronkan ke app copy P1-1, lalu real Auth menghasilkan SSR cookies untuk **dua GET/reload** `/dashboard/preorders/44c12f52-1eb5-4b7f-82d5-1fa2a514d5c2`. Keduanya HTTP 200 dan KPI **Sudah dibayar 3 unit / Bisa dipesan 39 unit**. Shared PostgREST reader baru terbukti berjalan pada aplikasi.

Browser tambahan dicoba tetapi **BLOCKED pada automation** (transient document/readiness, kemudian timeout CDP `Runtime.enable`); tidak diklaim browser PASS P1-2. Context AI diuji melalui real DB HTTP + actual service consumer; belum melalui owner AI HTTP/UI route karena itu P1-3. Tidak menambahkan debug endpoint.

Artefak non-secret di workdir P1-1: `p12-real-context-results.json`, `p12-http-kpi.txt`, `p12-run.mjs`, `p12-mocks.mjs`, `p12-preflight.mjs`. File credentials/status privat tetap tidak dicetak. Run fixtures idempotent; order sintetis dipertahankan untuk pengembangan, bukan reset data P1-1. Product fields dipulihkan, **version tetap naik** sesuai CAS; tidak diturunkan diam-diam. Hold aktif akan kedaluwarsa menurut waktu server, sehingga read berikutnya boleh menghasilkan availability berbeda.

## H. Source Freshness

- C1 nested PostgREST query membaca business, item, product, capacity, reservation dan payment fields dari satu statement snapshot; perhitungan expiry menggunakan clock server yang sama pada projection tersebut.
- Membership dan pengecekan published campaign adalah query terpisah: **tidak mengklaim snapshot atomik lintas semua read**. Tidak ada transaction/RPC/lock framework baru.
- Existing builder memeriksa age/provenance/identity/versions. Optional capacity memiliki guard availability dan harus sesuai capacity revision. Semua facts real masuk hash canonical existing; bisnis/categories, biaya, harga beku, kapasitas dan commitments dapat mengubah hash meski preorder version tidak naik.
- Read time baru dengan facts identik tetap menghasilkan hash stabil. Generator existing memuat ulang owned context sesudah provider; perbedaan sumber menolak hasil. `revalidateStrategyProposal` tetap dipakai oleh validation downstream; stale proposal harus dibaca/dihitung ulang.
- Tidak ada DB lock ditahan saat generasi dan tidak ada reservasi kapasitas akibat rekomendasi AI. Snapshot yang masih berada dalam freshness window tetap bukan jaminan stok sampai operasi atomik order/publish existing.
- Approval/publication source-version/CAS guards tidak diubah. Wiring real loader pada boundary owner dan Blueprint/execution persistence yang belum tersedia harus dilakukan P1-3; laporan ini tidak mengklaim full real approval telah berhasil.

## I. Regression

| Pemeriksaan baru | Hasil |
|---|---|
| `npm.cmd run typecheck` | PASS, strict |
| `npm.cmd run lint` | PASS |
| `npm.cmd test -- --run` | **1.143 PASS / 69 file**; termasuk **24** unit baru |
| Selected AI mock, exact allowlist | **69 PASS / 7 file**: blueprint-manual-edit, blueprint-provider-provenance, duplicate-inference, evaluation-provider-validation, generation-quota-blocker, memory-generation-claims, remaining-ai-contracts |
| Opt-in real `owned-preorder-context.test.ts` | **5 PASS / 1 file**, only P1-1 isolated project |
| `npm.cmd run build` | PASS; tidak deploy atau menjalankan production app |
| Protected application HTTP readback | PASS, dua actual SSR requests setelah source sync |
| Catalog end check | 14 migration / 26 tabel / 352 kolom / 50 public RPC, tidak ada schema additions |
| Specialized SQL concurrency, normal Supabase suites, full type regeneration/strict catalog suite | NOT EXECUTED; tidak ada perubahan SQL/types dan normal helpers tidak aman untuk target tugas ini |
| Live Gemini/Midtrans/email, owner AI UI/approval E2E | NOT EXECUTED, di luar scope |

Percobaan unit awal memperbaiki expected normalization timestamp `.000Z` dan mock HTTP error agar tidak tertahan automatic SDK retry. Runner mock awal gagal me-resolve alias ketika config dimatikan; diperbaiki menggunakan config Vitest repository dengan include exact list. Tidak mengubah assertion domain, auth/finance guard atau implementasi provider agar lolos. Hasil final di tabel adalah eksekusi baru, bukan angka historis P1-1/F1.

## J. Safety

- Baseline **690 file** mencakup dirty/untracked dan `.env.local`. Scope final: delapan file existing yang relevan diubah, empat source/test baru dan laporan ini ditambahkan; pekerjaan A1–P1-1 lainnya dipertahankan, tidak ada file hilang.
- Original persistent DB `campaign-lab` **tidak di-query atau dimutasi** dalam P1-2. Tidak menjalankan old helper/test SQL yang menarget container normal. Tidak mengklaim fresh fingerprint DB normal karena membaca DB itu memang dilarang oleh task.
- Delapan Docker resource P1-1 dipakai kembali, bukan membuat DB/project baru. Identity/network/mount/loopback dicek ulang; normal/other-project containers tidak diubah. App 3301 yang semula berhenti dijalankan melalui existing source-sync/process-env helper; bukan kill berdasarkan PID historis.
- Seluruh 14 migration, `.env.local`, `supabase/config.toml`, generated types dan `docs/schema.md` tetap byte-identik terhadap baseline. Tidak ada schema/RLS/grant/index/function mutation atau type regeneration.
- Tidak ada Gemini/Midtrans/email/embedding provider call, service key di browser, payment adapter, Memory verified approval atau synthetic Evaluation finalization baru.
- Tidak ada dependency, Git commit/push/merge/rebase/reset/stash atau deployment. Unit dan allowed fixture writes saja; tidak ada reset/backfill/data import dari normal stack.

## K. Remaining MVP Work

**P1-3:** shared owner SSR session dan UI/routes; inject real loader ke persistent discussion/Blueprint/execution orchestration sambil mempertahankan existing quota/admission/persistence guards. Approval/Blueprint/execution contracts yang saat ini synthetic-only perlu ditangani eksplisit sebelum real persistence; jangan melabel data nyata sebagai synthetic atau melemahkan Memory/Evaluation guards.

**C8/P2-1:** real published offer integration masih diperlukan. Adapter P1-2 fail-closed jika ada published campaign, termasuk published yang lifecycle-nya belum diputuskan resolver; tidak menerka diskon/base offer dari stub. Tidak ada perubahan checkout SQL dalam tugas ini.

Indro belum merge: buyer/payment tetap P2-3/P2-4. Full Evaluation/Memory tetap DEFER. App copy aktif untuk reuse; perubahan berikutnya tetap dilakukan di main repository kemudian source-sync sesuai runbook P1-1. Snapshot availability 39 di laporan tidak boleh dijadikan konstanta UI/test lintas waktu.

## L. Final Verdict

**YA: data core bisnis/preorder nyata sekarang tersedia dan terbukti digunakan oleh pipeline AI Strategist existing tanpa synthetic fallback.** Ini integrasi server data/service P1-2 yang diotorisasi dan diuji terhadap real Supabase; bukan klaim owner AI UI lengkap atau live-provider success.

Pekerjaan berhenti pada P1-2. P1-3, checkout/Indro, Midtrans, Memory dan Evaluation tidak diimplementasikan.
