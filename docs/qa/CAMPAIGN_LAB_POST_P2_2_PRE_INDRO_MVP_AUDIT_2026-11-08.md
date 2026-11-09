# Campaign Lab — Audit integrasi pasca-P2-2 sebelum merge Indro

8 November 2026. **Putusan: READY WITH LIMITATIONS untuk mulai merge Indro; belum siap dinyatakan sebagai MVP E2E lulus.** Ini audit source Steven + Rafi yang sudah tergabung, bukan pekerjaan menggabungkan keduanya. Bukti yang disebut *historis* berasal dari run sebelum audit ini.

## A. Executive Summary

P1-1/P1-2 tetap tersambung menurut source yang tidak berubah sejak pengujian historis. P1-3 memiliki jalur owner yang nyata dan bukti browser dengan provider mock. P2-1 menghubungkan publish owner, resolver harga SQL, quote, dan order writer; P2-2 mengubah pemeriksaan deadline serta urutan kunci yang tepat. Source dan tes kedua migration konsisten dengan laporan Rafi. Unit, mock AI, TypeScript, ESLint, dan build **lulus sekarang**.

**Batas bukti utama:** tidak ada run SQL 16 migration atau browser current-source dalam audit ini. Harness disposable resmi berhenti karena allowlist masih 14 migration; instance MVP terverifikasi masih 14 migration dan salinan app-nya tertinggal tiga file dari source. Tidak ditemukan cacat bisnis baru yang *terbukti* dalam source current, tetapi hasil P2-1/P2-2 tidak diberi label fresh SQL PASS. Indro dapat mulai menggabungkan modulnya memakai kontrak yang sudah ada; verifikasi bersama harus menunggu lingkungan/harness cocok dengan 16 migration. Gemini live, Midtrans, email provider, dan buyer E2E belum dijalankan.

## B. Git and Migration Baseline

- Branch `merge/ai-campaign`, HEAD `42a9cec775201d9619fab030c33e26c0b83dafd1`; working tree bersih saat audit dimulai. Commit baru sesudah integrasi `d3541e4`: `3ebb20d` (C8) dan `42a9cec` (payment). P1-3 sudah berada dalam commit integrasi `d3541e4`; tidak ada laporan P1-3 baru khusus Rafi. Laporan P1-3 lama masih menggambarkan C8 terblokir, sesuai keadaan *sebelum* P2-1.
- Source mempunyai **16 migration** berurutan. Baru: `20261108100000_c8_campaign_offer_resolver.sql` dan `20261108110000_payment_settlement_clock_and_accept_lock_order.sql`. Git diff dari `d3541e4` menunjukkan 14 file migration pertama tidak diubah/dihapus. Kedua file baru memakai `CREATE OR REPLACE FUNCTION`, tanpa tabel/kolom baru. Nama argumen, hasil, `SECURITY DEFINER`, dan `search_path` fungsi yang diganti konsisten dengan kontrak lama secara inspeksi source; ACL runtime 16-chain belum diintrospeksi ulang. Generated types tetap masuk akal untuk signature/kolom yang tidak berubah, tetapi kesesuaiannya dengan DB 16-chain belum diverifikasi secara runtime.
- `docs/schema.md` masih menyatakan verifikasi 14 migration; `database/v2.1/tests/migration-contract.mjs::ACTIVE_MIGRATIONS` juga berhenti pada 14. Ini drift dokumentasi/harness, bukan bukti dua migration telah terpasang.
- Project MVP `cl-mvp-72e87c9aa2bc` masih aktif: delapan exact container berlabel benar, network/volume sendiri, port loopback, **ledger 14 migration/352 kolom**; GET `/login` pada app salinan port 3301 menjawab 200. Introspeksi fungsi **read-only** menemukan resolver C8 belum memuat predicate campaign published, `apply_verified_payment` belum memakai pemeriksaan `reservation.expires_at > clock_timestamp()`, dan `accept_late_payment` belum mengunci order sebelum capacity. Salinan app berbeda dari repo pada `campaign-execution/api.server.ts`, `campaign-execution/components/execution-workspace.tsx`, dan `campaign-strategist/owner-api.server.ts`. Runtime itu **belum menjalankan P2-1/P2-2**. Tidak ada migration atau sinkronisasi source dilakukan.

## C. Task Readiness Matrix

