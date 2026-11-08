# Batch A5 — Database Types & Schema Documentation Synchronization

Tanggal **7 November 2026, Asia/Jakarta**. Branch `merge/ai-campaign`, HEAD `5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762`.

## A. Executive Summary

**Overall: PASS dalam scope PM08/PM13 yang diuji.** Tipe public database diregenerasi dengan official Supabase postgres-meta dari database baru berisi seluruh 13 root migration. Output dua generation identik byte demi byte dan file aplikasi sama dengan output resmi tanpa patch manual. Independent catalog verification memeriksa **26 tables, 352 columns, 66 public relationships, 46 public RPC names / 50 signatures**.

`docs/schema.md` kini mencatat categories, enam default core, dan kontrak A1/A2/A3. Strict comparator **352 MATCH, 0 EXTRA, 0 MISSING, 0 MISMATCH**, exit 0. Negative controls tetap mendeteksi drift.

Tidak ada migration, RLS/grant/function body atau business runtime yang diubah. Satu alias type-only mempertahankan nullable admission inputs yang tidak dapat diinfer generator; caller test terkait hanya mengganti type import. Emitted JavaScript kedua file tersebut identik. Unit **1.101/67 berkas**, mock **69/7 berkas**, typecheck, lint, build dan seluruh regresi SQL terkait lulus.

**Bukan production readiness.** Actual Supabase Layer 2 tetap NOT EXECUTED. Persistent/remote DB tidak disentuh; A1/A2/A3 belum deployed. Batch A6/B/C tidak dimulai.

## B. Initial State

Working tree awal berisi perubahan/untracked Stage 0 dan A1–A4: jobs repository/concurrency, schema comparator/main harness, tiga migration A1/A2/A3, focused SQL modules, parser/type-related fixtures dan laporan QA. Semuanya dipertahankan; baseline **678 berkas** termasuk `.env.local` dicatat dengan SHA-256. Branch/HEAD tidak berubah dan tidak ada staging/commit/stash/reset.

Root active inventory yang diverifikasi, terpisah dari `database/legacy/migrations`, v2.1 snapshot dan test bootstrap:

```text
20261103000000_initial_v21.sql
20261103090000_atomic_campaign_blueprint_creation.sql
20261104090000_evaluation_cas_and_finalization.sql
20261104091000_seal_completed_campaign_updates.sql
20261104092000_reject_synthetic_finalization_memory_approval.sql
20261104093000_memory_approval_and_indexing_transactions.sql
20261104094000_memory_index_recovery.sql
20261106090000_memory_generation_type.sql
20261106100000_atomic_ai_generation_admission.sql
20261106160000_core_preorder_on_v21.sql
20261107090000_generic_job_acknowledgement_guards.sql
20261107100000_job_claim_isolation.sql
20261107110000_canonical_preorder_publication.sql
```

Tipe awal memiliki public schema, Row/Insert/Update/Relationships, Json dan helper aliases, tetapi berasal dari kontrak sebelum core integration dengan beberapa tambahan AI manual. Hanya compiles bukan bukti kecocokan schema. A4 artifacts tersedia dan dipakai untuk investigasi awal; generation A5 tetap menginspeksi fresh database, bukan menghasilkan types dari salinan A4 catalog.

## C. PM08 Root Cause

Matriks actual PostgreSQL versus kondisi awal:

| Object | Database actual | Generated types awal | Dokumentasi awal | Mismatch |
|---|---|---|---|---|
| Tables | 26 | 26 | 26 | Tidak ada tabel hilang |
| Columns | 352 | 351; categories tidak ada | 351; categories tidak ada | Ya |
| Public RPC names/signatures | 46 / 50 | 27 / 27 | Daftar target dan addendum parsial | Ya, 19 names + 4 overloads hilang |
| Public FK relationships | 66 | 65 | Field FK umumnya ada; detail additive perlu clarification | `capacity_reservations_order_id_business_id_fkey` hilang pada types |
| Insert default optionality | Enam kolom mendapat default core | Enam masih required | Default belum tertulis pada keenam field | Ya |
| Admission NULL inputs | Conditional SQL NULL sah/diperlukan | Nullable Args ditambahkan manual ke generated file | Kontrak atomic admission dijelaskan parsial | Generator limitation, kini dipisahkan ke type-only transport alias |

