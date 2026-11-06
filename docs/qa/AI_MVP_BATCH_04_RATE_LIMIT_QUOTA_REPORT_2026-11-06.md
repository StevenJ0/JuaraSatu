# Campaign Lab — Batch 04: AI Rate Limit & Quota Protection

Tanggal: 6 November 2026. Scope: F06. Referensi: AGENTS, schema/PRD, final audit, Batch01/02, Batch03 dan Batch03B; actual source, migration chain dan katalog PostgreSQL lokal diperiksa.

## A. Executive Summary

**Overall: PARTIAL. F06 enforcement BLOCKED — DATABASE ADMISSION CONTRACT CHANGE REQUIRED.**

**Quota belum aktif pada entry point aplikasi.** Independent policy/config sudah diimplementasikan dan diuji, serta primitive database diverifikasi dengan PostgreSQL nyata. Existing API/workflow/claim code tidak dipasangi rangkaian RPC yang tidak atomik. Tidak ada migration/RPC/schema change pada batch ini.

Existing `take_rate_limit` atomik untuk satu bucket, tetapi menghitung setiap panggilan termasuk denial, tidak idempotent, dan tidak mempunyai generation identity. Memanggilnya terpisah untuk minute/hour/day sesudah claim tidak dapat memenuhi admission atomik, no-charge-on-denial, atau same-key recovery. Sebelum claim juga dapat men-charge duplikat/payload conflict. Bukti PostgreSQL menunjukkan partial charge dan duplicate charge dari susunan naif tersebut.

Reproduksi acceptance aplikasi tetap **2 FAIL** saat opt-in: shared claim boundary dan actual Memory service masing-masing memanggil provider7 kali untuk7 pekerjaan baru dalam satu menit, expected6. Assertions tidak diubah menjadi expected7; kedua specs dipertahankan opt-in sebagai blocker yang belum selesai.

Regresi aman: **773 PASS,3 SKIPPED**, plus **10 quota-primitive PostgreSQL PASS** dan **10 existing F05 PostgreSQL PASS**. Total verification suites793 PASS; ini bukan793 bukti F06 selesai. Dua acceptance F06 tetap merah ketika dijalankan eksplisit. Typecheck, ESLint, build dan native Bruno validation lulus. Fixture rows dibersihkan dan snapshot histori/RPC/migrations identik.

## B. Existing Database Contract

### Schema dan RPC aktual

`public.rate_limit_buckets`:

| Field | Contract |
|---|---|
| bucket_key_hash | text,64 lowercase hex |
| window_start | timestamptz,NOT NULL |
| count | integer,NOT NULL,>=0 |
| expires_at | timestamptz,NOT NULL |
| primary key | `(bucket_key_hash, window_start)` |

RPC existing:

```sql
public.take_rate_limit(
  p_key_hash text,
  p_window_start timestamptz,
  p_expires_at timestamptz,
  p_limit integer
) RETURNS boolean
```

Actual body dari migration awal dan live PostgreSQL sama:

```sql
IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501';
END IF;
IF p_limit<1 OR p_expires_at<=p_window_start THEN
  RAISE EXCEPTION 'INVALID_BUCKET' USING ERRCODE='22023';
END IF;
INSERT INTO public.rate_limit_buckets(bucket_key_hash,window_start,count,expires_at)
VALUES(p_key_hash,p_window_start,1,p_expires_at)
ON CONFLICT(bucket_key_hash,window_start)
DO UPDATE SET count=public.rate_limit_buckets.count+1
RETURNING count INTO used;
RETURN used<=p_limit;
```

Function SECURITY DEFINER, fixed empty search_path; EXECUTE hanya postgres/service_role. RLS tabel enabled, tanpa authenticated policy. Anon/authenticated tidak mempunyai SELECT/INSERT/UPDATE maupun RPC EXECUTE; service_role mempunyai hak tersebut. Generated type existing sudah benar: empat args, return boolean; tidak diubah.

