# Campaign Lab — Batch 03B: Business Memory Durable Generation Claim

Tanggal: 6 November 2026. Scope: sisa F05, satu perluasan CHECK lokal, Memory application integration, dan isolated PostgreSQL race verification. Dasar: instruksi Batch03B yang secara eksplisit mengotorisasi perubahan ini; bukan perluasan izin untuk schema lain, remote database, atau provider nyata.

## A. Executive Summary

**Overall: PASS untuk scope implementasi dan verifikasi lokal Batch03B.** Business Memory sekarang memperoleh durable claim sebelum inference, termasuk saat dua request UUID berbeda merujuk Evaluation/sourceVersion yang sama. Counter yang sebelumnya2 menjadi1; duplikat aktif mendapat `409 GENERATION_IN_PROGRESS`. Alias berikutnya mengembalikan kandidat canonical beserta ID, synthetic flags dan provider provenance milik pemenang.

Satu migration diterapkan ke Supabase lokal Campaign Lab untuk menambahkan `memory` pada CHECK `generation_type`. Unique key, RLS, grant, RPC dan tabel lain tidak diubah. Histori existing dipertahankan. Tidak ada Gemini/embedding call nyata, perubahan remote, commit/push/deploy, atau edit `.env.local`.

Final verification: **750 safe regression tests PASS, 1 metadata test SKIPPED**, ditambah **10 actual PostgreSQL tests PASS**. Total final suites: **760 PASS, 0 FAIL, 1 SKIPPED / 38 files**. Typecheck, ESLint, production build dan native Bruno validation lulus. Actual application HTTP E2E lengkap dan live Gemini E2E tidak dijalankan; level evidence dibedakan di bagian E/H.

| Modul F05 | Hasil setelah Batch03B | Dua concurrent request ekuivalen |
|---|---|---|
| Strategist | PASS, existing claim tidak ditulis ulang | Counter1 |
| Blueprint create/replan | PASS, Batch03 guard tetap | Counter1 |
| Evaluation | PASS, Batch03 guard tetap | Counter1 |
| Business Memory | PASS, canonical-source claim | Counter1, termasuk alias requestId |

## B. Root Cause

Sebelumnya `memoryService.generate` menjalankan get(requestId), bySource(Evaluation/version), provider, lalu insert. Dua handler bisa sama-sama melihat null sebelum provider selesai. `UNIQUE(business_id, source_evaluation_id, source_version)` baru membatasi candidate persistence; inference sudah terjadi dua kali.

Batch03 tidak boleh menyelesaikan Memory dengan mengaku sebagai type `evaluation`, memakai job `embed_memory` sebagai mutex, atau mengganti durable claim dengan Map. Tabel `ai_generations` hanya menerima strategies/discussion/blueprint/evaluation. RPC Strategist juga session/chat-bound dan hanya menerima discussion/strategies. Karena itu Batch03 menandai Memory BLOCKED secara benar. Otorisasi spesifik Batch03B memungkinkan satu perubahan CHECK, lalu penggunaan helper sessionless yang sudah ada.

Memory juga mempunyai satu kandidat canonical per business/Evaluation/sourceVersion. UUID client saja tidak cukup: dua alias requestId bukan dua pekerjaan independen untuk source canonical yang sama.

## C. Database Migration

File: [`supabase/migrations/20261106090000_memory_generation_type.sql`](../../supabase/migrations/20261106090000_memory_generation_type.sql).

Original:

```sql
CHECK (generation_type IN ('strategies','discussion','blueprint','evaluation'))
```

Final:

```sql
CHECK (generation_type IN ('strategies','discussion','blueprint','evaluation','memory'))
```

Migration mempertahankan nama `ai_generations_generation_type_check`. DROP dan ADD ada dalam satu `BEGIN`/`COMMIT`; tidak ada window committed tanpa CHECK. File historical applied migrations tidak disentuh. Generated database types tidak perlu diubah: field ini memang bertipe `string`, bukan enum TypeScript/PostgreSQL. `docs/schema.md` diperbarui untuk type dan canonical key Memory. Daftar ringkas empat type pada PRD historis tidak ditulis ulang; kontrak aktual perubahan ini ada pada schema/migration/report.