19 RPC names yang hilang: `accept_late_payment`, `advance_fulfillment`, `cancel_preorder_draft`, `cancel_published_preorder`, `claim_payment_attempt`, `close_preorder`, `complete_job`, `complete_preorder`, `create_manual_order`, `create_preorder_order`, `create_standalone_manual_order`, `decline_late_payment`, `enqueue_expire_jobs`, `expire_or_cancel_order`, `fail_job`, `read_preorder_offer`, `record_payment_charge`, `resolve_production_cost`, `save_preorder_draft`.

Empat name yang hanya mewakili satu legacy signature: `apply_verified_payment`, `claim_jobs`, `create_business_with_owner`, `publish_preorder`. Seluruhnya kini memiliki dua signature terpisah sesuai catalog.

Enam Insert fields yang semula required kini optional karena actual DB defaults: `preorders.status`, `payments.provider`, `job_runs.status`, `job_runs.attempt_count`, `job_runs.next_run_at`, `domain_events.occurred_at`. Categories justru **required** pada Insert karena NOT NULL tanpa column default; trigger fallback bukan column default.

## D. Type Generation Method

Tool: official existing image **`public.ecr.aws/supabase/postgres-meta:v0.100.0`**, bukan manual type fabrication atau npm package baru. Target: PostgreSQL **17.11.0.006**, seluruh root migrations diterapkan oleh A4 engine dan strict docs/SQL regressions lulus sebelum generator dijalankan.

Command baru yang benar-benar dijalankan dua kali:

```powershell
node scripts/generate-database-types-v21.mjs --write
```

Tanpa `--write`, command menghasilkan/verifikasi candidate cache saja. Tidak menerima database URL atau existing container ID. Scope hanya **public**, one-to-one detection diaktifkan. Image generator dibuat dengan UUID label, diperiksa ID/network/mount/port sebelum start, dan berbagi namespace network milik PG disposable yang tetap network none. PG hanya membuka `127.0.0.1:5432` **di dalam namespace terisolasi**, tanpa published host port, mount atau volume. Ini bukan koneksi ke localhost database host.

Engine A4 memperoleh optional generation callback; default canonical run tetap Unix-socket-only dan diverifikasi lagi secara terpisah. Preflight PG mempertahankan local pinned Docker endpoint, new initdb `/tmp/campaign-a1`, postgres user/database, zero historical tables, zero mounts/ports dan scoped cleanup. Generator hanya punya local ephemeral connection config, tidak membaca `.env.local` atau hosted credentials.

Generation targets:

- `campaign-lab-a1-4b60aec2-0599-489d-868d-ff77213ee338` + owned `campaign-lab-types-4b60aec2-0599-489d-868d-ff77213ee338`.
- `campaign-lab-a1-bbcfb30f-b58f-4505-96ee-e15c27978659` + owned generator dengan UUID yang sama.
- Required standalone canonical strict run: `campaign-lab-a1-5605882a-c4fa-42ca-9956-40e93e767353`, tanpa generator callback.

Official output kedua generation identik dan sama dengan `src/lib/supabase/database.types.ts`, SHA-256 **`bdc759c96628b985fa5f96da33a5c9eda29a1617f578c5a3610981911e8d1e6a`**. Diff baris besar juga mencerminkan official formatter/expanded layout, bukan ribuan perubahan domain. Json/Database dan generated helper APIs tetap tersedia.

## E. Generated Database Types

