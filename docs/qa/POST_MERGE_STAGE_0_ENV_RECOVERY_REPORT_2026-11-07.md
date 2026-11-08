# Stage 0 — Post-Merge Environment Recovery & Baseline Verification

Tanggal: **7 November 2026, Asia/Jakarta**. Proyek: Campaign Lab / Juara Satu.

## 1. Executive Summary

**Overall: PASS.** Lingkungan development pascamerge berhasil dipulihkan dan memenuhi acceptance criteria Stage 0 tanpa perubahan source aplikasi, test, konfigurasi proyek, schema, migration, manifest, lockfile, atau `.env.local`.

- `npm.cmd ci --no-audit --no-fund`: **PASS**, 564 package terpasang; seluruh **23 dependency langsung** cocok dengan versi persis dalam lockfile.
- TypeScript: **77 → 20 → 0 diagnostic**. Instalasi dependency menghilangkan 57 diagnostic; regenerasi tipe route menghilangkan 20 sisanya. Tidak diperlukan perbaikan source untuk diagnostic tersebut.
- ESLint: **PASS**.
- Unit/mock default: **1.098 test PASS dalam 66 berkas**, tanpa assertion failure, load failure, atau skipped test.
- Regresi integrasi AI yang dipilih dan memakai transport/repository mock: **69 test PASS dalam 7 berkas**, tanpa failure atau skipped test. Ini eksekusi terpisah; tidak digabung menjadi satu angka suite.
- Production build: **PASS**, exit 0, setelah akses unduhan font existing tersedia. Percobaan sandbox pertama gagal mengunduh Google Fonts; tidak disembunyikan dengan font mock, perubahan konfigurasi, atau penggantian font.
- Pemeriksaan integritas membandingkan 662 berkas awal, termasuk `.env.local` dan laporan audit terdahulu: seluruhnya tetap identik.

Hasil ini menyelesaikan pemulihan lingkungan. Temuan kontrak database/produk dalam audit sebelumnya belum diperbaiki. **Siap masuk tugas Batch A berikutnya; bukan persetujuan merge ke main atau deployment.**

## 2. Scope & Safety Boundaries

Pekerjaan dibatasi pada toolchain/dependency, generated Next.js types, typecheck, lint, unit/mock regression, build, serta laporan ini. Batch A database remediation tidak dijalankan.

Acuan: `AGENTS.md`, `AI_MODULE_HANDOFF.md`, `docs/schema.md`, PRD, dan laporan `docs/plans/POST_MERGE_STEVEN_RAFI_INTEGRATION_AUDIT_2026-11-07.md`; kontrak dan batas audit sebelumnya tetap berlaku. Source/config/test setup yang relevan diperiksa sebelum eksekusi, termasuk hook instalasi, route/layout auth, development gates, owner fonts, dan pemilihan test.

Keluaran lokal yang diizinkan: instalasi `node_modules`, cache/generation/build `.next`, dan berkas generated Next.js seperti `next-env.d.ts` yang diperbarui CLI. Tidak ada edit manual konfigurasi untuk melemahkan pemeriksaan. Tidak ada penghapusan source atau reset Git/database.

Jaringan yang digunakan adalah unduhan dependency registry npm dan font publik yang diperlukan `next/font/google`. Tidak menjalankan Gemini, embedding, Midtrans, email, worker, HTTP E2E, atau test database persisten. Telemetry Next dimatikan melalui environment proses, tanpa mengubah file env/config.

## 3. Git & Toolchain Baseline

| Item | Kondisi awal terverifikasi |
|---|---|
| Branch | `merge/ai-campaign` |
| HEAD | `5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762` |
| Tracked changes | Tidak ada |
| Untracked yang sudah ada | `docs/plans/POST_MERGE_STEVEN_RAFI_INTEGRATION_AUDIT_2026-11-07.md` |
| Node.js | `v24.11.0` |
| npm | `11.6.1` |
| Next.js | `16.4.3`, sebelum dan setelah instalasi |
| TypeScript | `5.9.3`, sebelum dan setelah instalasi |
| Vitest | `4.1.12`, sebelum dan setelah instalasi |
| Lockfile | Versi 3; root dependencies/devDependencies cocok dengan manifest |

Node memenuhi requirement paket yang diperiksa: Next.js `>=20.9.0`, TypeScript `>=14.17`, dan Vitest mendukung Node `>=24.0.0`. Tidak ada penggantian versi Node/npm atau dependency.

