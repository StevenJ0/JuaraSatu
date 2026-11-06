# Local Supabase v2.1 — cutover dan verification

Tanggal: 3 November 2026 (Asia/Jakarta). **Cutover lokal selesai.** Database aktif telah diperiksa melalui PostgreSQL, GoTrue dan PostgREST; bukan hanya container PostgreSQL disposable. Stage 4B aplikasi belum dibuat.

## Environment dan migration

| Item | Hasil aktual |
|---|---|
| Workspace / CLI project | `D:/Project/campaign-lab`, project ID `campaign-lab` |
| Supabase CLI | 2.122.0; tidak di-upgrade |
| PostgreSQL | 17.11 |
| Database container / volume | `supabase_db_campaign-lab` / `supabase_db_campaign-lab` |
| API / database / Studio / mail | 54321 / 54322 / 54323 / 54324 |
| API lokal | `http://127.0.0.1:54321` |
| Remote CLI link | Marker project-ref tidak ada; tidak menghubungi remote |
| Riwayat aktif | `20261103000000`, name `initial_v21` |
| Chain lama | `20261030210000` + `20261030225000`, sekarang arsip di `database/legacy/migrations/` |

Root config, project ID, dan seluruh port dipertahankan. Root migrations hanya berisi satu initial v2.1, dengan hash sama seperti snapshot baseline yang direview. Root seed adalah salinan seed sintetis yang tervalidasi. Snapshot review `database/v2.1/supabase/` dipertahankan sebagai bukti historis; perubahan schema berikutnya harus menggunakan migration baru pada root, bukan mengedit snapshot atau initial yang telah diterapkan.

Saat audit, `.env.local` semula menunjuk remote. Setelah backup, URL dan publishable/service-role key lokal diselaraskan menggunakan status CLI yang dibaca privat. Alias publishable lama juga diarahkan ke lokal; variabel Gemini dipertahankan. Tidak ada secret dicetak atau ditulis ke source. `.env.example` hanya placeholder dengan nama service role server-only. **Belum ada Supabase application client/repository di Next.js**; environment telah lokal, tetapi UI belum otomatis memiliki persistence.

## Data safety dan backup

Sebelum reset pertama, semua 19 tabel aplikasi, `auth.users`, `storage.objects` dan `storage.buckets` berjumlah nol. Label container menunjuk workspace Campaign Lab dan volume yang tepat. Backup custom-format dibuat dan berhasil dibaca dengan `pg_restore --list`; config serta environment asli ikut disimpan.

Reset kedua dipakai untuk membuktikan reproduksi fresh setup/full-stack suite. Safety gate diperiksa ulang: hanya dua akun/bisnis demo dan discussion fixture sintetis buatan task, tanpa order, payment, blueprint, evaluation, memory atau storage milik pengguna. Backup baru dibuat dan dibaca sebelum reset tersebut. Tidak ada data pengguna yang dihapus. Kedua reset memakai **`db reset --local`**, tidak memakai linked/db-url/remote flags.

Backup berada di cache yang diabaikan Git, di luar direktori yang di-reset:

- `node_modules/.cache/database-v21-cutover/pre-cutover/`: `database.dump`, checksum, config dan environment asli.
- `node_modules/.cache/database-v21-cutover/pre-replay/database.dump`: fixture sebelum fresh replay.

Backup bukan arsip Git dan dapat memuat credential konfigurasi; jangan dibagikan/di-commit. Tidak dilakukan restore ke database aktif karena itu akan menimpa v2.1; readability diperiksa melalui TOC, bukan klaim restore drill penuh.

Project lain terdeteksi melalui container/volume Docker yang berbeda, termasuk Chatbot dan top-k. Tidak ada command stop/reset/update terhadap resource project lain. Container `supabase_vector_campaign-lab` (log collector, bukan pgvector) sudah restart-loop saat inspeksi awal; issue logging ini tidak diperbaiki karena di luar scope. Auth, PostgREST, PostgreSQL, Studio dan API tetap diuji.

## Full catalog comparison

`tests/catalog.sql` dipakai pada database fresh disposable dan database Supabase aktif. Hasil: **864 MATCH, 0 MISSING/EXTRA/MISMATCH terhadap DDL baseline**. Perbandingan mencakup 26 tabel/RLS/table privileges, 351 kolom beserta formatted types/defaults/nullability, 288 constraint, 100 index, 25 policy, 34 trigger, 38 fungsi beserta signature/body/EXECUTE privileges, serta dua extension wajib.

