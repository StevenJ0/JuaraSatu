# Batch A3 — Canonical Preorder Publication & Snapshot Compatibility

Tanggal **7 November 2026, Asia/Jakarta**. Branch `merge/ai-campaign`, HEAD `5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762`.

## A. Executive Summary

**Overall: PASS untuk PM05 pada source dan fresh disposable PostgreSQL.** Kedua public overload tetap didukung dengan signature, return type, ownership, SECURITY DEFINER, empty search_path dan EXECUTE ACL yang sama. Keduanya kini memanggil satu private primitive yang memakai aturan publikasi core dan menghasilkan empat field pickup snapshot kanonis.

Tidak ada perubahan reader, UI, checkout, payment, Memory, generated database types, dependency, migration lama atau data historis. Caller service-role dengan actor owner eksplisit tetap sah; owner dengan actor default NULL tetap sah. Legacy tidak lagi melewati pemeriksaan remaining commitment.

Bukti final: **14 kelompok SQL A3**, empat observed publication/capacity lock races, satu observed MVCC editor overlap, dan **5 Vitest parser cases** memakai row PostgreSQL nyata. Regresi **18 kelompok A2**, **15 A1**, **10 Memory 8B**, **100 pgTAP assertions pada checkpoint historis**, unit **1.101/67 berkas**, selected mock AI **69/7 berkas**, typecheck, ESLint dan build lulus. Kelompok/race/assertion SQL tidak dijumlahkan sebagai individual Vitest tests.

**Belum diterapkan ke database persisten lokal atau remote. Keberadaan legacy published rows di sana UNKNOWN dan belum diperbaiki.** Batch A4/B tidak dimulai.

## B. Verified Root Cause

`supabase/migrations/20261103000000_initial_v21.sql:1040` menulis `pickup_terms_snapshot = {pickupInstructions: ...}`. `20261106160000_core_preorder_on_v21.sql:1167` menulis empat snake_case fields. `src/features/preorders/repository.ts:66` mendefinisikan `pickupTermsSchema` dengan keempat field tersebut dan tidak mempunyai fallback camelCase.

Pada real PostgreSQL setelah 12 migration sebelum A3, valid legacy publish berhasil menyimpan status published, timestamp dan item price/name/SKU yang dibekukan, tetapi pickup JSON hanya memiliki `pickupInstructions`. Row ini kemudian dimasukkan ke fungsi repository asli: `findPreorder`, `findPublicPreorder`, `findPreorderContext` semuanya menolak dengan ZodError. Jadi kegagalan bukan sekadar perbandingan nama JSON atau parser tiruan.

Reproduksi kedua membuktikan rule mismatch: capacity total 10 dengan allocated commitment 6 masih dapat diterbitkan legacy dengan quota 5, meski remaining capacity hanya 4. Setelah A3, kedua overload menolak kasus tersebut dengan `PREORDER_QUOTA_OVER_CAPACITY` tanpa partial publication.

## C. Overload Comparison

Singkatan: **B**=`20261103000000_initial_v21.sql`; **K**=`20261106160000_core_preorder_on_v21.sql`; **A3**=`20261107110000_canonical_preorder_publication.sql`, semuanya di `supabase/migrations/`.