Source definition: `supabase/migrations/20261103000000_initial_v21.sql`, function `public.take_rate_limit`; generated types di `src/lib/supabase/database.types.ts`. Actual function definition MD5 sebelum/sesudah fixture `8484ad66ff38dd39645ba451807809c3`. Callers aplikasi existing hanya generated contract; test transport retry dan SQL invariants memakai primitive tersebut. Tidak ada production generation caller yang melakukan quota admission.

### Perilaku yang benar-benar tersedia

1. UPSERT row lock/primary key mengarbitrasi concurrent requests **untuk satu bucket**. Dari satu allowance tersisa, dua koneksi menghasilkan satu true dan satu false.
2. Denied call tetap increment: limit6, tujuh panggilan menghasilkan6 true +1 false, tetapi count7. Unit existing adalah **bucket evaluations/calls**, bukan admitted generations.
3. Tidak ada request/generation/idempotency key arg. Memanggil ulang args sama increment lagi, termasuk bila ACK pertama hilang.
4. Tidak menerima business/owner identity. Business isolation harus berasal dari trusted server-derived HMAC key dan owner validation di admission boundary; tidak ada FK business pada bucket.
5. Window start/end/limit sepenuhnya dari trusted caller. RPC tidak menentukan minute/hour/day, timezone, current time, atau source/module.
6. `expires_at` metadata saja: tidak me-reset counter atau menghapus row setelah waktunya lewat. Window baru memerlukan `window_start` baru. Conflict increment mempertahankan expires_at pertama; arg expiry baru tidak menggantinya.
7. Boolean response tidak mengembalikan exceeded window, quota reservation ID, canonical claim, atau authoritative Retry-After.
8. HTTP Supabase transport melakukan satu committed transaction per RPC/INSERT/UPDATE. Tidak ada existing public RPC yang menggabungkan tiga bucket dan claim; client tidak mempunyai transaction handle lintas HTTP requests.

### Counterexample coordination

| Susunan naif | Hasil gagal |
|---|---|
| Quota sebelum claim | Identical request/Memory alias atau konflik dapat mengambil quota sebelum kalah claim |
| Claim → minute → hour → day | Hour denial dapat meninggalkan minute terpakai dan claim running; rejected attempt ter-charge |
| Claim → quota denial → fail claim | Terminal canonical Memory key tidak dapat dipakai lagi sesudah reset tanpa melanggar recovery semantics |
| Claim → quota → crash/ACK lost | Tidak ada durable admission identity untuk membedakan belum dibayar/sudah dibayar; retry dapat double-charge |
| Refund melalui UPDATE terpisah | Ambiguous commit dan concurrent writers membuat refund/CAS/claim state tidak atomik; tidak diimplementasikan |

Actual SQL test untuk partial commit: hour bucket sudah mencapai limit1; panggilan minute diizinkan, hour ditolak. State persisten minute1/hour2/day0, tanpa provider. Ini melanggar no-charge-on-denied-generation. Bukan sekadar asumsi dari source.

## C. Quota Architecture

### Independent implementation yang selesai

File baru `src/lib/ai/generation-quota-policy.server.ts` mengekspor `generationQuotaPolicy`:

