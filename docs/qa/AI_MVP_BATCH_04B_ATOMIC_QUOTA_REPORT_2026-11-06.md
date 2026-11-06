# Campaign Lab — Batch 04B: Atomic AI Generation Admission

Tanggal: 6 November 2026. Scope: F06 provider-backed text generation pada Strategist, Blueprint, Evaluation, dan Business Memory. Migration ini diterapkan **hanya pada Supabase lokal** berdasarkan otorisasi Batch 04B. Tidak ada panggilan Gemini atau embedding nyata.

## A. Executive Summary

**Overall: PARTIAL untuk readiness internal AI MVP; implementasi F06 dan verifikasi transaksi lokal selesai.** Dua acceptance F06 yang sebelumnya merah kini lulus tanpa mengubah batas 6. Namun `.env.local` saat ini tidak memiliki `RATE_LIMIT_HMAC_KEY`, sehingga fresh generation di runtime lokal gagal tertutup sampai operator memasangnya. Authenticated HTTP E2E yang aman juga belum tersedia: route development memakai sumber demo historis, sedangkan tes wajib tidak boleh memutasi histori. Tidak ada klaim kesiapan produksi atau kualitas model nyata.

## B. Root Cause

`take_rate_limit` atomik untuk **satu** bucket, tetapi setiap panggilan menaikkan counter, termasuk denial. Panggilan terpisah untuk claim → minute → hour → day tidak berada dalam satu transaksi HTTP/PostgREST; hour/day denial dapat meninggalkan claim dan bucket sebelumnya terpakai. Replay/ACK hilang juga bisa double-charge. Batch 04 membuktikan ini dengan PostgreSQL aktual; pendekatan tersebut tidak dipasang.

## C. Database Migration

- File: [`20261106100000_atomic_ai_generation_admission.sql`](../../supabase/migrations/20261106100000_atomic_ai_generation_admission.sql). Satu fungsi `public.admit_ai_generation(uuid,uuid,uuid,text,text,text,text,uuid,uuid,integer,text,text,text,text,text,integer) → jsonb` dan REVOKE/GRANT khusus fungsi itu; tanpa tabel, kolom, constraint, index, trigger, RLS, atau migration lama yang diubah.
- Preflight: repository/config `campaign-lab`, Docker Desktop named pipe lokal, container `supabase_db_campaign-lab`, label project/workdir cocok, database `postgres` PostgreSQL 17.11. Delapan migration lama cocok dengan file lokal; hanya migration `20261106100000` pending. `supabase migration up --local` menerapkan tepat satu migration; daftar sesudahnya berisi sembilan.
- Sebelum/sesudah: definisi `claim_ai_generation` MD5 `a5cb2447a834b3d58907be6a4d0d2bbd`; `take_rate_limit` MD5 `8484ad66ff38dd39645ba451807809c3`, keduanya tidak berubah. Constraint/RLS existing tetap; `ai_generations` owner SELECT policy dan `rate_limit_buckets` tanpa policy client tetap. EXECUTE RPC baru: anon=false, authenticated=false, service_role=true; role client diuji langsung dan menerima 42501.
- RPC memeriksa `auth.role()='service_role'`, `private.require_owner(businessId,actorUserId)`, parameter, dan mengunci business row. Jam PostgreSQL sesudah lock menentukan fixed minute/hour UTC dan hari Asia/Jakarta. Subtransaksi memanggil `claim_ai_generation` existing untuk Strategist atau memasukkan claim sessionless, kemudian `take_rate_limit` tiga kali. Bila salah satu false, exception internal terpilih membatalkan **seluruh** claim, pesan, kenaikan version, dan ketiga counter; handler hanya mengembalikan `denied`, jenis window, dan integer `retryAfter`. Exception lain tidak ditelan.

## D. Claim + Quota Architecture

Owner diambil dari authenticated server boundary dan diperiksa ulang oleh RPC. Tiga key HMAC berasal dari [`generation-quota-policy.server.ts`](../../src/lib/ai/generation-quota-policy.server.ts) dengan namespace bisnis yang sama untuk seluruh modul; secret tidak dikirim ke SQL atau respons. SQL menerima cap 6/menit, 30/jam, dan daily 100 default atau positive integer terkonfigurasi. Application clock hanya menghitung hash yang tidak bergantung waktu; bucket window/retry memakai PostgreSQL.

Strategist existing turn RPC tetap memvalidasi session/version/context, dedupe, dan pesan. Blueprint/Evaluation memakai request UUID; Memory memakai `memory:<evaluationId>:<sourceVersion>`. Existing compatible claim dibaca sebelum config/charge; `claimed` dengan ACK pemanggil sendiri saja mengizinkan inference. `running`, terminal, checkpoint dan alias adalah readback tanpa charge. Hilangnya ACK setelah commit mempertahankan allowance dan tidak memulai provider. Provider failure, invalid output, atau stale source setelah admission tidak mendapat refund. Transaction SQL berakhir sebelum provider dipanggil.