### Preflight dan target

- Repository/cwd: `D:\Project\campaign-lab`.
- `supabase/config.toml`: project_id `campaign-lab`.
- Docker context: `desktop-linux`; endpoint lokal `npipe:////./pipe/dockerDesktopLinuxEngine`.
- Container: `supabase_db_campaign-lab`, label project `campaign-lab`, workdir `D:\Project\campaign-lab`.
- Database: `postgres`, PostgreSQL17.11; local mapped database port54322, local API `http://127.0.0.1:54321`.
- Tujuh migration repository lama cocok dengan database applied chain: 20261103000000, 20261103090000, 20261104090000, 20261104091000, 20261104092000, 20261104093000, 20261104094000. Tidak ada pending migration lain atau equivalent Memory change.
- Existing generation counts sebelum perubahan: discussion/failed7, discussion/success3, total10. Semuanya valid terhadap perluasan CHECK; tidak ada type yang dikeluarkan.

Command aktual:

```powershell
node node_modules/supabase/dist/supabase.js migration list --local
# Setelah file baru dibuat, hanya 20261106090000 yang pending.
node node_modules/supabase/dist/supabase.js migration up --local
```

Exit0; CLI melaporkan hanya `20261106090000_memory_generation_type.sql` applied. Final database chain memiliki8 migration, dengan `memory_generation_type` sebagai tambahan tunggal. Tidak ada db reset, remote push, seed historical, atau migration repair.

### Post-migration preservation

Katalog lokal mengonfirmasi CHECK final dengan lima type dan `convalidated=true`. Actual fixture INSERT menguji semua lima type; unsupported type ditolak23514. Unique constraint `ai_generations_business_id_generation_type_request_key_key` tetap persis `UNIQUE(business_id, generation_type, request_key)`. Seluruh constraint lain pada tabel identik before/after.

RLS tetap enabled; owner_read SELECT memakai `is_business_owner(business_id)`. Anon tetap tanpa SELECT/INSERT/UPDATE; authenticated SELECT saja; service_role SELECT/INSERT/UPDATE. Tidak ada grant/policy/RPC baru. Actual role tests mengonfirmasi unauthorized writes gagal42501 dan foreign read kosong.

Counts dan row-JSON MD5 digests before migration dibandingkan sesudah migration/fixture cleanup. Delapan tabel berikut tetap identik:

| Tabel | Before → After |
|---|---|
| ai_generations | 10 → 10 |
| businesses | 2 → 2 |
| business_members | 2 → 2 |
| preorders | 4 → 4 |
| campaigns | 3 → 3 |
| campaign_evaluations | 6 → 6 |
| campaign_memories | 1 → 1 |
| job_runs | 0 → 0 |

Setiap PostgreSQL fixture run juga memeriksa full row count/digest `auth.users` before/after; identik. Final check:0 task businesses,0 task auth users,1 historical Memory,0 embedding jobs. Fixture generation rows tidak ditinggalkan sebagai history sukses palsu.

### Forward correction

Migration bersifat forward-only. Mengembalikan CHECK lama hanya aman jika tidak ada Memory generation row; saat ini fixture rows sudah dibersihkan, tetapi data future tidak boleh dihapus untuk memaksa rollback. Jika ada masalah sesudah penggunaan nyata, lakukan tugas forward correction yang diotorisasi, pertahankan existing records dan lima accepted types, serta hentikan generation baru bila perlu. Jangan rollback/destructive cleanup otomatis terhadap histori.

## D. Application Implementation

### Canonical identity dan alias

`generationClaims` diperluas dengan Memory branch pada identity schema, bukan sistem claim baru. Blueprint/Evaluation tetap mewajibkan UUID request key. Memory memakai:

```text
scope     = authenticated business_id + generation_type memory
key       = memory:<evaluationId>:<sourceVersion>
inputHash = fingerprint({source: validatedFullMemorySource, scenario})
```

Full source mengikat business/campaign/preorder/Evaluation/blueprint, context hash, sourceVersions, finalized observations, eligibility/synthetic flags dan limitations. Alias requestId sengaja tidak masuk hash. Key maksimum54 karakter untuk UUID dan sourceVersion2147483647, di bawah batas database128. Parser menolak UUID request key biasa untuk Memory, versi0/leading-zero/out-of-range, malformed UUID, dan Memory key untuk Blueprint/Evaluation.

Existing requestId tetap menjadi candidate ID milik pemenang. Payload checkpoint menyimpan `generation.requestId` winner beserta scenario, source, validated interpretation dan provenance. Alias tidak membentuk ID/provider interaction baru. `replayed` pada response tetap mengikuti domain-row replay/reconciliation: save pertama dari checkpoint yang belum mempunyai candidate masih dapat `replayed:false`, tetapi ID/provenance tetap milik winner dan counter provider tidak bertambah.

Canonical replay kini memeriksa source fingerprint dan scenario juga untuk alias. Payload berbeda pada canonical source yang sama mendapat `IDEMPOTENCY_CONFLICT`, termasuk sesudah candidate tersimpan. Ini adalah pengetatan Memory application contract yang diperlukan agar input berbeda tidak diam-diam dianggap pekerjaan ekuivalen. Replay compatible existing data tetap bisa berjalan sebelum lookup claim; historical candidate tidak diubah atau diberi claim retroaktif.

### Request → response

1. Existing Memory API authenticates owner, resolves business, checks feature/origin, dan parses strict command.
2. Repository membaca latest completed final Evaluation melalui scoped user JWT/RLS; existing source eligibility dan snapshot/finalization guards tetap berlaku.
3. Service memvalidasi source schema, command campaign/Evaluation/context binding, existing request ID, lalu canonical source replay. Incompatible source/scenario ditolak.
4. Service membentuk canonical key/hash dan memanggil `repository.generations.run`. Helper memverifikasi owner dengan JWT, membaca claim tenant/type/key, lalu atomic privileged INSERT jika belum ada.
5. Hanya INSERT acknowledged dengan own attempt ID mengizinkan provider. Concurrent duplicate membaca running; conflicting hash/preorder ditolak. Request INSERT selesai/commit sebelum provider dijalankan.
6. `generateMemoryInterpretation` tetap melakukan existing provider envelope/schema, source assessment/reference dan F04 narrative validation. Valid payload + winner ID/provenance disimpan sebagai durable checkpoint melalui conditional running UPDATE.
7. Service memvalidasi checkpoint source/scenario/unreviewed state, menjalankan narrative validation lagi, dan membaca ulang fresh eligible source. Full fingerprint harus cocok.
8. Existing Memory repository insert menyimpan draft candidate dengan winner ID dan content hash. Canonical unique key tetap otoritatif. Lost persistence response direkonsiliasi via bySource dengan kompatibilitas source/scenario; ID collision terhadap Memory lain ditolak.
9. Response menggunakan canonical row dan provenance existing. `GenerationClaimError` dipetakan Memory API ke safe code/status/no-store, termasuk409 running. Tidak ada polling atau transaction/row lock selama inference.

### Failure dan recovery