| Task | Status | Source evidence current | Runtime/test evidence | Remaining issue |
|---|---|---|---|---|
| P1-1 | PASS dalam cakupan historis | Auth/owner, product, capacity, preorder tidak berubah pada dua commit baru | **BROWSER VERIFIED historis** P1-1: login sampai publish/reload/owner asing | Belum diulang pada app current 16-chain |
| P1-2 | PASS dalam cakupan historis | `loadOwnedPreorderContext` tetap memakai owner, Core projection, frozen price, biaya nullable, commitment/versi/hash | **PLATFORM HTTP/SQL historis** P1-2; **UNIT VERIFIED fresh** dalam 1.154 tes | Setelah campaign published, C8 context masih `unavailable` secara fail-closed |
| P1-3 | PASS dengan mock; live provider UNVERIFIED | SSR owner API → Strategist/admission → Blueprint CAS → Execution; source owner publish diperbarui P2-1 | **BROWSER/MOCK PROVIDER historis** P1-3 dan run P2-1 owner 21/21; **UNIT VERIFIED fresh** | Runtime MVP lokal masih salinan sebelum P2-1; HMAC belum tersedia pada `.env.local` |
| P2-1 | UNVERIFIED fresh SQL; source tersambung | Publish owner enabled; SQL resolver C8, quote dan writer sama-sama memakai offer; tes C8 berisi 14 kasus | **DISPOSABLE SQL + BROWSER historis Rafi**: 180/180 dan 21/21; tidak diulang sekarang | Harness/instance 16-chain perlu diselaraskan sebelum sign-off terpadu |
| P2-2 | UNVERIFIED fresh SQL; fix terinspeksi | `clock_timestamp()` setelah lock pesanan; accept mengunci order lebih dulu; enam tes dua sesi | **DISPOSABLE SQL historis Rafi**: 186/186, enam tes baru; tidak diulang sekarang | Tidak membuktikan semua interleaving bebas deadlock; fresh 16-chain tertahan harness |

`PASS` historis tidak berarti tes platform pada HEAD ini dieksekusi kembali. P2-3/P2-4 Indro belum tergabung dan tidak dinilai selesai.

## D. End-to-End Owner Journey

| Tahap | Koneksi aktual | Tingkat bukti tertinggi |
|---|---|---|
| Login → owned business → dashboard | SSR Supabase `getUser`, membership owner, guard halaman/API | Browser historis P1-1/P1-3; source current tidak berubah |
| Product/cost → capacity → preorder publish | Server Actions/repository, frozen `preorder_items`, quota/capacity, F1 CAS/bounds | Browser/SQL historis; unit fresh |
| Pilih preorder → AI context | `loadOwnedPreorderContext` → C1/server provenance/hash; paid/held/allocated terpisah, unknown cost tetap null | SQL/HTTP historis P1-2; source + unit fresh |
| Strategist → Simulator → Blueprint edit/approval | Persistent discussion/admission → deterministic simulator → Blueprint workflow/RPC; manual edit tanpa inferensi | Browser/mock historis P1-3 dan P2-1; mock unit fresh |
| Approved → Execution → publish | `campaignExecutionService` memvalidasi source/versi/approval lalu `publish_campaign`; owner tidak lagi ditahan `C8_NOT_READY` | Browser/SQL historis P2-1; source current |
| Published campaign → quote → order | `current_order_offer` → `read_preorder_offer` dan `create_preorder_order`; writer menghitung ulang harga | SQL/PostgREST historis P2-1; source current; **tidak diuji fresh** |
| Order hold → claim/charge → verified apply | Core C4/C5 RPC dengan review/expiry/idempotency; adapter dan buyer UI menunggu Indro | SQL historis P2-2; **tidak ada Midtrans/buyer E2E** |

Rute owner dan layanan saling terhubung di source. Bukti browser terbaru yang tersedia adalah laporan P2-1 Rafi, bukan run audit ini pada salinan app 14-chain.

## E. P1-3 Findings

`/dashboard/campaigns` dan nav owner memakai sesi Auth yang sama. `/api/owner/{discussions,blueprints,campaigns}` memperoleh `businessId` dari membership dan membatasi repository/RLS; tidak menerima dev bearer sebagai identitas. Discussion memakai loader P1-2, Strategist, simulator, admission, persistence dan provider adapter existing. Blueprint memakai proposal tersimpan, edit manual tanpa LLM, CAS dan pemeriksaan sumber saat approve. `synthetic=false` hanya untuk fakta server; hasil provider mock tidak menjadi fakta penjualan. Execution memproyeksikan jadwal, budget, target, task; task dapat diubah hanya pada status published/closed. Guard polling session ID/epoch dan replan financial edits ada serta diuji unit.