| Aspek | Legacy sebelum A3 | Core sebelum A3 | Kontrak kanonis setelah A3 |
|---|---|---|---|
| Signature | `public.publish_preorder(p_business_id uuid,p_preorder_id uuid,p_expected_version integer,p_actor_user_id uuid DEFAULT NULL)` | `public.publish_preorder(p_preorder_id uuid,p_expected_version integer)` | Keduanya dipertahankan |
| Return | `public.preorders` composite row | `void` | Tetap; actual legacy return dibandingkan dengan saved row |
| Definisi | B:1040 | K:1167 | Kedua body diganti di A3; satu private primitive baru |
| Owner/security/path | postgres; SECURITY DEFINER; `search_path=''` | Sama | Metadata existing identik pada actual catalog comparison |
| EXECUTE | authenticated dan service_role; tidak PUBLIC/anon | authenticated saja; tidak service_role/PUBLIC/anon | Sama; tidak menambah akses public overload |
| Auth | `private.require_owner(business,actor)`; authenticated memakai auth.uid, tidak boleh spoof actor; service wajib explicit actor owner | `private.current_owner_business()` dari auth.uid membership | Masing-masing boundary dipertahankan; helper tidak menerima direct application calls |
| Binding bisnis | Explicit business, scoped preorder/item, owner membership | Business diturunkan dari sesi dan scoped preorder lock | Kedua path hanya dapat menerbitkan preorder bisnis terotorisasi |
| Version/input | `version<>expected`; NULL dapat melewati kondisi SQL | Pemeriksaan sama pada `lock_owned_preorder` | NULL/stale/zero expected version ditolak; missing item mendapat `PREORDER_INPUT_INVALID` |
| State | Draft, active product, ends belum lewat | Draft, active product, full schedule recheck | Aturan core dipakai bersama |
| Capacity | Row lock; trigger baseline memeriksa binding/quota total; tidak memeriksa remaining commitment saat publish | Total dikurangi allocated + live held; quota tidak boleh melampaui remaining | Pemeriksaan core dipertahankan untuk kedua overload |
| Lock | Advisory business/date → capacity → preorder → item → product | Preorder → item → capacity; ordinary committed reads product/business | Lock order core dipakai helper; uniqueness tetap dijamin index DB, tanpa advisory terpisah legacy |
| Snapshot | Satu camelCase key | Empat snake_case keys | Empat field core persis, tanpa fabricated defaults |
| Item facts | Freeze current product base price/name/SKU | Sama | Sama; cost/currency tidak ditambah pada pickup JSON |
| Timestamp/version | `clock_timestamp()` dan trigger version | `now()` dan trigger version | Mengikuti core: now() PostgreSQL transaction time dan trigger version |
| Transaksi | Seluruh RPC atomik | Sama | Item update + publication atomik; exception me-rollback seluruh statement |
| Errors | 42501 FORBIDDEN; 40001 PREORDER_NOT_PUBLISHABLE; missing row/unique dapat keluar sebagai SQL errors | P0001 PREORDER_NOT_FOUND/VERSION_CONFLICT/NOT_DRAFT/PRODUCT_INACTIVE/SCHEDULE_INVALID/QUOTA_OVER_CAPACITY/DATE_TAKEN | Canonical core messages/SQLSTATE; legacy invalid cases kini mengikuti error core yang lebih spesifik |
| Runtime caller | Tidak ditemukan pada aplikasi Next aktif; ada dev/test utilities | `transitionPreorder` → `runPreorderTransition` → `publishPreorderAction` | Tidak perlu perubahan caller/signature |

### Seluruh caller/consumer yang ditemukan

- Dashboard: `preorders/actions.ts:publishPreorderAction` memeriksa owner dan form ID/version, membuat session client, memanggil service/repository dengan named args `p_preorder_id,p_expected_version`. `PreorderRepositoryError` sudah memetakan canonical messages. Tidak diubah.
- `scripts/prepare-campaign-execution.mjs:60`: trusted service-role fixture dengan explicit actor, setelah memeriksa synthetic business/membership. Tetap didukung tanpa mengganti JWT atau mengalihkan service ke core authenticated-only.
- `scripts/test-supabase-v21.mjs:121`: authenticated HTTP owner, legacy business/preorder/version, actor omitted; memerlukan returned row.status. Default actor path dan return row tetap didukung. Script tidak dieksekusi karena helper mutatif pada stack persisten.
- `database/v2.1/tests/invariants.sql:81`: historical legacy call pada checkpoint lama; source assertion tidak diubah. Snapshot migration di `database/v2.1/supabase/migrations/` bukan active root chain dan tetap utuh.
- Owner list/detail: `listPreorders`, `findPreorder` memakai schema nullable untuk draft, empat field required bila snapshot non-NULL. Dashboard detail menggunakan frozen pickup terms.
- Public contract: `findPublicPreorder` sudah terimplementasi dalam repository, membaca published/closed/completed projection, frozen pickup/item price/name, dan `read_preorder_offer`; bukan bukti buyer UI/checkout Indro sudah terintegrasi. Product description/photo tetap data mutable yang memang tidak masuk frozen item facts.
- Context producer: `findPreorderContext` memakai schema diperluas yang sama lalu `toPreorderContext`; price/name berasal dari item snapshot. Wiring actual C1 ke Strategist tetap di luar A3.
- Campaign execution membaca preorder status/window/version pada repository-nya, bukan menginterpretasi pickup JSON. AI fixture preparation memakai legacy writer di atas. Tidak menambahkan consumer yang belum ada.
- Tidak ada bukti absence external callers. Signature/default/return tetap, tetapi external consumer yang bergantung error legacy 40001 perlu ditinjau saat rollout.

