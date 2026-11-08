# Batch A2 — Job Claim Isolation & Legacy Claim Hardening

Tanggal: **7 November 2026, Asia/Jakarta**. Branch `merge/ai-campaign`, HEAD `5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762`.

## A. Executive Summary

**Overall: PASS untuk PM06 pada source dan PostgreSQL disposable.** Legacy claimant tidak lagi beroperasi sebagai catch-all. Generic typed claimant hanya menerima `expire`, `reconcile`, dan `send_paid_email`; daftar invalid, termasuk campuran dengan Memory, ditolak sebelum mutasi. Dedicated Memory claimant dan proteksi acknowledgement A1 tetap utuh.

Satu migration baru mengganti tepat dua body `claim_jobs`. Tidak ada perubahan tabel, CHECK/enum, index, trigger, RLS, ownership atau EXECUTE ACL. Caller TypeScript generic dipersempit sesuai kontrak tersebut. Satu pemanggilan dalam tes concurrency aktif dialihkan ke overload typed; assertion historis dipertahankan pada checkpoint asal.

Bukti: **18 kelompok A2**, **15 kelompok A1**, **10 kelompok Memory 8B**, dan **100 assertion pgTAP historis** pada checkpoint yang sesuai. A2 mengamati empat skenario claim yang overlap dan satu lock contention admission F05; A1 dan Memory masing-masing mengamati lima lock races. Angka kelompok/race bukan jumlah individual assertion yang boleh dijumlahkan dengan Vitest. Unit **1.101/67 berkas**, selected AI mock **69/7 berkas**, TypeScript, ESLint dan build lulus.

**Migration A1 dan A2 belum diterapkan pada database Campaign Lab lokal persisten maupun remote.** PASS ini bukan status deployment atau persetujuan produksi. Batch A3 tidak dimulai.

## B. Root Cause

Source sebelum A2:

- `20261103000000_initial_v21.sql:1304`: legacy `claim_jobs(integer,integer,integer)` tidak mempunyai filter jenis baik pada exhaustion UPDATE maupun selection. Service worker tanpa scope dapat mengambil atau mematikan Memory, email, expiration dan reconciliation.
- `20261106160000_core_preorder_on_v21.sql:643`: typed `claim_jobs(text[],integer,integer)` sudah memfilter jenis pada exhaustion dan selection, tetapi hanya memvalidasi cardinality/bounds. `embed_memory`, unknown dan NULL elements belum ditolak sebagai daftar tidak sah. Jadi bukan temuan bahwa UPDATE typed lama sama sekali tidak punya filter; masalahnya adalah scope yang diterima tidak dibatasi pada ownership generic.
- Exhaustion typed lama hanya mencakup expired-running. Selection tidak memeriksa `attempt_count<5`, sehingga queued/retryable yang sudah lima attempt bisa menjadi running attempt keenam. UPDATE exhaustion juga dapat menunggu row lock, sementara penggunaan `now()` mengacu awal transaksi.

Reproduksi nyata sebelum migration A2, setelah sepuluh migration historis dan A1:

1. Legacy claim mengambil Memory fixture.
2. Typed request `['embed_memory']` mengambil Memory yang sama dalam transaksi terpisah.
3. Typed email claim mengubah queued attempt 5 menjadi attempt 6.

Dua reproduksi Memory di-ROLLBACK agar tidak mengganggu verifikasi selanjutnya. Seluruhnya memakai fixture baru pada database disposable; tidak ada bukti atau klaim historical data pengguna telah korup.

## C. Existing RPC and Caller Inventory

### Data dan fungsi claim

Kontrak aktual berasal dari migration aktif, bukan mengasumsikan dokumen target telah diterapkan. `job_runs` memiliki ID, `job_type`, `entity_id`, `business_id`, `dedupe_key`, status, attempt, jadwal, lease, error/reference dan timestamps. Tidak ada payload JSON. CHECK aktual pada baseline baris 600–601 membatasi jenis tepat **empat**: `expire`, `reconcile`, `embed_memory`, `send_paid_email`; status `queued`, `running`, `succeeded`, `retryable_failed`, `dead`. UNIQUE `(job_type,dedupe_key)` tetap.

