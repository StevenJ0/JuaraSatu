# Campaign Lab — Batch 03: Duplicate Inference Protection

Tanggal: 6 November 2026. Scope: F05 saja. Pemeriksaan menggunakan source aktual, kontrak `docs/schema.md`, PRD, final audit, dan laporan Batch 01/02; dokumen historis tersebut tidak ditimpa.

## A. Executive Summary

**Overall: PARTIAL. F05 belum tertutup untuk seluruh AI MVP.**

Blueprint create/AI replan dan Evaluation sekarang memperoleh claim database sebelum memanggil provider. Implementasi menggunakan unique key dan hak DML yang sudah tersedia pada `ai_generations`; tidak memerlukan migration. Strategist mempertahankan RPC claim existing dan mendapat regresi konkurensi tambahan. Business Memory tetap **BLOCKED — DATABASE CONTRACT CHANGE REQUIRED**, karena CHECK `generation_type` tidak mengizinkan Memory. Tidak ada mutex process-local yang dipasang sebagai pengganti.

Reproduksi sebelum integrasi menunjukkan dua provider entries untuk Blueprint create, Blueprint replan, dan Evaluation. Setelah integrasi masing-masing satu; duplikat aktif menerima `409 GENERATION_IN_PROGRESS`, lalu hasil domain yang tersimpan dapat direplay. Memory tetap dua entries pada characterization test yang sengaja tidak melakukan persistence. Test ini lulus karena berhasil membuktikan blocker, bukan karena Memory sudah diperbaiki.

Regresi aman: **728 PASS, 1 SKIPPED, 36 files**; TypeScript, ESLint, Next production build, dan native Bruno validation lulus. Tidak ada actual Gemini/embedding call atau mutasi database dalam verifikasi. Klaim durable didukung kontrak SQL existing dan katalog database lokal yang diperiksa read-only; race DML nyata lintas proses tidak dieksekusi terhadap database aktif.

## B. Per-module Status

| Module | Before | After | Provider Counter untuk dua request ekuivalen | Durable Protection | Status |
|---|---|---|---|---|---|
| Strategist | RPC claim sebelum provider sudah tersedia | Production code tidak ditulis ulang; concurrent identical/conflicting regression ditambah | 1 → 1 | Existing `claim_ai_generation`, finalize/fail dan session CAS | PASS |
| Blueprint create | Replay sebelum provider, persistence guard sesudahnya | Atomic INSERT claim, output checkpoint, source/financial revalidation, existing create RPC | 2 → 1 | Existing UNIQUE pada `ai_generations` + conditional terminal UPDATE | PASS |
| Blueprint AI replan | Replay/CAS check sebelum provider; dua request masih bisa inference bersamaan | Mekanisme claim yang sama; revision/parent CAS tetap pada domain/RPC | 2 → 1 | Sama; request hash mencakup parent/version dan edits | PASS |
| Evaluation | Replay/latest/source check belum menutup window sebelum provider | Atomic claim sebelum `interpretEvaluation`; Analysis checkpoint sebelum existing CAS persistence | 2 → 1 | Sama, generation type `evaluation` | PASS |
| Business Memory | Canonical candidate uniqueness hanya melindungi persistence | Production path tetap; blocker direproduksi dan proposal disiapkan | 2 → 2 | Belum ada claim compatible untuk Memory | **BLOCKED — DATABASE CONTRACT CHANGE REQUIRED** |

PASS di atas mencakup implementasi aplikasi dan deterministic mocked-transport regression, dengan batas verifikasi SQL nyata yang dijelaskan di bagian F. Tidak menyatakan exactly-once eksekusi jaringan eksternal dalam seluruh kondisi crash.

### Inventaris generation flow aktual