- 6 per fixed minute,30 per fixed hour, dan configurable daily cap.
- `AI_DAILY_GENERATION_LIMIT` default100. Ini keputusan starter MVP berdasarkan contoh environment PRD§19.1 yang memang berisi100; PRD§15.4 hanya mewajibkan configurable cap. Default yang finite menghindari missing-config unlimited behavior.
- Positive decimal integer1..2147483647; empty/zero/negative/fraction/NaN/Infinity/scientific notation/overflow ditolak. Missing daily value memakai100; malformed tidak memakai fallback diam-diam.
- `RATE_LIMIT_HMAC_KEY` wajib32..4096 karakter, sekurangnya32 setelah trim untuk menolak whitespace-only. Gunakan secret acak kuat saat task konfigurasi terotorisasi; panjang minimum sendiri bukan bukti entropy. Parser tidak membaca/mengubah `.env.local`.
- Missing/invalid secret/config mengembalikan safe `{success:false,code:'AI_QUOTA_CONFIGURATION_REQUIRED'}` tanpa error input atau secret. Secret disimpan dalam closure, bukan response object yang bisa diserialisasi.
- Keys: HMAC-SHA256 atas namespace `campaign-lab:text-generation:quota:v1:<canonical-business-uuid>:<minute|hour|day>`. Tidak memasukkan module/session/requestId/tab; semua modul seharusnya berbagi tiga keys tersebut. UUID dinormalisasi lowercase.
- Windows half-open. Minute/hour align pada UTC minute/hour; hari reset00:00 Asia/Jakarta (UTC+07), yaitu17:00UTC hari sebelumnya. Ini fixed-window policy, bukan sliding-window cap; burst lintas boundary tetap mungkin menurut definisi fixed window.
- Method windows menerima trusted business/time yang divalidasi, tetapi **bukan pemeriksaan ownership** atau izin inference. Tidak memanggil database/provider dan tidak menganggap hasil policy sebagai allowance.

**Policy ini belum dihubungkan ke services.** Constructor/config validation yang diuji tidak berarti seluruh aplikasi sudah fail-closed terhadap quota; entry points existing tetap tanpa budget guard sampai blocker database diselesaikan. Tidak ada active quota baru atau error429 baru yang diproduksi oleh batch ini.

### Minimum migration proposal — review saja, tidak diterapkan

Dibutuhkan satu public transaction RPC baru, misalnya `admit_ai_generation`, dengan service-role-only EXECUTE. Existing tables/unique constraints/claim checkpoints dan `take_rate_limit` dapat dipakai tanpa diubah. Tidak diperlukan Redis, worker, queue, tabel quota baru, atau perubahan model.

Contoh signature proposal (bukan SQL migration yang dibuat):

```text
admit_ai_generation(
  business_id, actor_user_id, attempt_id, generation_type,
  request_key, input_hash, model_id, preorder_id,
  quota_key_hashes {minute,hour,day}, daily_limit,
  session_id?, expected_session_version?, context_hash?, message?
) -> admitted | running | completed | failed | denied
```

Required transactional semantics:

1. Require service_role dan existing `private.require_owner(business_id, actor_user_id)`; actor berasal dari verified server auth. Validate allowed operation, source/UUID/hash/key lengths, three distinct HMAC hashes dan positive daily cap. Jangan menerima quota keys/caps langsung dari client request.
2. Lock business row dalam transaksi pendek untuk serialisasi business-wide admission; gunakan lock order business→session→buckets secara konsisten. Tentukan current time dari PostgreSQL setelah lock diperoleh, lalu hitung fixed minute/hour/WIB day. Clock browser/app instance tidak menentukan quota window efektif.
3. Periksa existing generation identity/hash/source. Completed/failed/running/replay mengembalikan state existing **sebelum counter changes**. Same canonical Memory aliases memakai key yang sama. Konflik tidak men-charge.
4. Untuk Strategist, panggil existing `claim_ai_generation` di dalam subtransaction yang sama; pertahankan seluruh session/version/context/user-message semantics. Sessionless Blueprint/Evaluation/Memory memakai existing unique INSERT dan supplied attempt UUID. Tidak membuat chat session palsu.
5. Hanya branch newly claimed mengambil tiga allowances melalui `take_rate_limit`, limit6/30/server daily config. Jika salah satu ditolak, rollback **seluruh subtransaction**, termasuk semua bucket increments, new generation, user message dan session version. Setelah rollback, return denied + failed window(s)/safe retry duration. Denial tidak disimpan sebagai running/terminal claim; request/canonical key yang sama dapat mencoba admission setelah window reset.
6. Bila semua diizinkan, commit claim + tiga counters bersama-sama. Return own attempt ID dan status newly admitted; hanya acknowledged admission milik attempt tersebut memberi izin provider. Duplicate/readback/lost ACK tidak dianggap dispatch permission baru.
7. Function selesai/commit sebelum inference. Provider/checkpoint/failure/freshness/domain persistence tetap di luar transaksi menggunakan F05 guards existing.
8. Pastikan schema hasher/keys dari trusted server konsisten; SQL validates owner/type/window invariants. Service-role-only RPC adalah trust boundary; policy function sendiri tidak mengautentikasi business.