Singkatan seluruh path di `supabase/migrations/`: **B**=`20261103000000_initial_v21.sql`; **M93**=`20261104093000_memory_approval_and_indexing_transactions.sql`; **M94**=`20261104094000_memory_index_recovery.sql`; **K**=`20261106160000_core_preorder_on_v21.sql`; **A1**=`20261107090000_generic_job_acknowledgement_guards.sql`; **A2**=`20261107100000_job_claim_isolation.sql`.

| Exact signature / return / definisi aktif | Authorization | Jenis, lease, attempt/exhaustion dan caller |
|---|---|---|
| `public.claim_jobs(p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 60,p_max_attempts integer DEFAULT 5) → SETOF public.job_runs`; B:1304 → A2:4 | SECURITY DEFINER, `search_path=''`, owner postgres, EXECUTE service_role; body memeriksa `auth.role()` | Sebelum A2 global, lease 1–300 detik, max attempts input 1–20, SKIP LOCKED; dapat mengubah Memory. Sekarang **selalu menolak** service call dengan `0A000 / TYPED_JOB_CLAIM_REQUIRED`, tanpa query/mutasi queue. Signature/default/return/ACL tetap. Tidak ditemukan production/runtime caller di repository. |
| `public.claim_jobs(p_job_types text[],p_limit integer,p_lease_seconds integer) → jsonb`; K:643 → A2:11 | SECURITY DEFINER, empty search_path, owner postgres, EXECUTE hanya service_role via ACL | Tiga jenis generic saja; limit 1–100, lease 1–3.600 detik, max attempt tetap 5. Invalid input `P0001 / VALIDATION_ERROR`. Exhaustion dan picking type-scoped, SKIP LOCKED, PostgreSQL clock; tidak dapat mengubah Memory. Runtime `src/features/jobs/repository.ts:39` → `runExpireJobs`; tests Supabase jobs dan SQL A1/A2. |
| `public.claim_memory_jobs(p_business_id uuid,p_model text,p_profile text,p_embedding_version integer,p_limit integer DEFAULT 5,p_lease_seconds integer DEFAULT 60,p_max_attempts integer DEFAULT 5) → SETOF public.job_runs`; M93:103 → latest M94:50 | SECURITY DEFINER, empty search_path, owner postgres, service_role ACL dan body check | Hanya `embed_memory`; business/model/profile/version/durable key, approved target, queue/recovery state; limit 1–20, lease 1–300, max attempts 1–20. Scoped exhaustion, monotonic attempt, SKIP LOCKED. Runtime `business-memory/indexing.server.ts:26`; unit worker, integration Memory dan SQL 8B. **Tidak diubah.** |

Queue eligibility Memory tidak menggantikan source eligibility sebelum provider/writeback. Public approved production source tetap membutuhkan otoritas C6/C7.

### Acknowledgement dan writer lain