## D. Canonical Contract Decision

Dipilih **Option C**, satu `private.publish_preorder_canonical(uuid,uuid,integer) → public.preorders` sebagai implementation bersama. Primitive merupakan SECURITY INVOKER dengan empty search_path dan tanpa application EXECUTE; ia hanya dipanggil oleh dua public SECURITY DEFINER entry point yang masing-masing sudah memeriksa otorisasi.

Alasan: ada legitimate service actor caller dan legacy row-return consumer. Retiring legacy menambah perubahan script/return handling yang tidak diperlukan. Menyalin seluruh core implementation ke legacy membuat dua writer rawan drift. Memanggil core dengan mengganti JWT/role di dalam SECURITY DEFINER tidak digunakan karena akan mencampur authentication boundary.

Aturan core tetap rujukan. Perubahan tambahan hanya NULL-version refusal dan missing-item error yang eksplisit pada publikasi. Tidak mengubah shared `lock_owned_preorder` atau use case lain. Missing/stale/lifecycle errors legacy kini kanonis; tidak ada caller repository yang ditemukan bergantung old error string. A3 tidak mendukung republish row lama untuk backfill.

## E. Implemented Changes

1. `supabase/migrations/20261107110000_canonical_preorder_publication.sql`: satu transaksi forward-only, private primitive + restricted EXECUTE + dua public wrappers.
2. `database/v2.1/tests/preorder-publication.mjs`: focused SQL reproduction, authorization, capacity/lifecycle/frozen terms, concurrency dan offline actual-reader bridge.
3. `tests/integration/preorder-publication-parser.test.ts`: menggunakan repository asli, Supabase client asli dengan semua fetch diintersep, fixture SQL tervalidasi Zod; tidak menyalin application parser.
4. `database/v2.1/tests/job-acknowledgement.mjs`: flag `--a3`, validasi ordered prefix 13 migration sebelum mutation, reuse target/cleanup A1 dan wiring A3.
5. `database/v2.1/tests/job-claim-isolation.mjs`: satu hook setelah A2 migration/catalog verification agar A3 diterapkan sebelum seluruh runtime assertions A2/A1/Memory. Assertion/expected behavior A2 tidak diubah.
6. Laporan ini.

Tidak ada application source, script runtime/dev, test expectation historis, package/config atau types yang perlu diubah. Exact API signatures tetap.

Alur dashboard: form → owner session + ID/version validation → action/service → repository named RPC → core wrapper derive business → private primitive locks/rechecks/freezes → void response → revalidation/redirect. Alur legacy owner/service: explicit business + authorized actor boundary → primitive yang sama → published row. Auth gagal sebelum mutasi; invalid version/state/schedule/capacity menolak; date conflict me-rollback item dan snapshot; tidak ada external call dalam SQL.

## F. Snapshot Compatibility

| Field wajib `pickup_terms_snapshot` | Tipe JSON / sumber | Default/nullability |
|---|---|---|
| `pickup_instructions` | string, `businesses.pickup_instructions` | NOT NULL sumber; teks persis dipertahankan |
| `public_contact` | string atau JSON null, `businesses.public_contact` | NULL sah, key tetap hadir |
| `intake_cutoff_at` | string hasil timestamptz JSON, capacity terkait | Wajib, tidak default ke empty string |
| `fulfillment_window_end_at` | string hasil timestamptz JSON, capacity terkait | Wajib |

Tidak ada optional key, snapshot version/provenance, price atau currency dalam pickup JSON aktual. Harga integer IDR, product name dan SKU dibekukan pada kolom `preorder_items` yang sudah ada. Fulfillment date serta starts/ends dibekukan pada preorder oleh trigger existing. Publication tidak mengubah cost quality atau mengarang biaya; product unknown cost tetap sah untuk base-price preorder.

Real SQL evidence terdiri dari satu before-patch legacy row dan empat after-patch row: core owner, legacy owner dengan actor default, legacy service explicit actor, serta non-NULL contact case. **5 Vitest cases** menjalankan ketiga fungsi reader asli. Legacy row lama ditolak ketiganya; semua row kanonis diterima dengan expected price/pickup/contact/status. Fetch interception menjamin tidak ada network ke localhost/Supabase; SQL rows diproyeksikan seperti nested relations yang diminta reader.

Ini verifikasi real PostgreSQL + actual parser/mapping, **bukan full PostgREST/Auth HTTP integration**. Projection transport-nya diintersep; RLS/privileges diuji terpisah pada SQL roles. File JSON synthetic sementara di `.next/cache` dihapus oleh test setelah reader run.

