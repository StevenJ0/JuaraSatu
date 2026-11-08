# Batch A1 — Job Acknowledgement Integrity & Business Memory Isolation

Tanggal: **7 November 2026, Asia/Jakarta**. Branch `merge/ai-campaign`, HEAD `5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762`.

## A. Executive Summary

**Overall: PASS untuk scope PM07.** Unsafe callable path pada `complete_job` dan `fail_job` telah diperbaiki dalam satu migration forward-only dan diverifikasi dengan PostgreSQL nyata pada database disposable. Tidak ada klaim bahwa Memory aktif sebelumnya sudah korup.

- Generic completion/failure kini menolak `embed_memory` dengan `ATOMIC_MEMORY_INDEXING_REQUIRED`, SQLSTATE `23514`, tanpa mengubah row job maupun Memory.
- Generic acknowledgement memerlukan status running, attempt cocok, dan lease yang masih hidup menurut PostgreSQL **setelah row lock diperoleh**. Missing/stale/expired ACK mempertahankan return contract `false`/`NULL`.
- Email, expiration, dan reconciliation jobs tetap dapat complete/fail; retry email 1/5/15/60 menit dan exhaustion attempt kelima tetap benar.
- PostgreSQL: **15 focused A1 groups dengan 5 observed lock races**, **10 existing Memory 8B groups dengan 5 observed lock races**, serta **100 pgTAP assertions pada checkpoint legacy yang sesuai** lulus. Kelompok tersebut bukan satu jumlah individual test yang boleh dijumlahkan dengan Vitest.
- Unit/default **1.098 PASS / 66 berkas**; selected AI mocked integration **69 PASS / 7 berkas**; typegen, typecheck, ESLint, dan production build lulus.
- Tidak ada perubahan caller aplikasi atau generated database types karena signature/return shape tetap. Sepuluh migration lama, dokumen schema/handoff, test lama, package/lockfile dan `.env.local` dipertahankan.
- Migration hanya diterapkan pada dua container baru disposable milik test run; keduanya sudah dibersihkan. **Belum diterapkan pada database Campaign Lab lokal persisten atau remote.**

Scope tetap PM07. PM06 claimant isolation, PM05 publication snapshot, dan Batch A2 tidak diimplementasikan.

## B. Root Cause

Definisi pada `supabase/migrations/20261106160000_core_preorder_on_v21.sql:750` dan `:1140` melakukan UPDATE berdasarkan ID, `status='running'`, dan attempt saja. Keduanya tidak menyaring `embed_memory` dan tidak memeriksa `locked_until`.

Trigger Memory 8B menolak direct indexing mutation dari role aplikasi, tetapi generic RPC bersifat SECURITY DEFINER dengan owner postgres. Karena itu trigger yang memeriksa `current_user` tidak mencegah fungsi tersebut mengubah status job Memory. `complete_job` dapat membuat job succeeded sementara vector/status indexing belum ready; `fail_job` dapat mengubah retry/dead tanpa transaksi Memory. `finish_job` legacy sudah menolak Memory, tetapi pembatasannya belum ada pada dua RPC core baru.

**Reproduksi nyata sebelum patch**, setelah 10 migration historis diterapkan pada container kosong:

1. Generic complete terhadap Memory fixture mengembalikan `true`; job menjadi succeeded, row Memory tidak berubah dan embedding masih NULL.
2. Generic fail terhadap Memory fixture mengembalikan `retryable_failed`; row Memory tetap tidak berubah.
3. Generic complete pada expiration job dengan lease sudah expired masih mengembalikan `true`.

Semua bukti ini berasal dari fixture disposable yang baru dibuat, bukan inspeksi/mutasi historical records. Worker Memory aktual tetap memakai dedicated RPC; tidak ditemukan caller aplikasi yang sengaja menggunakan generic completion untuk Memory.

## C. Existing Contracts

### Job data dan ownership

Tabel aktual `public.job_runs` (`initial_v21.sql:431`), dengan `job_type`, `status`, `attempt_count`, `locked_until`, `next_run_at`, `entity_id`, `business_id`, `dedupe_key`, error/provider reference dan timestamps. Tidak ada kolom JSON payload job; binding pekerjaan memakai entity/business/durable key.