| Exact signature / latest source | Kontrak, security dan penggunaan |
|---|---|
| `public.complete_job(uuid,integer,text DEFAULT NULL) → boolean`; A1:4 | Service-only, definer/empty path; running + matching attempt + live lease setelah lock; Memory 23514; missing/stale false. Repository generic/expiry. Tidak diubah. |
| `public.fail_job(uuid,integer,text,text DEFAULT NULL) → text`; A1:28 | Service-only, definer/empty path; guard A1 yang sama, safe code validation; retry 1/5/15/60 menit, attempt 5 dead; stale NULL. Repository/expiry. Tidak diubah. |
| `public.finish_job(uuid,integer,boolean,text DEFAULT NULL,text DEFAULT NULL) → void`; latest M93:194 | Service ACL/body check, definer/empty path; non-Memory saja, lease/attempt, 40001 stale, successful replay, retry 30 detik. SQL tests; bukan worker Memory runtime. Tidak diubah. |
| `public.complete_memory_index_job(uuid,uuid,integer,uuid,text,integer,text,text,extensions.vector DEFAULT NULL,text DEFAULT NULL,integer DEFAULT 5) → void`; M93:178 | Service ACL/body check, definer/empty path. Dedicated context/source validation dan atomic transition; worker `indexing.server.ts:13`. Tidak diubah. |
| `private.finish_memory_index_job(uuid,uuid,integer,uuid,text,integer,text,text,extensions.vector,text,integer) → void`; latest M94:4 | Private invoker, empty path, tidak punya application EXECUTE. Memeriksa binding/hash/profile/version/vector/lease/attempt dan menulis vector + job atomik, termasuk replay/recovery/retry/dead. Tidak diubah. |
| `public.complete_memory_indexing(uuid,text,integer,text,text,extensions.vector) → void`; B:1271 | Legacy vector-only path; EXECUTE service dicabut M93, tetap tidak diaktifkan kembali. |
| `private.approve_memory_and_enqueue(uuid,uuid,text,text,text,uuid) → uuid`; M93:42 | Private invoker tanpa application EXECUTE, approval/enqueue/audit atomik; dipanggil public guarded approval. Tidak diubah. |
| `public.enqueue_expire_jobs(integer) → integer`; K:1049 | Service-only definer/empty path; dedupe enqueue due orders, caller `runExpireJobs`, tidak mengklaim atau acknowledge. Tidak diubah. |
| `private.enqueue_paid_email(public.orders) → void`; K:114 | Definer/empty path helper: enqueue `send_paid_email`, entity order, dedupe `<order>:paid-v1`, dipanggil verified-payment/late-accept transaction. Tidak mengirim email. |
| `private.close_active_payment_attempts(public.orders,text) → void`; K:48 | Definer/empty path helper: tutup attempt dan enqueue `reconcile`, entity payment, dedupe `payment:<id>`. Tidak menjalankan provider. |

Trigger `guard_memory_job`, `guard_memory_pipeline`, approval/source guards, RLS dan semua fungsi lain identik pada catalog comparison sebelum/sesudah A2.

### Klasifikasi caller

- **Runtime generic ditemukan:** `claimJobs` memakai named parameters `p_job_types`, `p_limit`, `p_lease_seconds`; `runExpireJobs` meminta `['expire']`, batch default 50, lease 60 detik. Tidak ada runtime legacy call yang ditemukan dengan pencarian source/scripts/tests/migrations. Worker email/reconcile delivery nyata belum tersedia pada branch ini; kontrak typed persistence-nya diuji, implementasi Indro tidak dikarang.
- **Runtime Memory:** `runMemoryWorker` memakai dedicated claimant; completion melalui dedicated atomic RPC, bukan `finish_job`/generic acknowledgement.
- **Active integration:** `tests/supabase/jobs.test.ts` sudah typed. `database/v2.1/tests/concurrency.mjs` dipanggil harness lama setelah full chain; satu SQL claim diubah dari legacy SETOF ke `jsonb_array_elements(claim_jobs(ARRAY['expire'],1,60))`, ekspektasi dua job berbeda tetap.
- **Historical checkpoint:** `invariants.sql:219` dan `memory-pipeline.mjs:26,32` tetap memakai legacy contract pada schema sebelum M93. Source assertion tidak diubah agar unsafe path dapat lolos pada schema baru. Snapshot `database/v2.1/supabase/migrations/` bukan active root chain dan tetap utuh.
- **External caller tidak diketahui:** pencarian repository tidak membuktikan tidak ada scheduler/skrip eksternal. Legacy refusal sengaja breaking untuk caller tersebut; rollout harus menginventarisasi consumer di lingkungan tujuan.

## D. Canonical Worker Ownership

| Job type | Jalur yang didukung | Binding pekerjaan |
|---|---|---|
| `expire` | Trusted core worker → typed `claim_jobs(['expire'],...)` | Entity order; `runExpireJobs` memakai server repository |
| `reconcile` | Trusted core worker → typed `claim_jobs(['reconcile'],...)` | Entity payment; provider tetap di luar transaksi SQL |
| `send_paid_email` | Trusted email worker → typed `claim_jobs(['send_paid_email'],...)` | Entity order dan dedupe template |
| `embed_memory` | `claim_memory_jobs(...)` saja untuk supported worker admission | Business + Memory + durable key + model/profile/version, source guard sebelum embedding/writeback |

