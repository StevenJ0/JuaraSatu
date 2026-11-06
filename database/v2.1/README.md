# Fresh database foundation v2.1 — review baseline

> **Pembaruan 3 November 2026:** cutover lokal sudah dilakukan. Panduan aktif, hasil Auth/JWT/PostgREST, batas kontrak, dan perintah reproduksi berada di [LOCAL_VERIFICATION.md](./LOCAL_VERIFICATION.md). SQL kanonis sekarang `supabase/migrations/20261103000000_initial_v21.sql`, seed aktif `supabase/seed.sql`, dan types kanonis `src/lib/supabase/database.types.ts`. Dua migration lama dipindahkan ke `database/legacy/migrations/`. Config review dan salinan SQL/seed di folder ini merupakan snapshot historis; tidak menjadi project aktif. **Seluruh isi di bawah adalah laporan sebelum cutover**, termasuk command/status lama; jangan gunakan command `--write-types` pada harness disposable untuk memperbarui types aplikasi.

**Status:** 26 tabel/351 kolom sudah dibangun dan diuji pada PostgreSQL disposable. Baseline ini terpisah dari chain aktif `supabase/`. Belum diterapkan ke database lokal pengguna atau remote; bukan upgrade data legacy dan bukan implementasi Stage 4B.

Permintaan database ini secara eksplisit mengizinkan migration/RLS/RPC/seed. `docs/schema.md`, migration lama, root config, serta seluruh source aplikasi dipertahankan. Target kontrak tetap `docs/schema.md` v2.1; lihat [COVERAGE.md](./COVERAGE.md) untuk perbandingan katalog kedua chain, seluruh tabel, perubahan kolom dan inventory RPC.

## Keputusan migration dan keselamatan

- `supabase/migrations/` berisi dua SQL legacy, keduanya belum tracked pada Git saat audit. Karena itu Git history belum dapat menjadi arsip yang dapat diandalkan.
- Marker `supabase/.temp/project-ref` tidak ditemukan. Ini bukan bukti bahwa migration belum dipakai oleh developer lain atau remote; tidak dilakukan koneksi remote untuk menebak statusnya.
- Migration lama tetap berada di lokasi semula, tanpa penghapusan atau penulisan ulang. Baseline baru hanya di `database/v2.1/supabase/migrations/`.
- Jangan menambahkan migration fresh ini setelah chain legacy: nama tabel bertabrakan dan tidak ada transformasi data. Review/cutover baseline atau upgrade database berisi data merupakan tugas terpisah.
- SHA256 legacy untuk pembanding audit:
  - `20261030210000_initial_schema.sql`: `0024416c8296b70eb9b1024b9f13df9a048ce35fe5d8c32a46e0185b25ee9f65`.
  - `20261030225000_add_campaign_memory_and_calendar_contents.sql`: `09dc752f763f5610fc33f0dd8a956bad1945249ed6444970bc18b7c0e20c8088`.

## Reproduksi pengujian

Dari root repository, setelah dependency yang sudah ada terpasang dan Docker berjalan:

```powershell
node scripts/test-database-v21.mjs
# Hanya jika ingin memperbarui snapshot generated types dari katalog aktual:
node scripts/test-database-v21.mjs --write-types
npm.cmd run test:unit
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd run build
```

Harness memerlukan image lokal berikut; tidak otomatis melakukan pull:

- `public.ecr.aws/supabase/postgres:17.11.0.006` (PostgreSQL 17.11, vector 0.8.2, pgTAP 1.3.3).
- `public.ecr.aws/supabase/postgres-meta:v0.100.0` untuk generated types Supabase.

Harness membuat container unik berlabel `campaign_lab.disposable=v21-test`, tanpa volume atau port host, memakai `--network none`. Metadata generator berbagi network namespace container tersebut, yang hanya mendengarkan loopback internal. Tidak menghubungi database aplikasi, provider atau internet. Dua database kosong di dalamnya dipakai untuk chain target dan legacy secara terpisah. Container buatan harness dihentikan/dihapus otomatis setelah memeriksa labelnya, termasuk saat test gagal. Ini menghapus hanya data test yang baru dibuat.