- Provider error/abort dan invalid/unsafe interpretation gagal sebelum candidate save. Helper menyimpan safe terminal error; alias retry mengembalikan error yang sama tanpa provider kedua. Existing normalization `MEMORY_PROVIDER_UNAVAILABLE` untuk transport/timeout/abort tetap berlaku.
- Lost INSERT ACK tidak dianggap hak inference. Lost committed checkpoint ACK direkonsiliasi dari owner-scoped readback.
- Domain persistence gagal setelah checkpoint: same request atau alias membaca payload winner, memvalidasi current source lagi, lalu menyimpan/reconcile tanpa inference ulang.
- Interrupted claim setelah180detik ditutup menjadi failed `GENERATION_INTERRUPTED`; tidak diambil alih untuk inference. Late provider response tidak memenangkan running-CAS dan tidak boleh persist candidate.
- Source context/version/latest Evaluation berubah selama inference atau recovery: gagal tertutup, tanpa candidate baru dari stale output.
- Terminal canonical claim tidak otomatis dibuka ulang oleh alias UUID. Request untuk canonical source berbeda tetap independen. Untuk source yang sudah terminal karena outcome ambigu, retry inference memerlukan keputusan recovery eksplisit pada tugas terpisah; batch ini tidak menambah retry/token/attempt budget baru.
- Conditional UPDATE fencing dijalankan aplikasi dan dieksekusi PostgreSQL. Ini bukan klaim bahwa service_role yang sengaja mengirim UPDATE tanpa predicate dibatasi state-machine trigger; role tersebut tetap privileged sebagaimana kontrak existing. Public/authenticated users tetap tidak mempunyai hak write.

### File terkait

| File | Perubahan |
|---|---|
| `src/lib/ai/generation-claims.server.ts` | Memory canonical key/type runtime schema; existing atomic acquisition/checkpoint/replay/expiry dipakai ulang |
| `src/features/business-memory/repository.server.ts` | `memoryRepository` mengekspos existing `generationClaims` dengan user JWT dan business scope |
| `src/features/business-memory/service.ts` | `memoryService.generate`: canonical hash/key, claim sebelum provider, winner payload/ID, fresh source/narrative validation, strict canonical reconciliation |
| `src/features/business-memory/api.server.ts` | Safe response untuk `GenerationClaimError` |
| `supabase/migrations/20261106090000_memory_generation_type.sql` | Satu CHECK extension atomik |
| `docs/schema.md` | Type memory dan canonical key contract |
| `tests/fixtures/memory-claims.ts` | Mocked domain/SQL-transport fixture dengan actual helper dan Memory service; provider/embedding spies |
| `tests/integration/memory-generation-claims.test.ts` |21 Memory cases: aliases, conflicts, errors, recovery, freshness, isolation, provenance dan safety |
| `tests/fixtures/postgres-generation-claims.ts` | Verified local PostgreSQL target, disposable owners/businesses/preorders, real role/SQL transport, guarded cleanup dan digest evidence |
| `tests/integration/memory-claims-postgres.test.ts` |10 actual PostgreSQL cases, independent connections + production helper with mocked provider |
| `tests/unit/generation-claims.test.ts` | Memory key guard diperbarui; batas54char/version/type isolation ditambah; existing regression tetap |
| `tests/unit/business-memory.test.ts` | Fixture claim integration; concurrent duplicate sekarang menyatakan running409 dan canonical replay |
| `tests/integration/remaining-ai-contracts.test.ts` | Existing SDK-mocked Memory fixture memakai claim helper; provenance/review/synthetic assertions tetap |
| `tests/integration/duplicate-inference.test.ts` | Historical blocker characterization diperbarui menjadi fixed regression counter1 dan canonical replay; Blueprint/Evaluation assertions tetap |

Tidak ada provider prompt/model/timeout/retry change, perubahan review/approval/indexing, dependency baru, queue/worker baru, atau financial calculation change.

## E. Concurrency Evidence

### Mocked provider + actual Memory service + SQL-transport simulation