Multi-type request generic boleh jika worker server secara eksplisit bertanggung jawab atas seluruh jenis yang diminta. Semua worker privileged tetap berbagi service role; ini pemisahan kontrak queue, bukan kredensial DB terpisah per jenis atau proteksi terhadap superuser. Browser tidak dapat mengklaim job.

## E. Implemented Fix

Legacy mempertahankan signature/ACL tetapi tidak lagi membaca atau memutakhirkan queue. Service caller mendapat error jelas agar migrasi ke typed tidak diam-diam mengambil semua non-Memory jobs.

Typed claimant:

1. Validasi seluruh array lebih dahulu: tidak NULL/kosong, setiap elemen non-NULL dan salah satu tiga jenis core; limit/lease tetap tervalidasi. Mixed invalid request gagal atomik.
2. CTE exhaustion memilih hanya jenis yang diminta, attempt ≥5, queued/retryable atau expired-running, dengan `FOR UPDATE SKIP LOCKED`; UPDATE hanya ID yang terkunci. Core exhausted queued/retryable kini terminal dan tidak mendapat attempt keenam. Queued/retryable exhausted boleh diretire tanpa menunggu jadwal berikutnya karena tidak ada attempt tersisa.
3. CTE picking memerlukan type scope, attempt <5, `next_run_at<=clock_timestamp()`, dan eligible status/expired lease. Urutan `next_run_at,created_at,id` memecahkan tie secara deterministik; SKIP LOCKED tetap.
4. UPDATE mengubah running/attempt+1/lease menurut clock PostgreSQL pada admission, mengosongkan finished_at, dan mengembalikan lima field JSON yang sama. NULL running lease tidak dianggap expired. Lease deadline `<=` berarti tidak hidup lagi, konsisten dengan A1.

TypeScript: `JOB_TYPES`/`JobType` generic hanya tiga jenis; input array divalidasi sebelum RPC dengan Zod existing, dan parser respons ikut menolak Memory. Named parameters, mapping lima field menjadi `ClaimedJob`, serta `JobRepositoryError` tidak berubah. Tidak mengubah expiry business logic, generated types atau dependency.

Alur: scheduler server → `runExpireJobs` → enqueue → `claimJobs` input validation → service-role typed RPC → validate seluruh scope → row-lock exhaustion/picking → JSON schema/map → proses fixture/business use case → A1 complete/fail. Input invalid gagal sebelum mutasi; browser gagal ACL; job locked dilewati; stale ACK false/NULL. Memory memakai alur dedicated yang tidak diubah.

## F. Migration

Berkas baru: `supabase/migrations/20261107100000_job_claim_isolation.sql`.

Satu transaksi, dua `CREATE OR REPLACE FUNCTION`; timestamp unik setelah A1. Seluruh **12 root migration** diterapkan berurutan: 10 historis, A1, A2. Tidak mengedit migration terdahulu. Tidak ada GRANT/REVOKE baru: PostgreSQL catalog comparison membuktikan signature, default, return, owner, ACL, SECURITY DEFINER dan empty search_path tetap; tepat dua body claimant berubah. Semua acknowledgement, Memory, quota dan generation functions identik.

Applied **hanya ke container disposable**. Tidak membaca migration ledger/catalog dari stack persisten, tidak menjalankan Supabase reset/push/repair atau deployment. Source existence tidak menunjukkan patch sudah live.

Rollout yang disarankan untuk tugas terpisah: baca history/catalog target, identifikasi consumer legacy termasuk scheduler eksternal, pindahkan consumer legitimate ke typed scope, review error `TYPED_JOB_CLAIM_REQUIRED`, kemudian terapkan A1 → A2 dengan otorisasi lingkungan yang sesuai. Jangan mengaktifkan kembali catch-all sebagai fallback untuk consumer yang belum teridentifikasi.

## G. Isolation Evidence