`database-types-contract.mjs` memakai TypeScript compiler API terpasang untuk memeriksa source type terhadap catalog yang dibaca langsung dari verified disposable PG, termasuk metadata tambahan yang tidak ada pada A4 catalog lama:

- Exact table/column sets; SQL→TS mappings; Row nullability; Insert required/optional berdasarkan nullability/default/identity; Update optionality. Tidak membuat semua Insert optional. Tidak ada identity/generated columns aktif yang perlu override.
- FK names, ordered source/target columns dan exact-unique one-to-one flags: **66 public relationships**. Lima FK ke auth.users tetap tercatat dalam authoritative catalog tetapi tidak diekspos generator public-only sebagai public relationship: business_members user, blueprint approver, order_event actor, production_cost resolver dan domain_event actor. Ini batas generator/scope, bukan FK DB dihapus.
- Exact public function-name set, masing-masing signature/Args names/default optionality, SQL type mappings, scalar/composite/set/table return contracts. TABLE OUT fields dan SETOF row fields juga diperiksa, bukan hanya array versus object.
- Public Views, Enums dan standalone CompositeTypes semuanya kosong pada actual catalog. CHECK-based status tetap string; implicit table composites dipresentasikan sebagai returned row objects. Vector dipresentasikan sebagai string; JSON/JSONB sebagai Json/NonNullable<Json> sesuai output resmi; bigint sebagai number.

Overload penting tetap terpisah sebagai official **union of function definitions**, sesuai installed Supabase SDK:

| Name | Signature distinction / generated return |
|---|---|
| publish_preorder | Core dua args → `undefined` (SQL void); legacy business/preorder/version/optional actor → preorder row |
| claim_jobs | Typed text[]/limit/lease → Json; legacy default integer args → job_runs row array, walau runtime path sengaja fail-closed |
| apply_verified_payment | Core provider_event_key/transaction_id variant → Json; legacy payment_id/event_key variant → string |
| create_business_with_owner | Core categories-array versus legacy category/actor signature tetap berbeda |

Tidak mengubah fungsi menjadi any/unknown untuk menyembunyikan mismatch, tidak menghapus return variant, dan tidak menambahkan private schema/helper RPC ke Database. Metadata types bukan authorization; disabled public legacy RPC tetap dapat muncul sebagai metadata tanpa menjadi supported runtime path.

**Generator limitations:** PostgreSQL signature tidak mengekspresikan conditional NULL behavior dalam function body. Official Args tidak menerima NULL eksplisit meskipun SQL admission mewajibkannya pada beberapa mode; scalar return declaration juga tidak menunjukkan stale `fail_job=NULL`. Raw generated file tidak dipatch. `AiAdmissionArgs` pada typed transport mempertahankan tepat enam nullable input fields yang diverifikasi SQL: generation_id/preorder_id/session_id/expected_version/context_hash/message. Existing initial Evaluation CAS nullable-token override tetap. Tidak membuat arbitrary nullable overrides atau client-wide permissive unions. Runtime parsers tetap memvalidasi response/provider/domain DTO; CHECK enums dan nullable RPC behavior tidak boleh disimpulkan dari generated metadata saja.

## F. PM13 Documentation Drift

`docs/schema.md` mempertahankan struktur awal, dengan perubahan faktual terfokus:

1. `businesses.categories`: text[], NOT NULL, **tanpa default**; backfill dari category pada K, CHECK satu dimensi/1–3 trimmed nonempty labels/uniqueness case-insensitive, trigger legacy fallback dan category-first-element mirror. Tidak mengarang enum kategori.
2. Enam defaults dari §C didokumentasikan: draft, midtrans_sandbox, queued, 0, now(), now(). Tidak mengubah database agar mengikuti dokumen.
3. Status dokumen menjelaskan migration-derived disposable verification versus target product requirements/deployment. Referensi dua legacy migration dibetulkan ke path historis sebenarnya.
4. Addendum §29 mencatat canonical publication snapshot dan auth, typed/retired generic claim, ACK fencing, dedicated Memory, payment attempt naming, atomic AI admission serta generator limitations. Table aktual adalah capacity_reservations/payments, bukan mengarang reservations/payment_attempts.

