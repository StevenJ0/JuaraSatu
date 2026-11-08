# Batch A4 — Database Test Harness Recovery & Full Migration Verification

Tanggal: **7 November 2026, Asia/Jakarta**. Branch `merge/ai-campaign`; HEAD `5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762`.

## A. Executive Summary

**Overall: PASS untuk PM09 / Layer 1 isolated SQL harness.** Entry point utama kini memakai engine disposable A1–A3 yang sama, bootstrap Storage terpisah dan versioned, checkpoint historis eksplisit, reviewed migration inventory, full-chain contract checks dan artefak per-run. Tidak ada application logic, migration aplikasi, schema docs atau generated types yang diubah.

**Comparator execution PASS; schema versus docs DRIFT, strict comparison FAIL.** Tepat satu perbedaan terdeteksi: `businesses.categories` EXTRA, dengan 351 kolom MATCH. PM13 tidak disembunyikan atau dianggap selesai. CLI strict tetap exit 1. SQL-layer success dibedakan dari documentation-match gate.

Layer 1 menjalankan 13 migration, 100 assertion pgTAP termasuk #65 pada checkpoint yang benar, 7 kelompok Memory legacy, A1 15 kelompok, A2 18, A3 14 beserta 5 actual-reader tests, Memory 8B 10 dan 8 kelompok kontrak A4. Default unit **1.101/67 berkas**, selected AI mock **69/7 berkas**, TypeScript, lint dan build lulus. Angka kelompok/race tidak dijumlahkan sebagai individual Vitest tests.

**Layer 2 actual Supabase platform: NOT EXECUTED.** Tidak ada mutation pada stack lokal persisten/remote. A1/A2/A3 tetap belum deployed. Batch A5 tidak dimulai.

## B. Root Cause Verification

1. Runner lama `scripts/test-database-v21.mjs` menyediakan auth stand-in, tetapi tidak `storage.buckets`/`storage.objects`; K (`20261106160000_core_preorder_on_v21.sql`) membutuhkan bucket serta tiga object policies. Reproduksi A4 pada container kosong: K gagal karena Storage tidak ada, dan transaksi gagal tidak menyisakan `businesses.categories`. Scaffold kemudian dimuat dan migration yang sama berhasil tanpa perubahan source.
2. Runner lama sudah memisahkan pgTAP sebelum M93 (`20261104093000...`), jadi bukan benar bahwa seluruh runner lama menjalankan #65 pada final hardened schema. Namun checkpoint tidak dijelaskan tegas, coverage current bercampur dengan historical prerequisites, dan schema-doc assertion menghentikan tes lanjutan. A4 mempertahankan seluruh assertion lama dan menegaskan boundary.
3. Comparator existing adalah pemeriksaan kolom terhadap `docs/schema.md`: type/nullability/documented defaults/UUID PK default plus missing/extra columns. Algoritmanya benar dalam mendeteksi `categories`; tidak perlu diubah. Strict documentation mismatch sebelumnya menghentikan pipeline sebelum coverage/current Memory/concurrency dapat selesai.
4. Runner lama menduplikasi Docker orchestration, tidak mem-pin endpoint lokal atau memeriksa empty target/mount/port seketat engine A1–A3, memerlukan postgres-meta image dan menghasilkan cache types. A4 menghapus orchestration duplikatif dari entry point utama dan tidak menjalankan pekerjaan PM08 type generation.

## C. Existing Harness Inventory