**Mock provider verified, live Gemini NOT EXECUTED.** Kode memerlukan `GEMINI_API_KEY`, `GEMINI_MODEL`, dan admission memerlukan `RATE_LIMIT_HMAC_KEY`. Pemeriksaan nama variabel saja menemukan dua yang pertama ada di `.env.local`, HMAC tidak ada. Salinan app MVP tidak menyalin `.env.local`; tidak ada klaim provider real dapat dipakai pada runtime itu. P2-1 laporan Rafi menguji ulang owner journey dengan mock dan publish asli. Tidak ada perubahan guard Memory/Evaluation pada dua commit terbaru.

## F. P2-1 Findings

Migration C8 mengganti stub `private.current_order_offer`: discount hanya untuk `percent_discount` published yang belum ditutup, setelah `max(starts_at,published_at)`, sebelum `ends_at`, pada preorder published yang sama. `private.resolve_attribution` menerima slug campaign aktif pada preorder yang sama; ref asing/palsu memberi null. `normal_price` tidak mengisi `pricing_campaign_id`, tetapi link sah boleh mengisi atribusi. Konfigurasi offer/window dibekukan oleh trigger campaign existing. Quote `findPublicPreorder` membaca `read_preorder_offer`; writer `create_preorder_order` mengunci preorder → kapasitas → campaign published, memanggil resolver yang sama, membandingkan harga ekspektasi (`OFFER_CHANGED`), lalu `private.assert_orderable` dan insert atomik. Permintaan ulang dengan key/hash/token sama mengembalikan order lama walau offer kemudian berubah.

**Bukti historis yang cocok dengan source/tes:** tanpa campaign/base, diskon aktif 10% Rp120.000→Rp108.000, pembeli organik tanpa atribusi, ref sah/asing, future/expired/closed, normal price, pembulatan C2 termasuk batas bps, stale quote tanpa order/reservasi, replay, dan manual order tetap base. F1 nominal maksimum dan guard CAS pada migration sebelumnya tidak diubah. `FOR SHARE` pada campaign memitigasi race close vs checkout; urutan lock pada `private.lock_campaign_context` diubah preorder sebelum kapasitas. Rafi melaporkan kontrol sebelum fix menunjukkan stale discount dan 40P01, lalu kasus sesudah fix lulus; **audit ini tidak mereproduksinya sendiri**. Jendela SQL memakai `now()` waktu transaksi; jangan mengklaim uji semua interleaving batas waktu.

## G. P2-2 Findings

R1/A6-09: migration mengganti satu syarat `reservation.expires_at > now()` menjadi `> clock_timestamp()` setelah row `orders`/`payments` terkunci. Laporan Rafi menunjukkan dua sesi: settlement mulai sebelum batas lalu menunggu lock melewati batas. Sebelum fix, hold bisa dialokasi atau gagal `CAPACITY_EXCEEDED`; sesudahnya hasil `review`, order `requires_review`, reservation `released`, tanpa email lunas. Kontrol sebelum deadline tetap `applied`/satu email. Tes source memeriksa state dan capacity, bukan hanya return code.

R2/U01: `accept_late_payment` sekarang memanggil `private.lock_order` sebelum lock preorder/kapasitas. Laporan Rafi menangkap 40P01 sebelum fix, juga menolak percobaan fix lain yang membuat deadlock dengan expiry. Enam tes P2-2 mencakup accept invalid-state vs settlement, accept valid pada capacity bersama, serta expire vs settlement. Hasil sesudah fix yang dilaporkan tidak deadlock pada interleaving itu; **tidak ada bukti bebas deadlock universal**.

Invariant pembayaran lain ada dalam `payments.test.ts` historis: event sama/banyak concurrent hanya satu apply dan satu email job, nominal salah `amount_mismatch`, stale attempt/reconcile, `paid_sandbox` tetapi belum `applied_at` masuk review/unapplied, late accept last-slot tepat satu, foreign owner RLS. `applyVerifiedPayment` menerima fakta provider yang **harus sudah diverifikasi adapter**; signature HTTP Midtrans belum ada. Tidak ada fresh PostgreSQL/PostgREST P2-2 pada audit ini.

## H. Integration and Regression Results