| Skenario real PostgreSQL | Hasil |
|---|---|
| Legacy default, explicit dan NULL-argument call | 0A000; full snapshot semua job identik, termasuk mixed exhausted fixtures |
| NULL/empty/unknown/Memory/NULL element/mixed valid-invalid types | VALIDATION_ERROR; semua job identik, termasuk eligible dan max-attempt jobs yang bisa terkena sweep bila validasi terlambat |
| Limit 0/101/NULL, lease 0/3601/NULL | Refusal tanpa mutasi |
| Email-only, expire-only, reconcile-only | Hanya tipe yang diminta; full row Memory dan dua core queue lain identik; shape JSON tepat dan immediate A1 completion sukses |
| Explicit multi-type core + duplicate element | Jenis valid diterima; job tidak diklaim dua kali |
| Exhaustion tiap jenis core dalam queued/retryable/expired-running | Hanya tipe requested menjadi dead, attempt tetap 5, lease cleared; jenis lain dan Memory unchanged; attempt 4 dapat menjadi claim 5 |
| Future next_run_at / live lease | Tidak diklaim, row identik |

Snapshot memakai keseluruhan `to_jsonb(job)`, bukan hanya status: attempt, lease, jadwal, error, reference dan timestamp ikut dibandingkan. Tidak ada unbounded delete; retirement fixture menggunakan ID yang dibuat test.

## H. Memory Compatibility

Dedicated Memory fixture dapat diklaim dengan business/model/profile/version/durable key yang sesuai. Generic typed Memory request ditolak; generic exhaustion pada mixed max-attempt fixture tidak menyentuh Memory. `complete_job` dan `fail_job` A1 tetap menolak Memory dengan 23514 tanpa mutation.

Suite `memory-transactions.mjs` tetap tidak diubah dan dijalankan setelah A2: scoped claim/tenant isolation, atomic vector+ACK, enqueue rollback, invalid vector/hash/profile/source, expired/stale fencing, concurrent invalidation/duplicate completion, ready-vector recovery, public dedicated failure retry/dead dan privileges. Lima lock races benar-benar diamati. A1 juga menguji Memory di lima status ditambah running attempt kelima.

Positive vector/writeback memakai private primitive sebagai postgres pada fixture eksplisit synthetic/test_only/productionEligible=false, mengikuti kontrak 8B existing. Public approval untuk sumber synthetic/foreign tetap ditolak; tidak mengganti source checker, menonaktifkan trigger, memberi private EXECUTE aplikasi, atau mengubah provenance menjadi verified. **Bukan bukti public production Memory success E2E; C6/C7 tetap dependency.**

## I. Concurrency and Lease

Empat skenario A2 memakai sesi psql independen. Holder diamati melalui `pg_stat_activity` dalam `PgSleep`; contender harus selesai saat holder masih memegang lock, dengan statement timeout 2 detik versus hold 4 detik. Ini bukti SKIP LOCKED dan overlap aktual, bukan asumsi dari Promise.all:

1. Dua worker untuk satu email job: satu owner, attempt naik sekali, worker kedua tidak menerima claim yang sama.
2. Dua worker batch satu untuk dua expiration jobs: ID berbeda, masing-masing attempt satu; juga mempertahankan ekspektasi tes concurrency generic aktif.
3. Exhausted expiration row dikunci: sweep melewatinya, job lain tetap admitted; sweep berikutnya setelah release menjadikannya dead.
4. Email holder, expiration claimant dan dedicated Memory claimant overlap; tiap hasil hanya jenisnya sendiri, tanpa double ownership.

Satu tambahan F05 admission race diamati sebagai **wait_event_type=Lock** pada business serialization: winner claimed, duplicate running dengan generation ID winner. Ini berbeda dari SKIP LOCKED queue race dan dihitung terpisah.

Lease/reclaim: expired generic attempt 1 diklaim ulang menjadi 2; stale complete false/fail NULL; current complete true. Transaksi berumur dua detik masih dapat membuat lease satu detik yang live untuk immediate A1 ACK karena memakai `clock_timestamp()`, bukan waktu awal transaksi. A1 tetap lulus lima lock races, termasuk lease habis saat menunggu row lock; Memory tetap lulus lima race-nya sendiri. Tidak ada klaim exactly-once email/provider delivery.

## J. Regression Tests

Command utama:

```powershell
node database/v2.1/tests/job-acknowledgement.mjs --a2
.\node_modules\.bin\next.cmd typegen
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
npm.cmd run lint
npm.cmd run build
```