## G. Capacity and Lifecycle

Precondition: owned preorder, exact non-NULL version, draft, tepat satu item valid, active product, starts < ends ≤ cutoff < fulfillment end, ends > PostgreSQL now(), quota ≤ total − allocated − effective live held. Existing FK/CHECK/trigger menjaga product/business/date/capacity binding dan quota/target. Tidak menonaktifkan guard untuk menciptakan malformed fixture.

Actual tests: kedua overload menolak allocated/live-held shortage; quota tepat remaining boundary diterima; expired held tidak mengurangi remaining. Draft changes menuju product/capacity lain atau quota di atas total ditolak guard baseline. Capacity row lengkap tidak berubah karena publish; tidak membuat reservation, order, payment, generation atau job.

Item base price/name/SKU di-refresh saat publish, lalu existing snapshot trigger menolak perubahan frozen price. Pickup instructions Unicode, punctuation dan newline dipertahankan; NULL/non-NULL contact benar. Product price/name/SKU/cost dan business pickup/contact boleh diedit kemudian tanpa mengubah frozen row. Capacity schedule update saat published ditolak trigger existing.

Draft→published berhasil. Published ulang dengan old version menghasilkan VERSION_CONFLICT; dengan current version NOT_DRAFT. Closed/completed/cancelled, inactive product, schedule lewat, NULL/zero/stale version dan missing item ditolak tanpa partial state. Retry setelah gagal tetap dapat dilakukan dengan memperbaiki prasyarat dan memakai current version; duplicate success tidak dianggap publish baru/idempotent success. Tidak menambah state machine atau mengubah kebijakan close/complete.

Lock order mengikuti core existing preorder → item → capacity; product/business dibaca dengan PostgreSQL MVCC. Tidak mengklaim memperbaiki seluruh lock-order risk checkout/payment di luar A3.

## H. Authorization and RLS

Actual SQL roles membuktikan core owner, legacy owner (termasuk default actor), dan legacy service dengan valid owner actor berhasil. Foreign owner, explicit actor spoof, business mismatch, missing session/membership, service tanpa actor, foreign actor, anon, dan direct private helper calls ditolak. Core service_role tetap tidak mempunyai EXECUTE.

Existing public function owner/ACL/definer/config dibandingkan sebelum/sesudah dan identik. Private helper owner mengikuti migration postgres, SECURITY INVOKER, `search_path=''`, seluruh EXECUTE PUBLIC/anon/authenticated/service_role dicabut dalam transaksi yang sama. ACL helper diperiksa dengan `has_function_privilege` dan actual denial. RLS/table grants/trigger tidak diubah; bootstrap auth hanya test stand-in, bukan bukti JWT verification HTTP.

## I. PostgreSQL Evidence

Runner: `node database/v2.1/tests/job-acknowledgement.mjs --a3`. Root migration timestamps unik; ordered chain 10 historis + A1 + A2 + A3 = **13**, diverifikasi sebelum bootstrap mutation. Function catalog comparison membuktikan hanya dua body public publish berubah dan satu private helper ditambah; semua fungsi jobs/Memory/admission/payment/offer tetap identik.

Empat race memakai dua psql sessions, statement timeout, barrier `PgSleep`, lalu observed `wait_event_type=Lock`:

1. Legacy publish holder versus core publish preorder sama: satu publish, loser VERSION_CONFLICT.
2. Core versus service legacy untuk dua preorder berbeda pada business/date sama dan produk berbeda: unique index memilih satu winner, loser DATE_TAKEN; full losing preorder/item/capacity snapshot identik, termasuk draft price/version.
3. Capacity shrink dari 10 ke 9 saat commitment 2 dan quota 8: sebelum edit remaining 8, sesudah edit 7. Publisher yang menunggu lock menolak dengan QUOTA_OVER_CAPACITY.
4. Core publish holder versus capacity schedule edit: editor menunggu, lalu ditolak CAPACITY_SCHEDULE_FROZEN setelah status published terlihat.

Satu skenario MVCC terpisah: product/profile editor menahan uncommitted changes; publication selesai saat editor masih di PgSleep, memakai complete committed pre-edit facts. Sesudah editor commit frozen price/pickup tetap sama. Ini observed overlap tanpa mengklaim row-lock contention atau serialisasi seluruh edit profil.

