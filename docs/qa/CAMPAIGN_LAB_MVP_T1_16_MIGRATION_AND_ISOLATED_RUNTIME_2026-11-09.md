# Campaign Lab — T1: 16-Migration Harness & Isolated Runtime

Tanggal: 9 November 2026 (WIB). Scope: implementasi T1 saja.

## 1. Executive Result

**PASS.** Source Steven + Rafi + Indro berjalan langsung dari repository saat ini pada Supabase baru dengan seluruh 16 migration. Harness PostgreSQL resmi menyelesaikan suite strict pada container disposable tersendiri. Runtime Supabase dan aplikasi T1 dibiarkan aktif untuk T2/T3.

Hasil baru: typecheck, lint, build, 1.298 unit test, strict SQL harness, serta **208/208 integration test pada 13 file** lulus. Ini bukan pengulangan klaim historis. Tidak ada perubahan business logic, migration SQL, generated types, atau `.env.local`. Tidak ada commit, deployment, atau panggilan Gemini/Midtrans/email eksternal.

## 2. Baseline

- Repository: `D:/Project/campaign-lab`.
- Branch: `feat/mvp-final-gaps`.
- HEAD: `dbe828455874a93d30a68469065af6e192efda44`, tetap sama setelah T1.
- Awal pekerjaan: tracked working tree bersih. Dua file untracked milik pengguna dipertahankan: `docs/plans/CAMPAIGN_LAB_FINAL_MVP_POST_MERGE_AUDIT_AND_E2E_COMPLETION_PLAN_2026-11-09.md` dan `docs/qa/CAMPAIGN_LAB_POST_P2_2_PRE_INDRO_MVP_AUDIT_2026-11-08.md`.
- Source memiliki 16 migration; allowlist dan titik aplikasi akhir harness sebelumnya berhenti pada 14. Database normal berledger 9 migration; project MVP lama berledger 14. Keduanya tidak dipakai sebagai target mutasi.
- Copy aplikasi lama `D:/Project/campaign-lab-mvp-72e87c9aa2bc-app` tidak dipakai atau disinkronisasi ulang. Runtime T1 memakai source repository langsung sehingga tidak mengulangi masalah copy tertinggal.