Tidak mengubah PRD, lifecycle/pricing rules atau mengklaim target produk seluruhnya implemented. Historical published row shape belum diaudit/backfilled pada persistent DB; source-only publication fix tetap tidak memperbaiki sejarah otomatis.

## G. Schema Comparator

| Ukuran | A4 historical baseline | A5 aktual |
|---|---:|---:|
| MATCH | 351 | **352** |
| EXTRA | 1 categories | **0** |
| MISSING | 0 | **0** |
| MISMATCH | 0 | **0** |
| Strict docs exit | 1 | **0** |

Comparison source tetap docs/schema.md, actual tetap PostgreSQL catalog. A4 known-drift expectation diganti menjadi **zero drift required**, bukan ignore list. Comparator hanya diperluas untuk mengenali tiga default token baru yang kini benar-benar didokumentasikan (draft/queued/midtrans_sandbox), dengan expected expression tepat. Tidak mengurangi dibandingkan columns atau menonaktifkan checks.

Existing negative controls EXTRA/MISSING/type mismatch tetap; nullability dan default mismatch controls ditambahkan. Explicit missing payment-provider default juga terdeteksi MISMATCH. Type/catalog verifier menolak malformed categories type dan missing publish overload. Compile-only negative contracts menolak wrong field/key/type tanpa any, suppression atau permissive casts.

Commands verified:

```powershell
node scripts/test-database-v21.mjs --strict-docs
node database/v2.1/tests/schema-contract.mjs node_modules/.cache/database-v21/bbcfb30f-b58f-4505-96ee-e15c27978659/catalog.json
```

Keduanya exit 0. Comparator CLI mencetak execution PASS, schema MATCH, drift [].

## H. Cross-Module Type Compatibility

Source audit AST pada **216 application TS/TSX files** memeriksa 25 literal `.from` dan 41 literal `.rpc` calls terhadap actual table/function-name sets; seluruhnya ada. Typed transport AI, DTO/Zod parsers dan seluruh application/tests ikut compiler strict. Core SDK factories/repositories existing belum diparameterisasi Database; A5 tidak melakukan refactor massal client tersebut atau mengklaim semua dynamic query paths otomatis menjadi typed.

`tests/types/database-contracts.ts` merupakan compile-only module, tidak dipanggil dan tidak mengeksekusi SQL/provider. Ia menguji required categories/string[]/Update, generated core versus legacy publication returns, typed claim, complete/fail, dedicated Memory, canonical/legacy payment distinction, AI claims/admission, composite Blueprint creation return dan evaluation finalization. Actual `SupabaseClient<Database>.rpc` calls membuktikan installed SDK memilih distinct returns dari Args, bukan hanya manual union assertions. Runtime PostgREST overload resolution tetap belum terbukti.

Sesudah regeneration, compiler mengungkap 12 NULL-input diagnostics pada admission callers/test. Ini metadata limitation, bukan runtime behavior yang perlu diubah. Perbaikan hanya:

- `src/lib/supabase/transport.server.ts`: export AiAdmissionArgs dan conditional type mapping; CAS override yang sudah ada dipertahankan.
- `tests/integration/atomic-generation-admission-postgres.test.ts`: type import/alias memakai kontrak nullable yang sama.

Emitted JavaScript dengan comments/types dihapus dibandingkan sebelum/sesudah untuk kedua file: **identik**. Tidak mengedit generation claims, discussion orchestration, payment, pricing, UI atau worker logic. Test assertion Blueprint mengikuti actual composite campaign_blueprints return, bukan mengasumsikan JSON. Final compiler dan lint bersih.

## I. Database Contract Verification