Pemeriksaan terpisah `tests/schema-contract.mjs` membaca tabel Markdown `docs/schema.md` terkini: seluruh 351 nama/tipe/nullability, default yang dinyatakan, dan UUID PK default cocok. Draft slug tetap nullable; interpretasinya di bawah. Kesamaan katalog terhadap baseline tidak berarti semua workflow aplikasi atau seluruh aturan naratif PRD telah selesai.

Extension:

- **MATCH:** `vector 0.8.2` pada schema `extensions`, kolom `campaign_memories.embedding` tepat `vector(768)`; `plpgsql 1.0`.
- **INTENTIONALLY DIFFERENT:** extension bawaan Supabase `pgcrypto 1.3`, `uuid-ossp 1.1`, `supabase_vault 0.3.1`, `pg_stat_statements 1.11`.
- **INTENTIONALLY DIFFERENT:** `pgtap 1.3.3` untuk test lokal; tidak termasuk initial aplikasi.

Katalog aktual, perbandingan per objek, dan perbandingan kolom tersedia di ignored cache `actual-catalog.json`, `schema-diff.json`, dan `documented-columns.json`. Matriks semua tabel ada di bagian akhir laporan ini.

## Kontrak yang belum sepenuhnya selesai

| Klasifikasi | Objek / aturan | Penjelasan |
|---|---|---|
| MISSING | `create_preorder_order`, `create_manual_order`, `claim_payment_attempt`, `expire_or_cancel_order`, `advance_fulfillment`, `accept_late_payment`, `read_metrics_snapshot` | Operasi target schema §19 masih kontrak handoff. Tidak ditambahkan sebagai desain baru pada cutover ini. |
| MISSING | Transition service untuk `completed` campaign / preorder dan lifecycle lintas order | Status enum tersedia; RPC yang diuji adalah publish/close dan blueprint approval. Belum mengklaim seluruh transition aplikasi selesai; privileged direct DML tetap memerlukan aturan service. |
| MISMATCH | Narasi schema §3.7 menyebut payment events append-only | Baseline melarang DELETE, tetapi `apply_verified_payment` meng-update `processed_at/outcome` row event yang sama. §10.2 juga menyediakan field processing tersebut. Konflik narasi-versus-lifecycle perlu review tersendiri; tidak diam-diam mengubah SQL atau schema pada cutover. Tidak memblokir AI discussion. |
| INTENTIONALLY DIFFERENT | Kapasitas per business/product/date | Mengikuti schema §5.2/§24.1. PRD §11.2 masih menyebut unique business/date; pembatasan tersebut diterapkan pada **published preorder**, bukan capacity row. |
| INTENTIONALLY DIFFERENT | Nullable/default implisit dan slug draft | `NULLABLE` eksplisit dipertahankan, field tanpa penanda nullable diperlakukan required, kecuali slug preorder/campaign yang hanya ditulis UNIQUE. Slug published wajib. Ambiguitas dokumentasi tetap dicatat, bukan diubah. |
| INTENTIONALLY DIFFERENT | `campaign_contents.campaign_task_id` legacy | Tidak ada pada target; relasi memakai campaign/blueprint/key. |
| INTENTIONALLY DIFFERENT | Error stale-write pada direct PostgREST | SQLSTATE 40001 + `VERSION_CONFLICT` terbukti ditolak, tetapi PostgREST mengirim HTTP 500. Handler aplikasi nanti harus memetakan conflict ke HTTP 409; belum ada handler tersebut. |
| INTENTIONALLY DIFFERENT | Profil embedding, task channel, manual payment state | Allowlist baseline dipertahankan. Model/profile produksi dan final `external_payment_status` belum disepakati; query baseline mengenali `confirmed`. Ini bukan klaim readiness checkout/RAG produksi. |

C6 metrics snapshot, recovery generation yang process-nya mati setelah claim, memory canonical version/stale propagation, dan distribusi raw private tracking token email tetap pekerjaan integrasi. Privileged service role bisa melewati RLS dan mempunyai INSERT/UPDATE; jangan memperlakukan direct DML sebagai pengganti RPC bisnis yang benar.

## Auth, PostgREST, RLS dan RPC

Pengujian `test-supabase-v21.mjs` memakai dua akun GoTrue nyata yang dibuat melalui Admin Auth API lokal, lalu login password menghasilkan JWT lokal. Tidak memakai bootstrap auth stand-in pada database aktif.