`take_rate_limit` dapat tetap menghitung denied call di internal subtransaction: rollback RPC admission menghapus seluruh efek dari failed admission. Karena itu minimum perubahan adalah tambahan transactional coordinator, bukan wajib mengedit function limiter existing. Permission untuk function baru memerlukan REVOKE PUBLIC/anon/authenticated + GRANT service_role pada migration yang diotorisasi terpisah; existing permissions tidak perlu dilemahkan.

### Accounting dan recovery yang harus diterapkan setelah otorisasi

Unit yang diusulkan: **newly admitted generation attempts**, bukan successful narratives atau actual provider receipts. Admission ditolak/transaction rollback:0; compatible replay/duplicate/Memory alias/checkpoint recovery/manual edit:0 tambahan. Newly admitted attempt:1 di ketiga windows. Provider failure/domain-invalid output sesudah dispatch tetap1.

Admission committed tetapi dispatch tidak terjadi, termasuk process crash/lost ACK: allowance tetap terpakai secara konservatif. Tidak ada blind retry, refund parsial atau charge ulang key yang sama. F05 stale retirement dan late-result fencing tetap berlaku. Ini mendefinisikan budget yang aman, bukan exactly-once eksekusi jaringan eksternal.

Request harus menyelesaikan input/domain preflight sebelum admission. Blueprint saat ini mempunyai beberapa financial/offer validations di `generateBlueprint` sesudah claim; follow-up perlu menempatkan reusable preflight sebelum atomic admission tanpa mengubah arithmetic atau manual-edit branch. Source yang berubah setelah admission tetap ditolak oleh post-provider/freshness/CAS checks; retained admission mengikuti crash/no-dispatch accounting di atas.

### Application integration yang terblokir

- `generation-claims.server.ts`: ganti fresh read+INSERT admission dengan satu RPC yang menggabungkan claim dan quota; replay/checkpoint/terminal handling tetap, no quota call pada existing claim. Config untuk fresh admission saja, sehingga missing quota config tidak memblokir persisted history/replay.
- Strategist `createSupabaseDiscussionRepository.beginTurn`: route newly claimed turn melalui transactional coordinator yang membungkus existing claim RPC. `sendPersistentDiscussion` tetap memanggil provider hanya jika newly admitted; jangan menaruh quota exception di dalam provider catch.
- Blueprint create/AI replan: preflight→same helper; manual `edits.plan` tetap bypass provider/factory/claim/quota.
- Evaluation: admission sebelum `interpretEvaluation`, sehingga denied quota tidak berubah menjadi persisted failed/invalid provider result. Existing source/latest/CAS/review/finalization tetap.
- Memory: admission sebelum `generateMemoryInterpretation`, key canonical existing, payload winner/provenance/source recovery tetap. Tidak ada retry atau embedding job baru.
- Generated RPC types, runtime result schema dan API mapping perlu berubah hanya setelah DB contract diotorisasi. New safe error `AI_RATE_LIMIT_EXCEEDED`, HTTP429, no-store, integer Retry-After dari database; existing409 generation-in-progress tetap. Provider-side rate-limit code tetap dibedakan.

Proposed denied metadata hanya window dan retry seconds. Perhitungan Retry-After memakai maksimum akhir window yang exhausted berdasarkan DB clock; bukan tebakan dari boolean primitive saat ini. Jangan mengembalikan raw hashes/counters/prompt/SQL errors/other-business usage. Jika transport outcome ambigu, persistence503 dan fail-closed F05 semantics tetap berlaku; jangan mengaku quota denial pasti.

