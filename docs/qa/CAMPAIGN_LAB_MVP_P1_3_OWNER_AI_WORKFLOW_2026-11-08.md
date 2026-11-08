# Campaign Lab MVP — P1-3 Owner AI Workflow

Tanggal: 8 November 2026. Scope: Steven × Rafi; tanpa integrasi buyer/payment Indro.

## A. Executive Summary

**PASS untuk P1-3 dengan provider AI mock yang dinyatakan eksplisit.** Login owner existing → dashboard → preorder milik sendiri → strategi/simulator → Blueprint → edit manual → approval → reload → execution tersambung. Auth, HTTP, PostgreSQL/PostgREST, CAS dan materialisasi task/konten menggunakan layanan nyata pada lingkungan MVP terisolasi. Gemini live tidak dijalankan. Approval rencana tidak mempublikasikan campaign untuk pembeli.

## B. Initial State

- Branch `merge/ai-campaign`; HEAD `5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762`, tetap sama.
- Working tree sudah dirty/untracked dari batch sebelumnya. Snapshot hash awal mencakup 695 file termasuk `.env.local`; bukan baseline Git bersih.
- P1-2 menyediakan `owned-preorder-context.server.ts` dan `owned-strategy.server.ts`; owner AI UI/API belum tersambung pada awal tugas.
- Reuse project `cl-mvp-72e87c9aa2bc`, API `http://127.0.0.1:56321`, aplikasi `http://127.0.0.1:3301`.
- Preflight sebelum penulisan dan setelah pengujian: delapan exact container dari manifest, label project, network sendiri, volume sendiri, binding loopback; 14 migration dan 352 kolom public. Tidak memeriksa database project lama.
- App berjalan dari salinan `D:\Project\campaign-lab-mvp-72e87c9aa2bc-app`; source utama disinkronkan mengikuti prosedur Environment Reuse P1-1.

## C. Owner Authentication Integration

`src/features/auth/owner-api.server.ts::authenticateOwnerApi` memakai client SSR existing, memverifikasi `auth.getUser()`, lalu mencari membership owner lewat `findOwnedBusinessId`. JWT session baru dipakai sebagai transport setelah identitas tersebut terverifikasi. Business/actor berasal dari server, bukan payload client.

Halaman menggunakan `requireBusinessOwner`; API mengembalikan JSON 401/403 tanpa redirect HTML. Mutasi memerlukan Origin yang sama dengan origin publik request. Public Host dipakai karena Next development menormalisasi hostname internal menjadi localhost; `X-Forwarded-Host` tidak digunakan untuk mengizinkan Origin asing. Kasus ini direproduksi sebagai tes gagal, lalu diperbaiki. Bearer/cookie development tidak mengautentikasi endpoint owner. RLS dan scoped repositories dipertahankan.

## D. Owner AI Route and UI

- Nav existing: **Campaign AI** → `/dashboard/campaigns`.
- Execution: `/dashboard/campaigns/execution?campaignId=…`.
- API GET/POST: `/api/owner/discussions`, `/api/owner/blueprints`, `/api/owner/campaigns`.
- Boundary integrasi: `src/features/campaign-strategist/owner-api.server.ts`.
- Reuse `DiscussionWorkspace`, `BlueprintPanel`, `ExecutionWorkspace` dengan prop `owner`; tidak menyalin workspace. Handler factory kecil mempertahankan alur dan guard development existing.
- Selector memuat preorder published dalam jendela intake. Server tetap memverifikasi ownership dan menolak intake tertutup/slot habis. Daftar campaign tersimpan membuka session/Blueprint existing; create menolak draft/published lain pada preorder yang sama.
- Empty/error state mengarah ke preorder/login atau meminta refresh fakta; skenario fake, login kedua, serta tautan Memory/Evaluation development disembunyikan untuk owner.

## E. Real Context Consumption

Request → SSR owner → owned preorder/session → `loadOwnedPreorderContext` P1-2 → `buildBusinessContext` → `sendPersistentDiscussion` existing → admission PostgreSQL/HMAC → `generateCampaignStrategies` existing → prompt/provider → validasi/simulator → persisted proposal → UI.

`generateOwnedCampaignStrategies` P1-2 adalah wrapper generator langsung. Endpoint memakai loader P1-2 yang sama di dalam orkestrasi persistent existing, sehingga tidak melewati quota, idempotency, ataupun persistence dengan memanggil wrapper mentah. Tidak ada loader/kalkulasi UI baru.

Audit prompt mock membuktikan preorder `44c12f52-1eb5-4b7f-82d5-1fa2a514d5c2`, business/product aktual P1-1, frozen price Rp25.000, biaya estimated Rp12.000, quota 50, kapasitas 60, allocated preorder 7, paid manual 3, held aktif 0. Hold lama sudah kedaluwarsa; angka tidak dipaksakan mengikuti snapshot P1-2 sebelumnya. Source C1/C8 berprovenance server, versi dan context hash dipertahankan. Tidak ada fallback kapasitas demo 40. Unknown cost tetap melalui kontrak null P1-2; P1-3 tidak mengubah data biaya untuk mengujinya ulang.