Seluruh 13 migration diterapkan ulang pada tiga PG targets baru A5. Dua generation runs memakai full A4 engine dengan strict docs; command standalone A4 dengan strict docs diverifikasi terpisah untuk default networkless behavior.

| Scope per complete run | Hasil |
|---|---|
| Historical pgTAP | 100 assertions PASS pada checkpoint asal, termasuk #65 |
| Historical Memory | 7 groups PASS sebelum M93; bukan final approval contract |
| A1 | 15 groups PASS, 5 observed ACK lock races |
| A2 | 18 groups PASS; 4 claim overlaps + 1 F05 admission lock contention |
| A3 | 14 SQL groups PASS; 4 lock races + 1 MVCC editor overlap; 5 actual-reader Vitest cases |
| Memory 8B | 10 groups PASS, 5 observed races; source/profile/hash/lease/atomicity/recovery guards tetap |
| A4 | 8 current-contract groups PASS: RLS/column grants/Storage SQL subset/constraints/core persistence/concurrency/comparator |
| F05/F06 SQL | One durable generation/replay dan atomic quota denial rollback PASS |
| Strict schema | 352 MATCH / zero drift, PASS |

Catalog final tetap 26 tables, 352 columns, 290 constraints, 107 indexes, 30 public policies, 45 public triggers dan 99 public/private functions. Public application Functions subset 50 signatures. RLS, grants, synthetic-source rejection, generic Memory claim/ACK exclusion dan canonical publication tidak diubah.

Positive Memory vector test tetap lower-layer synthetic private plumbing, bukan public verified C6/C7 success. Core payment test hanya SQL persistence synthetic, tanpa callback, provider atau delivery. Tidak menjumlahkan test/race counts antar-run untuk memperbesar coverage.

## J. TypeScript and Application Tests

| Check | Hasil A5 |
|---|---|
| `next.cmd typegen` | PASS |
| `tsc.cmd --noEmit --incremental false` | PASS, 0 diagnostics, termasuk compile-only type contracts |
| `npm.cmd run lint`, focused tooling/type-test lint | PASS |
| `npm.cmd run build` | PASS exit 0; compile 2.8s, TypeScript 8.5s, prerender 29/29 |
| Default safe Vitest | **1.101 PASS / 67 files**, 0 FAIL/pending, exit 0 |
| Same seven AI mock files | **69 PASS / 7 files**, 0 FAIL/pending, exit 0 |
| Official generation/catalog verifier | PASS 26/352/66/46 names/50 signatures; two byte-identical generation outputs |
| Actual canonical strict DB command | PASS exit 0 |

Mock allowlist sama dengan Stage 0–A4: manual-edit 16, provenance 3, duplicate-inference 11, provider-validation 12, quota-blocker 3, Memory claims 21, remaining contracts 3. F04 narrative, F05 replay/fencing, F06 quota, F07 manual edit dan synthetic Memory protections tetap lulus. Tidak menjalankan unrestricted integration glob atau persistent-stack SQL fixtures; test compiler module terpisah dari jumlah Vitest.

Test subprocess memakai OS/home minimal, NODE_ENV=test, smoke flags disabled dan tanpa ambient credentials/performance flags. Build production memakai font existing, tidak memanggil API/worker/provider. Diagnostic selama penyusunan type assertions/SDK NULL mapping diselesaikan berdasarkan actual SQL/type contract tanpa suppression atau runtime changes.

## K. Safety

Changed files, masing-masing terikat A5:

1. `src/lib/supabase/database.types.ts` — output generator resmi.
2. `docs/schema.md` — categories/defaults/current-contract facts.
3. `src/lib/supabase/transport.server.ts` — type-only nullable mapping.
4. `tests/integration/atomic-generation-admission-postgres.test.ts` — type-only import/alias.
5. `tests/types/database-contracts.ts` — compile-only assertions/SDK compatibility.
6. `scripts/generate-database-types-v21.mjs` — official generator on verified disposable target.
7. `database/v2.1/tests/database-types-contract.mjs` — independent catalog/type verification.
8. `database/v2.1/tests/job-acknowledgement.mjs` — optional generation hook/isolated loopback; default behavior dan guard assertions utuh.
9. `database/v2.1/tests/current-contracts.mjs` — zero docs drift required + negative controls.
10. `database/v2.1/tests/schema-contract.mjs` — support documented literal defaults, strict algorithm tetap.
11. Laporan ini.

Seluruh 13 migrations termasuk A1/A2/A3, remaining batch modules/reports, application business logic, PRD, `.env.local`, Supabase config, package/lock dan dependency versions dipertahankan. Tidak staging/commit/push/pull/merge/rebase/reset/stash/deploy. Tidak memakai hosted/persistent DB, normal Supabase reset/push/repair, Gemini/embedding, payment/email provider atau real workers.

Generator/cache artifacts berada di ignored `node_modules/.cache/database-types-v21/<runId>`: raw official types, initial source snapshot, authoritative type-catalog, verification dan initial-versus-current diff. A4 catalog artifacts tetap per-run terpisah. Negative-control temporary type file dan parser JSON dibersihkan. Tidak mencetak atau menyimpan secret.

Ketiga run A5 berakhir exit 0. Read-only Docker inventory akhir membuktikan ketiga PG targets dan kedua generator containers sudah tidak ada, sedangkan `supabase_db_campaign-lab` tetap ada. Fingerprint akhir terhadap 678 berkas awal menunjukkan hanya tujuh existing files yang berubah sesuai daftar di atas, ditambah empat berkas baru; seluruh migration dan protected configuration identik.

## L. Remaining Findings

- **PM08:** resolved pada public migration-defined metadata, dengan generator NULL/JSON/vector/CHECK limitations dan explicit type-only compatibility mapping dijelaskan di atas.
- **PM13:** resolved untuk verified schema-column/default contract dan direct A1–A3 descriptions; seluruh PRD target bukan otomatis implemented karena dokumentasi sinkron.
- **PM09:** A4 canonical isolated harness tetap PASS; kini strict docs MATCH.
- **PM05/PM06/PM07:** source/disposable protections tetap PASS; historical publication rows belum diaudit pada persistent DB dan rollout belum dilakukan.
- **U01:** payment/late-accept cross-operation lock-order risk masih perlu dedicated business concurrency audit; tidak diselesaikan A5.
- **U02:** actual existing migration history/catalog target belum diinspeksi; fresh chain bukan upgrade proof.
- **C1/C8:** real AI context wiring/checkout discount-attribution tetap dependency, tidak diimplementasikan.
- **C6/C7:** verified metrics/source authority/positive public production Memory loop tetap dependency.
- **Real Supabase Layer 2:** NOT EXECUTED; tidak ada klaim GoTrue/PostgREST overload/Storage HTTP E2E.
- **Persistent migration deployment:** A1/A2/A3 tetap belum diterapkan; memerlukan task/izin rollout terpisah.

## M. Final Verdict

**Ya: generated public TypeScript database types dan schema documentation kini konsisten dengan final merged PostgreSQL contract dalam scope metadata/type/generator capabilities yang diverifikasi, strict schema comparison dan regresi terkait lulus, tanpa mengubah business logic atau persistent databases. Batch A5 selesai pada tested scope.**

Repository dapat melanjutkan **Batch A6 full business logic audit dalam tugas terpisah**. Ini bukan persetujuan produksi/deployment dan A6 tidak dimulai otomatis.

Belum diuji: actual Supabase HTTP platform/overload resolution, browser/provider E2E, U01 dan existing history U02. Risiko yang tersisa ialah deployment yang belum dilakukan serta dependency C1/C8/C6/C7; generator metadata tidak menggantikan runtime validation atau authorization.