`tests/bootstrap.sql` adalah **auth stand-in untuk test saja**: role PostgreSQL nyata, dua subject sintetis, serta `auth.uid()`/`auth.role()` yang membaca request claims. Tidak boleh dipasang di Supabase asli. RLS/constraint/transaksi/concurrency berjalan pada PostgreSQL nyata; JWT signature, GoTrue, PostgREST dan browser login belum diuji oleh harness ini.

Hasil pengujian yang sudah dijalankan:

- Fresh migration dan seed berhasil; legacy chain juga berhasil dikompilasi secara terpisah.
- 96 assertion pgTAP: tenant isolation, grants, composite FK, stale version/idempotency, AI success/failure, immutable snapshots, rollback blueprint, publication uniqueness, memory/profile/vector, payment replay, production ledger completeness dan lease fencing.
- Tiga race dengan koneksi PostgreSQL berbeda: last-slot reservation, duplicate AI request, dan job claim `SKIP LOCKED`.
- Kesesuaian 26 tabel/351 kolom, tipe, panjang varchar dan nullable eksplisit dengan schema Markdown.
- Type generation Supabase berhasil dari katalog nyata; `database.types.ts` lulus TypeScript strict. 247 unit test aplikasi, lint, typecheck dan build lulus.

Katalog lengkap, hasil `pg_dump --schema-only` dan hasil type generation terbaru ditulis ke cache yang diabaikan Git: `node_modules/.cache/database-v21/`. Katalog mencakup FK/check/unique/index/policy/grant/trigger/function/extension; tidak berisi row pelanggan.

## Konfigurasi Supabase dan seed

`supabase/config.toml` dalam folder ini adalah project review terpisah, PostgreSQL 17, memakai API 55321, DB 55322, shadow DB 55320, Studio 55323, dan mail 55324. Seed path `./seed.sql` tersedia. Root config tetap legacy dan referensi root seed yang belum tersedia tidak diperbaiki pada task ini.

Supabase CLI terpasang versi 2.122.0. Command read-only berikut menerima config lalu gagal koneksi karena stack review penuh memang tidak dijalankan:

```powershell
npx.cmd supabase --workdir database/v2.1 migration list --local
# ECONNREFUSED 127.0.0.1:55322 — expected: tidak ada stack review pada port host.
```

Belum ada bukti `supabase start`/GoTrue/PostgREST penuh. Jangan menjalankan reset atas project yang sudah berisi data. Pengujian di atas tidak membutuhkan `supabase start`, `db reset`, `db push`, link remote, atau kredensial.

Seed hanya membuat dua bisnis demo, owner membership, produk, kapasitas, preorder/item dan campaign draft. Tidak ada order/payment yang diklaim telah diverifikasi. Auth subject berikut harus sudah tersedia **pada environment test yang memang dituju**:

- `11111111-1111-4111-8111-111111111111`.
- `22222222-2222-4222-8222-222222222222`.

Pada harness, subject disiapkan oleh bootstrap test sebelum migration/seed. Pada Supabase penuh, provisioning subject melalui Auth yang benar masih diperlukan; seed tidak menulis `auth.users` secara langsung. Bila subject belum tersedia, seed memberikan NOTICE dan melewati seluruh dataset. Seed ini ditujukan untuk sekali jalan pada database fresh, bukan seed ulang database yang sudah berisi fixture.

## Batas akses dan kontrak runtime

