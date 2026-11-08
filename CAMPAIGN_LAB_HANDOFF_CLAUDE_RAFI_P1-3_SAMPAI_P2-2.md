# CAMPAIGN LAB — HANDOFF UNTUK CLAUDE (RAFI)
## Lanjutkan MVP dari P1-3 sampai P2-2, sebelum merge Indro

**Tanggal konteks:** 8 November 2026  
**Penerima:** Claude yang bekerja bersama Rafi pada repository lokal Campaign Lab  
**Mode kerja:** **IMPLEMENTASI + VERIFIKASI**, bukan audit umum atau sekadar membuat plan  
**Prinsip:** **MVP first · reuse existing code · smallest complete change · no overengineering**

> **Instruksi utama untuk Claude:** Baca handoff ini, periksa status repository dan pekerjaan yang sedang berjalan, lalu **selesaikan hanya pekerjaan yang belum selesai dari P1-3 → P2-1 → P2-2 secara berurutan**. Kerjakan tiap tahap sampai ada bukti, tulis QA singkat, baru lanjut tahap berikutnya. **BERHENTI setelah P2-2**; kode Indro **belum merge**, jadi jangan mengerjakan P2-3/P2-4 atau mencoba membuat penggantinya.

---

## A. Tujuan produk dan batas kerja tim

Campaign Lab adalah platform **preorder UMKM**: owner mengelola produk/preorder, menggunakan AI untuk merencanakan campaign, menyetujui Blueprint, mengaktifkan promo yang memengaruhi harga preorder, lalu nantinya pembeli checkout melalui modul Indro. MVP tidak memerlukan sistem AI atau infrastruktur yang sempurna; yang penting alur inti berjalan dengan benar dan aman.

**Status kolaborasi yang wajib dipahami:**

- **Kode Steven dan Rafi SUDAH DIGABUNG menjadi satu codebase** pada branch kerja. **Tidak ada proses “merge Rafi ke Steven” atau “merge Steven ke Rafi” lagi.**
- Steven berfokus pada Strategist/Simulator/Blueprint/Execution; Rafi berfokus pada Auth/Core/Preorder/SQL/Payment Persistence. Pembagian ini adalah kepemilikan area, **bukan dua repository yang perlu di-merge kembali**.
- **Kode Indro (buyer catalog, checkout, Midtrans Sandbox) BELUM di-merge**. Integrasi Indro baru dilakukan **SETELAH P2-2**, melalui P2-3 dan P2-4. Jangan membuat ulang fitur Indro atau mengasumsikan route/adapter-nya tersedia.
- Setelah merge Indro, masih ada **P3-1 (KPI aktual)** dan **P3-2 (final E2E)**. **Bukan bagian dari mandat handoff ini.**

### Roadmap lengkap sebagai orientasi

| Task | Status berdasarkan handoff | Scope |
|---|---|---|
| P1-1 — Isolated Supabase + Owner Core Smoke | **PASS** | Sudah selesai; jangan ulang dari nol |
| P1-2 — Real Core → AI Context | **PASS (data/service)** | Sudah selesai; pakai integrasinya |
| **P1-3 — Owner AI + Blueprint + Execution UI** | **SEDANG/AKAN dikerjakan; hasil akhir belum dikirim** | **Selesaikan jika belum PASS** |
| **P2-1 — Campaign Pricing & Attribution (C8)** | **PENDING** | **Kerjakan sesudah P1-3** |
| **P2-2 — Payment Integrity (A6-09/U01)** | **PENDING** | **Kerjakan sesudah P2-1** |
| P2-3 — Buyer UI/Checkout | Belum merge Indro | **JANGAN KERJAKAN** |
| P2-4 — Midtrans Sandbox adapter | Belum merge Indro | **JANGAN KERJAKAN** |
| P3-1 — Actual KPI | Pending | **JANGAN KERJAKAN** |
| P3-2 — Full MVP E2E | Pending | **JANGAN KERJAKAN** |

---

## B. Kondisi aktual dan dokumen sumber kebenaran