- Owner A hanya membaca bisnisnya; Owner B tidak membaca session/message A.
- Anonymous tidak membaca campaign privat; authenticated direct update ditolak.
- Create session owner, binding business/preorder, claim idempotent, expected-version dan reload history diuji melalui PostgREST.
- Finalize ditolak untuk owner JWT, berhasil untuk service-role JWT setelah validasi scope, dan replay tidak menambah assistant dua kali.
- Fail generation mencatat failure tanpa assistant success tambahan.
- RPC memory tenant lain dan payment application oleh owner ditolak.

SQL suite menjalankan **100 assertion pada PostgreSQL Supabase aktual** dan melakukan ROLLBACK data pengujian. Cakupan termasuk frozen price, tenant FK, rollback approval/materialization, duplicate publication, unknown/missing ledger, invalid finalization rollback, unapproved memory exclusion, vector768/model/profile, payment replay/unverified pending attempt, serta worker fence.

Satu integration test Vitest tambahan memuat proposal aktif langsung dari database dan memvalidasinya dengan `StrategyProposalSchema` aplikasi yang sudah ada. Fixture sukses terbaru berbentuk lengkap `no_valid_options`, berlabel sintetis. Session dari pengujian boundary SQL awal yang hanya memakai envelope minimum ditutup, tanpa menghapus histori; tidak dijadikan contoh proposal aplikasi yang tervalidasi.

Tiga race memakai koneksi PostgreSQL berbeda pada database aktif: hanya satu reservasi memperoleh slot terakhir, claim AI duplikat membuat satu user message/generation, dan dua worker memperoleh job berbeda. History sintetis dipertahankan; hold test dilepas, order test dibatalkan, generation test ditandai failed, dan job test diselesaikan. Tidak ada provider call.

## Seed dan tipe aplikasi

Seed SQL tidak menulis langsung `auth.users`. Pada database fresh, seed CLI memberi NOTICE/skip bila subject belum tersedia; script setup lokal membuat dua subject via GoTrue, lalu menjalankan seed. Ini setup dua tahap yang eksplisit, bukan klaim seed pertama telah mengisi data ketika prerequisite Auth belum ada.

Subject sintetis tetap UUID `11111111-1111-4111-8111-111111111111` dan `22222222-2222-4222-8222-222222222222`; email memakai domain `campaign-lab.example.test`. Password acak hanya disimpan dalam ignored `fixture-credentials.json` agar suite dapat login ulang; tidak dicetak. Setup menolak menimpa akun dengan email yang tidak dikenal.

Dua preorder diterbitkan melalui owner RPC: harga frozen Rp120.000, target/quota/capacity 40, belum ada paid sale. Campaign tetap draft. Fixture tambahan hasil concurrency jelas sintetis/cancelled; tidak ada fake Midtrans success yang dipersist sebagai payment nyata. Chat fixture berlabel synthetic dan tidak berasal dari Gemini.

Types kanonis: `src/lib/supabase/database.types.ts`, dihasilkan oleh CLI dari database aktif. `database/v2.1/database.types.ts` hanya compatibility re-export. Tidak menambahkan application Supabase dependency/client pada task ini dan tidak mengubah kontrak C1/C2/C6/C8.

Semua Row/Insert/Update dan RPC Args/Returns cocok secara structural TypeScript dua arah dengan hasil disposable. Perbedaan snapshot lama adalah formatting dan metadata relasi `isOneToOne` yang ditambahkan generator CLI berdasarkan unique constraints. JSON/status/bigint/vector generated types tetap memerlukan runtime validation, safe-integer checking, dan narrowing pada adapter aplikasi.

## Reproduksi tanpa reset otomatis

Jalankan dari root dengan Docker/stack `campaign-lab` aktif. Tidak ada script di bawah yang menjalankan reset:

```powershell
node scripts/test-database-v21.mjs
# Untuk database lokal yang baru di-reset secara sadar dan sudah melewati data-safety gate:
node scripts/test-supabase-v21.mjs --setup-fixtures --pg-tests --write-types
# Untuk mengulang JWT/catalog/type checks pada fixture yang sudah tersedia:
node scripts/test-supabase-v21.mjs
npm.cmd run test:unit
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd run build
npx.cmd vitest run tests/integration/supabase-proposals.test.ts
npx.cmd supabase migration list --local
```