Inventory urut yang benar-benar diaplikasikan:

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
20261108090000_financial_bounds_owner_cas.sql
20261108100000_c8_campaign_offer_resolver.sql
20261108110000_payment_settlement_clock_and_accept_lock_order.sql
```

SHA-256 seluruh migration identik dengan baseline dan salinan konfigurasi T1. Tidak ada migration ditulis ulang.

## 3. Files Changed

| File repository | Perubahan |
|---|---|
| `database/v2.1/tests/migration-contract.mjs` | Allowlist eksplisit 16 migration, tetap memeriksa nama, urutan, dan timestamp unik. |
| `database/v2.1/tests/job-acknowledgement.mjs` | Setelah checkpoint F1, aplikasikan migration sisanya dan periksa delta function tanpa menghilangkan checkpoint historis. |
| `database/v2.1/tests/current-contracts.mjs` | Verifikasi generated types existing terhadap katalog akhir, jalankan regresi C8/payment, tambah negative inventory checks urutan/duplikasi. |
| `database/v2.1/tests/campaign-payment-contracts.mjs` | Baru: sembilan kelompok regresi SQL pricing, attribution, settlement, deadline dan lock order pada target disposable. |
| `database/v2.1/tests/type-catalog.sql` | Baru: query katalog read-only untuk verifier tipe existing; bukan DDL/migration. |
| `docs/schema.md` | Hanya paragraf status verifikasi di header diperbarui setelah strict suite PASS; definisi schema tidak diubah. |
| Laporan QA ini | Bukti, batasan, identitas runtime dan handoff. |

Tidak ada perubahan application source atau konfigurasi repository. Setup lokal, helper, manifest, kredensial dan log berada di luar Git, di root privat berikut:

```text
C:\Users\TUF GAMING\AppData\Local\Temp\campaign-lab-t1-5c24f460eb0e
```

Helper lokal utama: `setup.mjs`, `runtime.mjs`, `smoke.mjs`, `auth-smoke.mjs`. Manifest menyimpan identitas source, SHA migration, ID container, serta baseline resource lama. File `private-env.json`, `platform-status.private.json`, `ready-account.private.json` dan log privat tidak boleh dipublikasikan. Jangan menyalin isi file tersebut ke issue atau Git.

## 4. Migration Harness Changes

Memperbarui array saja tidak cukup: eksekutor memiliki checkpoint khusus A1/A2/A3/F1. Eksekutor sekarang mempertahankan checkpoint tersebut lalu benar-benar menjalankan SQL migration 15 dan 16. Ledger harness ditulis setelah SQL sukses, bukan sebagai pengganti eksekusi migration.

Snapshot function sebelum/sesudah membuktikan tepat enam body berubah: `accept_late_payment`, satu overload `apply_verified_payment`, `current_order_offer`, `lock_campaign_context`, `resolve_attribution`, dan `create_preorder_order`. Signature, owner, ACL dan configuration tetap sama. Dua resolver private C8 menjadi security definer sesuai SQL migration; perubahan flag lain ditolak. Tidak ada tabel/kolom public baru: **26 tabel, 352 kolom**.

Pemeriksaan akhir mencakup RLS seluruh 26 tabel, column grants, overload RPC, definer dengan search path kosong dan pembatasan anon, Storage bucket/policies, money bounds, owner CAS, kapasitas dan job guards. Generated types cocok dengan katalog: **66 public FK relationships, 46 nama RPC, 50 signature**. Lima FK lintas schema dikecualikan sesuai kontrak generator existing. Tidak ada regenerasi tipe.

Command resmi:

```powershell
node scripts/test-database-v21.mjs --strict-docs
```

Run final `5a6c93cf-6fca-413c-b62d-e01b7465602c`: exit 0, sekitar 343 detik, 16/16 APPLIED, Layer1 PASS, comparator PASS, **352 MATCH / 0 drift**. Artifact lokal:

```text
node_modules/.cache/database-v21/5a6c93cf-6fca-413c-b62d-e01b7465602c/summary.json
node_modules/.cache/database-v21/5a6c93cf-6fca-413c-b62d-e01b7465602c/catalog.json
node_modules/.cache/database-v21/5a6c93cf-6fca-413c-b62d-e01b7465602c/schema-comparison.json
```

Angka suite memakai satuan berbeda, sehingga tidak dijumlahkan menjadi jumlah test palsu:

| Suite | Bukti hasil baru |
|---|---|
| Legacy pgTAP | 100 assertion PASS, termasuk assertion 65 pada checkpoint aslinya. |
| Memory | 7 kelompok SQL dan 1 claim race PASS; regresi Memory 8B existing tetap dijalankan. |
| A1 | 15 kelompok, 5 observed lock races PASS. |
| A2 | 18 kelompok PASS. |
| A3 | 14 kelompok SQL dan 5 actual-reader Vitest cases PASS. |
| F1 | 19 kelompok, 170 rejected statements dengan snapshot rollback identik pada 13 tabel terkait. |
| A4 current contracts | 9 kelompok PASS. |
| T1 C8/P2-2 | 9 kelompok PASS; 2 deadline races dan 3 lock-order races. |

Regresi T1 memeriksa quote/writer equality, eligibility periode/harga normal, floor rounding, organic versus linked/foreign attribution, replay idempotent, `OFFER_CHANGED` atomik, dan close versus checkout. Payment memeriksa settlement sekali saja, duplikasi tanpa email job ganda, row-lock wait melewati deadline dengan/tanpa slot terpakai kembali, valid/invalid accept versus settlement, serta expiry versus settlement. Invalid accept mengharapkan **SQLSTATE `P0001`, `ORDER_STATE_INVALID`**. Barrier `pg_stat_activity` memastikan wait benar-benar teramati; statement dibatasi 15 detik.

Fixture campaign memakai seam transaction-local replica yang sudah digunakan integration test existing. Ini menguji kontrak SQL offer, bukan seluruh alur publikasi Blueprint. Payment memakai verified-payment fixture SQL tanpa provider. Hasil race berlaku untuk skenario yang diuji, bukan bukti universal bebas deadlock.

Missing, unexpected, reversed dan duplicate inventory ditolak. Error SQL tetap merambat, rollback tetap diperiksa. Container harness dibuat baru, tanpa network/volume/port host; cleanup akhirnya hanya menghapus container run tersebut dan sudah selesai.

`layer2: NOT EXECUTED` dalam artifact harness berarti runner PostgreSQL itu sendiri tidak menjalankan Supabase integration. Suite Supabase terpisah benar-benar dijalankan dan hasilnya ada di §7.

## 5. Isolated Supabase Environment

| Identitas | Nilai nonsecret |
|---|---|
| Project | `cl-t1-5c24f460eb0e` |
| Root | `C:\Users\TUF GAMING\AppData\Local\Temp\campaign-lab-t1-5c24f460eb0e` |
| App | `http://127.0.0.1:3311` |
| Supabase API | `http://127.0.0.1:57321` |
| PostgreSQL | `127.0.0.1:57322` |
| Shadow port yang dialokasikan | `57320` |
| Studio | `http://127.0.0.1:57323` |
| Mailpit UI/API | `http://127.0.0.1:57324` |
| Network | `supabase_network_cl-t1-5c24f460eb0e` |
| DB volume | `supabase_db_cl-t1-5c24f460eb0e` |
| Storage volume | `supabase_storage_cl-t1-5c24f460eb0e` |
| Ledger | 16 versi, urutan sama dengan inventory source |