### B1. Pencapaian yang sudah terbukti (jangan dibangun ulang)

**P1-1 PASS:** Supabase terisolasi asli + Next berhasil menjalankan browser journey: login → business → product/foto Storage → capacity → preorder draft → publish → reload → foreign-owner denied. Real Auth/PostgREST/PostgreSQL/Storage digunakan, bukan mock.

**P1-2 PASS pada data/service:**

- Modul konteks nyata: `src/features/ai-context/owned-preorder-context.server.ts`.
- Use case Strategist: `src/features/campaign-strategist/owned-strategy.server.ts`.
- Owner scoped → business/preorder nyata → harga preorder **frozen** → cost + quality (NULL tidak dianggap nol) → quota/capacity → paid/allocated/live-held → source IDs/versions → AI context schema/hash → Strategist/prompt/simulator existing.
- **Tidak ada fallback ke demo 40 unit.** `NULL` payment tidak dianggap paid, held kedaluwarsa tidak dihitung live. Readback historis P1-2: **paid manual 3, orderable 39**; itu nilai fixture pada waktu tes, **bukan konstanta**.
- Historis P1-2: **1.143 unit PASS, 69 selected mocked AI PASS, 5 real integration PASS**; typecheck/lint/build/owner HTTP readback PASS. **Browser AI dan live Gemini belum dibuktikan.**

**Hardening sebelumnya:** A1/A2/A3, F1 money bounds dan owner CAS lulus di disposable PostgreSQL. Jangan membongkar ulang atau mengubah fungsi yang sudah bekerja tanpa bukti regresi baru.

### B2. Lingkungan uji MVP yang sudah tersedia

Project Supabase terisolasi: `cl-mvp-72e87c9aa2bc`  
API: `http://127.0.0.1:56321`  
Next app: `http://127.0.0.1:3301`  
Schema terakhir yang diketahui: **14 active root migrations**, **26 tabel**, **352 kolom**, **50 public RPC signatures**, strict schema **zero drift**.

**PENTING:** App di port `3301` adalah **SALINAN source**, bukan watcher repository utama. Perubahan dilakukan di repo utama terlebih dahulu. Untuk uji runtime, ikuti prosedur sync/restart dari laporan P1-1; jangan mengubah source hanya di salinan app. Verifikasi ulang identitas container, port dan process sebelum memulai/menghentikan layanan.

**DB Campaign Lab lama berbeda dan tidak boleh disentuh:** `supabase_db_campaign-lab` tercatat baru **9 migration**, berisi **2 published preorder legacy camelCase**. Jangan `reset`, `push`, `repair`, migrasi, backfill, atau menjalankan test mutasi ke DB lama. Jangan menyentuh remote database.

### B3. Baca ini sebelum mengedit

1. `AGENTS.md` — aturan coding proyek.
2. `AI_MODULE_HANDOFF.md`.
3. `docs/schema.md` dan `docs/requirements/PRD.md` — kontrak domain, bukan alasan menambah semua fitur non-MVP.
4. `docs/plans/CAMPAIGN_LAB_MVP_GAP_AUDIT_AND_IMPLEMENTATION_PLAN_2026-11-08.md` — roadmap resmi dan detail blocker G1–G6/R1–R2.
5. `docs/qa/CAMPAIGN_LAB_MVP_P1_1_ENVIRONMENT_AND_CORE_SMOKE_2026-11-08.md` — manifest dan **runbook reuse/safe shutdown**.
6. `docs/qa/CAMPAIGN_LAB_MVP_P1_2_REAL_AI_CONTEXT_INTEGRATION_2026-11-08.md` — kontrak konteks terbaru.
7. `docs/plans/POST_MERGE_BATCH_A6_BUSINESS_LOGIC_INTEGRATION_AUDIT_2026-11-07.md` — temuan C8 dan payment, baca bagian terkait saja.
8. `docs/qa/POST_MERGE_A6_F0_PLATFORM_TARGET_EVIDENCE_REPORT_2026-11-08.md`.
9. `docs/qa/POST_MERGE_A6_F1_FINANCIAL_CAS_INTEGRITY_REPORT_2026-11-08.md`.
10. Jika sudah ada, baca `docs/qa/CAMPAIGN_LAB_MVP_P1_3_OWNER_AI_WORKFLOW_2026-11-08.md` dan perubahan yang mungkin dibuat oleh agent Steven.