| Entry point / command | Target, behavior dan klasifikasi |
|---|---|
| `node scripts/test-database-v21.mjs` | **Canonical full Layer 1** setelah A4; memanggil `runDatabaseContracts({fullChain:true})`; fresh local Docker PostgreSQL, network none, Unix socket, tanpa volume/port, fixtures hanya disposable, cleanup run-owned. Sebelumnya bare-PG orchestration terpisah dengan dependency Storage yang hilang. |
| `node database/v2.1/tests/job-acknowledgement.mjs` | Focused disposable A1 prefix; `--a2`/`--a3` menambah batch terkait. Engine sama dengan canonical entry; fokus prefix tidak diklaim full-chain entry. |
| `database/v2.1/tests/invariants.sql` | Historical pgTAP 100 assertion pada prefix sampai `20261104092000`, bukan final contract. Membutuhkan Auth stand-in, seed, vector dan pgTAP; default source ROLLBACK. Hanya harness disposable menahan fixture melalui penggantian final ROLLBACK→COMMIT dalam memori. |
| `memory-pipeline.mjs` | Historical Memory pipeline, 7 groups/1 concurrent claim scenario sebelum M93. Synthetic approval/vector-only success hanya pada checkpoint lama. Module menerima SQL closures, tidak memilih server sendiri. |
| `memory-transactions.mjs` | Current hardened 8B, 10 groups/5 observed races; dipanggil setelah seluruh migration. Positive private plumbing synthetic tetap bukan production eligibility. |
| `job-claim-isolation.mjs`, `preorder-publication.mjs` | Focused A2/A3 modules memakai target engine yang sudah diverifikasi; tidak menerima remote URL. A3 menjembatani SQL-produced rows ke actual application parsers dengan intercepted HTTP. |
| `concurrency.mjs` | Current-schema concurrency module: last reservation slot, AI replay/version dan typed workers. Dipakai canonical Layer 1; tidak mempunyai Docker target sendiri. |
| `node database/v2.1/tests/schema-contract.mjs <catalog.json>` | **Read-only strict comparator CLI**, tanpa database/network. Membaca existing docs sebagai expected contract, actual captured catalog sebagai actual; DRIFT berarti exit 1. |
| `node scripts/test-supabase-v21.mjs` | **Persistent-stack-dependent Supabase integration**, hardcode `supabase_db_campaign-lab`, CLI status/JWT/PostgREST, auth users/cache; `--setup-fixtures` menulis data/credentials dan `.env.local`; `--write-types` menulis generated source. Tidak dieksekusi dan bukan Layer 2 disposable. Legacy cache/type expectations script ini juga bukan output contract baru A4. |
| `npm.cmd run test:integration` / `tests/supabase/*` | Persistent Supabase Auth/HTTP/SQL helpers; fixture writes dan cleanup, beberapa mengganti offer function sementara. Localhost tidak membuktikan disposable. Tidak dieksekusi. |
| PostgreSQL F05/F06 files di `tests/integration`, fixture `postgres-generation-claims.ts`/`quota-postgres.ts` | Hardcode normal campaign-lab DB, row/claim/bucket mutations dan cache evidence. Tidak diaktifkan. Focused SQL F05/F06 dari A2 dijalankan pada disposable engine sebagai pengganti scope terfokus, bukan klaim seluruh suite lama itu dijalankan. |
| `prepare-campaign-execution.mjs`, browser/Bruno/business-memory E2E/provider smoke | Mutative app/normal-stack preparation atau provider-specific tests; bukan full-chain SQL harness dan tidak dijalankan. |

Separate `database/legacy/migrations` dan `database/v2.1/supabase/migrations` tetap historical/snapshot sources. Canonical current contract hanya dari root `supabase/migrations`. Runner utama tidak lagi mencampur compilation/type-generation chain historis lain ke acceptance current chain. File/instruksi historical tersebut tidak dihapus.

## D. Canonical Test Architecture

**Layer 1:** canonical entry → shared disposable engine → local endpoint/empty-target preflight → Auth stand-in → reviewed root prefix → seed → historical pgTAP/Memory → hardening → reproduce missing Storage/rollback → Storage v1 → remaining root migrations → A3/A2/A1/8B → current catalog/SQL contracts → strict diff artefacts → run-owned cleanup.

Reviewed filename inventory bersifat independen dari database introspection; missing/reordered/unreviewed migration gagal. Tidak mengubah expected schema menjadi hasil actual. Semua error tidak terduga tetap exception/nonzero exit.

**Layer 2:** harus memakai fresh real Supabase project dengan port/network/volume/project lifecycle yang diverifikasi. Tidak tersedia safe disposable platform entry dalam repository: helper existing menarget normal project/port/container dan dapat menulis `.env.local`. Docker read-only inspection mengonfirmasi stack campaign-lab aktif dan image platform tersedia, tetapi image availability bukan bukti isolasi instance kedua. Karena lifecycle platform disposable belum dibangun/dibuktikan, Layer 2 tidak dijalankan; SQL scaffold tidak digunakan untuk mengklaim HTTP/Auth/Storage service readiness.

## E. Implemented Changes