Sebelum mutasi lingkungan, SHA-256 dihitung dalam memori untuk 662 berkas tracked/untracked awal ditambah `.env.local`. Nilai atau isi secret tidak dicetak; perbandingan akhir hanya melaporkan path yang berubah. Laporan audit lama tetap dipertahankan sebagai untracked, tidak ditimpa atau di-stage.

## 4. Dependency Recovery

### Pemeriksaan sebelum instalasi

Root `package.json` tidak memiliki `preinstall`, `install`, `postinstall`, atau `prepare` hook. Script yang dipakai:

```text
lint       = eslint
typecheck  = next typegen && tsc --noEmit
test       = vitest run
test:unit  = vitest run tests/unit
build      = next build
```

Hook dependency yang tercatat di lockfile diperiksa:

- `@google/genai`: `preinstall` adalah echo no-op; registry install tidak menjalankan development `prepare` paket Git/source. Tidak memanggil API model.
- `protobufjs`: postinstall memeriksa compatibility metadata dan dapat menulis warning; tidak menjalankan database/provider.
- `unrs-resolver`: postinstall memeriksa/menyiapkan native binding melalui `napi-postinstall`; fallback mengambil paket native dengan versi tertentu dari registry. Tidak ada operasi aplikasi/database/deployment.
- `fsevents`: dependency optional macOS; tidak dijalankan sebagai instalasi platform Windows ini.

Tidak ditemukan hook instalasi yang menuntut operasi di luar scope. Tidak menggunakan `--ignore-scripts` untuk melewati hook tanpa pemeriksaan.

### Eksekusi dan hasil

Command:

```powershell
$env:npm_config_cache = 'D:\Project\campaign-lab\.next\cache\npm-stage-0'
$env:npm_config_update_notifier = 'false'
npm.cmd ci --no-audit --no-fund
```

Cache ditempatkan pada disposable `.next` agar tidak bergantung pada hak tulis cache user di luar workspace.

| Percobaan | Hasil |
|---|---|
| Sandbox biasa | Fetch tarball registry menghasilkan `EACCES`; proses dihentikan, exit 1. Ini kegagalan akses lingkungan, bukan mismatch lockfile. |
| Ulang dengan akses jaringan yang disetujui | **PASS**, exit 0: `added 564 packages in 59s`. |

Warnings instalasi: `node-domexception@1.0.0` deprecated dan `eslint@9.39.5` tidak lagi didukung upstream. Tidak ada upgrade, `npm audit fix`, `npm update`, atau regenerasi lockfile. Warning ini tidak menggagalkan verifikasi baseline.

### Resolusi setelah pemulihan

| Paket penting | Versi terpasang | Hasil |
|---|---|---|
| `@supabase/ssr` | `0.12.7` | Pulih, cocok lockfile |
| `@supabase/supabase-js` | `2.118.0` | Pulih, cocok lockfile |
| `lucide-react` | `1.67.0` | Pulih, cocok lockfile |
| `@tailwindcss/postcss` | `4.3.3` | Pulih, cocok lockfile |
| `@google/genai` | `2.32.0` | Cocok lockfile; provider tidak dipanggil |
| `sharp` | `0.35.5` | Cocok lockfile; photo-processing unit tests lulus |
| `next` / `typescript` / `vitest` | `16.4.3` / `5.9.3` / `4.1.12` | Tidak berubah |

Pemeriksaan seluruh package langsung dalam `dependencies` dan `devDependencies`: **23 dari 23 cocok**, tidak ada yang hilang atau berbeda dari lockfile. `package.json` dan `package-lock.json` identik dengan baseline awal.

## 5. Next.js Generated Route Types

Sebelum recovery, `.next/types/routes.d.ts` hanya mengenali `/` dan lima halaman `/dev/*`, serta layout `/`. Route auth dan dashboard yang ada pada source belum masuk generated union; akibatnya `PageProps<"/dashboard/...">`, `LayoutProps<"/dashboard">`, dan parameter `id` menghasilkan diagnostic.

Installed Next CLI memang mendukung `typegen`, dikonfirmasi dari `node_modules/next/dist/bin/next` dan implementasi installed CLI. Command yang dijalankan:

```powershell
$env:NEXT_TELEMETRY_DISABLED = '1'
.\node_modules\.bin\next.cmd typegen
```

**PASS**, exit 0: `Types generated successfully`. CLI memperbarui tipe produksi `.next/types` dan referensi generated `next-env.d.ts`. Union sekarang mencakup seluruh halaman dashboard, nested `[id]`, auth, onboarding, reset-password, dan workspace development yang tersedia.