Full row snapshots membuktikan no partial publication. Reproduksi old camelCase row tetap tidak diubah setelah migration; ini sekaligus bukti migration tidak membackfill historical rows.

## J. Regression Results

| Pemeriksaan | Hasil aktual |
|---|---|
| A3 focused PostgreSQL | 14 groups PASS; 4 lock races + 1 observed editor overlap |
| Actual application reader bridge | 5 Vitest cases PASS, 0 skipped; tiga actual readers, satu bad legacy + empat good canonical rows |
| A2 | 18 groups PASS; 4 observed claim-overlap scenarios + 1 F05 admission lock race; runtime assertions sesudah A3 |
| A1 | 15 groups PASS; 5 acknowledgement lock races; runtime assertions sesudah A3 |
| Memory 8B | 10 groups PASS, 5 lock races sesudah A3; suite existing tidak diubah |
| Legacy pgTAP | 100 assertions PASS pada checkpoint sebelum M93; bukan klaim assertion lama berlaku pada full chain |
| F05/F06 actual SQL | A2 regression membuktikan satu durable generation pada contention, replay gratis, denial rollback generation + tiga quota charges |
| F04/F05/F06/F07 unit/mock | PASS pada default/selected allowlist existing; tidak ada provider nyata |
| Default Vitest | 1.101 PASS / 67 files, 0 FAIL/pending, exit 0 |
| Seven selected AI mocked integration | 69 PASS / 7 files, 0 FAIL/pending, exit 0 |
| Typegen dan `tsc --noEmit --incremental false` | PASS, zero diagnostics |
| ESLint full/focused dan node syntax checks | PASS |
| `npm.cmd run build` | PASS exit 0; compile 1.625s, TypeScript 2.7s, prerender 29/29 |

Default memakai safe include existing; selected mock files sama seperti A2: manual-edit 16, provenance 3, duplicate-inference 11, evaluation-provider-validation 12, quota-blocker 3, memory-generation-claims 21, remaining-ai-contracts 3. Environment test OS/home minimal, credential ambient tidak diteruskan, smoke flags disabled dan flag performa tidak disetel. Build production/telemetry disabled memakai font existing tanpa mengganti config.

Run awal gagal pada fixture reservasi sebelum A3 karena deferred `ORDER_SNAPSHOT_TOTALS_MISMATCH`: order/item dibuat pada statement autocommit terpisah. Fixture diperbaiki menjadi satu transaksi sesuai kontrak DB; tidak mengubah totals guard. Container gagal tersebut tetap dibersihkan. Run perluasan dan run final dipisahkan; jumlah hasil tidak digabung untuk memperbesar coverage.

Batas: tidak menjalankan `tests/supabase`/browser/Bruno atau SQL F05/F06 lama yang hardcode stack persisten. Relevant preorder/capacity unit dan direct SQL matrix di atas lulus; parser bridge menguji reader asli tetapi tidak menggantikan HTTP E2E. Positive Memory vector plumbing tetap fixture synthetic private helper seperti 8B, bukan verified production source C6/C7.

## K. Historical Data and Rollout

**Keberadaan row legacy pada persistent/remote DB UNKNOWN.** A3 hanya memperbaiki future supported publication; tidak mengubah old row, melonggarkan parser, atau mengisi field dari business/capacity saat ini.

Query deteksi read-only untuk tugas rollout terpisah, **tidak dijalankan terhadap persistent DB**:

```sql
SELECT id, business_id, status, published_at,
       pickup_terms_snapshot ? 'pickupInstructions' AS has_legacy_key
FROM public.preorders
WHERE published_at IS NOT NULL AND (
  jsonb_typeof(pickup_terms_snapshot) IS DISTINCT FROM 'object'
  OR NOT coalesce(pickup_terms_snapshot ?& ARRAY[
    'pickup_instructions','public_contact','intake_cutoff_at','fulfillment_window_end_at'],false)
  OR jsonb_typeof(pickup_terms_snapshot->'pickup_instructions') IS DISTINCT FROM 'string'
  OR NOT coalesce(jsonb_typeof(pickup_terms_snapshot->'public_contact') IN ('string','null'),false)
  OR jsonb_typeof(pickup_terms_snapshot->'intake_cutoff_at') IS DISTINCT FROM 'string'
  OR jsonb_typeof(pickup_terms_snapshot->'fulfillment_window_end_at') IS DISTINCT FROM 'string'
);
```