Tidak dibuat migration file, placeholder RPC, generated type palsu atau unsafe two-step wiring untuk proposal ini. Otorisasi Batch03B sebelumnya khusus CHECK Memory, tidak mencakup RPC F06.

## D. Per-module Result

| Module | Quota Enforcement | Replay No-Charge | Concurrent Safety | Status |
|---|---|---|---|---|
| Strategist | Belum terpasang; perlu atomic wrapper existing claim | F05 replay tetap; combined quota accounting belum tersedia | Existing session claim PASS; business quota belum ada | BLOCKED |
| Blueprint create/replan | Belum terpasang; fresh helper admission perlu RPC | F05 checkpoint/replay tetap; no-charge quota belum terverifikasi | F05 counter1; total distinct request belum dibatasi | BLOCKED |
| Evaluation | Belum terpasang; admission harus di luar interpretation catch | Persisted/checkpoint replay tetap | F05 counter1; shared quota belum ada | BLOCKED |
| Business Memory | Belum terpasang; canonical claim perlu atomic admission | Canonical alias/checkpoint tetap; allowance ledger belum tersedia | F05 alias counter1; distinct sources counter7 masih lolos | BLOCKED |
| Manual Blueprint edit | Exempt; provider/factory/claim tidak dipanggil | Exempt | F07 preserved | PASS untuk exemption existing |

Alternative analysis sudah berada dalam Strategist. Simulator, execution materialization/checklist, publication/closure, Evaluation review/finalization, Memory review/reject/approve dan ordinary read bukan text-generation admissions. Tidak ditambahkan quota behavior untuk embedding/retrieval; tidak ada quota call baru pada operasi tersebut. Tanpa active quota, no-charge assertions tidak dijadikan bukti integrasi ledger yang belum ada.

## E. Test Results

### Acceptance reproduction yang masih gagal

```powershell
$env:AI_QUOTA_ACCEPTANCE='1'
node_modules/.bin/vitest.cmd run tests/integration/generation-quota-blocker.test.ts
```

Exit1,2 FAIL,718ms pada explicit final reproduction:

| Case | Expected | Actual | Status |
|---|---|---|---|
| Shared production claim helper,7 valid distinct keys across Blueprint/Evaluation/Memory types |6 provider entries,1 quota429 |7 entries | FAIL — F06 unresolved |
| Actual Memory service,7 eligible fixture sources |6 provider entries/candidates,1 quota429 |7 entries | FAIL — F06 unresolved |

Shared-helper case menjalankan actual helper dengan simulated SQL transport, bukan seluruh module HTTP routes. Memory case menjalankan actual service dengan eligible synthetic source/domain ports dan mocked provider. Tidak memakai historical database source untuk mutable reproduction.

Assertions6 dan429 dipertahankan. Suite default skipped kecuali `AI_QUOTA_ACCEPTANCE=1`, dengan nama BLOCKED dan komentar known-red. Ini pending acceptance untuk future authorized RPC, **bukan expected-failure yang dihitung PASS**. Initial reproduction sebelum skip gate juga menunjukkan2 FAIL dengan actual7; tidak ada test expectation yang diubah untuk menyembunyikan defect.

### Independent policy tests

`tests/unit/generation-quota-policy.test.ts`:23 PASS. Meliputi fixed6/30/default100, configured daily values,11 malformed limits, missing/weak/whitespace secret, HMAC business/window/namespace isolation, uppercase UUID normalization, cross-module stable keys, no secret serialization, timezone-equivalent timestamps, malformed identity/time, dan exact minute/hour/WIB midnight boundary.

### Scope-specific outcomes