Tidak mengubah signature route handler, `tsconfig.json`, atau source page untuk mengatasi cache lama. Cache `.next/dev/types` lama tidak perlu dihapus manual: referensi aktif `next-env.d.ts` menunjuk `.next/types`, dan compiler serta build berhasil dengan route hasil regenerasi. Tidak mengklaim startup server development telah diuji; CLI development dapat memperbarui cache dev saat digunakan berikutnya.

## 6. TypeScript Diagnostics

Command compiler yang dijalankan di setiap checkpoint:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
```

Eksekusi capture memakai entry compiler lokal yang ekuivalen, `node node_modules/typescript/bin/tsc --noEmit --incremental false`; exit code compiler dan diagnostic dihitung dari output sebenarnya.

| Kode | Sebelum Stage 0, audit terdahulu | Setelah npm ci, sebelum typegen | Setelah typegen |
|---|---:|---:|---:|
| TS2307, module tidak ditemukan | 45 | 0 | 0 |
| TS2344, constraint route | 13 | 13 | 0 |
| TS2339, `id` pada inferred unknown | 7 | 7 | 0 |
| TS7006, implicit parameter type | 4 | 0 | 0 |
| TS7031, implicit destructured type | 8 | 0 | 0 |
| **Total** | **77** | **20** | **0** |
| **Compiler exit** | Gagal | **2** | **0** |

Attribution recovery dapat dipisahkan: **57 diagnostic hilang setelah dependency dipulihkan**, termasuk implicit types yang kehilangan tipe SDK; **20 diagnostic sisanya hilang setelah generated routes diperbarui**. Semua 77 tidak memerlukan perubahan source. Ini tidak membuktikan semua kontrak runtime/database konsisten; generated database types yang tertinggal pada audit sebelumnya tetap pekerjaan Batch A.

Production build berikutnya juga menyelesaikan pemeriksaan TypeScript internalnya. Tidak menonaktifkan strict, mengubah ESLint rules, menambahkan `any`, atau memakai type suppression.

## 7. ESLint & Safe Unit Results

`npm.cmd run lint`: **PASS**, exit 0, tanpa diagnostic lint.

Default test selection tetap berasal dari `vitest.config.mts`:

```text
src/**/*.test.ts
tests/unit/**/*.test.{ts,tsx}
```

Command executable: `node node_modules/vitest/vitest.mjs run --reporter=json`, ekuivalen script `npm test` dengan reporter JSON. Tidak mengubah konfigurasi atau expectation test.

| Ukuran | Hasil eksekusi default |
|---|---:|
| Berkas test lulus | **66** |
| Berkas gagal dimuat | **0** |
| Individual test PASS | **1.098** |
| Individual test FAIL | **0** |
| Pending/skipped/todo | **0** |
| Exit code | **0** |

Reporter JSON juga menghitung 184 test suite/group bertingkat. Angka itu bukan 184 berkas dan tidak dibandingkan dengan 66 berkas audit terdahulu.

Empat berkas yang sebelumnya gagal dimuat kini lulus:

| Berkas | PASS | Penyebab pemulihan |
|---|---:|---|
| `src/features/auth/confirm-redirect.test.ts` | 6 | Dependency Supabase pulih |
| `src/features/auth/session.test.ts` | 11 | Dependency Supabase pulih |
| `src/lib/supabase/proxy.test.ts` | 8 | Dependency Supabase pulih |
| `tests/unit/simulator-preview.test.tsx` | 5 | PostCSS pulih; home-directory tersedia pada environment proses |

Tambahan 30 assertion yang kini dapat dijalankan menjelaskan perubahan **1.068 → 1.098**, tanpa menambahkan atau mengubah test.

Test dijalankan dari subprocess dengan environment baru yang hanya membawa kebutuhan OS/home/cache (`SystemRoot`, `COMSPEC`, `PATH`, `TEMP`, `TMP`, `USERPROFILE`, `LOCALAPPDATA`, `APPDATA`), `NODE_ENV=test`, telemetry/noncolor setting, dan smoke flags disabled. Tidak membawa credential ambient atau mengisi secret dari `.env.local` ke subprocess test. `EVALUATION_PERF_REPORT` dan `GEMINI_TRANSPORT_REPORT` tidak disetel; nilai string `0` bukan cara menonaktifkan branch truthy performa.

## 8. AI Regression Results

### Selected mocked integration run

Tujuh berkas diperiksa sebelum eksekusi. Repository/transport disimulasikan dalam memori dan HTTP provider menggunakan mock; tidak ada PostgreSQL, browser, atau provider nyata dalam selection ini.

| Berkas dalam `tests/integration/` | Individual PASS |
|---|---:|
| `blueprint-manual-edit.test.ts` | 16 |
| `blueprint-provider-provenance.test.ts` | 3 |
| `duplicate-inference.test.ts` | 11 |
| `evaluation-provider-validation.test.ts` | 12 |
| `generation-quota-blocker.test.ts` | 3 |
| `memory-generation-claims.test.ts` | 21 |
| `remaining-ai-contracts.test.ts` | 3 |
| **Total satu eksekusi** | **69** |

Hasil: **7 berkas PASS, 69 individual PASS, 0 FAIL, 0 skipped, exit 0**. Reporter mencatat 14 group bertingkat; bukan 14 berkas.

Karena default config tidak memasukkan direktori integration AI, selection dijalankan lewat API Vitest yang terpasang tanpa menulis config baru:

```javascript
import { startVitest } from "vitest/node";
// files berisi tujuh path persis pada tabel di atas.
await startVitest("test", files, {
  config: "vitest.config.mts", include: files, watch: false, reporters: ["json"],
});
```

Execution harness memeriksa jumlah hasil tepat tujuh berkas. Tidak menjalankan glob seluruh `tests/integration`; konfigurasi `test:integration` core yang menulis Supabase tidak dipanggil.

### Proteksi yang diverifikasi pada scope mock

| Area | Bukti test yang lulus | Batas klaim |
|---|---|---|
| F04 narrative safety | Default `ai-narrative-grounding` 54 dan `evaluation-narrative-safety` 54, ditambah provider-validation mock | Penolakan narasi tidak grounded pada kasus test; bukan jaminan semantik semua output AI |
| F05 durable inference/replay | Default `generation-claims` 21; selected duplicate-inference 11 dan memory-generation-claims 21 | Mock fencing/checkpoint/canonical alias tetap benar; concurrency SQL belum diuji |
| F06 quota | Default quota-policy 23 dan strategist-quota-admission 3; selected generation-quota-blocker 3 | Kontrak admission/denial/replay pada mock; atomic rollback PostgreSQL belum diuji |
| F07 manual Blueprint | Selected manual-edit 16 dan provenance 3 | Manual save/provenance serta explicit replan tetap terlindungi tanpa mengganti expectation |
| Finansial | Default pricing 69, simulator 56, evaluation 33, execution 38 | Kalkulasi/validasi deterministik pada fixture; belum parity publisher→SQL checkout nyata |
| Memory | Default business-memory 37, retrieval 6, worker 8, context 7; selected Memory claims/contracts | Synthetic approval tetap ditolak; bukan bukti loop verified Memory atau worker database sehat |

Angka per-area adalah rincian dari dua run di atas dan dapat saling terkait; **tidak dijumlahkan sebagai total test baru**. Source guards tidak dilemahkan untuk memperoleh PASS.

Provider smoke flags aktual `CAMPAIGN_GEMINI_SMOKE`, `MEMORY_EMBEDDING_SMOKE`, dan `GEMINI_METADATA_CHECK` disetel disabled pada proses test. Tidak menjalankan metadata/provider/embedding smoke. Test DB, HTTP E2E, browser dan Bruno bukan skipped test di dalam selection; kelompok tersebut memang **tidak dieksekusi**.

## 9. Production Build

Script `build` diperiksa: hanya `next build`, tanpa custom pre/post build hook. Layout/page auth memakai cookie boundary; workspace AI mempunyai gate production. Source `OwnerTheme` ternyata memakai dua font Google yang perlu diunduh pada build.

Command: `npm.cmd run build`, dengan `NEXT_TELEMETRY_DISABLED=1`, `NODE_ENV=production`, `GEMINI_DEBUG=false` dan smoke flags disabled pada environment proses. `.env.local` tidak diedit; Next melaporkan file tersebut sebagai environment input. Tidak mencetak isinya atau menjalankan fungsi provider/worker/API.

| Percobaan | Hasil aktual |
|---|---|
| Build sandbox | **FAIL**, exit 1. Dua warning dan dua error `next/font`: gagal koneksi Google Fonts untuk JetBrains Mono dan Plus Jakarta Sans. Import trace mengarah ke `src/components/owner/owner-theme.tsx`, bukan kegagalan TypeScript atau provider AI. |
| Build dengan akses jaringan yang diperlukan | **PASS**, exit 0. Font existing diunduh melalui mekanisme Next; tidak menggunakan mock font atau mengubah source/config. |

Output sukses:

```text
Compiled successfully in 11.8s
Finished TypeScript in 11.7s
Collecting page data using 15 workers
Generating static pages using 15 workers (29/29)
Finalizing page optimization
```

Route summary memuat halaman core/dashboard/auth, API `/api/dev/*`, workspace development, root, `icon.svg`, dan Proxy/Middleware. Angka 29/29 adalah progress prerender Next, bukan jumlah seluruh route atau bukti UI E2E. Route auth/dashboard ditandai dynamic/server-rendered on demand.

Build sukses tidak menghasilkan error atau warning kegagalan font. Next tetap menampilkan daftar fitur experimental existing `proxyClientMaxBodySize` dan `serverActions`; tidak ada perubahan setting untuk mengejar PASS. Warnings dependency deprecated dari instalasi tetap dicatat pada §4.

Keterbatasan operasional: build dari cache kosong membutuhkan konektivitas npm dan Google Fonts. Kegagalan sandbox pertama adalah masalah akses yang telah diatasi untuk verifikasi ini; bukan alasan mengganti desain font pada Stage 0.

## 10. Remaining Environment Issues

**Tidak ada blocker terverifikasi yang tersisa dalam scope acceptance Stage 0.** Dependency resolution, generated active routes, typecheck, lint, default unit, selected AI mock regression dan production build telah lulus.

Ketergantungan jaringan build dan warning deprecation sudah diketahui; tidak menghalangi hasil akhir dan tidak ditindaklanjuti dengan upgrade. HMAC untuk menjalankan fresh AI generation pada lingkungan aplikasi tetap urusan konfigurasi runtime di luar Stage 0; `.env.local` tidak diubah dan keberhasilan mock tidak boleh dipakai sebagai bukti runtime AI sudah siap.

## 11. Potential Source-Level Integration Defects

**Tidak ada source-level incompatibility baru yang terkonfirmasi oleh TypeScript, assertion unit/mock, atau production build setelah recovery.** Seluruh 77 diagnostic lama dan empat load failure selesai melalui dependency/type generation, sehingga tidak diperlukan ticket perbaikan source untuk kegagalan tersebut.

Temuan source/kontrak dari audit sebelumnya tetap terbuka dan tidak dinyatakan RESOLVED oleh Stage 0:

- PM05: snapshot publish legacy vs parser core.
- PM06/PM07: legacy global claimant dan generic acknowledgement yang tidak melindungi transaksi Memory/live lease.
- PM08/PM09/PM13: database types, disposable DB harness/Storage dependency, dan dokumentasi kontrak belum selaras full chain.
- C1/C8 nyata, C6 verified, source attestor/Memory positif, dan owner UI integration belum diimplementasikan.
- Risiko lock order dan applied migration history target belum direproduksi/diverifikasi.

Daftar tersebut merujuk audit source terdahulu yang tetap utuh. Stage 0 tidak menjalankan SQL untuk memperbarui confidence runtime-nya. Typecheck PASS juga tidak membuat generated database types otomatis sama dengan deployed schema.

## 12. Git & Safety Verification

Pemeriksaan akhir memakai `git status`, `git diff --check`, `git diff --stat`, serta perbandingan hash terhadap baseline sebelum instalasi.

| Area | Hasil |
|---|---|
| Branch / HEAD | Tetap `merge/ai-campaign` / `5065bc5` |
| Source aplikasi/test/config/schema/migration | Tidak berubah |
| `package.json` / `package-lock.json` | Tidak berubah |
| `.env.local` | Tidak berubah, dibuktikan fingerprint tanpa mencetak isi |
| Laporan audit sebelumnya | Tetap identik dan untracked seperti awal |
| Berkas repository baru pada tugas ini | Hanya laporan Stage 0 ini |
| Generated lokal | `node_modules`, cache/build/type output `.next`, generated Next type references |
| Git staging/commit/push/pull/merge/rebase/reset | Tidak dilakukan |
| Deploy / cloud configuration | Tidak dilakukan |
| Database/schema/seed/migration/reset | Tidak dijalankan |
| Worker/email/payment/Gemini/embedding | Tidak dijalankan |
| Secret/token | Tidak ditulis ke source/laporan, tidak dicetak atau di-stage |

Manifest dan lockfile tidak diregenerasi. Tidak ada expectation test, strictness TypeScript, rule lint, atau business validation yang diganti. Fingerprint semua 662 berkas awal tetap cocok; laporan baru merupakan tambahan terpisah.

### Perbandingan baseline

| Check | Before Stage 0 | After Stage 0 | Verdict |
|---|---|---|---|
| Dependency resolution | Empat paket penting hilang | 23/23 direct package cocok lockfile | PASS |
| TypeScript | 77 diagnostic | 0; compiler exit 0 | PASS |
| ESLint | PASS historis | PASS aktual, exit 0 | PASS |
| Unit default | 1.068 PASS, empat berkas load failure | 1.098 PASS, 66 berkas, nol load failure | PASS |
| AI selected mock regression | Belum dijalankan audit sebelumnya | 69 PASS, tujuh berkas; run terpisah | PASS |
| Build | Tidak dijalankan | PASS aktual setelah akses font tersedia | PASS |
| PostgreSQL / pgTAP | Tidak dijalankan | Tidak dijalankan | Deferred |
| HTTP / browser E2E | Tidak dijalankan | Tidak dijalankan | Deferred |
| Gemini / embedding / payment / email | Tidak dijalankan | Tidak dijalankan | Deferred |

## 13. Stage 0 Acceptance Criteria

| No. | Kriteria | Verdict | Evidence |
|---|---|---|---|
| 1 | Seluruh required dependency resolve | PASS | 23/23 direct package ada dan sesuai locked version; build/test berhasil |
| 2 | Instalasi sesuai lockfile existing | PASS | npm ci sukses; manifest/lock hash identik |
| 3 | Generated route types current | PASS | Installed `next typegen` sukses; active `.next/types` mencakup route gabungan |
| 4 | TypeScript exit sukses, zero diagnostic | PASS | Compiler exit 0 setelah typegen; build TypeScript juga selesai |
| 5 | ESLint lulus | PASS | `npm.cmd run lint`, exit 0 |
| 6 | Intended safe unit/mock default lulus tanpa import failure | PASS | 1.098 PASS / 66 berkas; nol failure/skipped |
| 7 | Relevant AI mock regression lulus | PASS | 69 PASS / tujuh berkas; nol failure/skipped |
| 8 | Production build lulus | PASS | `npm.cmd run build`, exit 0; percobaan font failure tetap dilaporkan |
| 9 | Source/schema/migration/lockfile tidak berubah | PASS | Perbandingan fingerprint 662 berkas awal dan Git checks |
| 10 | Tidak ada live AI/embedding/payment/email | PASS | Selection mocks, disabled smoke flags, tidak menjalankan worker/provider routes |
| 11 | Tidak ada persistent DB mutation | PASS | Tidak menjalankan DB tests/RPC/seed/migration/fixture preparation |
| 12 | Tidak ada commit/push/merge/deploy | PASS | Tidak menjalankan operasi tersebut; HEAD tetap |

**Status akhir Stage 0: PASS.** Diagnostic lingkungan yang sebelumnya menghalangi baseline berhasil diselesaikan tanpa perbaikan domain.

## 14. Recommendation for Batch A

**Ya, lingkungan pascamerge sudah cukup pulih dan terverifikasi untuk memulai tugas Batch A database integration remediation yang terpisah.** Tidak ada blocker compiler/unit/mock/build yang tersisa dari pemulihan ini.

Urutan awal yang disarankan tetap mengikuti audit: PM07 generic Memory acknowledgement → PM06 claimant isolation → PM05 canonical publish snapshot, disertai pemeriksaan applied-history target dan disposable DB harness yang benar. Rafi dan Steven perlu menyepakati perubahan SQL; Indro meninjau dampak payment/email/canonical C5. Jangan menganggap Stage 0 sebagai izin menerapkan migration atau mengubah schema; tugas database berikutnya memerlukan izin eksplisit sesuai AGENTS.

Jangan mulai dengan mengubah test #65 agar synthetic approval lulus, menghapus guard Memory, atau mengedit applied migration lama. Hasil mock/build saat ini menjadi baseline regresi untuk pekerjaan berikutnya.

Yang tidak dijalankan: PostgreSQL/pgTAP, HTTP/browser E2E, provider/embedding/payment/email, dan Batch A. Risiko integrasi database/kontrak yang dicatat audit sebelumnya tetap terbuka; Stage 0 PASS tidak berarti main-merge atau production-ready.