| Module / entry point | Identity dan source | Owner scope / replay | Provider boundary | Persistence guard / recovery |
|---|---|---|---|---|
| `sendPersistentDiscussion` | Client `requestKey`; hash dari session, expected context, message, preferences, scenario. Session expectedVersion divalidasi terpisah | Authenticated owner scope; owner-JWT repository reads; RPC memverifikasi owner dan source. Completed/failed/running claim replay sebelum inference | `generateCampaignStrategies`, hanya setelah `beginTurn` mengembalikan claimed | `claim_ai_generation` mengunci session di transaksi pendek, UNIQUE type/key, append user message dan menaikkan version; finalize/fail memeriksa claimVersion. Existing explicit recovery tidak diubah |
| `blueprintWorkflow.create/revise` | Client UUID `requestId`; fingerprint parsed revision command + persisted selected proposal source. Campaign, parent ID/version, edits, scenario dan proposal hash masuk fingerprint | Auth boundary memilih business; scoped repository selection/replay; helper memeriksa `is_business_owner` dengan JWT. Persisted Blueprint replay tetap didahulukan | `generateBlueprint` di dalam claim untuk AI. Manual `edits.plan` langsung memakai deterministic/manual path, tanpa provider factory atau claim | Existing create/revision RPC dan campaign/parent CAS. Validated output checkpoint dapat dipakai untuk recovery domain-save failure; source/financial checks diulang sebelum save |
| `evaluationService.generate` | Client UUID `requestId`; fingerprint `{action:'generate', ...parsedCommand}`, termasuk campaign, expected campaign/latest Evaluation, context hash, analytics/provider scenario | Authenticated business scope; persisted evaluation ID/hash replay; current context dan latest ID preflight; helper owner check | `interpretEvaluation`, setelah claim; calculation tetap deterministik | Existing append-only `record_campaign_evaluation_cas`; current source dicek lagi, latest CAS di RPC. Analysis `available`/`failed`/`invalid` disimpan sesuai lifecycle existing |
| `memoryService.generate` | Client UUID `requestId`; Evaluation ID + expected context; canonical source identity business/Evaluation/sourceVersion; source fingerprint dan scenario diperiksa | Owner repository source/get/bySource; latest completed final Evaluation dan freshness tetap syarat; replay request ID lalu canonical source | `generateMemoryInterpretation` masih setelah get/bySource tetapi sebelum atomic persistence | `UNIQUE(business_id, source_evaluation_id, source_version)` melindungi candidate canonical, bukan inference. Failed provider tidak menghasilkan candidate; tidak ada durable pre-inference recovery compatible |

Penelusuran caller source menunjukkan low-level generator di atas dipanggil dari workflow/service tersebut. Alternative Strategy Analysis berada pada Strategist; kalkulasi Promotion Simulator deterministik; materialisasi execution planner memakai Blueprint. Tidak ditemukan entry point provider tambahan yang perlu claim terpisah dalam scope ini.

## C. Root Cause

Blueprint dan Evaluation sebelumnya memiliki pola read/replay → validate source/version → provider → persist. Dua handler dapat sama-sama selesai membaca keadaan kosong sebelum salah satunya menyimpan hasil. CAS/unique persistence menjaga hasil domain, tetapi biaya inference sudah terjadi dua kali.

Memory memiliki window yang sama pada `repository.get(requestId)` dan `repository.bySource(evaluationId, sourceVersion)`. Kedua request bisa melihat null lalu masuk provider. Candidate uniqueness baru bekerja sesudah provider; final audit telah menunjukkan counter2, dan reproduksi Batch 03 mempertahankan bukti tersebut.

Strategist berbeda: `beginTurn` memanggil RPC sebelum generator. RPC mengunci session, memeriksa owner/hash/version/context, mencari claim existing, lalu membuat claim dan user message secara atomik. Transaksi selesai sebelum provider; existing path sudah sesuai sehingga tidak direfaktor.

## D. Architecture Decision

### Primitive existing yang dipakai

`ai_generations` sudah menyediakan:

- `UNIQUE(business_id, generation_type, request_key)` untuk arbitrasi lintas instance.
- Type `blueprint` dan `evaluation`, status `running/success/failed/invalid_output`, hash, model, timestamp, dan JSONB output.
- Nullable campaign/session serta preorder FK yang mencakup tenant. Claim dibuat sessionless dan campaign-null: Blueprint awal belum mempunyai campaign persisten. Campaign/lineage tetap terikat pada request hash dan domain output.
- Owner-read RLS, tanpa authenticated INSERT/UPDATE; service role memiliki INSERT/UPDATE.