1. `scripts/test-database-v21.mjs`: thin canonical entry ke shared engine; optional `--strict-docs` mempertahankan hard failure gate untuk doc drift.
2. `database/v2.1/tests/job-acknowledgement.mjs`: export `runDatabaseContracts`, tetap mendukung direct focused invocation; full-chain mode, explicit historical checkpoint/#65, reused legacy suite, atomic wrappers untuk SQL migration tanpa outer transaction, missing-Storage reproduction, run inventory dan current contract stage. Local endpoint dipin dan npipe remote-host form ditolak.
3. `database/v2.1/tests/platform-storage-v1.sql`: single versioned test scaffold, mengganti inline Storage DDL. Auth bootstrap existing tetap dipakai tanpa perubahan.
4. `database/v2.1/tests/migration-contract.mjs`: reviewed 13-file inventory, unique timestamps, deterministic exact matching; missing/unreviewed inventory negative checks.
5. `database/v2.1/tests/current-contracts.mjs`: 8 current-contract groups, strict diff/self-checks, full catalog + migration hashes + summary per-run.
6. `database/v2.1/tests/schema-contract.mjs`: hanya menambah read-only strict CLI; existing comparison algorithm/source of truth tetap.
7. Laporan ini.

Tidak menambahkan dependency atau migration aplikasi. A1/A2/A3 test expectations tidak diubah. Existing application source, docs schema/handoff dan previous reports dipertahankan.

## F. Auth/Storage Bootstrap

Auth stand-in existing: roles `anon`, `authenticated`, `service_role` (BYPASSRLS); `auth.users(id,email)` untuk FK dan dua synthetic owner UUID; `auth.uid()`/`auth.role()` membaca test GUC. Grants schema/function memungkinkan real SQL role checks. Ini tidak menjalankan GoTrue atau memverifikasi JWT.

Storage v1 menyediakan tepat surface yang dirujuk migration: schema `storage`; `buckets(id,name,public,file_size_limit,allowed_mime_types)`; `objects(id,bucket_id,name)`, PK/default UUID, bucket FK dan unique bucket/name, RLS enabled. Authenticated/service object SELECT/INSERT/DELETE serta schema USAGE adalah stand-in bagi platform grants. Application policies/bucket metadata berasal dari root migration, bukan scaffold. Tidak membuat fake business tables.

Actual SQL tests menguji bucket `product-photos` public, 5 MiB, JPEG/PNG/WebP; owner insert/select/delete path sendiri, foreign/invalid path denial, foreign DELETE zero rows, anon denied. Ketiga app policies dievaluasi di bawah authenticated role dengan test identity, bukan hanya keberadaannya di catalog.

Tidak ditiru: Storage HTTP/JWT pipeline, object byte upload/deletion, owner metadata tambahan, storage migrations lengkap, MIME/content enforcement saat upload, signed URLs atau platform role provisioning. Tidak menyatakan Storage service authorization/E2E sudah PASS.

Extensions aktual: plpgsql 1.0 di pg_catalog, vector 0.8.2 dan pgTAP 1.3.3 di extensions. Vector berasal dari root baseline; pgTAP dari historical test setup.

## G. Migration Chain

Seluruh file berikut **APPLIED** pada setiap complete fresh run, dengan source SHA-256 disimpan per-run:

| No. | Root migration |
|---|---|
| 1 | `20261103000000_initial_v21.sql` |
| 2 | `20261103090000_atomic_campaign_blueprint_creation.sql` |
| 3 | `20261104090000_evaluation_cas_and_finalization.sql` |
| 4 | `20261104091000_seal_completed_campaign_updates.sql` |
| 5 | `20261104092000_reject_synthetic_finalization_memory_approval.sql` |
| 6 | `20261104093000_memory_approval_and_indexing_transactions.sql` |
| 7 | `20261104094000_memory_index_recovery.sql` |
| 8 | `20261106090000_memory_generation_type.sql` |
| 9 | `20261106100000_atomic_ai_generation_admission.sql` |
| 10 | `20261106160000_core_preorder_on_v21.sql` |
| 11 | `20261107090000_generic_job_acknowledgement_guards.sql` |
| 12 | `20261107100000_job_claim_isolation.sql` |
| 13 | `20261107110000_canonical_preorder_publication.sql` |

Existing outer BEGIN/COMMIT dipakai apa adanya; file 3/4/5/10 tanpa outer transaction dibungkus harness BEGIN/COMMIT tanpa mengedit migration. Reproduksi Storage membuktikan failed K rollback; DDL error probe juga membuktikan psql error/transaction rollback. Applied inventory harus persis discovery root, bukan hanya timestamp tertinggi atau hardcoded count.