Quota nyata tetap berjalan: generation discussion dan Blueprint sukses tersimpan; bucket HMAC tervalidasi dan terisi. Tidak ada database lock ditahan selama inference. Manual save tidak membuat generation provider baru.

## F. Blueprint Workflow

Owner menggunakan `blueprintWorkflow` dan repository/RPC existing, bukan CRUD baru. Browser membuat v1, menyimpan edit manual v2 (budget Rp2.000, target 3 unit, tujuan direvisi), menyetujui v2, lalu reload dengan ID Blueprint yang sama. Riwayat dua versi tetap ada; campaign draft v4, Blueprint approved v2.

Provider audit hanya satu call strategi dan satu call Blueprint; manual save menyimpan plan existing dan `provider: manual`, tanpa replan/inference. Persetujuan tetap memvalidasi source proposal, hash/versi fakta, finansial, ownership, CAS serta transisi status. Stale Blueprint version ditolak.

## G. Execution View

Execution menampilkan campaign/status, window WIB, target 3 unit, budget Rp2.000, timeline, satu task dan satu caption dari Blueprint aktif tersimpan. Readback dibandingkan dengan repository/API nyata.

Checklist existing hanya dapat dimutasi pada campaign published/closed dengan Blueprint published. Karena P1-3 menghasilkan draft approved, checkbox readonly; HTTP update ditolak `INVALID_CAMPAIGN_STATE` (409), progress tetap 0. Tidak mengklaim task update sukses pada status yang dilarang.

Publikasi owner selalu fail-closed: `C8_NOT_READY` (409), tombol dan konfirmasi disabled, `published_at` tetap null. Resolver C8, SQL, harga checkout dan baseline publikasi tidak diubah. Tidak ada aktivasi diskon pembeli.

## H. Provenance and Source Integrity

- `synthetic` Blueprint/Execution kini boolean yang diturunkan dari provenance context, bukan literal true untuk semua sumber.
- `validateBlueprint` menolak flag yang tidak cocok dengan provenance C1; fixture tetap synthetic, source server false. Tidak menghapus guard Evaluation/Memory.
- Source nyata tidak berarti hasil LLM atau penjualan terverifikasi. Mock tercatat sebagai model `p13-test-mock` untuk discussion, `development-fake-blueprint` untuk pembuatan Blueprint, kemudian `manual` untuk revisi. Tidak menyamar sebagai Gemini.
- A6-10: guard ID session + epoch + versi menolak poll lama A setelah berpindah ke B, termasuk versi response yang mundur; tes asynchronous terfokus lulus.
- A6-11: input provider replan memakai target/budget/offer dan simulator dari edits terkini, bukan skenario awal; tes mock memeriksa perbedaan nilai awal dan hasil kalkulasi baru.
- Browser manual save benar-benar membiarkan replan unchecked. Tidak mengklaim pengujian browser untuk kegagalan Gemini/replan (A6-12); replan finansial diuji pada service dengan mock.

## I. Test Results

**Browser Edge nyata:** login existing, navigasi dashboard, preorder nyata, discussion persistence, strategi + simulator, create Blueprint, edit manual, approval dan reload berhasil. Pemeriksaan awal menemukan Origin mismatch dan budget execution yang belum ditampilkan; keduanya diperbaiki. Readback akhir mengonfirmasi execution, C8 disabled dan mobile tanpa horizontal overflow. Desktop 1440×1000 dan mobile 390×844 diperiksa visual. Tidak ada bearer/development login dalam browser.

Test provider dipasang melalui alias webpack **hanya pada salinan aplikasi sementara**, menuju `tests/fixtures/owner-ai-provider.server.ts`. Repository config dan endpoint produksi tidak memiliki flag/request override fake. Test secret HMAC tetap privat dan tidak dirotasi untuk melewati quota.

`tests/integration/owner-ai-workflow.test.ts` opt-in melalui `CAMPAIGN_LAB_P13_WORKDIR`; setup memverifikasi manifest container/label/network/volume/loopback sebelum real Auth A/B dan akses data. Suite mencakup anonim, dev bearer/cookie, CSRF, foreign/missing/invalid preorder, foreign discussion/Blueprint/execution/approval, persisted plan, admission, manual provider count, stale hash/version, invalid finance, fake scenario, task restriction dan C8.

Final suite mempunyai sembilan kasus: **8 PASS + 1 skip pada bundle mock**, lalu **8 PASS + 1 skip pada bundle normal**. Kasus yang saling eksklusif: stale-context generation memerlukan provider terkonfigurasi; normal bundle justru memerlukan konfigurasi tidak tersedia. Run normal pertama mengharapkan stale-context padahal provider sudah dihapus dan menerima CONFIGURATION_ERROR; prasyarat tes dipisah secara eksplisit, tanpa mengubah implementasi agar menutupi kegagalan. Kedua mode kemudian lulus. Semua sembilan kasus dieksekusi pada mode yang sesuai.