RPC Strategist **tidak** dipakai untuk Blueprint/Evaluation: input type-nya hanya `discussion/strategies`, memerlukan session, menulis chat message dan mengubah session version. Memaksakan RPC tersebut akan mengubah semantik modul. Helper baru menggunakan DML existing tanpa mengubah tabel/RPC/policy/permission.

### Alur request sampai response

1. Existing API auth, feature gate, origin check, dan runtime command validation tetap berlaku.
2. Workflow/service menjalankan replay domain dan preflight owner/source/version yang tersedia.
3. `generationClaims.run` memvalidasi identity dan owner JWT, lalu membaca claim dengan tenant/type/key filter. Same key + beda hash atau preorder ditolak `IDEMPOTENCY_CONFLICT`.
4. Jika belum ada, privileged INSERT membuat claim `running` dengan UUID milik attempt tersebut. **Hanya response INSERT sukses yang mengembalikan ID attempt yang sama** memberi izin inference. UNIQUE memastikan hanya satu INSERT menang; duplikat/response ambigu membaca ulang record tanpa mendapat izin inference.
5. Provider dipanggil sesudah request INSERT selesai. Tidak ada transaksi/row lock yang ditahan selama network inference.
6. Output divalidasi schema modul dan disimpan sebagai checkpoint JSONB dengan conditional UPDATE tenant/type/key/id/status=running. Checkpoint memuat output tervalidasi atau safe terminal error; bukan raw prompt, exception message, atau secret.
7. Blueprint memvalidasi binding revision/source dan menghitung ulang financials; Evaluation membaca ulang source/version/context. Existing repository/RPC menyimpan hasil domain dengan CAS dan replay reconciliation yang lama.
8. API mengembalikan hasil existing atau safe claim error dengan status/no-store. Tidak ditambahkan polling atau in-process waiting infrastructure.

Checkpoint sukses berarti generation outcome tersedia, **bukan** bukti Blueprint/Evaluation domain sudah berhasil disimpan. Evaluation Analysis `failed` menjadi generation status `failed`; Analysis `invalid` menjadi `invalid_output`. Keduanya tetap merupakan output Evaluation yang valid untuk disimpan sesuai kontrak lama, bukan narrative sukses meskipun route akhirnya HTTP200.

### Identity, isolasi dan provenance

Key menggunakan authenticated business, operation type dan existing client UUID. Input hash tetap hash domain existing, sehingga tidak melakukan dedupe seluruh business atau menggabungkan request sah yang berlainan. Configured Blueprint provider sekarang mengekspos configured model untuk metadata claim; output tetap menyimpan actual returned model/request ID existing. Model konfigurasi baru tidak mengganti provenance hasil replay lama.

Claim read memakai user JWT + RLS, creation/finalization memakai server-only privileged transport setelah ownership check. Schema readback menolak foreign business, wrong type/key/preorder/hash, atau lifecycle output yang tidak konsisten. Authenticated/public client tidak diberi hak claim write. Klaim tidak memberi otorisasi untuk approval, finalization, publication, atau embedding.

### Failure dan recovery

| Kondisi | Perilaku |
|---|---|
| Equivalent claim masih running | `409 GENERATION_IN_PROGRESS`, tanpa provider kedua |
| Same key, hash/source/lineage berbeda | Conflict; claim asli tidak diubah |
| Provider/domain validation melempar error | Conditional terminal fail; replay memakai safe code/status, tanpa retry inference untuk key yang sama |
| Evaluation mengembalikan Analysis failed/invalid | Checkpoint dan persist failed/invalid outcome; review tetap memerlukan available narrative |
| INSERT committed tetapi acknowledgement hilang | Readback tidak dianggap sebagai hak inference. Claim tetap running sampai terminal recovery; provider counter0 untuk attempt ambigu tersebut |
| Output checkpoint committed tetapi acknowledgement hilang | Readback tervalidasi dipakai, tanpa inference ulang |
| Checkpoint tidak berhasil commit | Claim running tetap mencegah inference ulang; bila perlu ditutup sebagai interrupted |
| Domain save gagal sesudah checkpoint | Retry key yang sama memakai validated checkpoint, memeriksa source lagi, lalu mencoba existing persistence; counter tetap1 |
| Process crash / claim stale | Setelah 180 detik, request berikutnya melakukan conditional retirement menjadi failed `GENERATION_INTERRUPTED`, bukan takeover provider. Tidak ada sweeper baru |
| Provider lama selesai setelah retirement | Conditional running UPDATE tidak menang; output tidak boleh lanjut menjadi domain save |
| Source berubah selama inference/recovery | Existing source/financial/CAS guard menolak save; checkpoint tidak mengizinkan bypass |
| Pekerjaan baru yang sah | Request ID baru tetap independen dan harus lolos domain guards. Ini aksi baru eksplisit, bukan retry otomatis key yang outcome provider-nya ambigu |