- Browser/anon tidak mendapat akses langsung ke tabel owner. Authenticated hanya SELECT dengan RLS dan RPC owner yang diberi GRANT eksplisit. Tidak ada direct INSERT/UPDATE/DELETE authenticated.
- `is_business_owner` tetap mengikuti membership/`auth.uid()`. Fungsi owner memakai identitas token; actor ID bukan bukti login. Fungsi server memerlukan service role dan memeriksa explicit actor terhadap membership.
- Finalisasi AI, draft/revision campaign, approval blueprint, publication, evaluation, payment, indexing dan worker hanya service role. Private helper tidak diekspos. Setiap SECURITY DEFINER memakai search path kosong dan referensi schema eksplisit.
- `service_role` adalah trusted writer dan melewati RLS. Grant langsung INSERT/UPDATE disediakan untuk orkestrasi server lintas tim. Tidak semua transisi bisnis dapat dijamin jika privileged code sengaja menulis flag langsung; gunakan RPC yang sesuai dan validasi service. Role ini tidak boleh berada pada browser.
- Generated types adalah kontrak transport, bukan runtime validator. JSONB tetap `Json`, status check tetap `string`, vector berupa `string`, bigint dipetakan `number` oleh generator. Adapter wajib melakukan narrowing/Zod, pemeriksaan safe integer/batas C2, UTC, dimensi dan profil embedding. Tidak menggunakan `any`.
- SQL menjaga invariants finansial/kapasitas dan binding identitas; validasi penuh narasi/proposal/blueprint/KPI tetap tanggung jawab service. Provider call berlangsung **di luar** transaksi PostgreSQL.

## Operasi AI dan kesiapan Stage 4B

| Kebutuhan | Kemampuan database | Integrasi berikutnya |
|---|---|---|
| Create session milik owner/preorder | `create_ai_session` + composite FK/RLS | Handler auth dan owner scope Rafi |
| Load setelah refresh | SELECT session + messages, urut `sequence` | Repository nyata; gabungkan read konsisten atau retry versi berubah |
| Refresh context | `refresh_ai_session_context`, CAS, menolak turn running | Context Builder harus menghitung ulang dari data server |
| Save user + claim generation | `claim_ai_generation`: lock session, dedupe, user message, increment version dalam satu transaksi | `DiscussionRepository.beginTurn` |
| Provider success | `finalize_ai_generation`: CAS + generation success + assistant/proposal + session version | Runtime validation proposal dan C2 sebelum finalisasi |
| Provider failure | `fail_ai_generation`: failure code aman + advance version; tanpa assistant success | `DiscussionRepository.failTurn`; timeout recovery server |
| Stale write / tenant lain | Version/hash guard, FK tenant dan RLS | Mapping error SQL ke domain errors |

Urutan server berikutnya: authenticate owner → build/revalidate context → claim RPC commit → Gemini di luar transaksi → parse output/recompute C2 → finalize atau fail RPC commit → response. Klaim tidak otomatis kedaluwarsa; bila process mati setelah claim, server reconciliation harus menandai kegagalan menggunakan generation ID dan versi terkini secara aman. Belum ada worker AI recovery pada task ini.

Perbedaan yang harus ditangani adapter terhadap fake repository sekarang:

- Dedupe target adalah `(business_id,generation_type,request_key)`, lebih luas daripada sesi; key yang dipakai di sesi lain ditolak, bukan menghasilkan turn kedua.
- DB `success` dipetakan ke repository `completed`; DB mengembalikan `output`, repository mengharapkan parsed `proposal`.
- `claimVersion` adalah session version setelah user message. Proposal binding memakai versi itu; finalisasi memajukan version sekali lagi.
- `StrategyProposal` tersimpan merupakan snapshot tervalidasi. Field persistence dari engine saat generation tidak boleh menjadi sumber kebenaran status penyimpanan; response repository harus mengembalikan hasil commit yang benar.
- `40001` mencakup beberapa domain conflict; petakan kode pesan yang dikenal. `42501` authorization; `23503` scope FK; `23505` duplicate; `P0002` not found. Jangan membocorkan SQL/provider payload ke UI.

Prasyarat database Stage 4B tersedia dan telah diuji. Auth aplikasi, Supabase server client/repository nyata, handler dan persistent UI belum dibuat. Tidak ada pekerjaan Stage 4B dilanjutkan otomatis.

## Campaign, blueprint, evaluation dan memory