Current catalog memuat **26 tables, 352 columns, 290 constraints, 107 indexes, 30 public policies, 45 public triggers, 99 public/private functions, 3 extensions**. Ini ukuran inventory, bukan klaim setiap object mempunyai individual behavioral test. Tambahan tiga Storage policies berada pada schema storage dan diuji terpisah.

## H. Historical pgTAP Checkpoints

| Boundary | Tes / count | Expected dan observed |
|---|---|---|
| Root prefix sampai `20261104092000`, sebelum M93 | `invariants.sql`: 100 assertions, termasuk exact output `ok 65 - owner approval queues durable memory job` | PASS; legacy synthetic lower-layer owner approval memang dapat enqueue pada checkpoint ini. Source assertion tidak diubah atau silently skipped. |
| Boundary sama, retained isolated fixture | `memory-pipeline.mjs`: 7 groups + 1 concurrent worker scenario | PASS; legacy approval/vector-only contract, filtered retrieval dan immutable source diuji pada versi asal. |
| Full chain termasuk A1/A2/A3 | Memory 8B 10 groups/5 observed races; A1/A2 guards | PASS; public synthetic/foreign approval ditolak, dedicated atomic writeback/recovery/fencing benar, vector-only old EXECUTE tetap disabled. |

Fixture hanya ditahan di database disposable melalui final ROLLBACK→COMMIT in-memory seperti harness historical existing. Tidak mengubah SQL assertion file. Historical #65 tidak dijalankan dengan harapan sukses pada final hardened source rules. Positive private vector plumbing 8B tetap synthetic/test_only/productionEligible=false; tidak mengganti source authority C6/C7.

## I. Strict Schema Comparison

Expected contract tetap `docs/schema.md`. Comparator execution **PASS**, actual source-schema comparison **DRIFT / strict FAIL**: **351 MATCH, 1 EXTRA `businesses.categories`**. Tidak ditemukan perbedaan baru selain PM13 yang sudah diketahui.

Tidak ada exclusions, ignore-column rule, strict-mode disable atau expected-schema generation dari actual catalog. Semua row comparison disimpan. SQL-layer acceptance mengharapkan deteksi known PM13 yang tepat; drift lain membuat assertion gagal. Ini bukan menandai known mismatch sebagai MATCH. Negative self-check menambahkan unexpected column, menghilangkan documented column dan mengubah tipe: masing-masing EXTRA/MISSING/MISMATCH terdeteksi.

CLI strict yang benar-benar dieksekusi:

```powershell
node database/v2.1/tests/schema-contract.mjs node_modules/.cache/database-v21/0c7fd02a-d645-4ae3-b60f-2770e0326846/catalog.json
```

Hasil **exit 1**, execution PASS, schema DRIFT dengan categories EXTRA. Canonical `--strict-docs` juga merupakan gate nonzero untuk mismatch yang sama. PM13 tetap perlu tugas terpisah; PM08 types tidak diregenerasi.

Artefak di `node_modules/.cache/database-v21/<runId>/`: `catalog.json`, `schema-comparison.json`, `summary.json` (ordered migrations + hashes, checkpoint/counts, target, duration). `latest.json` hanya pointer ke run terakhir. Artefak ini bukti actual, bukan sumber expected schema, dan tidak di-commit. Cache/types lama yang digunakan persistent `test-supabase-v21.mjs` tidak dianggap output contract baru; script itu belum menjadi disposable Layer 2 dan tidak dipakai untuk penerimaan A4.

## J. Database Contracts

Delapan kelompok A4 memverifikasi:

1. Seluruh 26 public tables RLS enabled, anon tidak punya table CRUD; 352 columns termasuk categories text[] NOT NULL; owner function postgres/restricted definers; tepat empat overload pairs `create_business_with_owner`, `publish_preorder`, `apply_verified_payment`, `claim_jobs`, serta exact core/admission signatures.
2. Exact allowed INSERT/UPDATE column sets pada businesses/products/production_capacity; tidak ada table-wide authenticated write; actual own read/update, foreign zero-row dan forbidden `is_demo` update denial.
3. Storage bucket metadata dan actual policy predicates dengan role SQL seperti §F.
4. Category constraint, FK/CHECK families order/item/reservation/payment/event/Memory/jobs, capacity/publication/reservation/category triggers, published-date unique index dan extensions.
5. Synthetic **SQL persistence saja**: public order total dihitung server 2×120000=240000; replay satu order; wrong expected price ditolak tanpa order baru; payment attempt amount sesuai; synthetic verified-payment persistence mengalokasikan hold, satu event dan satu durable email job pada replay. Tidak ada HTTP callback, provider atau email delivery.
6. Existing `runConcurrency`: satu winner last slot/no oversell, generation claimed/running replay + stale version denial, dua typed workers mendapat distinct jobs. Module existing tidak diubah.
7. Deliberate SQL error nonzero me-rollback DDL; missing/unreviewed migration inventory ditolak.
8. Strict comparator dan EXTRA/MISSING/MISMATCH self-checks, known PM13 dilaporkan.