180 detik melebihi maksimum configured text-provider total deadline120 detik dan storage request12 detik; tidak bergantung pada expiry untuk memberi izin inference. Clock skew dapat mempercepat retirement atau menunda recovery, tetapi tidak membuka duplicate invocation untuk key yang sama. Tidak ada automatic claim retry budget: **0 tambahan provider invocations pada duplicate/recovery key yang sama**. Adapter provider existing tidak diubah; production configuration tetap maxAttempts1. Unknown abort/exception metadata direplay sebagai safe provider-unavailable, tidak membocorkan pesan exception.

Manual Blueprint edits tetap tanpa claim maupun provider factory. Hasil manual memakai provider `manual`; F07 tidak berubah menjadi AI generation. Batch01 narrative validators tetap dijalankan pada generator dan sebelum domain persistence/readback sesuai alur existing.

## E. Code Changes

| File | Fungsi/perubahan |
|---|---|
| `src/lib/ai/generation-claims.server.ts` (baru) | `generationClaims`, `GenerationClaimError`, identity/lifecycle validation, atomic INSERT, conditional checkpoint/failure/expiry, replay reconciliation |
| `src/features/campaign-blueprint/workflow.server.ts` | `blueprintWorkflow`: shared create/replan generation branch, manual bypass, checkpoint binding dan fresh financial/source checks |
| `src/features/campaign-blueprint/repository.server.ts` | `blueprintRepository`: exposes owner-scoped `generations`; explicit nullable return type `blueprint` sesuai runtime existing |
| `src/features/campaign-blueprint/contracts.ts` | `BlueprintProvider` menyediakan configured model metadata |
| `src/features/campaign-blueprint/gemini.server.ts` | `configuredBlueprintProvider` mengekspos model existing config; tidak mengganti model/timeout/prompt |
| `src/features/campaign-blueprint/api.server.ts` | Response safe `GenerationClaimError`, termasuk 409 running |
| `src/features/campaign-evaluation/service.ts` | `evaluationService.generate`: claim/checkpoint membungkus `interpretEvaluation`; existing preflight/freshness/CAS tetap |
| `src/features/campaign-evaluation/repository.server.ts` | `evaluationRepository` mengekspos `generations` tenant-scoped |
| `src/features/campaign-evaluation/api.server.ts` | Response safe claim error/no-store |
| `tests/fixtures/generation-claims.ts` (baru) | Shared SQL-transport simulation dari UNIQUE/conditional UPDATE, menggunakan helper production actual |
| `tests/unit/generation-claims.test.ts` (baru) | 19 tests claim lifecycle, simultaneous INSERT, ambiguity, fencing, isolation, independent requests |
| `tests/integration/duplicate-inference.test.ts` (baru) | 11 tests actual workflow/service boundary, provider barriers, domain-save recovery, invalid/failed Evaluation dan Memory blocker |
| `tests/unit/persistent-discussion.test.ts` | Tambah satu barrier test identical/conflicting/replay dengan counter1; Strategist production code tidak berubah |
| `tests/integration/blueprint-provider-provenance.test.ts` | Existing fixture memakai actual claim helper via SQL simulation; provenance assertions tetap |
| `tests/integration/blueprint-manual-edit.test.ts` | Fixture compatibility; existing manual zero-provider/zero-factory assertions tetap |
| `tests/integration/evaluation-provider-validation.test.ts` | Fixture compatibility; existing SDK/output validation/persistence assertions tetap |
| Laporan ini | Evidence, trade-off, dan proposal Memory; bukan migration file |