| Test Case | Expected Provider Calls | Actual Provider Calls | Result |
|---|---|---|---|
| Same requestId concurrent |1 |1 | PASS; duplicate409 running sebelum first persistence |
| Different requestId, same source |1 |1 | PASS; canonical key sama; winner ID/provenance tersimpan |
| Conflicting fingerprint/scenario saat running | No second call |1 total | PASS; conflict, original hash/claim tetap |
| Completed same-ID/canonical alias replay |0 new |0 new | PASS; satu candidate, same interaction ID/synthetic flags |
| Failed persistence recovery melalui alias |0 new |0 new | PASS; payload/checkpoint memakai winner requestId |
| Committed checkpoint, ACK hilang |0 new |0 new | PASS; verified stored output direkonsiliasi |
| Candidate save committed, ACK hilang |0 new |0 new | PASS; canonical row direkonsiliasi |
| Provider unavailable/timeout/abort |≤1 |1, retry0 new | PASS; terminal error,0 candidates |
| Invalid/unsafe interpretation |≤1 |1, retry0 new | PASS; F04 menolak,0 candidates |
| Expired/interrupted + late completion | No new call/save |1 original,0 save | PASS; retired claim fenced |
| Stale context/version/latest saat inference | No stale save |1 original,0 save | PASS; source revalidation menolak |
| Changed source/checkpoint tampering saat recovery | No new call/save |0 new,0 save | PASS |
| Foreign owner/ineligible source |0 |0 | PASS; no claim/provider/candidate write |
| Different eligible canonical source |2 |2 | PASS; tidak digabung |
| Synthetic approval / embedding |0 embedding |0 embedding | PASS; approval forbidden, no provider construction/job |

Sebelum Batch03B, reproduksi Memory pada Batch03 menghasilkan2 entries untuk dua request ekuivalen. Setelah integrasi, former-blocker test kini memeriksa1, running conflict, satu candidate, dan completed replay. Existing test expectation Promise.all-success disesuaikan ke explicit running409 yang memang menjadi acceptance batch ini; candidate uniqueness dan replay assertions tidak dihapus.

### Actual PostgreSQL

Database fixture suite opt-in membuat dua UUID owner baru di `auth.users`, dua demo businesses, memberships dan draft preorders khusus run. Tidak memakai historical campaign/Evaluation/Memory sebagai mutable fixture; tidak memalsukan candidate di database. Role authenticated diberi fixture subject melalui existing request JWT GUC untuk menguji RLS; tidak mengubah grants/policies dan tidak membuat Supabase login session/token.

| PostgreSQL case | Evidence | Result |
|---|---|---|
| Same canonical-key INSERT bersamaan | Winner connection menahan uncommitted INSERT; loser terlihat `wait_event_type=Lock`; setelah commit loser23505; satu row dengan ID winner | PASS |
| Actual production helper, dua initial reads kosong | Dua helper instances, real SQL owner reads/INSERT/UPDATE; provider pertama ditahan barrier; duplicate409; counter1; checkpoint completed replay0 new | PASS |
| Same key + conflicting hash saat running | Actual readback conflict; original running/hash tidak berubah; provider counter1 | PASS |
| Different keys/businesses | Independent owner-scoped requests berjalan3; same key lintas business tidak tercampur; foreign RLS read kosong | PASS |
| Conditional winner checkpoint / losing attempt / terminal state | Winner checkpoint success; wrong ID/hash dan running-CAS terhadap terminal row menghasilkan0 updates; output tidak berubah/reopened | PASS |
| Stale retirement fencing | Real conditional UPDATE menutup claim; late output gagal running-CAS; provider counter1, output null | PASS |
| Existing five accepted types + unsupported negative | Kelima INSERT valid; unsupported type23514 | PASS |
| Unauthorized principals | authenticated own/foreign dan anon INSERT/UPDATE42501; anon read42501; foreign claim403 | PASS |
| Composite tenant FK | Privileged claim dengan foreign preorder ditolak23503 sebelum provider, counter0 | PASS |
| Lost committed checkpoint ACK | Actual committed output dibaca ulang via owner scope; replay counter tetap1 | PASS |

Satu test menerima semua lima generation types untuk memeriksa CHECK SQL. Memory service/helper tetap menuntut canonical key; SQL raw fixture untuk type acceptance bukan API generation/candidate sukses.