**Cek branch/HEAD dan `git status` aktual.** Last known branch `merge/ai-campaign`, HEAD `5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762` adalah **historis**, bukan asumsi kondisi kini. Banyak pekerjaan sebelumnya masih dirty/untracked; **jangan reset/stash/overwrite perubahan orang lain**.

**Koordinasi kerja paralel:** P1-3 mungkin sedang dikerjakan agent lain. Sebelum mengedit area yang sama, periksa file/perubahan terbaru dan apakah ada proses agent aktif. Jangan menimpa pekerjaan yang belum selesai. Jika P1-3 sudah PASS dengan bukti, **skip implementasinya**, hanya verifikasi kontrak lalu mulai P2-1. Jika belum selesai, lanjutkan dari kondisi aktual, bukan membangun ulang.

---

## C. P1-3 — Owner AI / Blueprint / Execution dari dashboard

### Hasil yang wajib tercapai

Owner hanya **login sekali via Supabase Auth existing**, masuk dashboard, memilih **preorder miliknya**, menjalankan Strategist memakai **context real P1-2**, melihat hasil dan simulator, melakukan **manual edit**, **approve Blueprint**, reload dan melihat data approved yang sama, lalu membuka **execution plan/jadwal/checklist** dari halaman owner.

**C8 belum ada pada awal P1-3:** jangan klaim promo sudah aktif untuk pembeli, jangan memaksa publish campaign melewati fail-closed guard. **Blueprint approved + execution view** cukup untuk PASS P1-3; buyer-facing activation dilanjutkan P2-1.

### Implementasi minimum

1. **Reuse owner session** `Supabase Auth SSR` dan owner/business guard yang sudah dipakai core. Server menurunkan identitas dan business scope; tidak mempercayai userId/businessId dari browser sebagai bukti hak.
2. Tambahkan **satu entry owner AI** pada dashboard/navigation dan route/API tipis sesuai struktur existing. Reuse discussion/strategy/Blueprint/execution UI & service yang ada; jangan menduplikasi satu workspace.
3. Sambungkan route owner ke `owned-preorder-context.server.ts` dan `owned-strategy.server.ts`. **Bukan** ke fixture development. `/dev/*` dan bearer/cookie development harus **tetap terpisah dan tetap dijaga**.
4. Pakai existing Blueprint create/revision/manual edit/approval, CAS, version/source hash, simulator dan persistence. Perubahan real/synthetic provenance harus **jujur**; jangan melemahkan Memory/Evaluation synthetic-source guards.
5. Tampilkan execution timeline, budget, target, checklist melalui service/projection existing. Task update hanya jika diperbolehkan state/ownership. Jangan membuat scheduler baru.
6. Jika reused discussion polling nyata menimpa sesi baru (A6-10), patch generation/active-session guard sekecil mungkin **dengan test reproduksi**. Jika replan termasuk flow owner dan benar-benar memakai angka lama (A6-11), patch input current facts minimal. Jangan jadikan keduanya proyek terpisah tanpa bukti.
7. **Jangan panggil Gemini live** demi smoke P1-3; pakai mocked provider lewat test seam yang aman, tanpa test-only bypass di endpoint normal. Jangan mematikan quota/admission atau mengarang HMAC secret.

### Bukti PASS P1-3

- Real owner Auth HTTP + aplikasi/browser: login → dashboard AI → pilih preorder → Strategist dengan fakta P1-2 → review/simulator → manual edit → approve → reload → execution/checklist.
- Owner asing/anon tidak dapat membaca/mutasi preorder/Blueprint/campaign. Dev bearer token tidak bisa login endpoint owner.
- Approval stale version/context tidak diterima; tidak ada fallback demo; audit trail/provenance benar.
- Jika browser tidak tersedia, catat **PARTIAL** dengan real HTTP + integration evidence; **jangan klaim browser PASS**.
- Typecheck, lint, unit yang relevan, selected AI mocks, build lulus.