## F. Test Evidence

### Reproduksi sebelum fix

Command awal setelah fixture selection disesuaikan ke schema aktual:

```powershell
node_modules/.bin/vitest.cmd run tests/integration/duplicate-inference.test.ts
```

Hasil sebelum claim diintegrasikan: **3 FAIL / 1 PASS**. Blueprint create, AI replan, dan Evaluation masing-masing counter aktual2 versus expected1. Memory characterization counter2 lulus sesuai blocker. Provider pertama ditahan barrier; request kedua masuk application boundary sebelum yang pertama menyelesaikan inference/persistence. Ini bukan sequential replay test. Setelah integrasi, keempat kasus awal lulus; suite selanjutnya diperluas menjadi11 kasus.

### Coverage fokus

- Dua coordinator/helper instances berbagi transport store; simultaneous initial reads keduanya kosong lalu bersaing INSERT. Hanya satu provider berjalan, satu canonical claim tersimpan.
- Workflow Blueprint create/replan dan Evaluation yang sebenarnya: duplicate running409, persisted canonical replay, counter1.
- Konflik hash/preorder dan payload replan/Evaluation: reject tanpa mengubah claim aktif atau memasuki provider kedua.
- Request key/type berbeda berjalan independen; key sama pada business berbeda tidak tercampur. Owner denied sebelum claim read/privileged INSERT/provider; foreign transport row ditolak.
- Timeout, unavailable, invalid output, abort, stale claim, late completion fencing, explicit fresh request, dan replay terminal error.
- Lost INSERT acknowledgement, lost checkpoint acknowledgement, failed checkpoint commit; tidak ada blind retry inference.
- Blueprint/Evaluation domain persistence gagal sesudah checkpoint: retry berhasil menyimpan menggunakan checkpoint dengan counter1.
- Evaluation failed/invalid tetap failed/invalid, bukan narrative available; changed source menolak save dan retry tidak memanggil provider lagi.
- Strategist existing claim tetap mendahului provider; identical running dan conflicting payload tidak menambah counter; completed replay tetap counter1.
- Memory memakai eligible synthetic fixture existing tanpa melemahkan production/synthetic approval restrictions. Counter2 terjadi sebelum persistence; fixture menolak save dengan `READ_ONLY_REPRO_NO_PERSISTENCE`, tidak melakukan approval atau menjalankan embedding.

### Final safe regression — command aktual

```powershell
# Process-local only; .env.local tidak diedit.
$env:EVALUATION_PERF_REPORT=''
$env:GEMINI_TRANSPORT_REPORT=''
$env:GEMINI_METADATA_CHECK='0'
$env:CAMPAIGN_GEMINI_SMOKE='0'
$env:MEMORY_EMBEDDING_SMOKE='0'

node_modules/.bin/vitest.cmd run tests/unit tests/integration/remaining-ai-contracts.test.ts tests/integration/evaluation-provider-validation.test.ts tests/integration/blueprint-provider-provenance.test.ts tests/integration/blueprint-manual-edit.test.ts tests/integration/duplicate-inference.test.ts tests/integration/gemini-transport.test.ts
node_modules/.bin/tsc.cmd --noEmit --incremental false
npm.cmd run lint
npm.cmd run build
node scripts/validate-bruno-collection.mjs
```

| Check | Hasil aktual |
|---|---|
| Unit | **679 PASS**, termasuk19 claim tests baru dan tambahan1 Strategist concurrency test |
| SDK/workflow mocked integration | **45 PASS**, termasuk11 Batch03 tests; F04/F07 suites lama tetap lulus |
| Local loopback TLS/Next transport | **4 PASS**, tanpa request Google |
| Total Vitest | **728 PASS, 1 SKIPPED / 36 files**,44.44s; metadata Google sengaja skipped |
| TypeScript | PASS, exit0; strict tidak dilemahkan |
| ESLint | PASS, exit0 |
| Next production build | PASS, exit0; compiled, TypeScript,13 pages generated |
| Native Bruno validation | PASS, parser0.40.0;141 HTTP definitions + environment/collection, method/URL/variables/opt-in/script syntax. Requests collection tidak dieksekusi. Diagnostic Crashpad CreateFile access-denied tidak menggagalkan parser, exit0 |