Fixture creation/cleanup evidence dipertahankan di [`evidence/AI_MVP_BATCH_03B_POSTGRES_2026-11-06.json`](evidence/AI_MVP_BATCH_03B_POSTGRES_2026-11-06.json), berisi local target, before/after metadata/digests dan exact generated fixture IDs/markers. Cache run manifests juga ada di `node_modules/.cache/batch03b-memory-claims/`.

| Run ID | Suite | Cleanup | Historical snapshot |
|---|---|---|---|
|6ea3eccd-023c-40c9-9f58-b30fd2a125a2 |9 initial PostgreSQL cases |cleaned |preserved=true |
|d9bdddb0-c9ab-4a1d-b37d-07c907050cae |10 final PostgreSQL cases |cleaned |preserved=true |

Cleanup memeriksa business ID+slug+is_demo, owner ID+email+task metadata, membership ID dan preorder ID+marker sebelum DELETE dalam satu transaksi. Hanya child claims milik business fixture dan exact fixture rows yang dihapus. Jika guard/FK gagal, transaksi batal dan manifest menandai cleanup_failed; tidak ada delete terhadap tabel historis append-only atau data berdasarkan prefix saja.

## F. Regression Results

Focused initial application run:

```powershell
node_modules/.bin/vitest.cmd run tests/integration/memory-generation-claims.test.ts tests/unit/business-memory.test.ts tests/unit/generation-claims.test.ts tests/integration/remaining-ai-contracts.test.ts tests/integration/duplicate-inference.test.ts
```

**91 PASS /5 files**,1.43s. Setelah itu ditambah bounded key test dan final PostgreSQL FK case, keduanya tercakup final runs berikut.

Final safe regression:

```powershell
$env:MEMORY_CLAIM_POSTGRES='0'
$env:EVALUATION_PERF_REPORT=''
$env:GEMINI_TRANSPORT_REPORT=''
$env:GEMINI_METADATA_CHECK='0'
$env:CAMPAIGN_GEMINI_SMOKE='0'
$env:MEMORY_EMBEDDING_SMOKE='0'
node_modules/.bin/vitest.cmd run tests/unit tests/integration/remaining-ai-contracts.test.ts tests/integration/evaluation-provider-validation.test.ts tests/integration/blueprint-provider-provenance.test.ts tests/integration/blueprint-manual-edit.test.ts tests/integration/duplicate-inference.test.ts tests/integration/memory-generation-claims.test.ts tests/integration/gemini-transport.test.ts
```

Final isolated PostgreSQL run, sesudah target dan fixture safety diverifikasi:

```powershell
$env:MEMORY_CLAIM_POSTGRES='1'
node_modules/.bin/vitest.cmd run tests/integration/memory-claims-postgres.test.ts --testTimeout=30000 --hookTimeout=30000
```

Checks:

```powershell
node_modules/.bin/tsc.cmd --noEmit --incremental false
npm.cmd run lint
npm.cmd run build
node scripts/validate-bruno-collection.mjs
```

| Check | Final outcome |
|---|---|
| Unit |680 PASS |
| SDK/workflow mocked integration |66 PASS, termasuk21 Memory claim cases baru |
| Local loopback TLS/Next transport |4 PASS, tanpa Google request |
| Safe Vitest total |750 PASS,1 SKIPPED /37 files,44.77s |
| Actual PostgreSQL |10 PASS,0 FAIL /1 file,11.34s |
| Combined final suites |760 PASS,0 FAIL,1 SKIPPED /38 files |
| TypeScript |PASS, exit0; strict tidak dilemahkan |
| ESLint |PASS, exit0 |
| Next production build |PASS, exit0; compiled, TypeScript,13 pages generated |
| Native Bruno parser |PASS, parser0.40.0,141 HTTP request definitions + environment/collection; actual collection requests tidak dieksekusi |

Bruno menghasilkan diagnostic Crashpad CreateFile access denied yang sama dengan batch sebelumnya; parser menyelesaikan validasi dengan exit0. Metadata Google sengaja skipped. Config/env flags di atas hanya process-local; `.env.local` tetap identik baseline.