- Jenis yang diizinkan CHECK: `expire`, `reconcile`, `embed_memory`, `send_paid_email`.
- Status: `queued`, `running`, `succeeded`, `retryable_failed`, `dead`.
- Fencing worker: pasangan job ID + monotonic attempt, ditambah live lease untuk acknowledgement. Dedupe: UNIQUE `(job_type,dedupe_key)`.
- Worker mutation RPC bersifat service-role-only; generic job processing memang trusted server lintas bisnis, bukan menerima otorisasi owner dari input browser. Owner membaca job miliknya melalui RLS.
- Memory menambahkan business/source/hash/model/profile/version binding, owner check pada entry aplikasi, serta source eligibility yang tidak dapat diganti flag client.

Singkatan migration pada inventaris: **B**=`20261103000000_initial_v21.sql`; **M93**=`20261104093000_memory_approval_and_indexing_transactions.sql`; **M94**=`20261104094000_memory_index_recovery.sql`; **K**=`20261106160000_core_preorder_on_v21.sql`; **A1**=`20261107090000_generic_job_acknowledgement_guards.sql`. Semua berada di `supabase/migrations/`.

### RPC dan writer inventory

| Function, exact signature dan defining migration | Security / EXECUTE | Jenis, lease, state/error contract dan caller aktual |
|---|---|---|
| `public.claim_jobs(integer DEFAULT 10,integer DEFAULT 60,integer DEFAULT 5) → SETOF public.job_runs`; B:1304 | SECURITY DEFINER, empty search_path; service_role; body memeriksa auth.role | Legacy global queue, seluruh jenis termasuk Memory, SKIP LOCKED; lease 1–300 detik, max attempts parameter. Mengubah running/attempt/lease dan exhausted→dead. Input invalid `22023`. Dipakai legacy SQL tests. **PM06, tidak diubah.** |
| `public.claim_jobs(text[],integer,integer) → jsonb`; K:643 | SECURITY DEFINER, empty search_path; service_role | Type-filtered generic claim; lease 1–3.600 detik, max attempts 5, SKIP LOCKED, retry/exhaustion core. `VALIDATION_ERROR` untuk input invalid. `jobs/repository.ts:40` dan expiry service memakai overload ini. Memory masih dapat diminta sebagai type; isolasi claim belum diubah pada A1. |
| `public.claim_memory_jobs(uuid,text,text,integer,integer DEFAULT 5,integer DEFAULT 60,integer DEFAULT 5) → SETOF public.job_runs`; M93:103, latest M94:50 | SECURITY DEFINER, empty search_path; service_role + body server-role check | Memory-only, business/profile/version/durable binding; approved target; lease/attempt bounds, SKIP LOCKED dan scoped exhaustion. Tidak mengambil email. Caller `business-memory/indexing.server.ts:26`. Tidak diubah. |
| `public.complete_job(uuid,integer,text DEFAULT NULL) → boolean`; K:750, latest A1:4 | SECURITY DEFINER, empty search_path; service_role via ACL | Sekarang hanya non-Memory, running+matching attempt+live lease setelah row lock. Sukses→succeeded, clear lease/error, preserve reference via coalesce. Stale/missing→false; Memory→23514. Caller `jobs/repository.ts:49`, `jobs/service.ts:19`, test core. |
| `public.fail_job(uuid,integer,text,text DEFAULT NULL) → text`; K:1140, latest A1:28 | SECURITY DEFINER, empty search_path; service_role via ACL | Sekarang non-Memory saja dan live-lease fencing sama. Return retryable_failed/dead, atau NULL untuk stale/missing. Regex error code `[A-Z0-9_]{1,64}` dan `VALIDATION_ERROR` tetap. Retry 1/5/15/60 menit, attempt≥5→dead. Caller `jobs/repository.ts:58`, expiry service pada jalur error, test core. |
| `public.finish_job(uuid,integer,boolean,text DEFAULT NULL,text DEFAULT NULL) → void`; B:1319, latest M93:194 | SECURITY DEFINER, empty search_path; service_role + auth.role check | Generic legacy non-Memory. Memory ditolak 23514; running/matching attempt/live lease diperlukan; stale→40001. Exact successful replay tanpa mutasi tetap idempotent; kegagalan retry 30 detik. Caller SQL concurrency/invariants/Memory negative tests, bukan worker Memory aplikasi sekarang. Tidak diubah. |
| `public.complete_memory_index_job(uuid,uuid,integer,uuid,text,integer,text,text,extensions.vector DEFAULT NULL,text DEFAULT NULL,integer DEFAULT 5) → void`; M93:178 | SECURITY DEFINER, empty search_path; service_role + auth.role check | Dedicated Memory transaction; context/source lock, source check untuk success, lalu private atomic transition. Failure memakai safe error code dan transaksi failed/retry/dead. Worker `indexing.server.ts:13–15`. Stale/mismatch/source/vector errors tetap; tidak diubah. |
| `private.finish_memory_index_job(uuid,uuid,integer,uuid,text,integer,text,text,extensions.vector,text,integer) → void`; M93:133, latest M94:4 | SECURITY INVOKER helper, empty search_path; tidak ada EXECUTE anon/authenticated/service_role | Primitive Memory atomic vector+job commit; business/key/hash/profile/version, live attempt/lease, vector 768 finite/nonzero, replay/recovery. Dipanggil wrapper dedicated; private invocation oleh superuser hanya untuk existing disposable plumbing test. Tidak diubah. |
| `public.complete_memory_indexing(uuid,text,integer,text,text,extensions.vector) → void`; B:1271 | SECURITY DEFINER, empty search_path; EXECUTE aplikasi/service dicabut M93 | Vector-only legacy path, bukan atomic ACK; tetap disabled. Tidak diubah atau diaktifkan kembali. |
| `private.approve_memory_and_enqueue(uuid,uuid,text,text,text,uuid) → uuid`; M93:42 | Invoker helper; tidak dapat dieksekusi role aplikasi | Approval+unique enqueue+audit atomik setelah public source validation. Dipakai existing explicit test-only lower-layer fixture oleh postgres; tidak diubah. |
| `public.enqueue_expire_jobs(integer) → integer`; K:1049 | SECURITY DEFINER, empty search_path; service_role | Enqueue due expiry dengan dedupe; tidak acknowledge. Caller `runExpireJobs`. Tidak diubah. |
| `private.enqueue_paid_email(public.orders) → void` dan `private.close_active_payment_attempts(public.orders,text) → void`; K:114 dan K:48 | SECURITY DEFINER, empty search_path; helper bukan public worker RPC | Enqueue email/reconcile dari payment/order core, bukan acknowledgement. Tidak diubah. Tidak ada email/payment execution pada test A1. |