**Output:** ringkasan QA P1-3. Gunakan path laporan yang sudah ditetapkan bila belum ada: `docs/qa/CAMPAIGN_LAB_MVP_P1_3_OWNER_AI_WORKFLOW_2026-11-08.md`. Jangan membuat laporan ganda untuk task yang telah selesai.

---

## D. P2-1 — Campaign Pricing + Attribution (C8)

### Mengapa ini blocker MVP

Core checkout SQL masih menggunakan placeholder:

- `private.current_order_offer` → diskon `0`, campaign pricing `NULL`.
- `private.resolve_attribution` → attribution `NULL`.

Existing `read_preorder_offer` dan `create_preorder_order` memanggil jalur ini. Di sisi Steven, published-offer contract/projection sudah tersedia (cek `campaign-execution/published-offer.server.ts`, `projections.ts` dan kontrak sebenarnya). **P2-1 menyambungkan keduanya**, tanpa membuat ulang pricing engine atau checkout.

### Target minimum

Saat campaign sudah **approved/published/eligible menurut state machine aktual**, harga yang ditampilkan untuk preorder dan harga yang ditulis ke order harus memakai **aturan promo yang sama**, dicek kembali **secara atomik oleh database** pada waktu order. Saat tidak ada campaign eligible, gunakan base price yang sah.

**Pricing campaign ID ≠ attribution campaign ID.** Pemberian diskon dapat berlaku tanpa atribusi referral yang valid. Ref dari query/cookie tidak otomatis trusted; harus divalidasi server ke campaign/preorder/business/waktu yang benar.

### Implementasi minimum

1. Baca actual SQL/contract publication, Blueprint approved facts, effective window, published/closed status. Temukan sumber promo yang **dibekukan saat publish**. Jangan mengambil angka dari teks AI/Blueprint draft atau mutable product price.
2. Buat **satu migration baru forward-only** setelah chain aktif (jangan edit 14 file migration yang sudah ada). Scope hanya function SQL yang perlu untuk C8 dan tests/typed contract relevan. **Tidak tambah tabel baru** jika informasi existing sudah memadai.
3. Hubungkan `private.current_order_offer` ke published eligible offer. Pastikan `read_preorder_offer` dan `create_preorder_order` menghasilkan **quote/order parity**, dengan lock/version/expected price checks existing; jangan menambahkan JS prefetch sebagai pengganti verifikasi SQL.
4. Hubungkan `private.resolve_attribution` bila skema/kontrak ref sudah tersedia. Tolak ref palsu/foreign/expired. Jika attribution dari jalur yang belum hadir karena Indro belum merge, **uji kontrak DB dengan synthetic ref**, jangan buat buyer UI.
5. Jika publication guard sebelumnya memblokir alur karena C8 belum siap, selesaikan keterkaitannya **melalui kontrak resmi**, bukan menonaktifkan guard atau menyetel status bohong. Pastikan owner bisa publish campaign hanya ketika data valid dan efek harga siap.
6. Reuse `pricing` dan simulator current. Formula diskon, pembulatan IDR, batas Rp1 miliar F1, frozen price, CAS, RLS, business scope dan quota tidak boleh melemah.
7. Jika ada ambiguity aturan domain atau fungsi schema tidak menyediakan data yang benar, dokumentasikan **blocker spesifik** dan jangan mengarang state/kolom baru tanpa justifikasi.

### Bukti PASS P2-1 (disposable SQL + real platform bila feasible)