Delapan container: `supabase_db_`, `supabase_kong_`, `supabase_auth_`, `supabase_rest_`, `supabase_storage_`, `supabase_pg_meta_`, `supabase_studio_`, dan `supabase_inbucket_` (layanan email Mailpit), masing-masing bersufiks project T1. ID persis tersimpan pada `environment-manifest.json`. Semua memiliki label `com.supabase.cli.project` project T1 dan hanya network T1. Kedua volume memiliki label yang sama dan timestamp pembuatan sesudah setup dimulai. Semua published port diikat ke `127.0.0.1`.

Safe-target preflight dilakukan sebelum setup: project/container/network/volume belum ada, port bebas, baseline 20 container lama serta dua ledger lama disimpan, target konfigurasi berada di root baru, tidak ada remote project/link. CLI terpasang **2.122.0** dipakai tanpa upgrade; konfigurasi baru mengikuti format aktual `[local_smtp]`. Seed dinonaktifkan dan 16 SQL disalin dengan pemeriksaan SHA. CLI start mengaplikasikan semuanya ke database baru. Layanan tambahan yang tidak diperlukan tidak dijalankan.

Auth, PostgREST dan Storage sehat; bucket `product-photos` tersedia. Auth memakai app origin `http://127.0.0.1:3311` dan callback `/auth/confirm`. Signup normal mengirim konfirmasi ke Mailpit lokal, verifikasi OTP berhasil, kemudian cookie SSR diterima aplikasi dengan user yang sama. Owner API mengembalikan 403 `BUSINESS_REQUIRED`, sesuai akun tanpa usaha. Tidak dibuat fixture bisnis/order melalui smoke ini.

JWT signing secret, password DB, HMAC dan cron secret dibuat khusus target lokal. Signature anon key diverifikasi terhadap signing secret baru. HMAC memenuhi validasi aplikasi; initialization policy dan RPC limiter benar-benar diuji. Tidak ada bypass admission dalam aplikasi.

## 6. Application Synchronization

Aplikasi memakai `D:/Project/campaign-lab` langsung, bukan source copy. HEAD dan SHA 324 file `src` diverifikasi melalui manifest; source application tetap identik dengan baseline. Build memuat route owner, buyer, order status, webhook dan cron.

Perintah PowerShell berikut dapat dipakai ulang pada mesin ini:

```powershell
$t1Root = 'C:\Users\TUF GAMING\AppData\Local\Temp\campaign-lab-t1-5c24f460eb0e'
node "$t1Root\runtime.mjs" status
# Jika container T1 sebelumnya dihentikan:
node "$t1Root\runtime.mjs" up
# Start/restart hanya aplikasi T1 dari repository saat ini:
node "$t1Root\runtime.mjs" app
node "$t1Root\smoke.mjs"
```

`status` memeriksa delapan ID container, label/network/volume/loopback, SHA migration, ledger, signing secret dan baseline database lama. `up` hanya melanjutkan container tercatat tersebut. `app` memeriksa target lalu menghentikan hanya PID aplikasi T1 yang command line/repo/port-nya cocok, dan menjalankan Next dev pada port 3311. Setelah edit T2, Next membaca source langsung; manifest T1 tetap menjadi bukti baseline dan harus diperbarui secara sadar saat memverifikasi source baru, bukan menganggap hash lama sebagai hasil baru.

Environment proses memakai allowlist sistem dan injeksi eksplisit target lokal. Secret server tetap server-only. Key Gemini, Midtrans dan Resend serta selector fake provider dikosongkan eksplisit agar `.env.local` tidak mengaktifkan provider luar. Email aplikasi memakai Mailpit lokal. Startup Next masih menyebut `.env.local`, tetapi nilai proses yang diinjeksi mengambil prioritas; file pengguna tidak diedit. Tidak ada fake-success behavior ditambahkan ke production source.

Alur smoke auth: signup pada Supabase T1 → email di Mailpit T1 → OTP diverifikasi → cookie SSR → owner API current app → user sama pada database T1 → penolakan `BUSINESS_REQUIRED` yang diharapkan. Route tanpa sesi ditolak/redirect; webhook tanpa konfigurasi menolak 503; cron tanpa otorisasi menolak 401. Tidak ada job/provider dipanggil dari smoke.

## 7. Verification Results

| Check | Result | Evidence | Limitations |
|---|---|---|---|
| `npm.cmd run typecheck` | PASS | Exit 0. | Tidak menggantikan runtime validation. |
| `npm.cmd run lint` | PASS | Full lint exit 0; targeted lint file harness juga PASS sesudah guard final. | Peringatan Git LF/CRLF tidak merupakan lint error. |
| `npm.cmd run build` | PASS | Production build current source selesai. | Listener handoff memakai Next dev pada source sama. |
| `npm.cmd test` | PASS | 1.298 test, 78 file. | Unit, bukan browser acceptance. |
| Strict PostgreSQL harness | PASS | Run ID/artifact §4, 16 APPLIED, 352 MATCH, drift kosong. | Supabase Layer2 terpisah. |
| Generated types/ACL/RLS/functions | PASS | 26 tabel/352 kolom, 66 relationships, 46 RPC names/50 signatures; guards existing dipertahankan. | Tidak meregenerasi tipe atau mengubah schema. |
| Supabase integration config existing | PASS | 208 passed, 0 failed, 0 pending, 13 file; `integration-results.json`. | Hanya target T1 milik tugas. |
| Runtime migration ledger | PASS | 16 versi cocok source; `runtime.mjs status`. | Tidak meng-upgrade ledger lama. |
| Auth/session | PASS | Signup, Mailpit confirmation, OTP, SSR user sama; `auth-smoke-results.json`. | Akun belum memiliki bisnis. |
| Storage/PostgREST | PASS | HTTP 200, bucket `product-photos` ditemukan. | Upload UI lengkap termasuk T3. |
| Application HTTP/routes | PASS | 14 pemeriksaan route/service dalam `smoke-results.json`. Login/register 200; owner redirect 307/API 401; private token tak dikenal 404; webhook 503; cron 401. | Public slug tak dikenal memakai streamed HTTP 200 dengan sentinel Next `NEXT_HTTP_ERROR_FALLBACK;404`, diperiksa sebagai semantic not-found. Bukan buyer journey selesai. |
| Local email | PASS | Mailpit API/UI sehat dan konfirmasi signup benar-benar diterima. | Email eksternal tidak diuji. |
| HMAC/admission config | PASS | Dedicated HMAC lolos policy dan limiter RPC; source guard tetap sama. | Tidak memanggil LLM. |
| Source/env safety | PASS | 353 file baseline terlindungi identik, termasuk source, migrations, `.env.local`, konfigurasi Supabase dan dua dokumen awal pengguna. | Resource runtime lokal sengaja dibuat baru. |
| `git diff --check` | PASS | Tidak ada whitespace error. | Tidak ada commit. |