| Pemeriksaan audit ini | Hasil dan batas |
|---|---|
| `npm.cmd test` | **1.154 PASS / 70 file**; source/unit termasuk owner, pricing, context. Tidak mencakup `tests/supabase` |
| Selected AI mocked integration (7 file via helper lokal `p12-mocks.mjs`) | **69 PASS / 7 file**; provider/repository mock, bukan SQL |
| `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build` | **PASS**, build memuat route owner baru |
| `node scripts/test-database-v21.mjs` | **FAIL sebelum SQL migration/test**: `ACTIVE_MIGRATIONS` hanya 14 sedangkan source 16. Harness membuat container networkless berlabel unik, lalu membersihkan *hanya* ID container run itu. Tidak ada data persisten disentuh |
| Instance MVP lokal | **READ-ONLY PREFLIGHT PASS**: delapan container, ledger 14, 352 kolom, loopback. Definisi tiga fungsi menunjukkan C8 dan dua perubahan P2-2 belum terpasang; app copy tertinggal. App login GET 200 bukan bukti owner flow current |
| Browser/HTTP owner current-source, 16-chain SQL, R1/R2 concurrency fresh | **NOT EXECUTED**; tidak memakai tests/supabase default yang membaca `.env.local` dan dapat memutasi stack persisten |

**Historis Rafi, bukan run audit ini:** P2-1 Supabase 180/180 dan owner browser/HTTP 21/21 pada disposable 15-chain; P2-2 Supabase 186/186 pada disposable 16-chain. Source tes dan migration yang dilaporkan ada pada HEAD ini, tetapi laporan tidak menggantikan reproduksi independen. P1-1/P1-2/P1-3 mempunyai laporan historis tersendiri. Tidak ada screenshot browser baru dalam audit ini.

## I. Pre-Indro Integration Contracts

Semua fungsi berikut berada pada source saat ini. `service role` berarti **hanya server Indro**, tidak browser. Output/effect dan penolakan wajib diuji lagi di 16-chain sebelum final acceptance.

| Kebutuhan | Producer / input → output | Boundary & error | Bukti / koordinasi |
|---|---|---|---|
| Katalog/quote | `src/features/preorders/repository.ts::findPublicPreorder(client, slug, now)` → status/availability, `orderableUnits`, frozen base price, effective `unitPriceIdr`/bps, pickup snapshot, foto | Server `service role`; null untuk draft/slug tidak ada; `read_preorder_offer` SQL memberi harga; tidak mengirim cost/order PII | P1-1 historis, P2-1 SQL historis. Business-wide listing belum ada; Indro tentukan halaman/listing tanpa mengubah harga Core |
| Buat order | `publicOrderSchema` → `src/features/orders/service.ts::placePublicOrder(client,input,holdTtlSeconds)` → `OrderResult` (ID/nomor/total/due/replayed) | Server `service role`; SQL hitung harga, quota/capacity, hold; `OFFER_CHANGED`, `CAPACITY_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT` mesti ditangani | P2-1 SQL historis. Browser harus menjaga key + token yang sama saat retry/lost response |
| Token & atribusi | `createPrivateOrderToken()`/`hashPrivateOrderToken()` di `orders/service.ts`; `attributionRef` = campaign slug; SQL pisah pricing vs attribution | Helper token ada di modul `server-only` (Node crypto), jadi browser Indro perlu membuat token setara dengan Web Crypto sebelum POST; server simpan hash saja. Ref invalid menjadi null | Koordinasikan cara mendapatkan campaign slug/link publik; route publik Indro belum ada |
| Claim/charge | `payments/service.ts::claimPaymentAttempt(client,token)` → `create_charge`/`reuse_qr`/`wait`/`reconcile`, ID/providerOrderId/amount; `recordPaymentCharge(client,charge)` → boolean | `service role` server; token invalid `ORDER_NOT_FOUND`; hanya `create_charge` boleh memanggil provider, `reconcile` memeriksa providerOrderId yang sama | `payments.test.ts` historis; adaptor Midtrans belum ada. Jangan membuat charge baru saat retry |
| Apply verified | `verifiedPaymentFactSchema` → `payments/service.ts::applyVerifiedPayment(client,fact)` → `applied`, `review`, `duplicate`, `conflict`, `recorded`, `ignored`, `amount_mismatch` | Adapter wajib validasi signature/status/referensi/nominal sebelum RPC; `service role`; `payloadHash` SHA-256, eventKey stabil. `review` bukan order teralokasi | P2-2 SQL historis; belum ada pengujian HTTP signature Midtrans |
| Status privat | `orders/service.ts::findOrderByPrivateToken(client,token,now)` → `PrivateOrderStatus` berisi status order/pembayaran terpisah, harga snapshot dan pickup | Server `service role`; invalid token → null; DTO tidak membawa nama/email/kontak/cost. Browser hanya membawa token privat | Tes Core historis; Indro buat route/status UI, label Sandbox wajib |