Trigger `private.guard_memory_job` dan `private.guard_memory_pipeline` tetap ada. Service role mempunyai table privileges yang disengaja, tetapi direct Memory indexing mutation tetap dilindungi trigger. A1 tidak mengubah policy/grant tabel, trigger, jenis job, atau queue schema.

## D. Implemented Fix

Hanya dua function body yang diganti:

1. Ambil job dengan `SELECT ... FOR UPDATE`.
2. Missing job mengembalikan `false` / `NULL`, sesuai bentuk return lama.
3. Bila `job_type='embed_memory'`, raise `ATOMIC_MEMORY_INDEXING_REQUIRED`, SQLSTATE `23514`, sebelum UPDATE apa pun.
4. Periksa running, attempt menggunakan `IS DISTINCT FROM` (termasuk menolak NULL), lease non-NULL dan `locked_until > clock_timestamp()`.
5. Baru lakukan UPDATE menggunakan assignment core yang sudah ada.

Row lock diperoleh **sebelum membaca waktu untuk validasi lease**, sehingga worker yang mengantre pada lock tidak dapat memakai keputusan lease lama setelah waktu habis. Dua worker juga tidak dapat sama-sama melakukan transisi running yang sama.

Return shape, safe error-code validation, max retry, backoff, timestamps/reference assignments, SECURITY DEFINER, empty search_path, owner dan ACL dipertahankan. Tidak menambahkan abstraksi/caller baru. Exact successful retry pada generic complete tetap menghasilkan false setelah status succeeded tanpa mutasi, sama seperti core sebelumnya; `finish_job` legacy mempertahankan contract replay-nya sendiri.

Tidak ada perubahan TypeScript repository/service: caller sudah mengirim job ID+attempt, mem-parse boolean/nullable status, dan worker Memory sudah memakai RPC dedicated. Generated database types tidak diubah karena signature/return contract tidak berubah.