`--pg-tests` menolak fixture yang sudah published/berversi lanjut; test tidak menghapus atau mereset data agar lolos. `--setup-fixtures` hanya memperbarui akun sintetis yang telah dikenali dan environment lokal. Tiga concurrency tests disediakan bersama di `tests/concurrency.mjs` dan dipakai kedua runner. Harness disposable tetap memakai auth stand-in dan database terpisah; real stack memakai auth Supabase asli.

Hasil command aktual:

| Command / pemeriksaan | Hasil |
|---|---|
| `supabase db reset --local --yes` pada workspace yang diverifikasi | Dua fresh application berhasil; safety gate + backup dilakukan sebelum masing-masing |
| `node scripts/test-database-v21.mjs` | Fresh migration/seed, 100 pgTAP, 3 concurrency, arsip legacy terpisah, direct schema checks dan type generation lulus |
| `node scripts/test-supabase-v21.mjs --setup-fixtures --pg-tests --write-types` | Setup GoTrue/seed, 100 pgTAP + 3 race pada Supabase aktif, JWT/RPC/catalog/type checks lulus |
| `node scripts/test-supabase-v21.mjs` setelah setup | 14 kelompok pemeriksaan ulang lulus; termasuk 351 kolom langsung terhadap Markdown dan 864 catalog matches |
| `npx.cmd vitest run tests/integration/supabase-proposals.test.ts` | 1 test runtime proposal database lulus |
| `npm.cmd run test:unit` | 247 test / 7 file lulus |
| `npm.cmd run lint` | Lulus |
| `npx.cmd tsc --noEmit` | Lulus |
| `npm.cmd run build` | Lulus |
| `npx.cmd supabase migration list --local` | Hanya `20261103000000`, cocok dengan history database lokal |

## File yang berubah pada cutover

| Tindakan | File |
|---|---|
| Dipindahkan, isi/hash tetap | Dua SQL `20261030210000_initial_schema.sql` dan `20261030225000_add_campaign_memory_and_calendar_contents.sql`: `supabase/migrations/` → `database/legacy/migrations/` |
| Ditambahkan dari snapshot baseline, tanpa redesign | `supabase/migrations/20261103000000_initial_v21.sql`, `supabase/seed.sql` |
| Ditambahkan | `database/legacy/README.md`, `database/v2.1/LOCAL_VERIFICATION.md` |
| Ditambahkan untuk audit/reuse test | `database/v2.1/tests/catalog.sql`, `schema-contract.mjs`, `concurrency.mjs` |
| Ditambahkan untuk real stack | `scripts/test-supabase-v21.mjs`, `tests/integration/supabase-proposals.test.ts` |
| Disesuaikan | `scripts/test-database-v21.mjs` memakai migration/seed root, arsip legacy dan helper bersama; `database/v2.1/tests/invariants.sql` bertambah empat assertion tanpa menghapus test lama |
| Generated / compatibility | `src/lib/supabase/database.types.ts` baru; `database/v2.1/database.types.ts` menjadi re-export |
| Handoff diperbarui | `database/v2.1/README.md`, `database/v2.1/COVERAGE.md` diberi penunjuk ke laporan aktif |
| Diubah secara lokal, diabaikan Git | `.env.local` dan placeholder `.env.example`; backup, akun fixture dan hasil verifikasi di `node_modules/.cache/database-v21-cutover/` |

Root `supabase/config.toml`, `docs/schema.md`, PRD, package/lockfile, dan module source C1/C2/C6/C8 tidak diubah oleh cutover. Perubahan working tree yang sudah ada sebelum task tetap dipertahankan.

## Stage 4B readiness dan handoff

| Komponen | Status | Bukti / pekerjaan berikutnya |
|---|---|---|
| Owner auth + tenant/business/preorder scope | DATABASE READY | GoTrue/JWT/PostgREST dan negative tests lulus |
| Session, user/assistant messages, sequence, generation claim/finalize/fail | DATABASE READY | SQL dan HTTP RPC nyata lulus |
| CAS/idempotency/replay/tenant isolation | DATABASE READY | Stale conflict ditolak; tiga race PostgreSQL lulus |
| Durable history setelah request baru/login | DATABASE READY | Independent read mengembalikan row committed |
| Browser refresh persistence | APPLICATION INTEGRATION PENDING | Belum ada repository nyata/UI persistence/session wiring |
| Fake Gemini provider development pada Stage 4B | APPLICATION INTEGRATION PENDING | Tidak dibuat pada task cutover |
| C1/C6/C8 read adapters dan mapping error | APPLICATION INTEGRATION PENDING | Kontrak publik dipertahankan; runtime validation dan mapping 40001→409 diperlukan |
| Checkout/payment/complete lifecycle/RAG workers | BLOCKED untuk klaim end-to-end modul tersebut | Operasi/kontrak yang belum selesai dicatat di atas; tidak diperlukan untuk memulai discussion development yang terisolasi |