- `save_campaign_draft` membuat/merevisi draft menggunakan expected version. `save_blueprint_revision` membuat row versi baru, mengubah approval lama menjadi discarded, serta mengganti active pointer. History/task/content lama dipertahankan, bukan dihapus. UI/query planner berikutnya wajib memakai active/published blueprint ID agar tidak menampilkan task lama. Jika sudah ada task completed, revision ditolak dan membutuhkan campaign baru.
- `approve_blueprint` menerima JSON minimum PRD §15.3 (`offer.type`, bukan DTO strategist `offer.offerType`). Service berikutnya harus membentuk/validate kontrak blueprint yang tepat; snapshot proposal strategist tidak langsung dianggap blueprint.
- Approval memeriksa lima versi fakta: `capacityVersion`, `preorderVersion`, `preorderItemVersion`, `productVersion`, `campaignVersion`, serta hash dan availability terkini. Versi berasal dari read server; hash hanya binding snapshot, bukan pengganti revalidasi. Bounds: tasks 1..12, contents 1..8 dan body 2200.
- Publication memerlukan approval, preorder published, window masih aktif, capacity dan discount policy yang valid. Baseline menyimpan paid units aktual database, bukan asumsi simulator. Baseline C6 lengkap/metrics snapshot perlu integrasi analytics; fungsi publish saat ini menyimpan baseline paid units dan versi sumber yang diperlukan fondasi.
- Diskon tunggal dalam basis poin; SQL memakai aritmetika integer/numeric dengan floor sesuai C2 dan melarang discount unknown-cost/nonpositive contribution pada approve/publish. Service tetap wajib memakai C2 sebagai sumber kalkulasi aplikasi. Normal-price campaign dapat memiliki budget; itu bukan otomatis baseline tanpa promosi.
- `record_campaign_evaluation` menyimpan snapshot append-only dan dapat menerima analysis NULL ketika AI gagal. Final memerlukan campaign closed/completed, published blueprint yang benar, completeness confirmed, cohort operasional selesai, ledger yang ada tidak unknown, serta ledger known dengan quantity penuh untuk item yang produksinya dimulai. **RPC ini belum menghitung C6 dan belum menggantikan `read_metrics_snapshot` yang konsisten.** Jangan mengirim metrics yang dihitung dari request independen lalu mengklaim snapshot atomik.
- Memory draft harus dibuat server dari final evaluation. Approval owner mengunci hash/profil dan memasukkan satu durable embedding job; indexing memakai CAS metadata. Retrieval menyaring business/approved/ready/model/profile/version sebelum distance+limit. Tidak ada global guides/documents/chunks.
- Model/profile embedding produksi belum dipilih; test memakai label sintetis dan vector buatan. Tidak ada provider embedding yang dipanggil. Memory revisions/stale propagation perlu service setelah definisi canonical source/version lintas evaluation dipastikan. Unique `(business_id,source_evaluation_id,source_version)` sudah menjaga satu row per versi sumber; jangan menganggap itu otomatis menandai versi terdahulu stale.

## Handoff lintas tim

| Pemilik | Kontrak yang perlu dihormati | Belum diimplementasikan |
|---|---|---|
| Rafi | Auth terverifikasi, membership; capacity per product/date; satu published preorder business/date; snapshot frozen; lock capacity sebelum preorder/item/campaign/order | Atomic create public/manual order, expire/cancel, fulfillment transitions dan production ledger |
| Steven | CAS/hash + C2, approval ≠ publish, active/published blueprint ID, append-only evaluation, approval memory | Persistent repository/auth wiring, full blueprint validator, C6 snapshot integration, memory version/recovery workers |
| Indro | Satu sandbox merchant tim; server total; signature/reconciliation sebelum payment RPC; email/job provider calls di luar transaction | Payment-attempt claim, gateway adapter/webhook verification, late-payment acceptance, durable worker/email delivery, metrics snapshot |

Kontrak operasi target yang masih perlu tugas implementasi tersendiri:

| Operasi | Input otoritatif dan transaksi wajib |
|---|---|
| `create_preorder_order` | Slug/token request + server-resolved owner/preorder/item/current offer, normalized customer input, request hash/idempotency key. Lock capacity → preorder/item → campaign; hitung C2 server; buat order+item+held reservation+private token hash satu transaksi. Raw token tidak disimpan/log. |
| `create_manual_order` | Auth owner + owned product/date/items, external payment state yang disepakati. Lock capacity terurut, snapshot harga/biaya, order/items/reservations dalam satu transaksi. |
| `claim_payment_attempt` | Order authorization/private token, expected order state, command key. Persist satu active attempt/provider order ID dan server amount sebelum provider call; retry memakai attempt yang sama. |
| `expire_or_cancel_order` | Actor/command key + expected version. Lock capacity → preorder/item → order → payment/reservation; release hanya saat legal, audit idempotent; produksi dimulai tidak mengembalikan kapasitas sunk. |
| `advance_fulfillment` | Auth owner + expected version + transition legal. Timestamp/ledger produksi dan audit satu transaksi; payment state terpisah. |
| `accept_late_payment` | Owner review, verified payment fact, current capacity dan expected version. Re-allocate seluruh item atau rollback; cegah applied payment kedua; email enqueue satu kali. |
| `read_metrics_snapshot` | Auth owner, campaign/published blueprint, actual activation window dan schema version. Baca satu snapshot konsisten, hitung C6 deterministik, buktikan ledger/completeness, simpan evaluation terikat sumber; bukan request REST per tabel. |

`apply_verified_payment` hanya menerima fact provider **yang sudah diverifikasi** oleh trusted server. Ia tidak memverifikasi signature, fraud status atau network response Midtrans. `capture` hanya boleh diteruskan setelah fraud/settlement eligibility diverifikasi adapter. Ia mencatat fact, mengalokasikan hold yang masih valid, menandai active/confirmed, memasukkan audit dan durable email job dalam satu transaksi. Late/duplicate paid masuk review; tidak otomatis meminta kapasitas tambahan. Tests memakai input `SIMULATED-*`, bukan transaksi Midtrans nyata.

Worker harus mempertahankan fencing `attempt_count` dan lease, membatasi retry, serta memakai dedupe provider. Database menjamin enqueue unik dan claim atomik; tidak menjamin email exactly-once jika provider berhasil lalu worker mati sebelum acknowledgement. Private tracking token email membutuhkan keputusan penyediaan token aman—schema hanya menyimpan hash, bukan raw token.

## Keputusan terbuka dan batas review

1. Cutover baseline belum aman karena applied history tim/remote belum diketahui. Old SQL dipertahankan; perlu keputusan terpisah sebelum memindahkan baseline ke root atau meng-upgrade database lama.
2. Schema tidak menetapkan enum final `external_payment_status`; fondasi tidak mengarang check enum. Query baseline sementara mengenali `confirmed`; Rafi/Indro perlu menyepakati state ini sebelum manual-order flow digunakan.
3. Nullable draft slug diizinkan karena kontrak hanya menyebut UNIQUE; published slug wajib. Field lain tanpa NULLABLE dianggap required. Ini keputusan interpretasi untuk review, bukan perubahan dokumentasi schema diam-diam.
4. Target tidak memuat `campaign_contents.campaign_task_id`; kolom legacy opsional itu tidak dibawa. Relasi lewat campaign/blueprint/content_key/task_key.
5. Task channel sementara mengikuti WA/Instagram/offline; content WA/Instagram/landing_page. PRD meminta allowlist tetapi tidak mendefinisikan enum final di tabel. Validasi UI/blueprint yang lebih sempit tetap harus ditegakkan service; perubahan allowlist memerlukan review kontrak.
6. Definisi canonical source/source_version dan propagation stale lintas evaluation perlu disepakati sebelum menyatakan RAG lifecycle lengkap. Profil embedding produksi dan distribusi private email token juga belum diselesaikan.
7. Transisi yang belum punya RPC, full metrics/ledger verification, JWT HTTP, provider/email dan recovery belum teruji E2E. Tidak ada klaim production-ready atau bahwa checkout/Stage 4B sudah berfungsi.

Tidak ada commit, push, deploy, perubahan schema remote, reset database pengguna, atau penghapusan migration lama. Berhenti di foundation untuk review.