A1/A2/A3 dan Memory suite menambah job retry/dead/lease fencing, generic Memory exclusion, scoped exhaustion, canonical publication/remaining capacity/frozen terms, source/profile/hash/vector validation, atomic rollback/recovery dan tenant negatives. F05/F06 SQL dari A2 membuktikan one durable generation pada contention, free replay dan atomic denial rollback generation + tiga allowance. Tidak mengubah payment/offer/AI/Memory functions.

## K. Concurrency & Repeatability

Canonical entry dijalankan berurutan pada dua fresh targets dengan nama/label/data directory milik run; tidak ada concurrent database test instances atau fixture state yang dibagi.

- Run 1: `campaign-lab-a1-0c7fd02a-d645-4ae3-b60f-2770e0326846`, complete Layer 1 PASS, exit 0, cleanup berhasil; duration artifact 229525 ms (diagnostik saja).
- Run 2: `campaign-lab-a1-ec67ea93-df5c-4984-b7da-c5bc2a6d9bfc`, complete Layer 1 PASS, exit 0, cleanup berhasil; duration artifact 233744 ms.

Perbandingan parsed `catalog.json` dan `schema-comparison.json` kedua run identik. Summary migration filenames/hashes, checkpoint, group count, SQL verdict dan doc drift juga identik; run ID/target/duration memang berbeda. Ini bukan mengganti source-of-truth schema dengan actual output: perbandingan dua actual catalog hanya membuktikan determinisme, sementara acceptance schema tetap menggunakan docs dan kontrak source yang dijelaskan di atas.

Run negatif tambahan, **sesudah kedua run normal selesai**, memakai `node scripts/test-database-v21.mjs --strict-docs` pada `campaign-lab-a1-45c22258-cf22-47e6-a660-f5e25e0feb97`. Seluruh SQL/checkpoint/regression groups kembali PASS, tetapi documentation-match assertion menghasilkan **exit 1** karena categories EXTRA. `finally` tetap membersihkan container milik run. Ini bukti failure-path cleanup dan nonzero propagation; bukan test failure yang ditelan atau dikonversi menjadi SKIP. Ketiga container sudah dibersihkan. Jumlah hasil antar-run tidak dijumlahkan untuk memperbesar coverage.

Offline self-check terhadap regex endpoint aktual menerima dua local socket forms dan menolak enam TCP/SSH/remote-host/malformed forms tanpa membuka koneksi. Pemeriksaan ini terpisah dari Vitest baseline dan tidak mengubah Docker context pengguna.

Per-run expected coverage: A1 15 groups/5 observed lock races; A2 18 groups/4 observed claim overlaps + 1 admission lock race; A3 14 groups/4 observed publication-capacity lock races + 1 MVCC editor overlap, 5 reader tests; Memory 8B 10 groups/5 observed races; historical Memory 7 groups/1 parallel claim; current concurrency 3 parallel scenarios. Kasus Promise.all tanpa pg_stat_activity barrier tidak diberi label observed row-lock race.

Data baru random UUID, names/labels unik, Unix socket saja, network none, zero mounts/ports. Before mutation: local Docker endpoint dipin, fresh initdb directory/user/database dan zero historical tables diverifikasi. Cleanup memeriksa ID/label/network, stop hanya owned container, `--rm` menghapusnya. Tidak memakai global prune, volume deletion atau stop terhadap stack normal.

## L. Supabase Platform Results

**NOT EXECUTED.** Terverifikasi: PostgreSQL role/RLS/column grants dan subset Storage policy predicates di bawah declared stand-ins. Tidak terverifikasi: real GoTrue/JWT, PostgREST named-overload resolution/schema cache, actual Storage migrations/API/uploads, fresh Supabase CLI platform lifecycle, browser/backend HTTP E2E.