- Base-price saat tanpa campaign; scheduled/belum efektif; active/published; closed/expired; invalid business/preorder; discount boundaries.
- `read_preorder_offer` dan `create_preorder_order` memakai harga/discount yang sama; stale `expected_unit_price` ditolak tanpa partial order/reservation.
- **Promo organic** valid walau attribution NULL; attribution hanya ada untuk ref yang valid dan sesuai scope.
- Harga/order tetap server-authoritative; no double-discount, no invalid quota, ownership/RLS aman, idempotency unchanged.
- Approval/publication → offer DB terbaca bila eligible; cek actual runtime yang tersedia tanpa menganggap buyer UI Indro sudah ada.
- Focused regression untuk A3/F1 dan related pricing; typecheck/lint/build/unit sesuai diff; no live provider.

**Output:** satu laporan ringkas, misalnya `docs/qa/CAMPAIGN_LAB_MVP_P2_1_CAMPAIGN_PRICING_ATTRIBUTION_2026-11-08.md` dengan migration baru, status test, known limitation dan handoff Indro.

---

## E. P2-2 — Payment Integrity: A6-09 + U01

**Tujuan:** Menutup dua **risiko penting** sebelum Indro menghubungkan Midtrans. Ini adalah tes+perbaikan **payment persistence/SQL existing**, BUKAN pembuatan Midtrans adapter/checkout.

### Risiko R1 / A6-09 — waktu expiry melewati lock wait

Temuan statis: `apply_verified_payment` memakai `now()` (waktu mulai transaksi); bila transaction mulai sebelum hold deadline, lalu menunggu lock sampai **sesudah** deadline, ada risiko payment wrongly applied/allocated.

**Reproduce first:** dua sesi PostgreSQL disposable yang terkontrol, barrier lock + bounded timeout. Buat pending order dan hold yang segera expired; transaksi payment mulai sebelum deadline tapi tertahan row lock sampai setelah deadline; lepaskan. Periksa status order/payment/reservation, capacity, domain events, email enqueue. Ulang **wait pada capacity** jika relevan dan kontrol payment normal/exact boundary.

- Jika bug **terbukti**, patch fungsi/timing check terkecil supaya eligibility didasarkan pada waktu aktual **setelah lock yang relevan**; nilai `now()`/`statement_timestamp()`/`clock_timestamp()` memiliki semantics berbeda, pilih berdasarkan bukti. Jangan mengubah seluruh payment state machine.
- Verified provider-paid tetapi hold tidak lagi boleh di-apply harus masuk status **review/unapplied** sesuai existing contract, **bukan paid allocated**, dan tidak enqueue paid email secara salah.
- Jika tidak terbukti, dokumentasikan setup, lock, SQLSTATE, hasil dan batas cakupan; jangan menambahkan framework sebagai pencegahan hipotesis.

### Risiko R2 / U01 — potensi deadlock urutan lock

Temuan sebelumnya: source `accept_late_payment` mengunci capacity → order, sementara settlement cenderung order → payment → reservation → capacity (termasuk trigger). Ini merupakan **lock-order inversion pada source**, tetapi **deadlock aktual belum terbukti**.

**Reproduce first:** dua sesi dengan barrier deterministik dan timeout bounded; uji late-accept pada valid/invalid state berhadapan dengan settlement serta kasus expiry/trigger yang relevan. Catat SQLSTATE `40P01` jika terjadi deadlock, atau timeout/ketiadaan siklus dengan setup yang jelas.

- Jika deadlock **terbukti**, selaraskan urutan lock writer minimum, pertahankan recheck state/capacity, ownership, CAS, rollback, idempotency. Uji ulang kedua sesi.
- Jika tidak terbukti dalam matriks yang relevan, catat hipotesis tetap terbuka/risiko residual secara jujur; jangan overhaul locking tanpa bukti.
- Untuk adapter Indro nanti: retry **persistensi DB** tidak boleh membuat external charge baru. Jangan implement adapter tersebut di task ini.

### Kontrak dan tes minimum lain