| Pemeriksaan | Hasil |
|---|---|
| A2 actual PostgreSQL | 18 kelompok PASS; empat observed queue-claim overlap scenarios + satu observed F05 admission lock contention |
| A1 actual PostgreSQL setelah A2 | 15 kelompok PASS, lima observed lock races; body migration A1 identik |
| Memory 8B actual PostgreSQL setelah A2 | 10 kelompok PASS, lima observed lock races; suite/guards utuh |
| Legacy pgTAP sebelum M93 | 100 assertions PASS; source tidak diubah, bukan klaim contract legacy tetap berlaku sesudah A2 |
| Focused F05 SQL | Concurrent identical admission satu durable generation ID; duplicate tidak membuat claim/charge tambahan |
| Focused F06 SQL | Tiga allowance masing-masing count 1; daily denial rollback generation + seluruh charge; replay tidak ditagih ulang |
| Default safe Vitest | **1.101 PASS, 67 berkas, 0 FAIL/skip**, exit 0; baseline 1.098 + tiga repository boundary tests |
| Selected AI mock integration | **69 PASS, 7 berkas, 0 FAIL/skip**, exit 0 |
| Core jobs | Existing expiry-service unit PASS; tiga repository input/response/error-mapping tests PASS; SQL tiga jenis claim/ACK/retry/exhaustion PASS |
| `node --check` pada tiga mjs terkait | PASS |
| Typegen / tsc tanpa incremental | PASS, zero diagnostics; mock response fixture telah disesuaikan ke SDK terpasang tanpa melemahkan strictness |
| ESLint full dan focused | PASS, exit 0 |
| Production build | PASS, exit 0; compile, TypeScript, prerender 29/29 selesai |

Tujuh selected mock files tetap: manual-edit 16, provider-provenance 3, duplicate-inference 11, evaluation-provider-validation 12, generation-quota-blocker 3, memory-generation-claims 21, remaining-ai-contracts 3. Default mencakup F04 narrative safety, F05 checkpoint/replay, F06 policy/admission dan F07 manual Blueprint. Tidak mengubah expectation lama untuk mengejar PASS.

Vitest menggunakan environment OS/home minimal + NODE_ENV=test, smoke flags disabled, tanpa credential ambient dan tanpa flag performa truthy. Default memakai installed Vitest JSON reporter; allowlist tujuh mock memakai `startVitest` seperti A1, tanpa edit config. Build memakai production/telemetry disabled dan akses font yang diperlukan, tidak menjalankan worker/provider route.

**Batas regresi:** file PostgreSQL F05/F06 lama (`memory-claims-postgres`, `atomic-generation-admission-postgres`, `generation-quota-postgres`) tidak diaktifkan karena fixture hardcode `supabase_db_campaign-lab` persisten. Sebagai gantinya fokus SQL F05/F06 di atas berjalan pada target disposable yang sama, ditambah existing unit/mock. Tidak mengklaim seluruh suite lama itu dijalankan. Full `tests/supabase/jobs.test.ts` membutuhkan Supabase HTTP/Auth persistent helper dan juga tidak dijalankan; kontrak SQL job diuji langsung. Modul concurrency lama secara keseluruhan (termasuk capacity/order tests) tidak dieksekusi; pemanggilan job aktifnya diperbarui dan ekspektasi distinct-claim diuji dalam A2. Bukan perbaikan umum PM09.

## K. Safety

Runner A1 diperluas dengan flag eksplisit `--a2`, bukan membuat harness container baru yang duplikatif. Sebelum SQL mutation, runner memeriksa source chain 12 migration/timestamp unik dan identitas target kosong. Docker endpoint dipastikan local npipe/unix lalu dipin ke setiap pemanggilan agar environment tidak mengalihkan operasi ke remote engine.