## E. Migration

Berkas baru:

`supabase/migrations/20261107090000_generic_job_acknowledgement_guards.sql`

Timestamp unik dan lebih akhir daripada 10 migration aktif sebelumnya. Satu transaksi BEGIN/COMMIT berisi dua `CREATE OR REPLACE FUNCTION` dengan signature existing:

```text
public.complete_job(uuid, integer, text) → boolean
public.fail_job(uuid, integer, text, text) → text
```

Tidak ada ALTER TABLE, trigger, RLS, index, constraint, enum atau grant baru. `CREATE OR REPLACE` pada signature yang sama mempertahankan existing EXECUTE ACL dan ownership; ini juga diperiksa terhadap catalog PostgreSQL nyata sebelum/sesudah patch, bukan diasumsikan dari syntax.

Test membandingkan seluruh definisi fungsi public/private: **hanya dua body di atas berubah**. Signature/owner/ACL/proconfig tetap sama, dan seluruh fungsi lain—termasuk kedua claim_jobs, Memory claim/completion/private helpers dan legacy finish_job—tetap identik.

### Target penerapan yang benar-benar dipakai

Runner: `node database/v2.1/tests/job-acknowledgement.mjs`.

- Image lokal existing: `public.ecr.aws/supabase/postgres:17.11.0.006`.
- Container run pertama: `campaign-lab-a1-9b0326ee-b055-4760-a755-b19f33d5b6a0`.
- Run final setelah penambahan assertion exhaustion dan live-before-wait: `campaign-lab-a1-601da736-672b-4148-8e57-10362f07d760`.
- Keduanya dibuat baru oleh runner, `--network none`, tanpa port/mount/host volume. Target SQL hanya Unix socket `/tmp`, database postgres, user postgres, data directory `/tmp/campaign-a1`.
- Sebelum mutation test, runner memeriksa container ID, label acak milik run, network/mount/port, identitas database, dan jumlah tabel public/auth/storage = 0. Runner tidak menerima URL atau container existing dari environment/argument.
- Cleanup memverifikasi ulang ID/label/network, lalu stop hanya container milik run; `--rm` membersihkannya. Kedua run berakhir dengan pesan cleanup sukses.

Mutation hanya dilakukan pada target disposable tersebut. Docker sandbox awal menolak akses pipe/config; pemeriksaan dan eksekusi berikutnya menggunakan eskalasi yang sesuai izin pengguna untuk disposable PostgreSQL. Tidak ada akses SQL ke hosted/shared/persistent local stack.

### Batas chain verification dan PM09

Seluruh **11 migration source** diterapkan pada real PostgreSQL. Untuk dependency platform, runner menggunakan auth bootstrap existing dan scaffold kecil `storage.buckets`/`storage.objects` khusus test A1. Scaffold ini tidak mengubah aplikasi atau harness PM09 existing, dan tidak membuktikan authorization/behavior Supabase Storage asli.

100 assertions pgTAP legacy dijalankan pada checkpoint sebelum migration Memory transaction hardening, mengikuti pola runner disposable existing. Fixture ditahan hanya di container disposable agar suite 8B bisa digunakan kembali. Sesudah itu sisa migration lama dan A1 diterapkan tanpa rewrite source migration/test lama. Ini bukan klaim bahwa assertion legacy #65 harus lolos pada full hardened schema.

Tidak menjalankan strict schema-doc comparator PM09 yang sudah diketahui drift, tidak memperbaiki bootstrap harness lama, dan tidak mengklaim full Supabase HTTP/storage/deployment validation.

## F. Memory Isolation Evidence

Pada **setiap** `complete_job` dan `fail_job`, test memeriksa Memory job dalam lima status (`running`, `queued`, `retryable_failed`, `succeeded`, `dead`), ditambah running attempt kelima untuk memastikan generic exhaustion juga tidak boleh menyentuhnya.

Hasil seluruh kasus: `23514 / ATOMIC_MEMORY_INDEXING_REQUIRED`. Full `to_jsonb(job)` sebelum/sesudah identik: status, attempt, lease, next_run_at, error/reference dan timestamp tidak berubah. Full `to_jsonb(memory)` juga identik, termasuk embedding/index status/provenance.

Suite existing `database/v2.1/tests/memory-transactions.mjs` digunakan **tanpa perubahan** dan lulus untuk:

- Dedicated Memory claim dengan business/model/profile/version/key dan SKIP LOCKED, tanpa mengambil email atau foreign business.
- Private atomic vector+ACK primitive: vector 768 tersimpan bersama succeeded; exact replay aman.
- Invalid vector/zero/NaN, hash/profile mismatch, stale attempt/source dan concurrent invalidation ditolak.
- Forced failure saat acknowledgement dan explicit ROLLBACK tidak meninggalkan vector atau success parsial.
- Ready-vector recovery dan reclaim fencing; tidak membutuhkan embedding baru untuk recovery.
- Public dedicated failure transaction tetap memutakhirkan Memory dan job secara atomik, termasuk retry/dead.
- Public synthetic/foreign approval tetap ditolak; private helper tidak memperoleh application EXECUTE grant; vector-only legacy path tetap disabled.

**Batas bukti positif:** seperti kontrak test 8B existing, success vector/writeback memakai private primitive pada fixture yang eksplisit `synthetic=true`, `test_only=true`, `productionEligible=false`, hanya sebagai postgres pada database disposable. Tidak ada public source guard diganti, trigger dinonaktifkan, atau provenance diubah menjadi verified. Public production approval/success E2E tetap menunggu authoritative C6/C7; PASS A1 bukan klaim production RAG tersedia.

## G. Core Job Compatibility

| Skenario PostgreSQL nyata | Hasil |
|---|---|
| `send_paid_email` queued → typed claim → complete | PASS; succeeded, provider reference/timestamp benar, lease dibersihkan |
| Email failure attempt 1–4 | PASS; retryable_failed, delay 1/5/15/60 menit, finished_at NULL, safe error/reference dipertahankan |
| Email failure attempt 5 | PASS; dead, finished_at terisi, tidak diklaim ulang |
| `expire` dan `reconcile` live complete | PASS melalui typed claim existing |
| `expire` dan `reconcile` live fail | PASS; retryable_failed |
| Duplicate complete atau fail setelah complete | PASS; false/NULL tanpa perubahan row |
| Complete atau fail ulang sesudah failure | PASS; false/NULL, tidak menimpa retry/dead |
| Missing/queued job, invalid error code | PASS; missing/unclaimed aman; invalid code tetap VALIDATION_ERROR, row tidak berubah |
| Explicit rollback complete | PASS; full row kembali identik |
| Anon/authenticated invoke complete/fail | PASS; SQLSTATE 42501 permission denied, row tidak berubah |

Ini memverifikasi persistence contract job saja; tidak mengirim email atau menjalankan expiration preorder nyata. Existing `src/features/jobs/service.test.ts` juga tetap lulus dalam default unit run dengan order/repository mock.

## H. Lease & Concurrency

Fencing saat acknowledgement: job ID + attempt yang masih running + live lease menurut waktu PostgreSQL setelah row lock.

| Kasus | Bukti actual PostgreSQL |
|---|---|
| Lease sudah expired sebelum ACK, belum di-reclaim | Complete=false dan fail=NULL; full row unchanged |
| Claim ulang setelah expiry | Attempt naik menjadi 2; attempt 1 dan NULL tidak dapat complete/fail; attempt 2 dapat complete |
| Dua session, complete menang dahulu | Session kedua benar-benar teramati menunggu lock; sesudah commit hanya refusal false/NULL |
| Dua session, fail menang dahulu | Session kedua tidak mengubah retry state menjadi succeeded atau failure lain |
| Lease habis selama menunggu lock, untuk complete dan fail | Test membuktikan lease masih live sebelum operasi menunggu, mengamati lock wait, menahan lock melewati expiry, lalu memverifikasi refusal dan snapshot unchanged |
| Claim/reclaim vs late old ACK | Old worker menunggu lock dan ditolak setelah ownership transfer; current claimant tetap dapat complete |
| Unrelated job | Snapshot identik sepanjang concurrent ACK cases |

Terdapat **5 observed A1 lock races**: dua ACK contention, dua expiry-during-wait, satu reclaim-vs-old-ACK. Suite Memory existing menambah **5 observed lock races** dengan invariant-nya sendiri. Pengamatan memakai `pg_stat_activity`/wait events dan koneksi psql independen; bukan sekadar `Promise.all` yang diasumsikan bersamaan. Query concurrent diberi statement timeout 20 detik dan barrier timeout terbatas.

