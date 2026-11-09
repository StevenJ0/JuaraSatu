# Campaign Lab — Final MVP Post-Merge Audit & E2E Completion Plan

Tanggal 9 November 2026, WIB. **Audit dan rencana saja; tidak ada perbaikan aplikasi, test assertion, migration, konfigurasi, atau deployment dilakukan.**

## 1. Executive Verdict

**Overall: PARTIALLY READY.** Source Steven + Rafi + Indro sudah berada dalam satu branch dan membentuk alur owner → AI → campaign → buyer → QRIS → email → KPI. Bukan lagi kasus modul buyer/payment belum merged. Regresi fresh pada HEAD ini lulus **1.298 tes/78 file**, **69 integrasi AI mock/7 file**, typecheck, ESLint, dan production build.

Seluruh E2E belum dapat dijalankan dan ditandatangani hari ini pada runtime yang diperiksa. Hambatan konkretnya:

1. Harness SQL masih mengizinkan 14 migration, sedangkan source 16; percobaan fresh gagal sebelum migration/test berjalan.
2. Instance MVP lama masih 14 migration; source-copy tertinggal dan app port 3301 tidak merespons. Belum ada runtime current-source + 16-chain yang diverifikasi dalam audit ini.
3. **Bug kode terukur:** ketika sessionStorage diblokir, retry checkout membuat pasangan token/key baru. Jika respons pertama hilang sesudah commit, retry dapat membuat pesanan kedua. Satu root cause ini mengenai E09 dan N05.
4. Pada `.env.local` yang diperiksa, HMAC, Midtrans, email provider, dan cron belum dikonfigurasi. Kunci/model Gemini terdeteksi ada, tetapi request live tidak dijalankan. Ini gap konfigurasi, bukan alasan menulis ulang provider.
5. Bukti 208 integrasi SQL dan 24/24 browser berasal dari laporan Rafi, bukan fresh run audit ini. AI/Midtrans pada browser tersebut mock; email Mailpit nyata lokal. Registrasi/verifikasi/reset Cloud, Gemini nyata, Midtrans Sandbox nyata, webhook internet, email eksternal dan deployment belum terbukti.

Tidak perlu membangun ulang Core, AI pipeline, checkout, pembayaran, atau KPI. Rencana di bawah menutup satu bug yang terkonfirmasi, prasyarat runtime, dan kekurangan bukti.

## 2. Current Repository Baseline

| Item | Kondisi terverifikasi |
|---|---|
| Branch / HEAD | `feat/mvp-final-gaps` / `dbe828455874a93d30a68469065af6e192efda44` |
| Baseline integrasi | Berasal dari `42a9cec`; merge Indro tercatat pada `3dfe280`, `48e7c31`, `7e4b027`, `a777df8`. Penutup: `a82e821` buyer/QRIS, `e24ddb4` KPI, `56eb2a4` email/limiter, `dbe8284` QA |
| Working tree awal | Satu laporan audit sebelumnya untracked: `docs/qa/CAMPAIGN_LAB_POST_P2_2_PRE_INDRO_MVP_AUDIT_2026-11-08.md`; dipertahankan |
| Migration source | **16**; dua terakhir `20261108100000_c8_campaign_offer_resolver.sql`, `20261108110000_payment_settlement_clock_and_accept_lock_order.sql`. Tidak ada delta migration sejak `42a9cec` |
| Kontrak/schema | `docs/schema.md` masih berstatus verifikasi 14-chain; public signatures/kolom tidak ditambah oleh penutup MVP. Fresh kesesuaian catalog/types/ACL pada 16-chain belum dibuktikan |
| Scripts | `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:unit`, `test:integration`, `spike:midtrans`. Script spike tidak dijalankan live; unitnya mengganti transport |
| Instance MVP | `cl-mvp-72e87c9aa2bc`: delapan exact container dari manifest, label/network/volume sendiri, loopback. Read-only ledger **14 migration/352 kolom**, API 56321, DB 56322 |
| App salinan lama | `D:\Project\campaign-lab-mvp-72e87c9aa2bc-app`: 9 file berbeda dan 40 file source baru belum ada; route `/p/[slug]` dan `/api/jobs/run` belum ada. Tidak ditemukan listener Next pada 3000/3301/3302 saat pemeriksaan; GET login 3301 tidak tersedia |
| Database normal | Nama container `supabase_db_campaign-lab`/port 54322 terlihat dari metadata Docker saja; tidak diakses SQL, tidak dipakai untuk tes |
| Dokumen | P2-3/P2-4, P3-1, P3-2 QA tersedia. `progress.md` tidak ditemukan di tree yang ditelusuri. README masih menyebut B00/starter dan AI handoff masih menggambarkan dev-only/chain lama; source dan QA terbaru lebih mutakhir |