Integration dijalankan oleh helper guarded, menggunakan Vitest terpasang dan **`vitest.integration.config.mts` yang sama dengan script repository**, dengan lima override aktual di §10. Fingerprint semua public/private function definitions sebelum/sesudah identik: fixture integration yang sementara mengganti function berhasil memulihkannya.

Run integration pertama mengalami satu kegagalan hook Auth `Database error checking email` saat startup DB belum stabil: 159 pass dan 49 skip akibat hook. Checker readiness kemudian diperkuat dari health endpoint menjadi query Auth admin yang benar-benar mengakses DB. Tanpa mengubah assertion/business source, full rerun menghasilkan **208/208 PASS**. Percobaan wrapper command dengan quoting path berspasi juga diganti argument array Node sebelum rerun. Ini koreksi transport/readiness lokal, bukan perbaikan business logic.

Khusus subprocess integration, default `RATE_LIMIT_HMAC_KEY` tidak diinjeksi: positive SQL fixtures mengirim secret test sendiri dan negative missing-config case harus menguji default kosong. Proses aplikasi tetap memakai dedicated HMAC; guard aplikasi tidak dilemahkan. Tidak ada generation provider yang dipanggil oleh suite database ini.

## 8. Safety Verification

`supabase_db_campaign-lab` dan project `cl-mvp-72e87c9aa2bc` tetap pada container ID, mount, network, port binding, DB start time/restart count serta ledger awal masing-masing **9 dan 14 migration**. Akses ke keduanya hanya pembacaan ledger setelah identitas diverifikasi. Tidak ada reset, migrate, seed, data cleanup, stop/restart atau mutasi yang ditargetkan ke environment lama. Data lama tidak diklaim diverifikasi byte-per-byte; bukti ini adalah batas tindakan dan metadata yang diperiksa.

Sebanyak 20 container lama dilindungi. Container non-DB `supabase_vector_campaign-lab` sudah memiliki crash loop dengan policy `unless-stopped`; restart counter teramati naik secara otomatis (574 → 599 pada status akhir). T1 tidak menjalankan stop/restart terhadapnya. Verifier tetap mengunci identitas resource dan start time/restart count **kedua database**; observasi background restart dicatat terpisah pada `protected-background-restarts.json`.

353 file baseline terlindungi tidak berubah. `.env.local`, migration SQL, source aplikasi, generated types, normal Supabase config, source copy lama dan dokumen untracked pengguna dipertahankan. Credential values tidak dicetak. File privat berada pada direktori Temp pengguna di luar Git; jangan menganggap `mode: 0600` Node sebagai jaminan permission Unix di Windows. Direktori lokal ini berisi secret test dan harus tetap privat.

**Lifecycle:** container PostgreSQL harness sudah dihapus oleh cleanup invocation-nya sendiri. Supabase T1, dua volume, network dan app **tetap aktif**. Helper/status mempertahankan manifest ID sehingga tidak menargetkan resource berdasarkan nama saja.

Prosedur berhenti tanpa menghapus data, untuk digunakan nanti:

```powershell
$t1Root = 'C:\Users\TUF GAMING\AppData\Local\Temp\campaign-lab-t1-5c24f460eb0e'
node "$t1Root\runtime.mjs" shutdown
```

Prosedur penghapusan permanen **hanya resource T1**, jika kelak target tidak diperlukan:

```powershell
$t1Root = 'C:\Users\TUF GAMING\AppData\Local\Temp\campaign-lab-t1-5c24f460eb0e'
node "$t1Root\runtime.mjs" destroy --confirm-project=cl-t1-5c24f460eb0e
```