### Database evidence dan batas pembuktian

Katalog PostgreSQL lokal dibaca melalui `docker exec -i supabase_db_campaign-lab psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1`, dengan SQL `BEGIN READ ONLY`, local statement_timeout10s, SELECT metadata constraints/grants/triggers/RLS, lalu `ROLLBACK`.

Terverifikasi pada katalog lokal:

- Unique constraint bernama `ai_generations_business_id_generation_type_request_key_key`.
- CHECK `ai_generations_generation_type_check` hanya mengizinkan `strategies/discussion/blueprint/evaluation`, sesuai `docs/schema.md` dan migration source.
- FK preorder/tenant, hash64hex, request_key1..128, JSON object output, status/timestamp checks sesuai source.
- Anon tanpa SELECT/INSERT/UPDATE; authenticated SELECT saja; service_role SELECT/INSERT/UPDATE.
- Policy authenticated `owner_read` memakai `is_business_owner(business_id)`; tidak ada non-internal trigger pada tabel ini.

Concurrency test menjalankan actual production claim helper, tetapi transport adalah simulasi UNIQUE/UPDATE dalam test. Domain persistence pada suite baru juga mock. SDK suites existing memakai actual installed SDK dengan HTTP mock. **Tidak menjalankan concurrent INSERT/UPDATE nyata atau membuktikan database race/RLS melalui mutating E2E baru.** Durability berasal dari existing PostgreSQL uniqueness + committed INSERT, bukan dari Map fixture. Mapping RLS/privileges diverifikasi melalui read-only catalog, bukan menambahkan izin.

Provider smoke, Google metadata, embeddings, mutating DB fixture suites, Bruno mutation runners dan browser authoring E2E tidak dijalankan. Historical `supabase-proposals.test.ts` fixture issue (F08) tidak diubah atau diklaim telah selesai. Tidak menambah dependency, config, atau runner baru.

## G. Remaining Blockers

### Business Memory: BLOCKED — DATABASE CONTRACT CHANGE REQUIRED

`generation_type` adalah text + CHECK, bukan PostgreSQL enum. Menggunakan type `evaluation` untuk Memory akan memberi semantik/type palsu dan bisa berbenturan dengan Evaluation. RPC claim existing hanya mendukung discussion/strategies. `job_runs` hanya mendukung expire/reconcile/embed_memory/send_paid_email; memakai embed_memory sebagai mutex kandidat akan menyalahgunakan kontrak dan dapat menjalankan indexing yang tidak diminta.

**Proposal minimal untuk tugas database terpisah, belum dibuat sebagai migration atau diterapkan:**

1. Perluas CHECK `public.ai_generations.ai_generations_generation_type_check` dengan satu nilai `memory`; pertahankan keempat nilai existing. Perbarui dokumentasi kontrak melalui tugas yang memang diotorisasi untuk perubahan database. Tidak diperlukan tabel/index/RPC/permission baru untuk pola sessionless INSERT yang sama.
2. Bentuk perubahan SQL yang diusulkan berikut hanya teks review; **tidak dieksekusi**:

   ```sql
   ALTER TABLE public.ai_generations
     DROP CONSTRAINT ai_generations_generation_type_check;
   ALTER TABLE public.ai_generations
     ADD CONSTRAINT ai_generations_generation_type_check
     CHECK (generation_type IN ('strategies','discussion','blueprint','evaluation','memory'));
   ```

   Kedua statement harus berada dalam satu migration transaction pada tugas terpisah agar tidak ada window tanpa CHECK. Jangan men-drop/recreate unique key atau melemahkan RLS. Source rollback ke CHECK lama hanya aman sebelum ada Memory generation rows; jangan menghapus record untuk memaksa rollback.