- Image lokal existing `public.ecr.aws/supabase/postgres:17.11.0.006`; tidak mengunduh image atau menambah dependency.
- Container baru UUID + label milik run, `--rm --network none`, port bindings kosong, mounts/volumes kosong; tidak mewarisi historical data.
- PostgreSQL baru initdb di `/tmp/campaign-a1`, listen_addresses kosong; psql hanya Unix socket `/tmp`, user/database postgres. Sebelum bootstrap: jumlah tabel public/auth/storage = 0, inet_server_addr NULL, directory/user/database tepat.
- Auth bootstrap existing dan minimal test-only `storage.buckets`/`storage.objects` seperti A1; ini bukan bukti Supabase Storage/Auth HTTP compatibility.
- Cleanup memverifikasi ulang ID/label/network sebelum stop container milik run saja; tidak menarget container stack persisten atau volume lain.

Container run awal: `campaign-lab-a1-b9c05e36-c7c0-44e7-9b2e-3b0ad41b7e89` (14 kelompok A2 awal). Run perluasan: `campaign-lab-a1-1d622124-6f50-4ba3-bfb5-3ef91c1ea978`. Run final setelah preflight chain dipindah sebelum mutation: `campaign-lab-a1-8acc394c-81b7-48dc-877c-21dc730d7298`. Hasil run tidak dijumlahkan untuk memperbesar coverage. Ketiga run berakhir exit 0 dan membersihkan container masing-masing. Percobaan sandbox awal ditolak akses Docker pipe sebelum container dibuat; eksekusi berikutnya memakai eskalasi sesuai otorisasi disposable pengguna.

Perubahan hanya tujuh berkas: migration A2; module tes A2; repository generic; tiga boundary tests pada repository.test.ts; satu SQL caller di concurrency.mjs; extension runner A1; laporan ini. Dari 666 berkas awal, hanya repository.ts, concurrency.mjs dan runner A1 berubah untuk alasan langsung tersebut. Seluruh historical migration, migration A1, Memory source/tests, laporan terdahulu, schema/handoff, package/lockfile dan `.env.local` tetap identik.

Tidak melakukan Git staging/commit/push/merge/rebase/reset/deploy, SQL pada persistent/remote DB, email, Midtrans/payment callback, Gemini/embedding atau application worker nyata. Tidak mencetak/menulis secret. Vektor fixture sintetis lokal; tidak dikirim ke provider.

## L. Remaining Findings

- **PM06:** selesai pada source dan verified PostgreSQL disposable. Legacy catch-all ditutup, typed ownership enforced, queue/exhaustion/concurrency/ACL terbukti pada kasus tes.
- **PM07:** tetap selesai pada source/disposable; migration A1 tidak diubah, seluruh acknowledgement/Memory regressions lulus setelah A2.
- **PM05:** pending canonical publication snapshot/overload compatibility; publish/checkout/offer tidak diubah.
- **PM08/PM09/PM13:** generated database types, general harness/platform compatibility dan dokumentasi schema drift tetap pekerjaan terpisah. Signature tidak berubah sehingga A2 tidak mengarang generated types.
- **C1/C8/C6/C7:** authoritative context/offer/metrics/source attestation dan positive public production Memory loop tetap dependency integrasi. A2 tidak memproduksi data bisnis terverifikasi.
- **Persistent migration deployment:** A1/A2 belum diterapkan. Applied history/catalog target dan kemungkinan external legacy consumers harus diperiksa dalam rollout terotorisasi. Caller legacy eksternal akan mendapat error; risiko kompatibilitas tersebut disengaja agar tidak ada unsafe fallback.

## M. Final Verdict

**Ya: PM06 telah cukup diperbaiki pada source dan diverifikasi dengan PostgreSQL nyata sehingga supported generic dan legacy claim paths tidak dapat mengambil/menghabiskan Memory atau queue di luar scope request, sementara email, expiration dan reconciliation tetap dapat diklaim melalui kontrak typed yang sah.**

Dedicated Memory claim/writeback dan A1 acknowledgement tetap utuh. PASS dibatasi fresh disposable migration chain dan kasus yang disebut, bukan deployment, full platform E2E atau production Memory readiness. Batch A3 tidak dimulai.

Tidak diuji: full Supabase HTTP/Storage/Auth, browser/provider nyata, seluruh suite PostgreSQL lama yang terikat stack persisten, serta rollout database aplikasi. Risiko yang perlu diketahui: patch belum live dan consumer legacy eksternal yang belum terinventarisasi harus dipindahkan ke typed claim sebelum rollout.