- Verified payment replay dan duplicate event tidak double-allocate quota/capacity atau email job.
- Wrong amount/status/provider facts tidak diterima oleh existing persistence contract. **Signature verification HTTP adalah pekerjaan Indro P2-4**, jadi jangan mengklaim telah diuji.
- Expired hold vs apply, late review → accept/decline, last-slot, cancellation, retry/stale state: tes fokus pada kasus yang disentuh perubahan.
- Tidak membuat reconciliation scheduler, queue baru, refund/payout pipeline atau load-testing framework.
- Jika perubahan function SQL dibutuhkan, buat **migration baru forward-only** sesudah P2-1, **tanpa mengedit migration lama** dan tanpa deploy ke DB persisten lama.
- Tests otomatis harus bisa berjalan pada disposable PostgreSQL yang terverifikasi; gunakan harness existing dan bounded two-session concurrency, jangan query produksi.

**Output:** satu laporan ringkas, misalnya `docs/qa/CAMPAIGN_LAB_MVP_P2_2_PAYMENT_INTEGRITY_2026-11-08.md`. Status bisa PASS jika R1 dicek benar serta R2 diuji dengan cakupan jujur dan tidak ada blocker integritas kritis yang tersisa untuk adapter; **jangan klaim tidak mungkin deadlock** hanya karena satu test tidak mereproduksi.

---

## F. Urutan kerja, milestone, dan kebijakan berhenti

Jalankan dalam urutan ini, tanpa audit ulang seluruh codebase:

1. **Preflight singkat:** Git/status, apakah P1-3 sedang dikerjakan atau sudah selesai, 14+ current migrations, status project terisolasi, dan baca kontrak domain relevan.
2. **P1-3** bila belum selesai: integrasikan owner UI/Auth/Blueprint/execution; catat hasil actual. Jika sudah PASS dengan bukti, jangan ulang implementasi.
3. **P2-1:** implement approved/published pricing resolver + attribution dengan migration forward-only terfokus; uji SQL quote/order parity dan runtime sewajarnya.
4. **P2-2:** reproduce dua risiko transaksi; patch **hanya** temuan yang terbukti, uji regresi; buat handoff kontrak untuk Indro.
5. **STOP.** Jangan merge Indro, jangan lanjut P2-3/P2-4/P3-1/P3-2.

**Jangan memulai task berikutnya bila task sebelumnya FAIL/BLOCKED pada kontrak wajib yang menjadi dependensi.** Lanjutkan testing/pekerjaan independen yang aman, lalu laporkan blocker tepat. Tidak perlu membuat sub-batch bernama baru untuk tiap helper/fix.

### Yang boleh diubah

- Source code dan tests yang langsung diperlukan P1-3, P2-1, P2-2.
- **Migration SQL forward-only BARU** khusus perubahan fungsi C8 atau payment yang terbukti (otorisasi handoff ini hanya untuk source/disposable testing). Tidak mengubah 14 migration lama atau migrasi berikutnya yang sudah applied di environment manapun.
- Dokumen/QA ringkas untuk masing-masing tahap.
- Data fixture sintetis pada database **disposable terverifikasi**; jangan gunakan data customer nyata.

### Yang dilarang

- Mengubah `.env.local`, `supabase/config.toml` asli, kredensial, linked project metadata, atau data DB lama.
- `supabase db reset/push/migration repair` atau mutasi SQL pada proyek persistent normal `campaign-lab` maupun remote.
- Menerapkan migrasi baru ke instance MVP P1-1 **yang menyimpan fixture** secara otomatis: **uji terlebih dahulu di disposable DB/platform baru**, lalu jika ingin upgrade instance P1-1, perlu keputusan terpisah dan verifikasi backup/compatibility; jangan menganggap karena local maka aman reset.
- Mengubah owner RLS/grants/guard tanpa alasan yang spesifik dan tes negatif.
- Menonaktifkan safety fail-closed, source provenance, money bound F1, CAS F1, publication snapshot A3, job/Memory isolation A1/A2.
- Memanggil Gemini live, Midtrans, email provider, charge nyata atau provider lain tanpa otorisasi terpisah.
- Mengembangkan kode Indro, menambah buyer routes/webhook, memperbaiki dashboard KPI, mengubah arsitektur besar, menambah library tanpa kebutuhan nyata.
- `git commit/push/merge/rebase/reset/stash`, deploy, perubahan Docker/global cleanup, stop project lain.