Tidak ada klaim exactly-once email/provider delivery; A1 menjamin penolakan mutation job oleh acknowledgement stale/Memory dalam kontrak yang diuji.

## I. Regression Results

### Actual execution

| Pemeriksaan | Hasil terbaru |
|---|---|
| `node --check database/v2.1/tests/job-acknowledgement.mjs` | PASS |
| ESLint focused test file | PASS setelah final assertion refinement |
| `node database/v2.1/tests/job-acknowledgement.mjs` | PASS, exit 0; 15 A1 groups/5 races, unchanged Memory 8B 10 groups/5 races, legacy checkpoint 100 pgTAP assertions |
| Default safe Vitest | **1.098 PASS / 66 berkas**, 0 FAIL, 0 skipped/load failure, exit 0 |
| Selected AI mock integration | **69 PASS / 7 berkas**, 0 FAIL/skipped, exit 0; run terpisah |
| `.\node_modules\.bin\next.cmd typegen` | PASS |
| `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` | PASS, exit 0, tidak ada diagnostic |
| `npm.cmd run lint` | PASS, exit 0; focused lint juga lulus setelah refinement test |
| `npm.cmd run build` | PASS, exit 0; compile, internal TypeScript dan prerender 29/29 selesai |
| Historical migrations/source fingerprints | Tetap identik; tidak ada perubahan pada 663 berkas awal |

Build menggunakan Node/Next installed baseline Stage 0, telemetry disabled dan mode production; akses dependency/font biasa diizinkan. Tidak mengganti font/config atau menggunakan mocked build result.

Default unit memakai include existing `src/**/*.test.ts` dan `tests/unit/**/*.test.{ts,tsx}`. Eksekusi menggunakan installed Vitest entry dengan reporter JSON. Subprocess test memakai environment OS minimal, home-directory tersedia, `NODE_ENV=test`, smoke flags disabled, tanpa credential ambient; `EVALUATION_PERF_REPORT`/`GEMINI_TRANSPORT_REPORT` tidak disetel. Tidak menjalankan seluruh `tests/supabase` atau integration glob yang bisa mengubah stack persisten.

Selected mock run menggunakan installed `startVitest` dengan allowlist tujuh path, tanpa perubahan config:

| Selected file di `tests/integration/` | PASS |
|---|---:|
| `blueprint-manual-edit.test.ts` | 16 |
| `blueprint-provider-provenance.test.ts` | 3 |
| `duplicate-inference.test.ts` | 11 |
| `evaluation-provider-validation.test.ts` | 12 |
| `generation-quota-blocker.test.ts` | 3 |
| `memory-generation-claims.test.ts` | 21 |
| `remaining-ai-contracts.test.ts` | 3 |

F04 narrative safety, F05 duplicate claims/checkpoints, F06 quota/admission, F07 manual Blueprint dan synthetic Memory protections tetap lulus pada scope unit/mock existing. Atomic SQL Memory dipisahkan dari mock evidence pada §F/H. Suite PostgreSQL F05/F06 yang terikat container persisten lama tidak dijalankan; semua fungsi claim/admission tersebut tetap identik pada catalog comparison A1.

Run PostgreSQL pertama lulus. Setelah menambah assertion Memory-at-exhaustion dan live-before-wait, run final lengkap kembali lulus; hasil dua run tidak dijumlahkan untuk membesar-besarkan coverage.

## J. Safety

Perubahan repository tugas ini terbatas pada tiga berkas baru:

1. `supabase/migrations/20261107090000_generic_job_acknowledgement_guards.sql` — dua RPC acknowledgement.
2. `database/v2.1/tests/job-acknowledgement.mjs` — regression/disposable PostgreSQL runner; reuse suite Memory existing.
3. Laporan QA ini.

Tidak ada application source, caller, generated database types, config, manifest/lockfile, `.env.local`, schema documentation, handoff, migration/test historis atau laporan terdahulu yang diubah. Dua laporan untracked sebelumnya dipertahankan. Generated `.next` dari pemeriksaan tetap disposable sebagaimana Stage 0.