| Requirement | Evidence | Outcome |
|---|---|---|
| Minute boundary | Actual primitive true×6,false×1; count7; next window true | Primitive PASS; app enforcement FAIL |
| Hour boundary | Actual primitive true×30,false×1; next hour true | Primitive PASS; combined windows BLOCKED |
| Daily boundary | Config2→true,true,false; exact WIB reset true | Policy/primitive PASS; app enforcement BLOCKED |
| Cross-module accounting | HMAC keys shared in policy; actual helper permits7 | Wiring BLOCKED |
| Memory aliases/replay | Existing F05 barrier/replay/recovery suites PASS | No duplicate inference preserved; quota no-double-charge not proven |
| Concurrent boundary | Real two connections with one allowance left:1 true,1 false | Single-bucket PASS; claim+three-window transaction BLOCKED |
| Tenant isolation | Policy HMAC keys independent; real anon/auth denied RPC/table access | Primitive ACL PASS; owner-scoped quota coordinator BLOCKED |
| Quota claim failure | No available atomic primitive; independent calls persist partial charge | BLOCKED; no unsafe integration |
| Checkpoint recovery | Existing application and real PostgreSQL F05 suites PASS | F05 preserved; integrated quota accounting BLOCKED |
| Manual/deterministic/read exemptions | Existing manual zero-provider/factory, financial, review tests PASS; no new callers installed | Existing behaviors preserved |

### Safe regression commands dan hasil

```powershell
$env:MEMORY_CLAIM_POSTGRES='0'
$env:AI_QUOTA_POSTGRES='0'
$env:AI_QUOTA_ACCEPTANCE='0'
$env:EVALUATION_PERF_REPORT=''
$env:GEMINI_TRANSPORT_REPORT=''
$env:GEMINI_METADATA_CHECK='0'
$env:CAMPAIGN_GEMINI_SMOKE='0'
$env:MEMORY_EMBEDDING_SMOKE='0'
node_modules/.bin/vitest.cmd run tests/unit tests/integration/remaining-ai-contracts.test.ts tests/integration/evaluation-provider-validation.test.ts tests/integration/blueprint-provider-provenance.test.ts tests/integration/blueprint-manual-edit.test.ts tests/integration/duplicate-inference.test.ts tests/integration/memory-generation-claims.test.ts tests/integration/gemini-transport.test.ts tests/integration/generation-quota-blocker.test.ts

$env:AI_QUOTA_POSTGRES='1'
node_modules/.bin/vitest.cmd run tests/integration/generation-quota-postgres.test.ts --testTimeout=30000 --hookTimeout=30000

$env:MEMORY_CLAIM_POSTGRES='1'
node_modules/.bin/vitest.cmd run tests/integration/memory-claims-postgres.test.ts --testTimeout=30000 --hookTimeout=30000

node_modules/.bin/tsc.cmd --noEmit --incremental false
npm.cmd run lint
npm.cmd run build
node scripts/validate-bruno-collection.mjs
```

| Check | Actual result |
|---|---|
| Unit |703 PASS, termasuk23 policy tests |
| SDK/workflow mocked integration |66 PASS |
| Local loopback TLS/Next transport |4 PASS, bukan Google |
| Safe Vitest |773 PASS,3 SKIPPED;38 files passed,1 file skipped;45.41s |
| Quota PostgreSQL |10 PASS,10.75s |
| Existing F05 PostgreSQL |10 PASS,11.16s |
| Combined non-acceptance verification |793 PASS,0 regression FAIL,3 SKIPPED |
| Explicit blocked acceptance |2 FAIL tetap direproduksi; tidak dimasukkan sebagai PASS |
| TypeScript |PASS, exit0; diulang setelah perubahan akhir acceptance assertions |
| ESLint |PASS, exit0; focused lint file baru juga PASS setelah perubahan akhir |
| Next build |PASS, exit0; compiled, TypeScript,13 pages generated |
| Native Bruno validation |PASS, parser0.40.0,141 HTTP definitions + environment/collection; requests tidak dieksekusi |