### Keamanan dan integritas yang TIDAK BOLEH dikorbankan untuk MVP

Owner isolation; server authority pada money/pricing; capacity/quota tidak oversold; quote/order parity; payment idempotency; stale/CAS; service/owner role boundaries; signed provider notifications (**nanti Indro**); state transitions; cleanup terisolasi.

---

## G. Cara verifikasi yang proporsional (bukan test marathon)

- **P1-3:** real owner Auth dan route/browser bila tersedia + provider mock controlled + persist Blueprint/execution; foreign-owner/anon/stale negative cases.
- **P2-1:** fresh/disposable SQL 14+new migration + quote/order promo cases, effective windows, invalid attribution, rollback/idempotency; satu real platform readback bila aman/tersedia.
- **P2-2:** dua skenario concurrency berbarrier, negative + payment capacity/event atomicity, regressions terkait. Satu kali bukti failure reproduced lebih bermakna daripada ribuan mock tests.
- Jalankan TypeScript, ESLint, relevant unit/integration dan build **setelah perubahan signifikan**, bukan tiap baris. Jalankan full existing suite jika diperlukan oleh area yang berubah; angka lama hanya baseline historis.
- **Pisahkan bukti:** static source, mocked AI, real HTTP/Auth/Storage, disposable SQL, browser, provider. Hasil yang tidak dijalankan harus **NOT EXECUTED**, bukan PASS.
- Bila browser/CDP gagal, tetap lakukan real HTTP + service/DB checks yang aman; laporkan keterbatasan tanpa memalsukan PASS browser.

---

## H. Handoff akhir yang Steven butuhkan setelah berlari

Beri satu ringkasan akhir **bahasa Indonesia**, ringkas, berisi:

| Task | Status | Yang berhasil digunakan | Bukti test | Belum selesai |
|---|---|---|---|---|
| P1-3 | PASS/PARTIAL/BLOCKED/FAIL | Owner AI/Blueprint/Execution | Browser/HTTP/mock/DB | ... |
| P2-1 | PASS/PARTIAL/BLOCKED/FAIL | Campaign price + attribution | SQL quote/order parity | ... |
| P2-2 | PASS/PARTIAL/BLOCKED/FAIL | Verified payment integrity | Two-session R1/R2 + SQLSTATE | ... |

Lampirkan:

1. **Daftar file yang dibuat/diubah** serta alasan, tanpa duplikasi arsitektur.
2. **Migration baru** (jika ada), urutan dan status **belum deployed**.
3. **PASS/FAIL aktual** untuk unit, mock, HTTP, SQL, browser, lint, typecheck, build.
4. **Status Supabase terisolasi** (`cl-mvp-72e87c9aa2bc`), apakah perlu source-sync/restart, tanpa membocorkan private keys.
5. Bukti DB persisten lama dan 14 migration awal **tidak dimutasi**.
6. **Kontrak serah terima Indro** sesudah P2-2: minimal server API/offer, `create_preorder_order`, `claimPaymentAttempt` / `recordPaymentCharge` / `applyVerifiedPayment`, private token/status, payment verification/amount/idempotency, dengan actual nama dan signature yang dicek dari source; **bukan implementasi Indro**.
7. **Tugas berikutnya setelah handoff: merge/integrasi Indro pada P2-3 dan P2-4**, kemudian P3-1/P3-2; **jangan kerjakan** tugas itu sekarang.

**Definisi selesai handoff:** Steven dapat kembali dan memahami tepat apa yang sudah bekerja pada codebase gabungan Steven+Rafi, apa yang teruji, perubahan apa yang belum diterapkan ke environment, serta apa yang harus disiapkan untuk menggabungkan Indro—tanpa perlu audit umum baru.

> **Mulai sekarang:** inspeksi repo/status P1-3, lanjutkan pekerjaan yang benar-benar belum selesai, dan berhenti di P2-2. **MVP jalan lebih penting daripada overengineering.**