Database target persisten/remote tidak dihubungi oleh runner; tidak ada migration up/push/reset/repair, SQL pada historical records, atau worker aplikasi. Tidak membuat commit, push, merge, rebase, reset Git, atau deploy. Tidak ada Gemini/embedding, Midtrans/webhook, pembayaran, atau email nyata. Vektor dalam test adalah array sintetis lokal.

Test cleanup hanya menghentikan container baru dengan ID dan label milik run; tidak menghapus volume/container lain atau melakukan unbounded deletion job. Fixture retirement menggunakan ID row yang dibuat test sendiri. Tidak ada secret yang dicetak, ditulis ke laporan/source atau di-stage.

### Acceptance criteria Batch A1

| Kriteria | Verdict | Bukti |
|---|---|---|
| Actual generic ACK diidentifikasi | PASS | Inventory dan unsafe behavior direproduksi sebelum migration |
| Generic complete/fail menolak Memory | PASS | Dua RPC, lima status dan exhaustion attempt; 23514 |
| Rejection tidak mengubah job/Memory | PASS | Full row snapshots identik |
| Dedicated Memory atomic indexing tetap | PASS pada kontrak primitive/public failure dan guard existing | Unchanged suite 8B real SQL; public verified success E2E tetap di luar kapabilitas C6/C7 sekarang |
| Lease/attempt menolak stale ACK | PASS | Expired-before-reclaim, NULL/old attempt, expiry-during-wait dan transfer races |
| Email/expiration compatibility | PASS | Actual claim/complete/fail/retry/dead SQL, tanpa operasi eksternal |
| Authorization | PASS | ACL/owner/search_path identik; anon/authenticated actual denial; Memory tenant negatives tetap |
| Concurrent ACK konsisten | PASS | Observed lock barriers; satu effective transition dan unrelated row unchanged |
| Satu forward-only migration, historis utuh | PASS | Hanya dua body replacement; semua berkas awal identik |
| Actual PostgreSQL disposable | PASS | Fresh isolated target + preflight + cleanup, final exit 0 |
| F04/F05/F06/F07/Memory regression | PASS pada scope test yang disebut | 1.098 default dan 69 selected mock; Memory real SQL dipisahkan |
| TypeScript/ESLint/build | PASS | Command exit 0 |
| Safety operasi | PASS | Tidak ada persistent/remote mutation atau provider/Git/cloud actions |

## K. Remaining Gaps

- **PM07:** resolved dalam migration source dan verified disposable PostgreSQL. Database aplikasi yang persisten belum menerima patch; penerapannya membutuhkan izin/tugas terpisah.
- **PM06:** belum diperbaiki. Legacy `claim_jobs` tetap global dan typed generic claim masih dapat diminta mengambil Memory. A1 memblokir acknowledgement Memory, bukan mengklaim seluruh queue telah terisolasi.
- **PM05:** canonical publication/pickup snapshot dan perbedaan writer tetap untuk batch berikutnya. Tidak mengubah publish_preorder atau payment/checkout/offer.
- **PM08:** generated database types masih perlu rekonsiliasi terpisah terhadap chain integrasi; A1 tidak mengubah signature sehingga tidak mengarang/mengedit generated types.
- **PM09/PM13:** harness full lama dan schema-doc drift belum diperbaiki. Scaffold A1 hanya memungkinkan focused real SQL validation; bukan perbaikan umum Supabase/Storage harness.
- **C1/C8/C6/C7 dan produk:** verified metrics/source authority, production Memory loop dan integrasi UI tetap dependency lama. Lower-layer synthetic test tidak membuat Memory production-eligible.

## L. Final Verdict

**Ya: PM07 telah diperbaiki secara memadai pada source dan diverifikasi dengan PostgreSQL nyata. Generic complete/fail tidak dapat melewati kontrak atomic indexing Business Memory, dan legitimate core jobs tetap kompatibel dalam skenario yang diuji.**

Perubahan hanya dua RPC dalam satu migration baru. Penerapan pada existing persistent local/remote DB belum dilakukan dan tidak tersirat dari PASS ini. Batch A2/PM06 tidak dimulai otomatis.

Tidak diperiksa: full Supabase HTTP/Storage integration, browser E2E, provider nyata dan rollout database aplikasi. Risiko tersisa adalah deployment patch yang belum diotorisasi serta PM06/PM05 dan kontrak integrasi lain yang belum diselesaikan.