Tiga skipped cases adalah1 Google metadata dan2 F06 pending acceptance. Initial PostgreSQL fixture run mempunyai9 PASS/1 harness failure karena invalid limit ditolak synchronous parser sebelum query; test diperbaiki agar mengirim invalid0 langsung ke PostgreSQL, yang benar-benar mengembalikan22023. Final10 cases PASS. Kedua run tetap melakukan verified cleanup. Diagnostic Crashpad access-denied Bruno tidak menggagalkan parser, exit0.

F04 narrative, F07 exact manual edit, F05 Strategist/Blueprint/Evaluation/Memory, financial simulator, synthetic approval dan checkpoint/source/CAS regressions tetap lulus. Tidak menjalankan live provider/embedding atau legacy suites yang memutasi historical campaign fixtures.

## F. Database Verification

### Target dan safety

Target sama dengan batch sebelumnya: repository `D:\Project\campaign-lab`; project/container `campaign-lab`/`supabase_db_campaign-lab`; local Docker named-pipe endpoint, label workdir cocok; database postgres17.11, port54322. Bukan hosted staging/production. Eight migration chain sampai `20261106090000_memory_generation_type` tetap; tidak ada migration baru/applied pada Batch04.

New quota test hanya membuat bucket rows dengan HMAC secret acak khusus run dan UUID namespace bisnis test. Tidak membuat/menulis actual owner/business/campaign/Evaluation/Memory untuk quota fixtures. Service-role SQL connections nyata dipakai; anon/auth roles diuji tanpa mengubah grants. Generic primitive tidak memverifikasi business owner; business-key isolation test memakai policy keys, bukan klaim owner-authenticated quota HTTP E2E.

### Actual PostgreSQL10 cases

1. Minute6 allowed/seventh denied + denied increment + new window.
2. Hour30 allowed/31 denied + reset.
3. Configurable daily cap2 + midnight WIB reset.
4. Dua koneksi aktual berebut last allowance: satu true/satu false.
5. Dua server-derived business keys independen.
6. Partial multi-window commit counterexample.
7. Identical RPC arguments double-charge counterexample.
8. Expired same-window bucket tetap counted; changed expiry arg tidak mengganti stored expiry.
9. Anon/authenticated tidak dapat RPC/SELECT/INSERT/UPDATE.
10. Invalid limit0 atau invalid expiry ditolak22023 tanpa row mutation.

Actual claim+quota no-double-charge belum dapat diuji sebagai integrated successful admission karena RPC-nya belum ada. Existing F05 PostgreSQL regression10 cases dijalankan ulang untuk claim arbitration/checkpoint/fencing/ownership/unique preservation; bukan dianggap quota admission proof.

### Fixtures dan cleanup evidence

[`evidence/AI_MVP_BATCH_04_QUOTA_2026-11-06.json`](evidence/AI_MVP_BATCH_04_QUOTA_2026-11-06.json) menyimpan live function/ACL/constraints/migrations, acceptance failure counts, exact fixture keys/windows, phases dan before/after count+digest snapshots. Cache originals berada di `node_modules/.cache/batch04-generation-quota/`.

| Run | Task rows actually created | Cleanup | Historical snapshot |
|---|---|---|---|
|0b43d968-b9ea-45f5-9506-de2953c8318f |13 |cleaned |preserved=true |
|f7bb8651-a990-40ca-a97f-ea558a7a8f26 |13 |cleaned |preserved=true |

Masing-masing run mendaftarkan39 potential key/window pairs, memverifikasi awal tidak ada collision, dan hanya13 menjadi actual rows. Cleanup memeriksa exact registered hash/window dan expected initial expiry, menyimpan task-row evidence, lalu menghapus exact pairs tersebut. Tidak menghapus berdasarkan prefix/global expiry atau mereset bucket bisnis lain. Run phases menyimpan preflight/registration/cleanup verification/cleaned.