Blueprint AI create/replan menjalankan source/offer/financial preflight sebelum admission, lalu memvalidasi lagi pada jalur generate dan sebelum persist. Manual edit tetap di cabang tanpa provider/claim/quota. Evaluation denial berada sebelum interpretation dan tidak menjadi failed Gemini Evaluation. Memory canonical alias, provenance sintetis, approval guard, dan zero embedding job tetap.

## E. Per-module Status

| Modul | Admission | Replay/no-charge | Concurrent safety | Hasil |
|---|---|---|---|---|
| Strategist | New turn via RPC pembungkus existing claim | Existing turn via claim RPC | Business lock + existing session lock | Wired; PostgreSQL positive/denial PASS |
| Blueprint create/replan | Preflight → shared claim helper → RPC | Checkpoint/readback | Business lock + unique key | Wired; mocked regression PASS |
| Evaluation | Shared claim helper sebelum interpretation | Existing result/checkpoint | Business lock + unique key | Wired; mocked regression PASS |
| Business Memory | Canonical shared claim helper | Alias/checkpoint/result | Business lock + unique key | Wired; mock + PG PASS |
| Manual Blueprint edit | Exempt | Exempt | Existing CAS | F07 regression PASS |

Promotion Simulator, execution checklist, Evaluation review/finalization, Memory review/rejection, dan ordinary readback tidak memanggil admission. Tidak ada perubahan pada provider, embedding, pembayaran, atau KPI producer.

## F. Quota Verification

| Kasus | Hasil aktual |
|---|---|
| 6/minute, ketujuh distinct | Acceptance mock: 6 provider calls, 1 error 429, 6 rows, tiga counter masing-masing 6. PostgreSQL: enam claim commit, ketujuh `denied`, no claim, bucket 6/6/6. |
| 30/hour | Policy unit 30; PostgreSQL hour bucket yang sudah mencapai 30 menolak admission baru dan membatalkan minute/claim. Primitive hour boundary/reset diuji pada Batch 04. |
| Daily cap/WIB | Default 100 dan malformed config diuji unit; PostgreSQL cap 1 menolak admission kedua tanpa partial charge. Ekspresi PostgreSQL memetakan 16:59:59Z→hari lama dan 17:00:00Z→hari baru. |
| Cross-module/cross-business | Enam claim nyata bergantian Blueprint/Evaluation/Memory berbagi tiga bucket; bisnis lain memakai namespace independen. Strategist turn nyata memakai kontrak bucket yang sama. |
| Concurrency | Dua connection meminta allowance ke-6: satu `claimed`, satu `denied`; bucket 6, satu claim. Dua request key sama: satu `claimed`, satu `running`, bucket 1. |
| Replay/Memory alias | Canonical Memory alias + replay tetap 1 provider call, tiga bucket masing-masing 1; PostgreSQL same-key readback tidak menaikkan bucket. |
| Rollback | Hour/day denial meninggalkan counter sebelumnya utuh dan no claim; Strategist denial meninggalkan session version 1, 0 user message, 0 claim. |
| ACK hilang | Real PostgreSQL admission commit tetap 1 allowance; mocked provider 0 panggilan; readback mengembalikan in-progress. |

Fixed windows bisa mengizinkan burst dekat pergantian window. Reset hour/day untuk *admission* belum diuji dengan menunggu jam/hari nyata; policy dan ekspresi SQL diverifikasi secara terpisah. Itu batas bukti, bukan perubahan perilaku yang disembunyikan.

## G. PostgreSQL Evidence

`AI_ADMISSION_POSTGRES=1 vitest run tests/integration/atomic-generation-admission-postgres.test.ts`: **9 PASS**, 11.00s pada final run. `MEMORY_CLAIM_POSTGRES=1 ...memory-claims-postgres.test.ts`: **10 PASS**, 12.38s pada rerun terakhir. Seluruh fixture membuat owner/business/preorder UUID baru dan hash HMAC sementara; snapshot sebelum/sesudah fixture final identik (`preserved=true`). Run admission final `7d669786-da9a-49f8-8ff4-391201547f09`; F05 run terakhir `ce005dae-052c-4325-a59c-c25ad5156945`. Manifest ada di `node_modules/.cache/batch03b-memory-claims/`; ringkasan yang dapat ditinjau ada di [evidence JSON](evidence/AI_MVP_BATCH_04B_ATOMIC_QUOTA_2026-11-06.json).