Aplikasi akhirnya dikembalikan ke config repository tanpa alias mock. Browser login/readback normal lulus. Request generation normal tanpa konfigurasi mengembalikan `CONFIGURATION_ERROR` 503 dan tidak menambah generation. Untuk generation Gemini nyata, server memerlukan `GEMINI_API_KEY`, `GEMINI_MODEL` dan `RATE_LIMIT_HMAC_KEY` sesuai kontrak existing; tidak dikonfigurasi lewat perubahan `.env.local` dalam tugas ini.

Bukti privat lokal, tanpa kredensial di laporan: workdir `C:\Users\TUF GAMING\AppData\Local\Temp\campaign-lab-mvp-72e87c9aa2bc`, file `p13-browser-results.json`, `p13-browser-readback-results.json`, `p13-normal-results.json`, `p13-provider-audit.jsonl`, `p13-workflow-identities.json`; screenshot `p13-approved.png`, `p13-execution-mobile.png`, dan padanan `normal`. `p13-browser-failure.json` merupakan kegagalan iterasi awal, bukan hasil akhir. Helper `p13-final-http-phases.mjs` menjalankan dua mode lalu selalu restore konfigurasi normal.

## J. Regression

| Pemeriksaan aktual | Hasil |
|---|---|
| `npm.cmd test` | **1.154 PASS / 70 file**; termasuk 11 tes P1-3 baru |
| `npm.cmd run test:unit` | **758 PASS / 35 file**; subset unit folder |
| Selected AI mocked integrations via helper `p12-mocks.mjs` | **69 PASS / 7 file** |
| Targeted real HTTP suite via `p13-http.mjs` | Dua mode masing-masing **8 PASS / 1 skip**, sembilan kasus unik |
| `npm.cmd run typecheck` | **PASS** |
| `npm.cmd run lint` | **PASS** |
| `npm.cmd run build` | **PASS**, termasuk route owner baru |
| Impeccable detect pada UI yang diubah | **PASS**, hasil `[]` |
| `git diff --check` | **PASS** |

Build sandbox pertama gagal mengambil Google Fonts existing; build dengan akses jaringan lalu lulus tanpa perubahan font/source/config. `npm.ps1` diblokir execution policy shell, sehingga command memakai `npm.cmd`; tidak mengubah policy sistem. Tidak menjalankan historical database concurrency suite, suite Supabase normal, atau live provider smoke.

## K. Safety

- Perbandingan 695 hash awal: 13 file existing yang memang terkait P1-3 berubah, 682 tetap sama, tidak ada file awal hilang. File baru terbatas pada owner boundary/routes/pages, guard response, fixture/tes dan laporan ini.
- `.env.local`, `.env.example`, `docs/schema.md`, 14 migration, `supabase/config.toml`, generated database types, source P1-2 dan pekerjaan dirty/untracked sebelumnya tetap sama terhadap snapshot awal tugas. Perubahan schema yang terlihat di Git sudah ada sebelum P1-3.
- Tidak ada migration/reset/truncate/seed destruktif, hosted/normal DB query atau mutasi, service-role key pada client, credential pada laporan, atau perubahan RLS.
- Penulisan hanya workflow/data sintetis pada project MVP yang diverifikasi. Fixtures P1-1/P1-2 dipertahankan; tidak mengubah produk/harga/kapasitas/orders untuk P1-3.
- Guard development existing dipertahankan. Tidak ada live Gemini, Midtrans, email, merge Indro, commit, push, rebase, reset atau deploy.
- Mock alias telah dihapus dari aplikasi berjalan; konfigurasi salinan dibandingkan sama dengan `next.config.ts` repository. Secret test tetap pada workdir privat, bukan source control.

## L. Remaining MVP Dependencies

- **P2-1:** resolver offer/pricing C8 dan integrasi checkout; publikasi pembeli masih diblokir.
- **P2-2:** payment integrity/sign-off sebelum integrasi pembayaran.
- **P2-3/P2-4:** buyer catalog/checkout/private status dan Midtrans Sandbox milik Indro belum merged/diimplementasikan pada tugas ini.
- **P3-1:** KPI actual/attribution berbasis order/payment terverifikasi; angka di workspace hanya asumsi/target rencana.
- Business Memory dan full Evaluation tetap di luar scope. Gemini live memerlukan konfigurasi server dan izin pengujian terpisah.

## M. Final Verdict

**PASS P1-3:** satu session owner existing dapat mengakses preorder berotorisasi, pipeline strategi/simulator existing, edit dan approval Blueprint persisted, lalu rencana execution melalui dashboard. Journey telah diverifikasi dengan real Auth/database/browser dan AI mock terkontrol. Readback tetap berfungsi setelah mock dilepas.

Generation Gemini nyata belum dieksekusi dan belum dikonfigurasi pada app terisolasi. Approval bukan publikasi pembeli; task draft readonly dan C8 fail-closed dipertahankan. Pekerjaan berhenti pada P1-3.