Snapshot `rate_limit_buckets`, businesses, memberships, preorders, campaigns, Evaluations, Memories, generations dan jobs sebelum/sesudah identik, termasuk function-definition hash dan migration count. Final buckets0, same empty digest. Existing F05 regression memakai fresh disposable owner/business/preorder UUID fixtures dari generator existing, run `12e7fdc4-17d3-4b0b-ae8d-ba1939d57e0f`, cleaned/preserved=true; auth user snapshot juga identik.

Tidak ada persistent SQL function/DDL yang dibuat untuk melewati blocker. Test SQL transaksi langsung tidak diekspos sebagai runtime application operation. Actual PostgreSQL proof di sini membuktikan **single-bucket primitive dan limitation**, bukan full transactional generation admission, actual Next HTTP E2E, atau live Gemini.

## G. Safety Confirmation

- Zero live Gemini generation, Google metadata, embedding calls, billing changes atau provider retries. Existing SDK tests memakai HTTP mocks/loopback; new tests memakai counters/Fake/SQL saja.
- Tidak ada `.env.local` edit, actual secret log, dependency/lockfile/model/timeout/provider changes.
- Tidak ada schema/RPC/migration/index/RLS/grant/constraint change. Schema doc/database types dan historical migrations tetap identik baseline.
- Tidak ada remote database target, reset, production/historical business mutation, historical QA overwrite, auth credential rewrite, commit/push/deploy.
- Test-only bucket mutations dan fresh F05 fixtures diotorisasi tugas ini, dibersihkan dengan verified scope; counts/digests tetap sama. Tidak ada job embedding atau Memory candidate baru yang ditinggalkan.
- Existing request/auth/source/claim/replay/provider/checkpoint/manual/review paths tidak diubah. Tidak menambahkan limiter parsial yang merusak F05 recovery atau mengaku manual edit sebagai generation.
- SHA-256425 baseline files:0 existing files berubah,0 dihapus. Tujuh file baru: policy, policy test, known-red acceptance specs, quota PostgreSQL fixture/test, laporan ini dan evidence JSON. Perubahan pengguna yang dirty/untracked tetap dipertahankan.

## H. Remaining Risks

**Blocker tunggal F06:** belum ada database transaction operation yang menggabungkan canonical claim + tiga quota reservations + rollback denial, termasuk session/message CAS Strategist. Tambahan RPC/grant/type/doc integration memerlukan tugas database terpisah yang mengotorisasi kontrak bagian C. Tidak ada dasar memakai izin CHECK Memory Batch03B untuk mengubah RPC sekarang.

Sampai follow-up itu selesai, semua provider-backed entry points masih bisa menerima banyak pekerjaan distinct. Minute/hour/day policy yang diuji belum menjadi enforcement, cross-module accounting belum aktif, quota denial429/Retry-After belum tersedia, dan no-double-charge integrated recovery belum terbukti. Dua red acceptance specs memperlihatkan gap tersebut secara executable.

Follow-up harus menerapkan RPC atomik, menghubungkan helper dan Strategist, menjaga preflight/manual/replay exclusions, lalu membuat dua acceptance specs hijau serta menambah actual PostgreSQL claim+quota denial/retry/alias/ACK-loss tests. Fresh denial harus dapat memakai canonical/request key yang sama setelah reset tanpa stranded claim atau phantom session message.

Fixed windows membolehkan burst lintas boundary; HMAC secret rotation mengubah counter namespace dan perlu prosedur konfigurasi terkendali. Actual deployed configuration, full HTTP E2E, dan live provider quota/billing tidak diverifikasi. Provider retries, embeddings, atau quota UI bukan bagian dari solusi yang diotorisasi ini.

**Final verdict:** F06 belum sufficiently implemented untuk AI MVP. Independent policy, reproducible defects dan database evidence sudah selesai; enforcement tetap BLOCKED. Existing durable generation claims/recovery tidak dirusak untuk membuat hasil Batch04 tampak PASS.