Affected shapes mencakup camelCase-only, NULL/missing fields dan wrong types. Query tidak mengekspos isi pickup/contact. Bila ada, simpan original snapshot/facts dan cari authoritative historical contact/timing dari sumber yang benar-benar tersedia. `pickupInstructions` lama dapat dipertahankan sebagai fakta lama, tetapi tiga field lain **tidak boleh ditebak dari mutable current business/capacity**. Backfill atau reader compatibility memerlukan keputusan dan izin data/schema terpisah, termasuk penanganan freeze guard. Jangan republish atau mematikan trigger untuk mengakali backfill.

Sebelum rollout: read-only applied migration history/content fingerprints dan catalog kedua overload/ACL/helper/guards; konfirmasi baseline versus historical chain lama; inventaris known/external consumers termasuk legacy error handling; review affected rows; baru rencanakan penerapan A1→A2→A3 dan PostgREST/schema-cache/backend verification dalam tugas terotorisasi. Fresh-container success tidak membuktikan existing deployment history kompatibel.

## L. Safety Verification

Enam changed/added files tercantum di §E. Dari 670 berkas awal, hanya dua harness test (`job-acknowledgement.mjs`, `job-claim-isolation.mjs`) diperluas. Seluruh historical migration termasuk A1/A2, existing application/source changes A2, laporan terdahulu, schema/handoff, manifest/lock, scripts dan `.env.local` dipertahankan identik. Tidak staging/commit/push/merge/rebase/reset/deploy.

Target baru milik runner, image existing `public.ecr.aws/supabase/postgres:17.11.0.006`, pinned local Docker npipe/unix endpoint, UUID label, network none, tanpa mount/volume/port. Identity SQL: postgres database/user, `/tmp/campaign-a1`, Unix socket `/tmp`, no listen address, tabel public/auth/storage awal 0. Cleanup hanya ID/label container sendiri dengan `--rm`. Minimal Auth/Storage stand-ins seperti A1/A2 tidak diklaim full Supabase platform.

Container run pertama `campaign-lab-a1-401133f5-50fa-4550-adbf-28f4d34386d7` dibersihkan setelah fixture failure; run perluasan `campaign-lab-a1-0b5b7c89-09d6-43ba-99eb-300e1ccc11b8`; run final `campaign-lab-a1-f27ad662-79a4-4c93-8813-750957f41df4`. Run perluasan dan final berakhir exit 0; ketiga container sudah dibersihkan. Hanya container baru tersebut yang menjadi target mutation/cleanup. Pemeriksaan akhir juga membuktikan tidak ada temporary parser evidence JSON yang tertinggal.

Tidak ada SQL terhadap persistent/remote database, real worker, Gemini/embedding, payment callback/Midtrans, atau email. Tidak ada secret dicetak/ditulis. Fixture customer/contact/domain sintetis hanya pada disposable test dan temporary parser file, yang dibersihkan.

## M. Remaining Findings

- **PM05:** resolved untuk future supported writers dan actual-reader compatibility pada source/disposable. Historical data repair dan deployment belum dilakukan.
- **PM06/PM07:** tetap resolved source/disposable; A1/A2 migration utuh dan regressions lulus sesudah A3.
- **PM08:** generated database types drift tetap terpisah; signature A3 tidak berubah sehingga types tidak diedit secara spekulatif.
- **PM09/PM13:** general platform/harness dan schema-doc drift tetap terpisah; focused scaffold bukan perbaikan umum.
- **C1/C8:** tidak menyambungkan real AI context atau discount/attribution checkout.
- **C6/C7:** verified Evaluation/source authority dan production Memory loop tetap dependency.
- **Rollout:** A1/A2/A3 belum diterapkan pada persistent/remote. Inventaris row lama serta consumer eksternal/error handling masih diperlukan.

## N. Final Verdict

**Ya: PM05 telah diselesaikan dalam supported publication contract dan diverifikasi dengan PostgreSQL nyata. Kedua overload menghasilkan satu snapshot authoritative yang diterima actual reader, dengan frozen facts, ownership, capacity, pricing dan lifecycle core tetap terlindungi pada kasus yang diuji.**

PASS ini tidak menyatakan legacy historical rows telah diperbaiki, deployment telah dilakukan, atau aplikasi production-ready. Batch A4/B tidak dimulai.

Tidak diuji: full Supabase/PostgREST/Auth/Storage HTTP, browser/provider nyata dan persistent rollout. Risiko utama: historical row shape masih UNKNOWN dan external legacy error consumers perlu diperiksa sebelum patch diterapkan.