3. Sesudah kontrak disetujui, tambahkan Memory branch pada helper dan `memoryRepository`, kemudian bungkus `generateMemoryInterpretation` di `memoryService.generate` sebelum inference. Gunakan canonical claim key `memory:<evaluationId>:<sourceVersion>` (panjang di bawah128), scope business/type dari helper. Existing helper UUID key tetap untuk Blueprint/Evaluation; Memory memerlukan validasi key canonical tersendiri.
4. Memory berbeda dari Blueprint/Evaluation: dua requestId berlainan untuk source Evaluation/version yang sama juga menuju satu canonical candidate menurut existing `bySource`/UNIQUE. Karena itu **requestId saja tidak cukup** sebagai claim key Memory. Hash harus mengikat campaign, Evaluation/version, full source fingerprint dan scenario, tanpa menjadikan alias requestId sebagai pekerjaan baru. Same source dengan input/scenario berbeda saat claim aktif harus conflict; sesudah canonical candidate ada, pertahankan canonical replay existing.
5. Checkpoint Memory perlu membawa candidate ID milik claim winner, validated interpretation/provenance dan source/scenario. Retry lewat alias harus menyimpan/replay ID winner, bukan membentuk kandidat baru dari alias. Initial owner/eligibility check dan post-provider source revalidation tetap wajib; checkpoint tidak boleh memperbolehkan synthetic approval.
6. Tetap gunakan existing canonical candidate UNIQUE, review/reject/approval guards. Jangan membuat job embedding saat generation. Indexing tetap mengikuti approval path existing saja.

Affected application functions untuk follow-up: identity parser/`generationClaims.run`; `memoryRepository` dan owner-scoped claim integration; `memoryService.generate`; Memory API error mapping bila menggunakan `GenerationClaimError`; fixture/tests konkurensi dan recovery Memory. Tidak diperlukan perubahan modul checkout/payment/order.

Acceptance follow-up: dua request identik dan dua alias requestId dengan canonical source sama masing-masing counter≤1 saat aktif; canonical candidate≤1; canonical replay/provenance benar; conflicting scenario/source ditolak; timeout/crash/ambiguous checkpoint tidak reinference otomatis; tenant/stale-source guards tetap; synthetic approval forbidden; tidak ada embedding call/job baru. Jalankan authorized local DB race test selain mock bila tugas terpisah mengizinkan mutation fixtures.

Memory production path sengaja belum dipasangi claim palsu/partial. Database contract proposal di atas adalah blocker implementasi, bukan permintaan izin untuk menjalankan SQL dalam batch ini. Selain Memory, SQL concurrency E2E baru masih belum diverifikasi, sehingga deployment confidence harus mempertimbangkan batas evidence ini.

## H. Scope Confirmation

- Tidak ada live Gemini, metadata Google, atau embedding call; provider baru pada test memakai counter/barrier/Fake/HTTP mock.
- Tidak ada schema/migration/RPC/RLS/permission change, database reset/seed, auth user creation, atau actual data mutation. Satu-satunya akses database batch ini adalah pembacaan katalog dalam transaksi read-only.
- Tidak mengedit `.env.local`, dependency/lockfile, database types, runtime/model/timeout config, financial calculations, atau modul checkout/order/payment/preorder/production analytics.
- Tidak ada commit, push, merge, deploy, atau cloud configuration change.
- F04 narrative validation, F07 zero-provider manual revisions, approved Blueprint immutability, financial checks, source/version CAS, Evaluation review/finalization, synthetic restrictions dan Memory review/indexing rules tetap dipertahankan; safe regression lulus.
- Perbandingan SHA-256386 baseline files:12 existing source/test files berubah,4 source/test files baru,0 baseline file dihapus. Seluruh perubahan berada pada daftar bagian E; laporan ini file dokumentasi baru di luar snapshot tersebut. Schema, migration, database types, PRD, dependencies/lockfile, configs dan `.env.local` identik baseline. Dirty/untracked work pengguna yang sudah ada tidak dibersihkan.

**Final verdict:** Duplicate Inference Protection sudah diterapkan untuk Strategist, Blueprint dan Evaluation pada kontrak yang tersedia, tetapi **belum memadai untuk seluruh provider-backed AI MVP**. F05 tetap **PARTIAL** sampai Memory mempunyai kontrak generation type yang diotorisasi dan integrasi/tes durable claim diselesaikan.