Rafi memakai membership/Auth lokal dan kontrak preorder-first; jangan mengasumsikan checkout/fulfillment RPC sudah tersedia. Steven dapat memulai Stage 4B dev Fake provider setelah review, memakai RPC atomik dan generated types kanonis. Indro harus menyelesaikan payment attempt, provider verification, jobs/email, metrics snapshot dan mapping state; SQL payment application hanya menerima fakta yang telah diverifikasi server.

Rekomendasi: aman memulai Stage 4B development dengan batas integrasi tersebut. Belum production-ready, belum ada browser E2E, dan tidak boleh menerapkan fresh baseline ini ke remote/DB legacy berisi data sebagai upgrade otomatis. Tidak ada commit, push, deploy atau perubahan remote.

## Matriks tabel aktual

| Tabel | Kolom | PK / FK / UQ / CHECK | Index | RLS / Policy | Status |
|---|---:|---|---:|---|---|
| `ai_generations` | 15 | 1 / 4 / 3 / 8 | 5 | ON / 1 | MATCH |
| `business_members` | 5 | 1 / 2 / 3 / 1 | 4 | ON / 1 | MATCH |
| `businesses` | 11 | 1 / 0 / 1 / 1 | 2 | ON / 1 | MATCH |
| `campaign_ai_messages` | 10 | 1 / 3 / 2 / 6 | 4 | ON / 1 | MATCH |
| `campaign_ai_sessions` | 10 | 1 / 3 / 2 / 4 | 4 | ON / 1 | MATCH |
| `campaign_blueprints` | 11 | 1 / 4 / 3 / 5 | 5 | ON / 1 | MATCH |
| `campaign_contents` | 11 | 1 / 3 / 2 / 4 | 3 | ON / 1 | MATCH |
| `campaign_costs` | 12 | 1 / 2 / 1 / 3 | 2 | ON / 1 | MATCH |
| `campaign_evaluations` | 13 | 1 / 4 / 2 / 5 | 4 | ON / 1 | MATCH |
| `campaign_memories` | 20 | 1 / 4 / 2 / 8 | 4 | ON / 1 | MATCH |
| `campaign_tasks` | 13 | 1 / 3 / 2 / 3 | 3 | ON / 1 | MATCH |
| `campaigns` | 26 | 1 / 4 / 3 / 14 | 6 | ON / 1 | MATCH |
| `capacity_reservations` | 13 | 1 / 4 / 2 / 4 | 5 | ON / 1 | MATCH |
| `domain_events` | 10 | 1 / 2 / 0 / 1 | 2 | ON / 1 | MATCH |
| `job_runs` | 13 | 1 / 1 / 1 / 3 | 3 | ON / 1 | MATCH |
| `order_events` | 11 | 1 / 3 / 1 / 2 | 4 | ON / 1 | MATCH |
| `order_items` | 17 | 1 / 5 / 2 / 14 | 3 | ON / 1 | MATCH |
| `order_production_costs` | 12 | 1 / 3 / 2 / 8 | 3 | ON / 1 | MATCH |
| `orders` | 33 | 1 / 4 / 4 / 14 | 6 | ON / 1 | MATCH |
| `payment_events` | 11 | 1 / 2 / 2 / 1 | 3 | ON / 1 | MATCH |
| `payments` | 19 | 1 / 2 / 4 / 7 | 8 | ON / 1 | MATCH |
| `preorder_items` | 13 | 1 / 4 / 3 / 5 | 4 | ON / 1 | MATCH |
| `preorders` | 15 | 1 / 1 / 1 / 5 | 4 | ON / 1 | MATCH |
| `production_capacity` | 10 | 1 / 2 / 3 / 3 | 4 | ON / 1 | MATCH |
| `products` | 13 | 1 / 1 / 2 / 6 | 4 | ON / 1 | MATCH |
| `rate_limit_buckets` | 4 | 1 / 0 / 0 / 2 | 1 | ON / 0 | MATCH |