Batch01/F04 tests, Batch02/F07 manual zero-provider/zero-factory, Strategist claim, Blueprint create/replan counter1, Evaluation counter1/failed/invalid/source-CAS, dan financial/simulator tests tetap lulus. Tidak menjalankan older mutating suites yang mengandalkan historical campaign fixture, provider smoke, atau embedding suite nyata untuk membuat klaim di luar scope.

## G. Safety Verification

- Synthetic source tetap synthetic dan production-ineligible. Generate tidak mengubah Evaluation, source attestation, review decision atau approval status.
- Synthetic approval tetap `SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN`; repository approve/embedding factory tidak tercapai pada focused tests.
- Tidak ada embedding call, vector write, production retrieval opt-in, indexing worker, atau job enqueue saat candidate generation. Row `embedding_status=queued` tetap mengikuti kontrak draft existing; tidak berarti job dibuat sebelum approval. Local `job_runs` dan embed_memory count tetap0.
- Existing generation/campaign/Evaluation/Memory/history rows tidak diubah; counts/digests delapan public tables dan auth fixture snapshots identik setelah cleanup. Existing Memory tetap1; tidak diklaim sebagai actual fresh Gemini result batch ini.
- Schema change tepat satu CHECK extension yang diotorisasi dan satu migration tracking entry. RLS/grants/UNIQUE/other constraints/RPC tidak berubah. Tidak ada remote/staging/production target, reset, cloud/billing change, auth credentials rewrite, atau mutation historis.
- Tidak ada real Gemini/embedding/model switching/provider retry; mock provenance diberi test fixture identity, bukan fabricated live interaction.
- Perbandingan SHA-256418 baseline files:9 existing files berubah (schema doc,4 application files,4 test files),5 implementation/test/migration files baru, ditambah laporan dan evidence JSON ini;0 baseline files dihapus. Historical migrations, old QA reports, PRD, database types, `.env.local`, dependencies/lockfile/configs dan modul tim lain identik baseline. Dirty/untracked work pengguna tetap dipertahankan.
- Tidak ada commit, push, deploy, atau release.

## H. Remaining Gaps

Tidak ada blocker F05 tersisa dalam scope lokal yang diotorisasi. Perlindungan pre-inference dan canonical alias Memory sekarang menggunakan kontrak durable yang sama dengan helper Blueprint/Evaluation, dengan arbitration/fencing terverifikasi pada actual PostgreSQL.

Batas evidence tetap eksplisit:

1. Actual PostgreSQL tests menjalankan production claim helper melalui SQL transport dan role/GUC fixture, bukan full HTTP Next.js + GoTrue session + real Evaluation-to-Memory persistence E2E. Memory workflow/source/finalization/candidate persistence tests memakai existing eligible synthetic domain fixtures dan mocked ports. Tidak membuat actual Memory candidate melalui SQL untuk mengaku berhasil.
2. Tidak ada live Gemini/embedding E2E, pengujian remote/deployment atau Google metadata; semuanya di luar izin batch. Tidak membuktikan provider billing/quota atau universal exactly-once external execution pada arbitrary crash.
3. Provider/invalid/ambiguous terminal canonical key tidak otomatis retry, termasuk melalui requestId alias. Ini fail-closed sesuai larangan provider retries; explicit future recovery policy membutuhkan keputusan terpisah. Clock skew dapat memengaruhi retirement180detik, tetapi tidak memberi izin provider kedua untuk key yang sama.
4. Positive production Memory embedding/retrieval dan verified source attestation gap historis tetap tugas integrasi berikutnya. Mendukung Memory claim tidak menjadikan synthetic data production-eligible atau menutup temuan audit lain.

**Final verdict:** F05 Duplicate Inference Protection sudah diterapkan secara memadai untuk Strategist, Blueprint, Evaluation dan Business Memory pada AI MVP lokal yang diuji. PASS ini terbatas pada contract/application/actual-PostgreSQL evidence di atas, bukan klaim live provider atau deployment readiness seluruh platform.