Existing campaign-lab stack terlihat lewat Docker read-only inventory, tetapi tidak dihubungi untuk SQL/status credential/API dan tidak dihentikan. Tidak menganggap shared local project sebagai disposable. Supabase CLI config project/ports tetap utuh. PM09 Layer 1 PASS tidak membuat platform readiness PASS.

## M. Source Regression

| Pemeriksaan A4 | Hasil |
|---|---|
| Default safe Vitest | **1.101 PASS / 67 files**, 0 FAIL/pending, exit 0 |
| Selected seven mocked AI files | **69 PASS / 7 files**, 0 FAIL/pending, exit 0 |
| `next.cmd typegen` | PASS |
| `tsc.cmd --noEmit --incremental false` | PASS, zero diagnostics |
| `npm.cmd run lint` + focused lint / node syntax | PASS |
| `npm.cmd run build` | PASS exit 0; compile 1538ms, TypeScript 3.0s, prerender 29/29 |
| Canonical database engine | Full chain/historical/current A1–A4/Memory/F05/F06 dijalankan ulang; counts di §A/H/J/K |
| Strict docs comparator | **FAIL / exit 1**, expected accurate PM13 drift; execution PASS |
| Canonical `--strict-docs` negative run | **FAIL / exit 1** pada documentation gate setelah seluruh SQL PASS; owned container tetap dibersihkan |

Vitest environment OS/home minimal, NODE_ENV=test, smoke flags disabled, tanpa credential ambient/performance flags. Allowlist tujuh mock sama dengan Stage 0/A1–A3; tidak menjalankan integration glob mutatif. Production build memakai font existing dengan akses yang diperlukan; tidak mengganti app config/provider.

## N. Safety

Perubahan hanya tujuh berkas infrastruktur/laporan pada §E. Baseline awal **674 berkas** termasuk untracked previous batches dan `.env.local` difingerprint. Existing modifications `jobs/repository.ts` dan `concurrency.mjs` milik A2 dipertahankan. Semua root migration termasuk A1/A2/A3, application source, generated database types, schema/handoff, previous reports, package/lockfile dan Supabase config tidak diubah.

Tidak staging, commit, push, pull, merge, rebase, reset, stash atau deploy. Tidak ada persistent/remote SQL mutation, normal Supabase reset, db push/repair, Gemini/embedding, email delivery, Midtrans/payment callback atau real application worker. Secret tidak dicetak/ditulis. Synthetic SQL payment call bukan provider callback.

## O. Remaining Findings

- **PM09:** resolved untuk canonical isolated PostgreSQL harness; strict documentation mismatch tetap terpisah, Layer 2 tidak dieksekusi.
- **PM08:** generated database type reconciliation pending; tidak dilakukan A4.
- **PM13:** categories EXTRA masih real drift; docs tetap read-only.
- **PM05/PM06/PM07:** source/disposable regressions tetap PASS; deployment A1/A2/A3 belum dilakukan; legacy historical publication row compatibility tetap belum diaudit pada persistent DB.
- **U01:** payment/late-accept cross-operation lock-order risk belum dibuktikan/resolved oleh single synthetic payment replay atau reservation race. Perlu focused concurrency task terpisah.
- **U02:** fresh application bukan bukti upgrade existing applied history. Ledger/catalog/content drift lingkungan tujuan masih memerlukan read-only inspection dan authorized rollout.
- **C1/C8/C6/C7:** real context/offer/metrics/source authority dan positive production Memory loop tetap dependency. Tidak diproduksi atau diklaim selesai oleh SQL fixtures.

## P. Final Recommendation

**Ya, Layer 1 yang diperbaiki cukup andal dan dapat diulang untuk memverifikasi full active chain dan melanjutkan pekerjaan Batch A5 dalam tugas terpisah.** Gunakan canonical command untuk SQL gate, dan strict comparator/`--strict-docs` bila memerlukan documentation-match gate; jangan menyamakan keduanya.

PM08/PM13 dan actual disposable Supabase HTTP platform verification tetap terpisah. Tidak ada izin rollout, production readiness atau mulai A5 otomatis yang tersirat. Semua pemakaian future migration harus memperbarui reviewed test inventory secara eksplisit.

Belum diuji: real disposable Supabase platform, full browser/provider E2E, U01 dan existing migration history U02. Risiko yang perlu diketahui: schema docs masih DRIFT dan patch A1/A2/A3 belum diterapkan pada persistent/remote DB.