Satu intermediate admission run `3268557d-1ffb-469a-a9c9-46b5ce3ddbf9` meluluskan 9 tes tetapi cleanup awal gagal 23514 karena trigger pesan append-only. Task-owned row diidentifikasi melalui marker owner/business dan bucket transaction IDs; scoped cleanup SQL `node_modules/.cache/batch04b-cleanup-3268557d.sql` memakai session-local trigger bypass **hanya saat menghapus satu pesan fixture**, lalu menyalakan kembali trigger sebelum penghapusan lain. Cleanup berhasil; manifest menyimpan kegagalan awal dan `recoveredCleanup`, tidak disamarkan sebagai run PASS. Final rerun cleanup otomatis lulus.

Snapshot histori sebelum/sesudah: businesses 2/digest `023a9bf2e2fce9e026b1c5f372772d41`; campaigns 3/`9f748a064cd7d5db3dd5d971f6de3f7e`; generations 10/`0337fa2cdb2d62d32f0e27ca29b3a580`; Evaluations 6/`196f27f36b413830938b6ae4be11bf02`; Memories 1/`52a5dfab22db1f1be936aa5568e6e145`; quota buckets 0/empty MD5 `d41d8cd98f00b204e9800998ecf8427e`. Sessions kembali 3, messages 13. Tidak ada histori yang ditulis ulang.

## H. HTTP Evidence

Mocked boundary test memverifikasi Strategist admission denial menghasilkan HTTP **429** `AI_RATE_LIMIT_EXCEEDED`, `Retry-After: 12`, dan `Cache-Control: no-store`. Kode route Blueprint/Evaluation/Memory meneruskan metadata sama. Existing 409 in-progress tetap melalui F05 suite. **Actual authenticated HTTP E2E tidak dieksekusi**: `.env.local` tidak mempunyai HMAC key dan seeded development context hanya berlaku untuk bisnis demo historis; menjalankan generation terhadapnya akan memutasi histori. Ini bukan bukti real HTTP route.

## I. Regression Results

| Pemeriksaan | Hasil final |
|---|---|
| Dua acceptance F06 sebelumnya merah | **2 PASS**, expected 6 tidak diubah |
| Safe unit + mocked integration + loopback | **780 PASS, 1 SKIP**, 40 files PASS, 45.23s; skip Google metadata yang sengaja nonaktif |
| Actual PostgreSQL admission | **9 PASS** |
| Actual PostgreSQL F05 | **10 PASS** |
| Combined completed tests | **799 PASS, 1 SKIP**, tidak menghitung intermediate cleanup failure sebagai final pass |
| `tsc --noEmit --incremental false` | PASS |
| `npm.cmd run lint` | PASS |
| `npm.cmd run build` | PASS, 13 pages generated |
| `node scripts/validate-bruno-collection.mjs` | PASS, 141 HTTP definitions; request tidak dieksekusi |

Bruno tetap mengeluarkan diagnostik Windows Crashpad `CreateFile: Access is denied`, tetapi validator exit 0. Safe suite mencakup F04 narrative, F05 claim/recovery, F07 exact manual edit, finance/simulator, source CAS, dan synthetic Memory approval guard.

## J. Safety

Real Gemini calls 0; embedding calls 0; remote DB changes 0; billing/model/retry changes 0; `.env.local` tidak diubah atau dicetak. Tidak ada migration remote, reset, commit, push, atau deploy. Satu migration additive lokal sesuai otorisasi; applied historical migrations, constraints, RLS, dan existing RPC definitions tidak diubah. Task-owned fixture dibersihkan dengan bukti snapshot.

## K. Remaining Gaps / Final Verdict

1. Operator perlu menetapkan **`RATE_LIMIT_HMAC_KEY` acak yang kuat, minimal 32 karakter** di environment server lokal; `.env.example` kini mencantumkan nama variabel dengan nilai kosong yang aman dan `.gitignore` hanya mengecualikan contoh itu dari pola `.env*`. `.env.local` tetap ignored. `AI_DAILY_GENERATION_LIMIT` opsional, default 100, atau positive integer ≤ 2,147,483,647. Jangan gunakan nilai test atau rotasi secret tanpa rencana karena namespace counter akan berubah. Sampai saat itu fresh generation mengembalikan 503 `AI_QUOTA_CONFIGURATION_REQUIRED`, replay tetap tersedia.
2. Authenticated HTTP E2E dengan business fixture terisolasi belum tersedia karena development context dibatasi ke demo historis. HTTP 429/409/foreign-owner/replay dinilai dari code path dan mocked/PG tests, bukan actual HTTP request.
3. Hour/day rollover nyata pada admission tidak ditunggu; boundary dihitung dan diuji melalui policy unit, primitive PostgreSQL Batch 04, serta ekspresi SQL PostgreSQL.

**Jawaban:** admission F06 sudah diimplementasikan dan terbukti atomik pada PostgreSQL lokal tanpa merusak regresi F04/F05/F07. Campaign Lab internal AI MVP saat ini **belum dapat dinyatakan siap penuh** sampai konfigurasi secret server dan bukti HTTP terisolasi tersedia.