Destroy mewajibkan project flag persis, delapan ID/label/network/mount/port sesuai manifest, volume baru berlabel T1 dan tidak dipakai container asing; hanya PID app yang cocok, delapan ID container, dua volume dan network ID tersebut yang dihapus. Data T1 akan hilang. Direktori privat/helper tidak dihapus otomatis. **Shutdown/destroy belum dijalankan atau diuji secara destruktif** agar runtime siap handoff; sintaks helper serta jalur `status`/ownership guard sudah diverifikasi. Jangan memakai global Supabase stop, Docker prune atau broad volume deletion sebagai pengganti.

## 9. Remaining Limitations

Tidak ada blocker T1 yang tersisa. Batas bukti yang tetap berlaku:

- Checkout retry bug T2 belum diperbaiki atau diuji sebagai hasil perbaikan.
- 24 browser acceptance assertions historis belum diulang; seluruh journey bisnis/UI termasuk T3/T8.
- Live Gemini, charge Midtrans, webhook eksternal, external email/cron serta final sign-off belum diuji dan tidak termasuk T1.
- Fixture offer/payment SQL bukan bukti publikasi Blueprint UI atau settlement provider nyata.
- Helper/kredensial runtime berada di Temp pengguna, spesifik mesin ini, dan perlu dipertahankan untuk reuse; penghapusan Temp menghilangkan konfigurasi handoff.
- Cleanup destruktif hanya didokumentasikan, tidak dieksekusi. Tidak ada klaim universal bebas race/deadlock di luar skenario terukur.

## 10. T2/T3 Handoff

Target source: `D:/Project/campaign-lab`, branch dan HEAD §2. Target aplikasi `http://127.0.0.1:3311`, API `http://127.0.0.1:57321`, database container `supabase_db_cl-t1-5c24f460eb0e`, Mailpit `http://127.0.0.1:57324`. Jalankan `status` sebelum aktivitas mutasi dan pakai `app` untuk restart dengan injeksi target yang sama.

T2 dapat mulai memperbaiki checkout retry pada source saat ini, memakai target T1 untuk fixture/order baru. Verifikasi perubahan retry dengan seam provider aman yang disetujui pada tugas T2/T3; konfigurasi T1 sengaja tidak menghasilkan charge/generation sukses palsu. Jangan menggunakan credential/provider luar atau mengarahkan ulang ke database normal demi menyiapkan fixture. Update bukti source sesudah perubahan T2; hash T1 hanya membuktikan baseline T1.

Untuk mengulang database integrations dengan guard target:

```powershell
$t1Root = 'C:\Users\TUF GAMING\AppData\Local\Temp\campaign-lab-t1-5c24f460eb0e'
node "$t1Root\runtime.mjs" status
node "$t1Root\runtime.mjs" integration --run-on-owned-t1
```

Jangan menjalankan bare `npm run test:integration` yang dapat mengambil target `.env.local`. Helper menjalankan konfigurasi suite existing dengan seluruh override aktual:

```text
TEST_SUPABASE_URL
TEST_SUPABASE_ANON_KEY
TEST_SUPABASE_SERVICE_KEY
TEST_DB_CONTAINER
TEST_MAILPIT_URL
```

Nama konfigurasi app/helper yang relevan, tanpa nilai secret:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_AUTH_JWT_SECRET
SUPABASE_DB_PASSWORD
RATE_LIMIT_HMAC_KEY
CRON_SECRET
EMAIL_PROVIDER
MAILPIT_URL
EMAIL_FROM
```

Nilai test berada di file privat lokal dan diinjeksi helper, tidak perlu disalin ke `.env.local`. Integration suite memutasi fixture target T1; fungsi SQL sementara dipulihkan dan fingerprint diperiksa. Jika manifest berbeda, hentikan dan verifikasi identitas; jangan menghapus guard.

Hasil 208 integration sudah merupakan bukti baru T1; angka 24 browser assertions dan live provider results tetap historis/belum diverifikasi ulang. **T1 selesai; T2 boleh dimulai melalui tugas berikutnya. T2–T8 tidak dikerjakan otomatis.**