Interface yang perlu disepakati saat merge: slug campaign untuk link atribusi, pembuatan token di browser, respons `OFFER_CHANGED` yang meminta quote ulang, penyimpanan key/token saat retry, `reconcile` tanpa charge baru, dan verifikasi webhook sebelum `applyVerifiedPayment`. Ini pekerjaan P2-3/P2-4, bukan defect yang membenarkan penulisan ulang Core.

## J. MVP Blockers Only

**Tidak ada defect bisnis baru yang terkonfirmasi dari audit source ini yang harus diperbaiki sebelum Indro mulai merge.** Tiga hambatan berikut nyata untuk menjalankan/menandatangani alur gabungan; semuanya **NONBLOCKING untuk mulai merge**, tetapi **BLOCKER untuk sign-off MVP E2E**:

1. **Harness SQL BROKEN:** allowlist `database/v2.1/tests/migration-contract.mjs` 14 vs 16; `node scripts/test-database-v21.mjs` gagal sebelum apply/test. Perbaikan terkecil pada tugas implementasi terpisah: review dua migration baru dalam inventory, terapkan sesuai urutan pada container disposable yang dimiliki harness, verifikasi katalog/ACL/types dan jalankan ulang tes 16-chain; jangan mengubah ekspektasi bisnis agar tes hijau.
2. **Runtime lama DISCONNECTED:** instance MVP 14-chain dan app-copy lama. Untuk verifikasi owner→C8→payment, siapkan lingkungan 16-chain yang diotorisasi secara terpisah atau rencana upgrade instance ini dengan backup/verifikasi; jangan uji source baru terhadap schema lama dan jangan memigrasikan instance sekarang selama audit.
3. **Generasi AI live belum operasional pada konfigurasi yang diperiksa:** `RATE_LIMIT_HMAC_KEY` belum ada di `.env.local`, sementara `GEMINI_API_KEY`/`GEMINI_MODEL` terdeteksi ada; runtime app salinan juga tidak mewarisi env itu. Konfigurasi server + smoke provider yang diotorisasi diperlukan sebelum menyatakan AI live siap. Alur dengan mock telah terbukti historis.

Tidak ada klaim P2-1/P2-2 **fresh SQL PASS**; risiko konkurensi di luar interleaving historis tetap UNVERIFIED, bukan cacat baru yang sudah terbukti.

## K. Deferred Work

Memory, Evaluation lanjutan, sender email nyata/worker, polish UI, dan optimasi nonesensial bukan syarat mulai merge. Buyer catalog/checkout, QRIS Midtrans Sandbox, webhook verification, status privat (P2-3/P2-4), KPI aktual P3-1, dan final buyer/payment E2E P3-2 tetap pekerjaan roadmap, bukan regresi Steven–Rafi.

## L. Next Action

**Rekomendasi 2 — ready with explicit nonblocking limitations: mulai merge Indro.** Pada saat yang sama, tugas terpisah perlu menyelaraskan harness 16 migration dan menyediakan environment 16-chain yang diverifikasi. Setelah branch Indro digabung secara sah, uji satu alur owner publish → quote/checkout dengan harga C8 → claim/charge mock → webhook terverifikasi mock → payment apply/review → status privat. Siapkan HMAC/server Gemini hanya untuk verifikasi AI live yang diotorisasi. Jangan menandatangani MVP E2E sebelum hasil itu ada.

## M. Safety

Audit ini hanya membuat **laporan ini**. Source, test, migration, `.env.local`, `supabase/config.toml`, data project MVP/normal/remote dan Git history tidak diubah. Tidak ada reset/migrate/seed pada instance persisten, live Gemini/Midtrans/email, merge Indro, commit/push/deploy. Satu container PostgreSQL disposable dibuat dan dibersihkan oleh harness existing setelah guard inventory menolak 16 migration. Pemeriksaan environment hanya metadata read-only serta GET login tanpa sesi. Nilai secret tidak dicetak atau disalin ke laporan.