**Pemeriksaan konfigurasi hanya keberadaan nilai, tidak mencetak secret:** Supabase URL/publishable/service-role, `GEMINI_API_KEY`, `GEMINI_MODEL` ada di `.env.local`. `RATE_LIMIT_HMAC_KEY`, `MIDTRANS_SERVER_KEY`, `MIDTRANS_MERCHANT_ID`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY`, `CRON_SECRET` tidak ditemukan berisi nilai. Klaim handoff “HMAC sudah dikonfigurasi” belum terbukti pada checkout ini; deployment/process secret lain belum diaudit. `.env.example` sudah mencantumkan nama variabel utama tersebut.

Parsing environment dengan loader `@next/env` mengonfirmasi hasil keberadaan di atas. Root `supabase/config.toml` mengaktifkan email confirmation dan memakai Site URL/redirect **port 3001**, sedangkan `npm run dev` tanpa argumen biasanya memakai 3000 dan instance MVP lama memakai konfigurasi terpisah/3301. T1/T4 wajib menyelaraskan URL app, Site URL, callback allowlist dan template pada target masing-masing; root config bukan bukti konfigurasi Cloud atau instance MVP.

### Bukti tes: fresh versus historis

| Pemeriksaan | Bukti aktual |
|---|---|
| `npm.cmd test` | Fresh **1.298 PASS / 78 file**: termasuk adapter Midtrans dengan HTTP mock, checkout schema/read, KPI metrics, email sender/template mock, limiter helpers, serta regresi Core/AI |
| Selected AI integrations via helper lokal existing `p12-mocks.mjs` | Fresh **69 PASS / 7 file**; mock transport/repository/provider, bukan PostgreSQL |
| `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build` | Fresh **PASS**; build memuat `/p/[slug]`, `/o/[token]`, webhook, cron dan owner routes |
| `node scripts/test-database-v21.mjs` | Fresh **FAIL** di `migration-contract.mjs::verifyMigrationInventory`: 14 expected vs 16 source. Container disposable networkless milik run dibuat lalu dibersihkan oleh harness; tidak sampai menjalankan migration/test |
| Pure retry probe | Fresh: sessionStorage getter melempar; dua `loadCheckoutIntent('audit-preorder')` menghasilkan `sameTokenOnRetry=false`, `sameIdempotencyKeyOnRetry=false`. Tidak memanggil DB/provider dan tidak menulis fixture |
| `npm run test:integration` / 208 tes | **Historis Rafi**, 13 file pada Supabase sekali pakai `gtnic_test` dari 16 migration. Meliputi SQL/PostgREST nyata, gateway pembayaran mock, empat tes email termasuk Mailpit lokal, tiga tes limiter. Tidak dijalankan terhadap instance persisten saat audit |
| P3-2 24/24 | **Historis menurut laporan** `CAMPAIGN_LAB_MVP_P3_2_FINAL_JOURNEY_2026-11-09.md`: UI/browser + Supabase nyata, AI/Midtrans mock, Mailpit nyata. Runner `docs/local/e2e/verify-p32-final.cjs` tidak ada di checkout ini; raw assertion tidak dapat diinspeksi/dijalankan ulang |

Angka 24 assertion P3-2 tidak otomatis sama dengan **24 scenario E01–E14/N01–N10**. Laporan memasukkan pemeriksaan responsif/error halaman dan tidak membuktikan registrasi/verifikasi/reset atau semua negatif melalui browser. Tidak ada fresh browser atau live provider PASS dalam audit ini.

## 3. MVP Feature Inventory

| Feature | Existing implementation | Current status | Evidence | Gap |
|---|---|---|---|---|
| Auth | `auth/actions.ts`, `/register`, `/login`, `/auth/confirm`, forgot/reset, Supabase SSR/proxy | PARTIALLY VERIFIED | Unit schema/session/redirect fresh; login historis | Full signup→email→verify→reset belum dibuktikan; Cloud SMTP/config URL perlu tim |
| Business/owner | `business/guard.ts`, membership/repository, dashboard/onboarding | PARTIALLY VERIFIED | Browser historis P1-1/P3-2, unit/regresi fresh | Runtime current belum tersedia |
| Product/photo/cost/capacity | Existing modules, Supabase Storage `product-photos` | PARTIALLY VERIFIED | Browser upload historis, Core tests fresh | Ulang owner+Storage pada target 16-chain |
| Preorder publication | Dua overload `publish_preorder` → `private.publish_preorder_canonical` | PARTIALLY VERIFIED | Source A3; historis browser/SQL; read-only snapshot counts | Jangan memakai fixture camelCase |
| AI/Simulator | SSR owner → P1-2 loader → persistent discussion/admission → Strategist/simulator | VERIFIED WITH MOCK | Unit + 69 mock fresh; browser mock historis | HMAC/current runtime dan smoke Gemini nyata |
| Blueprint/Execution | Existing workflow, manual edits, approval CAS, tasks, publish/close | VERIFIED WITH MOCK | Unit fresh, browser mock historis | Fresh approval/publish/task persistence pada 16-chain |
| Pricing/attribution | C8 resolver SQL, `read_preorder_offer`, order writer | PARTIALLY VERIFIED | SQL historis + calculator/unit fresh | Fresh SQL parity/atomicity dan buyer HTTP |
| Public buyer | `/p/[slug]`, C1 loader, checkout form/actions | PARTIALLY VERIFIED; retry edge BROKEN | Source + unit fresh; browser historis 27/27 | Fix pasangan intent saat storage gagal; browser current |
| Private status | `/o/[token]`, token-hash reader, minimal DTO/noindex/no-referrer | PARTIALLY VERIFIED | Unit/source fresh, browser historis | Fresh private reload/token denial |
| QRIS/notification | `qris-checkout.server.ts`, Sandbox adapter, webhook, manual reconcile | VERIFIED WITH MOCK | Adapter/signature unit fresh; SQL/browser historis | Akun Sandbox, public callback, real charge/settlement |
| Paid email/jobs | `paid-email/*`, inline `after()`, `GET /api/jobs/run` | PARTIALLY VERIFIED | Sender/template unit fresh; Mailpit/SQL historis | Pilih provider, secret cron, schedule dan actual delivery |
| Buyer limiter | `take_rate_limit`, HMAC, checkout/status actions | PARTIALLY VERIFIED | Tiga helper unit fresh; tiga SQL historis | HMAC/config dan enforcement/action checks fresh |
| Campaign KPI | `campaign-results/{repository,metrics,components}` pada detail preorder owner | VERIFIED WITH MOCK | 10 metrics tests fresh; 4 SQL/11 browser historis | Reload hasil sesudah fresh/live settlement |
| Memory/Evaluation | Existing module terpisah | OPTIONAL / DEFERRED | Tidak perlu untuk buyer→paid KPI | Tidak dijadikan prasyarat MVP |

### Canonical pickup, sumber AI, dan KPI

`20261107110000_canonical_preorder_publication.sql` membekukan key **snake_case** `pickup_instructions`, `public_contact`, `intake_cutoff_at`, `fulfillment_window_end_at`; dua entry point publik memakai helper canonical yang sama. Reader publik/privat/email mengharapkan bentuk itu. Pada instance MVP yang diidentifikasi, query shape-only menemukan **3 snapshot pernah published, 3 canonical, 0 camelCase**. Tidak ditemukan writer aplikasi current yang memproduksi camelCase. Error karena fixture camelCase harus diperbaiki di fixture/prosedur pembuatan, bukan dengan melonggarkan kontrak atau backfill otomatis database lama.

P1-2 tetap memakai frozen price, biaya nullable/quality, paid/held/allocated terpisah, source IDs/versions/hash dan owned scope; tidak ada fallback demo 40. Saat campaign sudah published, loader AI masih memberi C8 unavailable secara fail-closed; merencanakan campaign kedua saat yang pertama aktif bukan syarat alur MVP pertama. Manual Blueprint memakai plan existing tanpa LLM; replan memakai edits finansial terbaru. Hasil AI bukan penjualan terverifikasi.

`listPreorderCampaignResults` menggunakan client owner/RLS dan membaca order/item/payment tersimpan, menolak hasil order query yang terpotong. Satu order dihitung sekali dengan BigInt; hanya payment `paid_sandbox` dengan `applied_at` dalam window `[max(starts_at,published_at), min(ends_at,closed_at))`; manual dipisah, cancelled dikeluarkan, review/unapplied tidak dihitung. Atribusi dan diskon merupakan subset terpisah. UI membagikan `/p/<preorder>?ref=<campaign-slug>` dan menyebut Sandbox serta tidak mengklaim sebab-akibat.

## 4. Full E2E Flow Map

```text
/register → Supabase Auth email → /auth/confirm → /login → /dashboard
  → onboarding/business → products/photo → production capacity → preorder draft
  → publish_preorder → canonical frozen item + pickup terms
  → /dashboard/campaigns → /api/owner/discussions
  → SSR verified owner → loadOwnedPreorderContext → admission/HMAC
  → Gemini adapter [mock historis; live belum] → Strategist + Simulator → persisted proposal
  → /api/owner/blueprints → create/manual edit → approval CAS → persisted Blueprint/tasks
  → /dashboard/campaigns/execution → publish_campaign → frozen active campaign
  → owner preorder detail: campaign link /p/[slug]?ref=...
  → findPublicPreorder/read_preorder_offer → checkout form
  → placeBuyerOrderAction → limiter → placePublicOrder/create_preorder_order
  → authoritative C8 price + capacity hold + order/private-token hash
  → /o/[token] → continuePaymentAction → continueQrisPayment
  → claim_payment_attempt → createQris OR reuse/wait/reconcile → record_payment_charge
  → /api/payments/midtrans/notification: signature → GET Status → apply_verified_payment
  → applied/allocation OR requires_review (tidak dipalsukan sebagai lunas teralokasi)
  → private reload + paid-email job → after()/cron worker → selected email provider
  → /dashboard/preorders/[id] → listPreorderCampaignResults → actual persisted KPI
```

Transisi yang belum dapat ditandatangani: email Auth nyata; current app↔16-chain; retry tanpa storage; Gemini nyata; Midtrans/public webhook nyata; sender/cron terkonfigurasi; browser final pada environment demo. Core P2-2 clock/lock fixes tetap ada pada source 16-chain; adapter tidak mengganti writer pembayaran atau melakukan allocation sendiri.

QRIS hanya memakai `https://api.sandbox.midtrans.com`, server key berformat Sandbox, jumlah dari payment claim. Hanya `create_charge` membuat charge; reconcile 404 tidak membuat referensi baru. Webhook timing-safe SHA-512 lalu GET Status server-ke-server; yang diterapkan adalah fakta status provider, bukan klaim browser. Unit kode **body** `status_code=407`/`expire` menggunakan HTTP 200; jangan menyebutnya bukti menerima HTTP 407. Perilaku wire nyata harus dicatat pada smoke Sandbox. Private status memisahkan applied/unapplied; redirect bukan bukti lunas.

## 5. E2E Scenario Matrix

Legenda bukti: **F** = dijalankan fresh audit ini; **H** = laporan historis yang scope/source-nya diperiksa; **S** = inspeksi source. `VERIFIED WITH MOCK` di tabel merujuk bukti lokal mock historis yang didukung unit fresh, **bukan fresh browser atau provider live**. Status menilai skenario utuh, bukan keberadaan satu fungsi.

| ID / status | Prasyarat & entry | Komponen / expected | Coverage & evidence | Gap → next action |
|---|---|---|---|---|
| E01 UNVERIFIED | Email uji; `/register`, confirm/login/reset | Auth actions → Supabase email → callback → session dashboard/logout | F schema/session/redirect; H login dengan akun terverifikasi; full signup/reset belum | Auth email + config redirect → T3 lokal, T4/T7 Cloud |
| E02 PARTIALLY VERIFIED | Owner login; `/onboarding` | Create business/membership → dashboard; scope owner benar | H P1-1/P3-2 UI; S guard/repository | Runtime current → T1/T3 |
| E03 PARTIALLY VERIFIED | Owned business; products/capacity | Simpan price/cost/photo/kapasitas; reload bytes/facts benar | H P1-1/P3-2 UI/Storage; F Core units | Fresh Storage/owner browser → T3 |
| E04 PARTIALLY VERIFIED | Product/capacity valid; preorder form | Publish canonical RPC → frozen price/pickup/quota | H publication UI/SQL; S dua canonical overload; shape-only read 3/3 | Fresh current-chain publication → T1/T3 |
| E05 VERIFIED WITH MOCK | Published owned preorder; Campaign AI | Real context → admission → provider → recommendation/simulator | F owner/context/AI unit + selected mock; H P3-2 browser/audit prompt | HMAC + Gemini live → T4/T5 |
| E06 VERIFIED WITH MOCK | Saved strategy; Blueprint panel | Create/edit manual tanpa call baru → approve CAS → reload ID sama | F workflow/mock tests; H P1-3/P3-2 UI | Fresh owner route/persistence → T3; live text → T5 |
| E07 VERIFIED WITH MOCK | Approved Blueprint; Execution | Publish authorized → status published, tasks writable sesuai state | F projection/service units; H P2-1/P3-2 UI | Fresh publish/task update/readback → T3 |
| E08 VERIFIED WITH MOCK | Active discount; `/p/slug?ref=campaign` | C8 quote → discounted price, valid attribution ref | H P3-1/P3-2 browser; F pricing/read units | Fresh public route + SQL parity → T3 |
| E09 BROKEN | Valid form; response hilang + storage diblokir | Intent stabil → satu order, token tetap; actual helper mengganti keduanya | F pure retry probe; H happy checkout UI/SQL | Fix intent fallback → T2, lalu lost-response DB/browser T3 |
| E10 BLOCKED BY ENVIRONMENT | Pending order; tombol QRIS | Claim → satu Sandbox charge → persisted QR/amount/expiry | F adapter tests; H buyer SQL/browser gateway mock | Secret merchant/QR wire nyata → T4/T6 |
| E11 BLOCKED BY ENVIRONMENT | Charge; callback publik | Signature + GET Status → idempotent apply/allocation atau review | F signature/adapter unit; H SQL/browser mock | Callback/settlement Sandbox belum → T6 |
| E12 PARTIALLY VERIFIED | Token dari E09; `/o/token` | No-store private read → correct persisted payment/order state | H private status/browser; F Core DTO/schema tests; S headers/meta | Reload sesudah settlement current/live → T3/T6/T8 |
| E13 BLOCKED BY ENVIRONMENT | Applied payment/job; worker/cron | Recheck applied → send → ACK/reference; retry tidak mengubah payment | F 15 email tests; H SQL/Mailpit receipt | Sender/cron belum dipilih/diisi → T4/T7 |
| E14 VERIFIED WITH MOCK | Applied attributed order; owner preorder detail | KPI dari order totals/applied_at; tidak double count; organic terpisah | F 10 metrics; H 4 SQL + P3-2 UI dengan payment mock | Fresh/live settlement→KPI exact readback → T3/T8 |
| N01 PARTIALLY VERIFIED | Owner B; owner A IDs | Guard/RLS menolak read/mutate/context/KPI lintas usaha | F owner/context units; H SQL/browser foreign denial | Fresh session/HTTP dan KPI isolation → T3 |
| N02 PARTIALLY VERIFIED | Draft/invalid/closed preorder; `/p`/order action | Tidak orderable; 404/closed atau Core rejection, tanpa hold | F slug/schema units; H Core SQL | Fresh malformed/unpublished browser/action → T3 |
| N03 PARTIALLY VERIFIED | Quote lama lalu offer berubah | SQL `OFFER_CHANGED`; UI refresh, tidak membuat order/hold | H C8 SQL; S action/UI handling | Fresh stale quote lewat actual form → T3 |
| N04 PARTIALLY VERIFIED | Kuota/last slot; dua buyers | Tepat satu last-slot allocation/hold; sisanya rejection | H SQL concurrency; F availability units | Fresh bounded two-session + buyer HTTP → T3 |
| N05 BROKEN | Sama dengan E09, duplicate/retry | Pair harus sama; DB idempotency hanya melindungi key/token sama | F probe gagal memenuhi invariant storage fallback; H normal replay SQL | Satu root cause E09 → T2/T3 |
| N06 VERIFIED WITH MOCK | Signed event sama diulang/concurrent | Satu apply/allocation/email job; replay duplicate | F adapter/schema tests; H payment SQL/mock HTTP | Fresh SQL + actual route replay → T3; provider repeat T6 |
| N07 VERIFIED WITH MOCK | Webhook signature salah | 401, nol apply/provider-trusted write | F signature unit; H P3-2 HTTP 401 | Fresh route + no-write snapshot → T3 |
| N08 PARTIALLY VERIFIED | Hold lewat deadline; lock wait | P2-2 wall-clock → review/unapplied, tidak overbook/email lunas | H enam SQL dua sesi; S fix source | Fresh R1/R2 on 16-chain → T1/T3 |
| N09 PARTIALLY VERIFIED | Invalid/random token; `/o`/payment action | Tidak disclose order/PII, tidak create charge | F schema/DTO/read tests; H buyer browser/SQL | Fresh invalid/foreign token response → T3 |
| N10 PARTIALLY VERIFIED | Cron secret absent/wrong; `/api/jobs/run` | 401 sebelum client/worker, tidak kirim email | S timing-safe guard; H P3-2 HTTP 401 | Fresh 401 + authorized controlled run → T3/T7 |

**Hitungan 24 skenario:** 0 VERIFIED penuh; 7 VERIFIED WITH MOCK; 11 PARTIALLY VERIFIED; 3 BLOCKED BY ENVIRONMENT; 2 BROKEN (satu bug bersama); 1 UNVERIFIED; 0 NOT IMPLEMENTED. Runtime lama menghalangi fresh local E2E lintas skenario; hitungan ini tidak menyembunyikan hambatan tersebut. Target akhir harus menutup semua baris sesuai level bukti yang dibutuhkan, bukan sekadar mempertahankan status mock.

## 6. Genuine MVP Gaps

### Code defects — C1: intent retry saat storage gagal (P0)

`src/features/public-preorder/checkout-intent.ts::read/write` menelan storage error; `loadCheckoutIntent` lalu membuat intent baru setiap dipanggil. `checkout-form.tsx::submit` memanggilnya untuk tiap retry. Probe Node pada modul aktual, dengan getter sessionStorage melempar, menghasilkan dua boolean kesamaan **false**. Core menerima key baru sebagai order baru. Dengan commit pertama sukses tetapi respons hilang, ini membuka duplicate order/hold dan dapat berlanjut ke dua pembayaran independen. Belum ada reproduksi dua order nyata karena tidak boleh menulis pada instance persisten. Perbaikan minimum: simpan pasangan aktif dalam state/ref per form/mount, tetap coba persist, rotasi hanya setelah keberhasilan/aksi order baru eksplisit; jika tidak ada persistensi, jangan menjanjikan recovery setelah tab ditutup. Tidak perlu mengubah SQL/token schema.

### Integration defects

Tidak ditemukan edge aplikasi yang sepenuhnya hilang antara Core dan buyer/payment/email/KPI pada source current. Ada batas operasional yang harus diuji: provider gagal/charge response hilang, `review` tidak menjadi paid success, retry email setelah commit/ACK, task state, cohort KPI. Ini **missing verification**, bukan bukti bug baru. Link campaign dan token browser yang menjadi koordinasi pada audit pra-Indro kini sudah diimplementasikan.

### Infrastructure/configuration — E1/E2 (P0)

Harness inventory 14 dan jalur `runDatabaseContracts` belum menerapkan dua migration akhir pada full-chain run. Mengubah allowlist saja tidak cukup; urutan apply dan final catalog/contracts harus mengikuti 16 source tanpa melemahkan historical assertions. App/DB current juga belum tersedia bersama. Database reusable bukan izin reset. `.env.local` yang diperiksa tidak memiliki HMAC/Midtrans/email/cron, sehingga klaim handoff konfigurasi tidak berlaku otomatis di laptop ini.

Limiter nyata adalah **6 checkout attempts/IP/600 detik** dan **10 tombol cek status provider/token/600 detik**. Page polling `/o` membaca DB setiap 5 detik dan bukan request provider yang dibatasi. Limit mengembalikan result `RATE_LIMITED`/`rate_limited` pada Server Action/UI, bukan jaminan HTTP 429. Tanpa HMAC atau saat RPC error limiter **fail-open/disabled** dengan log; quota/payment SQL tetap berjalan. Batas 10 status belum diuji SQL oleh suite tiga limiter tests (suite itu berfokus checkout); tambahkan verifikasi action-level terarah di T3. Hosting harus menyediakan forwarded IP yang tepercaya agar batas per IP bermakna.

### External service/account dependency — X1 (P0)

Gemini, merchant Sandbox + simulator, webhook HTTPS publik, email/domain sender, Supabase Cloud SMTP/redirect template, dan cron hosting memerlukan keputusan/akun/izin tim. Tidak ada panggilan provider nyata atau konfigurasi cloud dalam audit. Paid email Resend/API dan Auth email SMTP adalah dua sistem berbeda.

Deadline “SMTP Cloud 10 November 2026 23.59 WIB” **tidak ditemukan sebagai ketentuan khusus SMTP**. PRD baris awal memuat deadline proyek pada waktu itu dan meminta cek ketentuan panitia. Perlakukan SMTP sebagai tindakan tim yang mendesak untuk menyelesaikan E01, bukan deadline resmi provider yang sudah diverifikasi.

### Test evidence gap — V1 (P0)

208 SQL integrations dan 24/24 browser belum direproduksi pada HEAD ini; runner browser lokal Rafi tidak ikut checkout. Registrasi/verifikasi/reset, storage-disabled retry, manual check limit 10, real QRIS wire/expiry 407, sender/cron deployment dan complete provider E2E belum memperoleh bukti yang cukup. Unit/mocked PASS tidak menutup gap tersebut. Dokumen README/handoff/schema header juga tertinggal; pembaruan ringkas pada final runbook diperlukan, tanpa audit historis ulang.

## 7. Prioritized Completion Roadmap

Semua tugas berikut **rencana**, belum dimulai. Tidak ada pekerjaan untuk mengganti arsitektur atau menambah schema. Perubahan schema baru, bila ternyata diperlukan, tetap tugas berizin terpisah.

### Phase A — runtime dan test readiness

**T1 — P0 / M: selaraskan harness dan runtime 16 migration.**

- **Tujuan/gap:** hilangkan failure fresh inventory 14/16 dan sediakan target current-source yang aman.
- **Scope/files:** `database/v2.1/tests/{migration-contract,job-acknowledgement,current-contracts}.mjs`, `scripts/test-database-v21.mjs`, prosedur bootstrap disposable existing; app copy/config khusus tes. Review inventory lalu apply dua file existing setelah F1; verifikasi final catalog/ACL/signatures/types. Jangan mengarang migration baru.
- **Dependensi:** tidak ada; otorisasi task setup terisolasi baru. Akun eksternal tidak dibutuhkan; developer menyiapkan secret lokal khusus tes.
- **Acceptance/evidence:** 16 filename/hash dan ledger cocok, final contracts berjalan, runtime app source hash cocok HEAD, Auth/Storage/Mailpit lokal siap, binding/volume/cleanup milik target baru terbukti; typecheck/lint dan harness strict lulus.
- **Code changes:** harness/prosedur test seperlunya, tidak application feature. **Jangan ubah:** migration body, schema, `.env.local` asli, volume/data instance lama, atau test expectation bisnis untuk memaksa hijau.

### Phase B — satu bug dan alur lokal gabungan

**T2 — P0 / S: pertahankan checkout intent saat storage diblokir.**

- **Tujuan/gap:** C1, pasangan berubah saat retry; scope satu form/helper.
- **Files/change:** `public-preorder/{checkout-form.tsx,checkout-intent.ts}` dan tes terarah; pegang intent aktif dalam memory form, storage hanya persistence tambahan. Rotasi setelah sukses/niat baru eksplisit.
- **Dependensi:** unit bisa mulai sendiri; T1 untuk pembuktian DB/browser. Tidak perlu credential/keputusan akun.
- **Acceptance/test:** storage normal, throwing getter/setter, response-lost setelah commit, double submit dan retry memakai token/key sama; tepat satu order/hold/payment claim. New order sesudah sukses mendapat pasangan baru. Nyatakan batas recovery setelah tab hilang tanpa storage.
- **Code changes:** ya, kecil. **Jangan ubah:** Core idempotency, private-token hash/entropy, query schema, rate limits, global state/library baru.

**T3 — P0 / M: buktikan local E2E 24 scenario pada source current.**

- **Tujuan/gap:** V1; mengganti klaim agregat dengan hasil per scenario.
- **Files/scope:** existing `tests/supabase/{buyer-checkout,campaign-offer,payment-integrity,paid-email,campaign-results,rate-limit}.test.ts`, owner/AI tests; pulihkan/adapt runner Rafi menjadi runner versioned terarah (misalnya file baru `tests/browser/mvp-e2e.mjs`, belum ada sekarang). Reuse seam provider transport/test-bundle existing, tanpa debug endpoint produksi.
- **Dependensi:** T1/T2. Tanpa real provider; Auth lokal+Mailpit, AI/Midtrans mock wajib teridentifikasi dan network external diblokir untuk run.
- **Acceptance/test:** fresh SQL suite 208 atau jumlah aktual yang dijelaskan; E01–E14/N01–N10 masing-masing status/log; owner A/B; canonical publish; admission tetap aktif; manual edit tanpa inference; live DB quote/order parity; lost-response retry; R1/R2/last-slot bounded; limits checkout ke-7/status-check ke-11; cron 401; email/job/KPI exact. Browser desktop/mobile, refresh, tanpa PII/secret di artifact.
- **Code changes:** test runner/coverage saja kecuali defect baru direproduksi dan dibuat task koreksi kecil. **Jangan ubah:** existing expected business behavior, reusable DB, source provider menjadi fake-success normal.

### Phase C — provider, akun, dan deployment yang diperlukan

**T4 — P0 / M: tetapkan environment demo dan konfigurasi eksternal.**

- **Tujuan/gap:** E2/X1; tim memilih target, email provider/domain, merchant Sandbox dan public webhook/cron/SMTP.
- **Scope/files:** `.env.example`/runbook existing jika perlu, process/deployment secret settings dan konfigurasi Supabase Auth/hosting melalui tugas berizin. Developer dapat memeriksa nama/config serta redirect routes; tim menyediakan akun/credential/domain/akses hosting dan menyetujui pengiriman/call.
- **Dependensi:** keputusan tim dapat berjalan paralel T1; validasi aplikasi sesudah T3. **Acceptance:** HMAC valid ≥32 karakter, Gemini config valid, merchant Sandbox/config valid, HTTPS callback tepat, sender terverifikasi, Auth confirmation/recovery redirect dan SMTP, cron bearer ≥16 karakter + jadwal platform yang didukung, secret hanya server. Tidak memilih produksi diam-diam.
- **Test/evidence:** config/metadata tanpa nilai secret, local health, target ledger/source identity, HTTP cron tanpa auth 401; belum dianggap live provider PASS.
- **Code changes:** umumnya tidak; hanya bounded config/runbook/hosting schedule bila diperlukan. **Jangan ubah:** tenant/RLS, payment provider, real-money endpoint, schema, shared env tanpa izin.

**T5 — P0 / S: smoke Gemini nyata melalui owner workflow.**

- **Tujuan/gap:** request model nyata belum terbukti; bukan rewrite AI.
- **Files:** `campaign-strategist/{owner-provider,owner-api}.server.ts`, `campaign-blueprint/gemini.server.ts`, loader P1-2, quota policy existing.
- **Dependensi:** T3/T4 dan izin panggilan AI nyata (potensi biaya/quota). **Acceptance/test:** satu owner/preorder nyata, admission/HMAC aktif, output lolos schema/grounding/simulator, tersimpan; manual save tidak memanggil ulang; approve/reload dengan source hash/CAS benar. Rekam model/provider/request evidence yang aman dan count; jangan pakai mock untuk hasil ini.
- **Code changes:** tidak secara default; perbaiki hanya mismatch terukur jika ditemukan. **Jangan ubah:** model/provider tanpa keputusan tim, quota/budget guard, data owner lain, source-integrity guard.

**T6 — P0 / M: smoke Midtrans Sandbox dan webhook publik nyata.**

- **Tujuan/gap:** E10/E11 belum memiliki provider/wire evidence.
- **Files:** `payments/{midtrans-sandbox.ts,qris-checkout.server.ts}`, notification route, buyer payment actions/panel, Core payment RPC existing.
- **Dependensi:** T3/T4, credential Sandbox tim, callback publik dan izin call; pengguna/tim menjalankan simulator Sandbox bila perlu. **Acceptance/test:** actual QRIS → simulator → signed HTTP notification → GET Status → correct amount/reference → satu apply/allocation/job; refresh/reconcile tidak charge kedua; private status benar. Catat HTTP status dan body status code secara terpisah, termasuk expiry 407 bila diuji. Late/review dan invalid signature tetap diuji dengan mock/SQL; jangan membuat transaksi berbahaya demi coverage.
- **Code changes:** tidak kecuali response mismatch terbukti. **Jangan ubah:** P2-2 clock/lock safeguards, server-authoritative amount, retry identity, endpoint menjadi production atau uang nyata.

**T7 — P0 / M: tutup Auth email, paid email dan cron.**

- **Tujuan/gap:** E01/E13 serta retry pengiriman belum terbukti pada provider/hosting yang disepakati.
- **Files:** auth actions/callback/templates, `paid-email/*`, `api/jobs/run`, jobs repository, hosting schedule/runbook.
- **Dependensi:** T4 untuk akun/domain/SMTP/cron; T6 untuk satu payment/job nyata, atau job test pada target terisolasi yang diotorisasi. Pengiriman email eksternal/remote config butuh izin task ini; recipient test milik tim.
- **Acceptance/test:** daftar → email → verify/login; forgot/reset → login baru/logout session; payment applied saja mengirim receipt dengan total/frozen pickup/label Sandbox tanpa token privat; receipt diterima, providerReference dan job ACK persisted; retry/dupe tidak menggandakan effect pada provider yang mendukung idempotency. Cron salah/absen secret 401; cron sah/inline tidak mengubah payment, backlog/retry/failed job terlihat. Verifikasi Mailpit dan provider eksternal sebagai bukti berbeda.
- **Code changes:** hanya config/schedule atau defect yang direproduksi; jangan membangun worker baru. **Jangan ubah:** Auth SMTP dianggap sama dengan Resend API, state pembayaran untuk memancing email, email produksi/recipient tanpa izin.

### Phase D — sign-off

**T8 — P0 / M: final E2E browser + KPI dan laporan sign-off.**

- **Tujuan/gap:** belum ada bukti final satu alur yang mencakup semua accepted provider dan 24 scenario.
- **Scope/files:** existing buyer/owner routes, `campaign-results/*`, bounded runner T3 dan satu laporan sign-off/runbook. Perbarui ringkas README/handoff status agar menunjuk bukti current, bukan mengulang audit umum.
- **Dependensi:** T1–T7; tim menyatakan apakah Cloud Auth/hosting adalah target demo wajib. **Acceptance/test:** E01–E14 positif, N01–N10 negatif dengan bukti tepat; payment → owner confirmation lewat existing order action → KPI readback; satu paid attributed order qty2/base120.000/diskon10% harus total216.000, potongan24.000, satu order/dua unit/atribusi benar, email/job sekali. Kasus organik/manual/cancel/review punya fixture terpisah dan angka eksak. Ulang reload dan tenant isolation.
- **Code changes:** tidak default, kecuali test/document. **Jangan ubah:** KPI menjadi output AI, menutupi provider blocked dengan mock PASS, atau menyatakan production-ready tanpa bukti. **Effort P1 tambahan:** rapikan runbook akun/operasi pada penutupan tugas ini; Memory/Evaluation/polish P2 ditunda.

## 8. Environment & External Services Checklist

| Item | Developer dapat menyiapkan | Tim/pemilik akun harus menyediakan/menyetujui | Exit evidence |
|---|---|---|---|
| Supabase 16-chain | Harness guarded, target disposable baru, source sync, catalog/ACL/Storage checks | Izin setup target baru atau upgrade terpisah dengan backup | Ledger/hash cocok, tidak memakai normal/14-chain |
| Local Auth + Mailpit | Confirmation/recovery test lokal, template/callback redirect | Recipient lokal/test; tidak ada email eksternal | Message→link→session terbukti |
| Cloud Auth SMTP | Config review, Site URL/redirect allowlist dan template yang sesuai `/auth/confirm` | Akses Cloud project, SMTP credentials/sender/domain, keputusan wajib Cloud | Actual signup/verify/reset di URL demo; status account provider diperiksa tim |
| Gemini | Adapter/quota config validation tanpa menampilkan nilai | API key/model yang disepakati, budget/izin smoke | Request real admitted + persisted output/schema PASS |
| HMAC | Validasi panjang/usage, limiter/admission tests | Secret berbeda per environment, disimpan server | AI admission dan limit enforcement aktif; tidak dirotasi untuk melewati quota |
| Midtrans | Sandbox-only adapter/QR/UI/callback path | Satu akun Sandbox tim, `MIDTRANS_SERVER_KEY`, `MIDTRANS_MERCHANT_ID`, persetujuan simulator | Charge+verified status/notification nyata, tanpa duplicate |
| Public webhook | Target HTTPS benar, response/error mapping | Hosting/tunnel yang disetujui; dashboard notification URL `/api/payments/midtrans/notification` | Notifikasi internet tiba dan tervalidasi; jangan mengarang env var URL yang tidak dibaca kode |
| Paid email | `EMAIL_PROVIDER`, `EMAIL_FROM`, provider adapter/receipt tests | Pilih Mailpit untuk lokal atau akun/domain sender eksternal (mis. `RESEND_API_KEY` bila memilih Resend) | Actual accepted receipt + persisted job/provider reference |
| Cron | `GET /api/jobs/run`, guard dan config schedule hosting yang mendukung | `CRON_SECRET`, akses/jadwal hosting, target URL | 401 tanpa auth; run sah, retry/backlog dan ACK terbukti |
| Secret management | Placeholder aman, server-only import boundary, redaksi artifact | Team secret store/rotation policy dan environment target | Tidak ada service-role/Midtrans/API keys pada client/log/Git |

Tidak ada `vercel.json` ditemukan; adanya route cron bukan bukti scheduler hosting sudah dipasang. Kehadiran `GEMINI_API_KEY` di file juga bukan bukti key/model/quota valid. Tidak ada verifikasi akun cloud dilakukan selama audit.

## 9. Exact Final E2E Test Plan

### Urutan dan batas target

1. **T1 preflight:** branch/HEAD/status/hash; 16 migration source, ledger, catalog/types; exact disposable project/container IDs, network/volume/port; app source sama HEAD. Child environment mengecualikan real provider keys saat run lokal. Jangan reset/migrate reusable/normal DB.
2. **Unit/mocked:** jalankan `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build` dan tujuh AI integrations yang sudah dipilih. T2 menambah regresi normal/throwing storage dan lost-response. Bukti mock jangan dicampur dengan provider real.
3. **Disposable PostgreSQL:** setelah harness diperbarui T1, jalankan `node scripts/test-database-v21.mjs --strict-docs`. Untuk real Supabase tests, isi seluruh override test secara privat (`TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_KEY`, `TEST_DB_CONTAINER`, `TEST_MAILPIT_URL`) dengan target disposable terverifikasi, baru `npm.cmd run test:integration`. Helper default membaca `.env.local`; jangan menjalankannya tanpa override/identity guard. Capture actual count, failure/skip dan bounded concurrency outcomes, bukan memakai angka 208 sebagai target yang harus dipaksa.
4. **Local browser/HTTP:** runner T3, AI mock hanya pada app test bundle, Midtrans mock pada transport, mail ke Mailpit milik stack. Buat owner A dan B lewat signup flow teruji; E01 memerlukan confirmation/reset email lokal, bukan hanya Auth Admin `email_confirm=true`. Jalankan E02–E14, kemudian N01–N10. Fixture capacity/quota dan jadwal dibuat relatif waktu WIB agar tidak melewati cutoff saat run.
5. **External Sandbox:** setelah akun/izin T4, lakukan T5 Gemini, T6 Midtrans melalui simulator dan public callback, T7 paid/Auth email+cron. Jangan memakai mock saat memberi label LIVE PROVIDER VERIFIED. Manual participation dicatat untuk account setup, simulator, membuka verification/reset link dan receipt inbox.
6. **Demo/Cloud browser:** T8 mengulang happy journey dengan target intended demo, lalu negatif yang aman; destructive/race/invalid-state memakai disposable tests, bukan shared Cloud. Capture evidence final pada satu source/config baseline yang diketahui.

### Fixture dan assertions wajib

- Business A: satu SKU price120.000/cost75.000 estimated, photo, capacity/quota memadai, published canonical preorder, target realistis; business B untuk tenant denial. Gunakan UI/RPC publikasi canonical, bukan direct camelCase snapshot.
- Campaign diskon10%: Blueprint manual edits tersimpan/approved, publish, share link. Buyer qty2 harus membayar216.000 dari SQL, bukan nilai client. Organic order, manual confirmed order, review/unapplied/cancelled, stale quote, future/expired/closed offer dan last-slot memakai fixture terpisah agar expected KPI jelas.
- Catat sebelum/sesudah: order/payment/reservation IDs yang direduksi, total/diskon, attempt count, transaction/event mapping, satu `applied_at`, satu paid-email dedupe job, complete ACK/provider reference, owner KPI dan private status.
- Response-lost setelah order commit harus tetap memakai token/key sama; storage getter dan setter gagal termasuk test. Dua attempt itu satu order/hold. Duplicate webhook/manual reconcile satu apply/job; provider timeout/404 tidak mengizinkan charge/reference baru.
- R1/R2: dua sesi bounded dengan bukti lock/wait/deadline dan SQLSTATE, lalu review/allocation/job snapshot; jangan menyatakan deadlock universal bebas.
- Limits: checkout ke-7 dari subject/window sama rejected tanpa order/hold; check-status ke-11 tidak menambah provider call; reset window/subject berbeda; polling page tidak charge/GET Status provider.
- Artifact per ID: prerequisite/target/time, step/result, actual HTTP status/action code, provider mode, DB assertion, screenshot desktop/mobile, console errors, reason skip/block. Secret/token penuh/PII tidak ikut artifact publik; token raw hanya di browser/test secret store.

## 10. Final Sign-off Criteria

- [ ] **Level 1 — integrated code ready:** required components dalam satu branch, current tests/build pass, T2 retry defect ditutup, harness 16-chain dapat dijalankan. Saat audit: struktur/regresi PASS, tetapi level ini belum selesai tanpa bug/harness closure.
- [ ] **Level 2 — local/disposable E2E ready:** current app+16-chain berjalan bersama; 24 scenario mempunyai hasil fresh yang sesuai; Auth email lokal, real SQL, mock AI/Midtrans, Mailpit, cron, private state dan KPI terhubung. Tidak ada assertion hilang di balik “24/24” agregat.
- [ ] **Level 3 — external Sandbox ready:** Gemini real, QRIS Sandbox real/verified webhook, sender email aktual, Cloud Auth bila diwajibkan, dan intended demo browser/scheduler terbukti. Account/SMTP/callback yang belum tersedia diberi BLOCKED, bukan PASS.
- [ ] **Level 4 — final MVP sign-off:** E01–E14 dan N01–N10 memenuhi bukti yang sesuai, tanpa duplicate order/charge/apply/email yang tidak ditangani, overbooking, amount mismatch yang diterapkan, tenant/PII leak atau KPI fiktif. Owner bisa mengonfirmasi order dan melihat hasil persisted; buyer melihat status yang sama setelah reload.
- [ ] Laporan final mencantumkan SHA/source/env/schema, provider real vs mock, commands/counts/skip, artifact, batas operasional serta persetujuan tim. Tidak ada unresolved P0; keterbatasan optional ditulis jelas.

## 11. Recommended Immediate Next Task

**Mulai hanya T1: perbaiki harness 16 migration dan siapkan runtime disposable current-source yang terverifikasi.** Ini dependency bersama untuk membuktikan bug retry sampai database, registrasi/email lokal, buyer/QRIS/job dan KPI; menghindari hasil dari app/DB lama. T2 dapat menyusul segera dengan fix kecil, bukan audit ulang.

Tugas T1 belum dijalankan. Audit ini hanya menambah dokumen ini, menjaga laporan untracked sebelumnya, serta menjalankan pemeriksaan aman/read-only. Tidak mengubah source/test assertions/migration/`.env.local`/Supabase config, tidak memigrasikan/reset database persisten, mengirim email nyata, memanggil Gemini/Midtrans live, menggabungkan branch, commit/push atau deploy. Container PostgreSQL sekali pakai milik harness dibersihkan setelah inventory guard menolak run; database normal hanya terlihat metadatanya, tidak diakses SQL.
