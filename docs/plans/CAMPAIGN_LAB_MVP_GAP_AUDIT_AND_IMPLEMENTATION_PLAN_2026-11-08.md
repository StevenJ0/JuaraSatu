# Campaign Lab — MVP Gap Audit & Minimal Implementation Plan

Tanggal: 8 November 2026. **Overall audit: COMPLETED; kesiapan MVP: PARTIAL.** Audit dan rencana saja; implementasi tidak dimulai.

## A. Executive Summary

Kontrak penerimaan adalah enam flow pada permintaan terbaru. PRD tetap acuan aturan domain; Memory, Evaluation penuh, email otomatis, dan worker platform bukan syarat tambahan MVP.

**Dua dari enam flow memiliki jalur source UI–database yang tersambung:** auth/business dan product/capacity/preorder. Ini hitungan konektivitas, bukan persentase fitur selesai. **Nol dari enam dinyatakan lulus E2E platform dalam audit ini.** Empat flow berikutnya masih kehilangan sambungan atau komponen wajib. Algoritme harga, simulator, persistence Blueprint/execution, reservasi dan payment persistence tersedia; membangun ulang modul tersebut akan memperbesar pekerjaan.

Ada **enam blocker terkonfirmasi secara source/bukti lingkungan historis**: tiga integrasi terputus, dua fitur esensial belum tersedia, satu prasyarat lingkungan. Tidak ada bug runtime baru yang direproduksi dalam audit ini. Dua risiko pembayaran lama menjadi gate keselamatan tersendiri, bukan klaim dua bug baru: A6-09 HIGH_CONFIDENCE dan deadlock U01 HYPOTHESIS. Kekurangan buyer/adapter Indro adalah dependency tim, bukan otomatis regresi merge Steven–Rafi.

Jalur demo tercepat yang aman: instance Supabase baru yang terisolasi dan sesuai 14 migration → adapter preorder nyata + session owner pada AI yang sudah ada → approve/publish melalui persistence lama → resolver offer atomik → UI buyer dan adapter Sandbox → agregasi KPI sederhana. Tanpa tabel, dependency, simulator, workflow engine, atau worker platform baru. Perubahan fungsi SQL C8 dan perbaikan payment jika terbukti memerlukan tugas/izin schema terpisah; belum diizinkan oleh audit ini.

Baseline source terverifikasi: branch `merge/ai-campaign`, HEAD `5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762`, 14 root migration sampai `20261108090000_financial_bounds_owner_cas.sql`. Seluruh pekerjaan dirty/untracked A1–F1 dipertahankan.

## B. MVP Feature Checklist

Status berlaku pada fitur di baris tersebut. WORKING pada komponen bawah hanya mencakup scope pengujian historis yang disebutkan; keberadaan source tidak membuktikan flow browser bekerja.

| MVP Feature | Status | Evidence | Missing/Broken Part | Minimal Fix | Owner |
|---|---|---|---|---|---|
| Flow 1: register/login, business, dashboard, reload | UNVERIFIED | `auth/actions.ts`, `auth/session.ts`, `business/guard.ts:requireBusinessOwner`, dashboard layout; jalur SSR tersedia | Belum ada bukti HTTP/UI pada platform 14-chain | Smoke login/onboarding/reload pada lingkungan baru; koreksi hanya kegagalan nyata | Rafi |
| Owner isolation | WORKING | Guard tersebut + ownership/RLS/RPC; bukti SQL owner/CAS pada F1 | Bukti UI foreign owner belum ada | Pertahankan guard; satu negative E2E lintas owner | Rafi |
| Flow 2: product/price/cost/photo, capacity, draft/publish preorder | UNVERIFIED | `src/app/dashboard/{products,capacity,preorders}/`, feature actions/service/repository; A3/F1 SQL PASS historis | Storage/platform runtime belum dibuktikan pada target sesuai schema | Reuse form, storage policy dan publish RPC; smoke persisted price/terms | Rafi |
| Kuota, komitmen, sisa kapasitas/preorder | WORKING | `preorders/metrics.ts:summarizePreorder`, core reservation RPC; last-slot SQL historis | Kombinasi deadline/lock payment belum ditutup | Reuse; uji terarah R1/R2 sebelum sign-off checkout | Rafi |
| Flow 3: memilih preorder nyata → AI → edit → approve | DISCONNECTED | `campaign-strategist/development-context.server.ts:seededDevelopmentContext`, Blueprint boundary | C1 masih fixture; owner AI terpisah | G1 + G2 di bawah, reuse pipeline | Steven + Rafi |
| Context business/product/cost/date/commitment nyata | DISCONNECTED | `preorders/repository.ts:findPreorderContext`, `preorders/context.ts:toPreorderContext` vs loader demo | Projection core belum memenuhi C1, termasuk numeric cost/versi | Enrich projection owned + adapter schema C1; bukan casting DTO | Rafi + Steven |
| Strategist, alternatif, simulator dan deterministik finance | WORKING | `campaign-strategist/`, `campaign-simulator/simulate.ts`, `pricing/`; unit/mock F1 historis | Belum membuktikan live Gemini dengan context nyata | Pakai kalkulasi dan validasi yang sama; smoke provider nanti | Steven |
| Blueprint persistence, revisi, approval | WORKING | `campaign-blueprint/repository.server.ts` → `create_campaign_with_initial_blueprint`, `save_blueprint_revision`, `approve_blueprint`; mock/SQL historis | Boundary masih dev/synthetic; jalur owner nyata belum tersedia | Ubah boundary/provenance terbatas, pertahankan CAS/source checks | Steven |
| Flow 4: aktivasi, offer, jadwal, budget/target, checklist, status | DISCONNECTED | `campaign-execution/service.ts`, `projections.ts`, `repository.server.ts`; workspace dev tersedia | Akses owner nyata dan hubungan harga checkout belum tersambung | Reuse execution UI/service; G2 + G3 | Steven + Rafi |
| Publication, kalender dan checklist internal | WORKING | `campaignExecutionService`, `executionCalendar`, `taskUpdateDisposition`; mock historis | HTTP owner aktual belum diuji | Mount di owner UI dengan session yang sama; replay/conflict smoke | Steven |
| Harga promo server saat quote dan order | DISCONNECTED | Core SQL `private.current_order_offer` mengembalikan discount 0, campaign NULL | C8 belum membaca published campaign | Resolver SQL yang sama untuk offer/read dan atomic checkout | Rafi + Steven |
| Attribution tervalidasi | DISCONNECTED | Core SQL `private.resolve_attribution` mengembalikan NULL | Belum memvalidasi ref ke campaign/business/preorder | Hubungkan resolver; pricing ID tetap terpisah dari attribution ID | Rafi + Steven |
| Flow 5: halaman publik, qty, checkout, pembayaran/status | MISSING | Dashboard preorder `BuyerPreview` menyatakan halaman buyer belum tersedia; inventory `src/app` tidak memuat buyer/webhook | UI/routes dan adapter provider Indro belum ada | G4: page + handler tipis + adapter Sandbox | Indro |
| Public order/private status contracts | WORKING | `orders/service.ts:placePublicOrder`, `findOrderByPrivateToken`; RPC/reservation SQL historis | Belum ada app consumer | Panggil dari handler server; token rahasia dan idempotency stabil | Indro + Rafi |
| Payment claim/record/apply persistence | WORKING | `payments/service.ts:claimPaymentAttempt`, `recordPaymentCharge`, `applyVerifiedPayment`; SQL historis | Tidak memverifikasi Midtrans sendiri; itu tanggung jawab adapter yang belum ada | Adapter server memverifikasi fakta sebelum apply; R1/R2 tetap gate | Indro + Rafi |
| Verifikasi callback, amount, duplicate, QRIS Sandbox | MISSING | Kontrak payment tersedia; adapter/route provider tidak ditemukan | Tidak ada jalur trusted provider → persistence | Single team merchant; verified notification/status; retry same attempt | Indro |
| Flow 6: hasil campaign nyata di owner UI | MISSING | Dashboard saat ini statistik operasional; Evaluation synthetic bukan sales | Agregasi paid revenue/order/campaign dan UI belum tersedia | G5: query deterministik + kartu ringkas | Rafi + Steven |
| Paid units preorder dan target gap | WORKING | `preorders/metrics.ts`, detail preorder menampilkan paidUnits/paidTargetGap/orderableUnits | Definisi termasuk manual confirmed perlu dipisah dari verified Sandbox | Reuse angka preorder dengan label jelas; tambah cohort verified untuk campaign | Rafi |
| Lingkungan current-schema untuk UI/API | UNVERIFIED | F0: target lama 9-chain; F1: 14-chain hanya PostgreSQL disposable | Platform Auth/Storage/PostgREST 14-chain belum tersedia sebagai bukti | G6: instance baru terisolasi, tanpa reset target lama | Rafi |
| Full Evaluation/verified Memory/email otomatis | DEFER | Modul dan guards sudah ada; bukan kontrak enam flow | Tidak perlu selesai untuk MVP | Gunakan unavailable/not_requested yang sah; jangan longgarkan guards | Steven / Indro |

Path feature tanpa prefiks di tabel berarti `src/features/`. Tidak ada flow lengkap yang diberi WORKING berdasarkan source semata.

Jejak enam perjalanan, sampai sambungan putus:

| Flow | Jalur aktual dan batas bukti |
|---|---|
| 1 | Auth form → `auth/actions.ts` → Supabase SSR Auth → session → `requireBusinessOwner` → business repository/RLS → dashboard. Source tersambung; reload/session platform NOT EXECUTED. |
| 2 | Owner pages/forms → actions/validation → product/capacity/preorder service/repository → Supabase dan publish RPC → persisted readback/detail. SQL publication/atomicity punya bukti historis; HTTP/Storage NOT EXECUTED. |
| 3 | `/dev/discussion` → `/api/dev/discussions` → `authenticateDiscussion` → `seededDevelopmentContext` → strategist/validation → Blueprint workflow/repository/RPC. Terhenti pada session dev dan context fixture untuk owner/preorder nyata. |
| 4 | Workspace execution dev → `/api/dev/campaigns` → synthetic boundary → service → `publish_campaign`/task update → projections. Publish internal tersedia; owner path dan C8 menuju order belum ada. |
| 5 | Public page **belum ada** → belum ada HTTP consumer → kontrak `placePublicOrder` → `create_preorder_order` tersedia → claim/record/apply tersedia → adapter/callback/status UI **belum ada**. |
| 6 | Orders/payments nyata → metrics paid units preorder tersedia → agregasi campaign verified paid + dashboard **belum ada**. Synthetic Evaluation tidak dipakai sebagai jalan pintas. |

## C. Top MVP Blockers

**Hitungan akar masalah:** confirmed 6 = DISCONNECTED 3 (G1–G3) + MISSING 2 (G4–G5) + environment 1 (G6). BROKEN runtime baru = 0 yang direproduksi. Unverified critical payment risks = 2 (R1/R2), di luar hitungan confirmed. Flow 1/2 juga membutuhkan verifikasi platform, bukan dua bug tambahan.

| ID / jenis | Source/fungsi, ekspektasi → aktual / stop edge | Minimal fix, dependency, PIC, tes selesai |
|---|---|---|
| G1 — DISCONNECTED, C1 | `campaign-strategist/development-context.server.ts:18 seededDevelopmentContext`: seharusnya preorder milik owner aktual; hanya dua business demo tetap, `is_demo=true`, kuota 40, tanpa order/campaign/reservation. `preorders/context.ts:toPreorderContext` belum memuat numeric cost serta semua source versions. Core → C1 putus. | Adapter real server dengan scope owned dan schema validation, harga frozen preorder-item, cost quality/null benar, paid/held/allocated/orderable aktual, timestamps dan versi. Snapshot provenance `server` sudah ada pada simulator contract. Reuse loader fixture hanya untuk dev. Dependency projection Rafi + consumer Steven; done: non-demo/non-40 + commitments + cost unknown + foreign owner + changed versions, tanpa provider live. |
| G2 — DISCONNECTED, owner AI boundary | `campaign-strategist/discussion-auth.server.ts:authenticateDiscussion` membaca bearer/dev cookie; `requireDiscussionDevelopment` membatasi dev; owner SSR memakai `business/guard.ts`. `src/components/owner/owner-nav.tsx` hanya core. `campaign-blueprint/api.server.ts:boundary` approval synthetic; `campaign-execution/api.server.ts:boundary` synthetic mode; Blueprint/Execution schemas masih `synthetic: literal(true)`. Owner login → AI/approve/publish nyata putus. | Route owner tipis dengan session SSR terverifikasi, business derivation, origin/input checks dan existing scoped repository; pasang panel/workspace yang sama. Reuse backend, jangan sekadar mencabut dev guard. Bedakan source/provenance real dan fixture pada kontrak dan producer terkait; jangan menandai data nyata synthetic atau melemahkan Memory/Evaluation. Dependency G1/G6; Steven + Rafi. Done: satu login → pilih → edit → approve → reload → publish/checklist; anonymous/foreign owner ditolak. |
| G3 — DISCONNECTED, C8 | `supabase/migrations/20261106160000_core_preorder_on_v21.sql`: `private.current_order_offer` (78), `private.resolve_attribution` (355), dipakai `read_preorder_offer` dan `create_preorder_order`. Ekspektasi published eligible offer; aktual 0/NULL. `campaign-execution/published-offer.server.ts:readPublishedOffer` dan `projections.ts:projectPublishedOffer` sudah memproduksi kontrak, belum dikonsumsi core checkout. | Isi resolver pada transaksi otoritatif existing, baca approved frozen publication/scope/window/status, gunakan formula harga yang sama, validasi attribution ref terpisah. Quote stale ditolak oleh existing expected-price check. **Perlu tugas/izin function migration terpisah**, tanpa tabel baru/edit migration lama. Rafi + Steven; dependency published contract. Done: SQL quote/order parity sebelum/saat/sesudah jadwal, close, stale price, invalid ref, tenant, promo organic tanpa attribution. |
| G4 — MISSING, buyer/provider | `src/app/dashboard/preorders/[id]/page.tsx:BuyerPreview` masih placeholder; pencarian app consumer untuk `findPublicPreorder`, `placePublicOrder`, `findOrderByPrivateToken` tidak menemukan buyer flow. `payments/service.ts` hanya kontrak C5, bukan Midtrans. Buyer → handler → provider → verified persistence → status putus. | Indro menambah minimum public page, checkout, private status, server charge/callback adapter; langsung reuse C4/C5, tanpa order engine baru. Dependency interface D, G3, G6, R1/R2 sebelum sign-off. Done: satu transaksi Sandbox terverifikasi + reload status + forged/duplicate/timeout cases; live provider test baru pada tugas terotorisasi. |
| G5 — MISSING, campaign results | `src/app/dashboard/page.tsx` memanggil `summarizeOrders`/capacity, bukan verified campaign KPI; `orders/recap.ts:summarizeOrders` menghitung produksi. Detail preorder sudah punya real paid units, tetapi belum paid orders/revenue/campaign cohort. Data payment/order → hasil campaign putus. | Query owned scoped tabel existing + UI ringkas dengan definisi D, tanpa C6 Evaluation pipeline. Rafi query, Steven campaign view; dependency fakta payment dan attribution G3 untuk attributed subset. Done: dataset deterministik paid/unapplied/duplicate/manual/foreign/outside-window menghasilkan angka eksak; unavailable attribution bukan nol palsu. |
| G6 — ENVIRONMENT | F0 mencatat target persisten 9 migration dan 2 published snapshot legacy; source kini 14. `src/lib/supabase/transport.server.ts:localSupabaseConfig` hanya menerima origin `http://127.0.0.1:54321`, menghalangi port instance baru. Database target → kontrak source tidak cocok. | Instance baru dengan 14 migration, Auth/PostgREST/Storage, origin lokal terpilih melalui config server terbatas; `.env.local`/stack lama tidak diubah. Gunakan desain F0, bukan ulang platform. Rafi, input Steven; detail tugas pertama K. Done: identity/ledger/352-column parity dan owner HTTP read/write/reload pada instance baru; bukti target lama tidak tersentuh. |

Risiko wajib ditutup sebelum penerimaan checkout:

| ID | Bukti dan status saat ini | Gate minimum |
|---|---|---|
| R1 / A6-09 | Core SQL `public.apply_verified_payment` memegang order/payment, lalu mengecek expiry dengan `now()` (waktu awal transaksi); wait dapat melampaui hold. HIGH_CONFIDENCE statis; audit ini tidak mereproduksi. | Dua sesi/barrier: settlement mulai sebelum expiry, ditahan lock sampai lewat expiry, lalu dilepas. Pastikan tidak allocate expired hold; verified-but-unapplied/review benar, tanpa paid email. Uji juga wait kapasitas setelah eligibility. Jika gagal: perbaikan waktu aktual setelah lock otoritatif pada tugas SQL berizin, bukan transaksi framework baru. Rafi. |
| R2 / U01 | `public.accept_late_payment` mengambil capacity→order; apply mengambil order→payment→reservation→capacity melalui trigger. Inversi source confirmed; deadlock aktual HYPOTHESIS. Kandidat: wrong-state accept pada pending_payment mengambil capacity sebelum validasi, bersamaan settlement. | Dua sesi barrier bounded dan `lock_timeout`/`statement_timeout`, capture SQLSTATE; bandingkan accept valid, invalid, settlement/expiry/trigger. Jika reproducible, selaraskan urutan writer minimum dan regression; adapter harus bisa mengulang persistence tanpa charge baru. Jika tidak reproducible, dokumentasikan kombinasi/prasyarat yang diuji, jangan mengklaim seluruh concurrency aman. Rafi + Indro. |

Observasi non-gate terpisah: A6-10 polling sesi lama (`discussion-workspace.tsx:loadSession`) dan A6-11 prompt replan memakai scenario asal (`blueprint-service.ts:generateBlueprint`, `gemini.server.ts`) masih relevan pada UI yang dipakai ulang. Reproduksi mock saat memasang owner UI; bila terkonfirmasi, batasi patch pada stale-response check/input scenario terbaru. Jalur edit manual tetap bisa dipakai. A6-12 browser test harus memilih replan bila hendak membuktikan provider failure. Ini bukan alasan menulis ulang Strategist atau menambah fase keempat.

F1 A6-07/A6-08 tetap **resolved dalam scope source/disposable yang sudah diuji**; tidak ada bukti regresi baru. Regression uang/CAS tetap bagian acceptance, bukan pembukaan ulang temuan.

## D. Steven–Rafi Integration Gaps

| Boundary | Producer → consumer dan kontrak minimum |
|---|---|
| Owner identity | `requireBusinessOwner`/verified SSR session → owner AI handler → `DiscussionOwner`-equivalent scoped user transport + actor. Verifikasi membership di server, JWT reads/RLS tetap dipakai sebelum privileged RPC. Jangan menerima businessId/actor dari browser sebagai otoritas; endpoint auth errors berbentuk respons API, bukan redirect HTML. |
| C1 | `findPreorderContext`/`toPreorderContext` + minimal owned enrichment → `BuildBusinessContextInputSchema` → strategist, Blueprint preflight dan execution publication. DTO core saat ini sengaja tidak menyertakan numeric cost; perlu kesepakatan mapping, bukan type assertion. Harga dari preorder item frozen, numeric cost dari sumber cost yang sah sesuai quality, null bila unknown. Seluruh source ID/version, scope, real paid/held/allocated/orderable dan waktu harus cocok; paid subset allocated, jangan dihitung dua kali. Baca ulang versi/hash sebelum save/approve/publish sesuai guards existing. Snapshot AI bukan reservasi stok. |
| Real vs fixture | `SimulationFactsSchema.snapshot.provenance` sudah mendukung `server`. Blueprint schema/body dan Execution response masih synthetic literal. Perubahan terbatas perlu menelusuri producer, consumer dan mock fixture agar provenance jujur; tidak cukup mengganti loader. Tidak ditemukan SQL demo-only gate pada fungsi approval/publication yang diperiksa. Guard synthetic/verified Memory dan Evaluation tetap tertutup; history boleh unavailable/not_requested. |
| C8 | Published campaign/approved frozen Blueprint → resolver offer SQL → `read_preorder_offer` dan `create_preorder_order`. `readPublishedOffer`/`projectPublishedOffer` menjadi acuan kontrak/parity test, bukan prefetch JS yang menggantikan pemeriksaan atomik SQL. Discount berlaku menurut scope dan jendela efektif; closed/expired/foreign campaign tidak eligible. `pricing_campaign_id` menunjukkan sumber harga; `attribution_campaign_id` hanya dari ref yang lolos validasi server. |
| Results | Applied verified payment + order/items + campaign publication → query scoped owner → kartu KPI. Tidak melalui synthetic Evaluation atau verified Memory. |

Kontrak Indro (terpisah dari regresi merge):

1. **Catalog/quote:** handler menggunakan `preorders/repository.ts:findPublicPreorder` dan existing offer RPC; response hanya public projection, frozen base/current offer, terms, remaining availability dan server quote. UI tidak membaca tabel privat atau service key. Jangan mengasumsikan URL `/p/{slug}` sudah diimplementasikan.
2. **Order:** input tervalidasi `PublicOrderInput` → `orders/service.ts:placePublicOrder` dengan service-role server. Persist private token dan idempotency key di sisi buyer sebelum POST pertama; retry lost response memakai pasangan dan payload sama. Hash token saja di database. Nominal client hanya expected quote untuk deteksi stale; server/SQL menghitung ulang, lock dan reserve.
3. **Charge:** `claimPaymentAttempt` → hanya `create_charge` boleh membuat charge; `reuse_qr`/`wait`/`reconcile` dipetakan sesuai kontrak → Midtrans Sandbox di luar transaksi DB → `recordPaymentCharge`. Timeout ambigu tidak membuat attempt/charge baru sembarangan; status lookup/retry attempt yang sama melalui request/refresh cukup untuk MVP, tanpa worker baru.
4. **Notification/status:** handler server memverifikasi autentisitas, environment Sandbox, transaction identity/order/business binding serta nominal terhadap record server → `applyVerifiedPayment`. Redirect/browser bukan bukti paid. Signature/status adapter dirinci dari dokumentasi resmi provider pada tugas implementasi; audit ini tidak memanggil provider. Status privat via `findOrderByPrivateToken`, tanpa PII publik. Provider-paid tapi tidak applied karena expiry/review tetap dibedakan dari paid order yang dialokasikan.
5. **Recovery/expiry:** refresh/status request dapat memakai mekanisme expiry/reconciliation existing secara server-authorized; quote/availability harus menghitung held yang belum kedaluwarsa. Jangan menjadikan scheduler platform prasyarat, tetapi jangan menghilangkan pemulihan lost notification/ambiguous charge. Paid-email enqueue existing dipertahankan; pengiriman email tidak menjadi syarat status paid atau akses token.

Definisi KPI minimum untuk disepakati pada task P3-1:

- Paid Sandbox cohort: distinct order milik business/preorder dengan payment `paid_sandbox`, verified dan `applied_at` terisi; belum applied/requires_review/failed/expired dan replay bukan penjualan valid. Cancellation yang menghilangkan validitas order harus dikecualikan serta dijelaskan; tidak menghitung refund/net settlement yang memang di luar MVP.
- Jendela campaign: pakai `applied_at` sebagai waktu fakta order diterapkan, interval setengah terbuka dari `max(starts_at,published_at)` sampai `min(ends_at,closed_at jika ada)`. Jangan memakai waktu request/browser atau provider_paid_at untuk menghidupkan hold expired. Tampilkan definisi waktu ini di label/contract test.
- Paid orders = count distinct order; nilai paid = jumlah `orders.total_idr` **sekali per order**; paid units = jumlah item pada cohort tersebut. Hindari join payment_events yang melipatgandakan omzet. Total agregat lintas order dapat melebihi Rp1 miliar: gunakan numeric/BigInt dan DTO aman, bukan melonggarkan bound per transaksi F1.
- Target campaign `target_additional_units` dan target total preorder adalah denominator berbeda. Tampilkan aktual paid di window dan target campaign dengan label jelas; jangan mengklaim tambahan kausal/uplift. Preorder paid units existing termasuk manual confirmed; pisahkan counter manual dari verified Sandbox.
- Attributed subset hanya menggunakan stored attribution yang tervalidasi server. Tanpa dukungan C8, tampilkan unavailable; jangan mengganti NULL dengan nol atau menyamakan pricing ID dengan attribution ID. Organic order yang mendapat promo bisa tidak attributed. Semua nilai diberi label **simulasi Sandbox**, bukan kas/profit nyata.

## E. Reuse vs Build

| Keputusan | Komponen dan batas perubahan |
|---|---|
| Retain | Core Auth/business/owner guard; product/cost/photo/capacity/preorder CRUD; canonical pickup publication A3; capacity reservation; financial/CAS F1; AI strategist/simulator/pricing validation; Blueprint persistence/revision/approval; execution calendar/tasks/publish; C4/C5/private status; existing UI primitives. |
| Modify minimum | Projection C1 + loader adapter; SSR owner boundary dan endpoint wiring pada komponen AI; synthetic/provenance contracts yang relevan; existing SQL offer/attribution functions lewat tugas terpisah; isolated local-origin configuration. Perbaiki payment/poll/replan hanya dengan bukti terarah dan tanpa mengganti modul utuh. |
| Build karena belum ada | Public buyer/checkout/private-status surfaces dan thin handlers; satu adapter Midtrans Sandbox; satu scoped real KPI query + tampilan campaign; setup instance baru dari desain F0. Tidak perlu payment SDK jika fetch dan dependency terpasang cukup. |

Semua item langsung menutup flow MVP. Tidak memerlukan tabel baru, generic repository layer, dependency baru atau job baru. Pengecualian nyata: body fungsi SQL C8 perlu berubah; ini tetap perubahan schema yang memerlukan izin terpisah. Jika KPI/C1 ternyata tidak dapat dibaca dengan kontrak/privilege existing, hentikan bagian itu dan laporkan kebutuhan; jangan mengubah grants/RLS diam-diam.

## F. Three-Phase Implementation Plan

Hanya tiga fase utama dan sembilan task. P0 = menghalangi jalur MVP; P1 = melengkapi penerimaan. Semua task di bawah adalah rencana, **NOT EXECUTED**.

### Phase 1 — Core + AI Working

Outcome: owner login, product/preorder nyata, AI dengan data nyata, satu Blueprint approved dan persisted. Tidak memerlukan Memory.

| Task / PIC | Target, prioritas, blocker | File/modul utama; dependency | Pendekatan minimum | Validation / Definition of Done |
|---|---|---|---|---|
| P1-1 / Rafi, review Steven | Lingkungan sesuai schema + owner core smoke; P0/G6 | `transport.server.ts:localSupabaseConfig`, desain F0, existing root migrations read-only; Next/Supabase process config baru di temp project | Instance unik baru, port terpisah, 14 existing migration, Auth/Storage; config origin lokal terbatas. Jangan menjalankan old fixture scripts terhadap stack normal | Identity/ledger/schema parity, login → business → product/photo → capacity → publish → reload; `.env.local`, stack/data lama identik; semua hasil runtime direkam. Detail K |
| P1-2 / Rafi + Steven | Core → AI real context; P0/G1 | `preorders/{repository,context,metrics}.ts`, `ai-context/contracts.ts`, loader baru di feature existing; dependency kontrak C1, runtime P1-1 | Enrich owned projection + satu adapter; existing computations/null/quality/versions; history optional, fixture tetap dev | Mock/unit non-demo, quota bukan 40, cost known/unknown, reservations/paid, foreign owner dan stale versions; source `server`; tidak ada fake available units |
| P1-3 / Steven, auth Rafi | Satu login → recommendation/edit/approve + execution view; P0/G2 | SSR auth/owner guard, AI `api.server`/discussion boundary, Blueprint/Execution contracts/services, owner nav/pages, workspace fetch URLs; dependency P1-2, runtime P1-1 | Thin owner route memakai session SSR + scoped transport; reuse panels/services/RPC; provenance real yang eksplisit. Edit manual sah; mock reproduce poll/replan saat relevan, patch lokal bila terbukti | Login core tanpa login dev kedua; memilih preorder nyata, mock-valid recommendation, edit, approved readback setelah reload, foreign/anonymous ditolak. Finance computed server, source versions/CAS tidak dilewati; provider smoke terpisah bila diotorisasi |

### Phase 2 — Campaign + Buyer Checkout Working

Outcome: offer aktif mengubah harga preorder publik; buyer dapat order dan membayar melalui single-merchant Sandbox.

| Task / PIC | Target, prioritas, blocker | File/modul utama; dependency | Pendekatan minimum | Validation / Definition of Done |
|---|---|---|---|---|
| P2-1 / Rafi, contract Steven | Quote/order memakai campaign published; P0/G3 | Existing `private.current_order_offer`, `private.resolve_attribution`; execution projections, pricing golden tests; dependency publication contract dan **izin tugas function migration terpisah** | Additive forward migration yang hanya mengganti fungsi relevan, tanpa edit migration lama/tabel; preserve lock/atomicity dan expected-price guard | Disposable SQL price parity/no-active/scheduled/closed/foreign/organic/attributed/stale quote; owner dapat publish/lihat jadwal,budget,target/checklist/status memakai execution existing |
| P2-2 / Rafi, recovery Indro | Tutup risiko integrity payment; P0/R1,R2 | Core apply/accept/expiry + capacity trigger, harness disposable existing; dependency izin uji isolated; mutation function bila diperlukan memerlukan izin tersendiri | Dua reproduksi bounded; hanya jika gagal patch root cause minimum dan ulang matrix terkait. Tidak membuat retry/transaction framework | Bukti deadline crossing/lock order sesuai H; normal/late/replay/expiry tidak double allocate/email. U01 tetap hypothesis jika tidak reproduced, dengan batas cakupan eksplisit |
| P2-3 / Indro, persistence Rafi | Public page → quote → order → private status; P0/G4 bagian buyer | Baru: public page/checkout/status route yang disepakati; reuse `preorders/repository`, `orders/{schemas,service,private-status}` dan UI primitives; dependency kontrak D, runtime P1-1, price final P2-1 | Handlers tipis; stable token/key before POST, server-calculated price, no PII public. UI untuk waiting/soldout/stale/conflict/reload | Contract/mock dan HTTP order + private token; lost response/idempotency, last slot, soldout, wrong quote, expired; tanpa charge provider dahulu |
| P2-4 / Indro + Rafi | Trusted Sandbox QRIS → paid state; P0/G4 bagian provider | Baru: server Midtrans adapter/charge+notification routes; reuse `payments/{schemas,service,repository}`; dependency P2-3, safe sign-off P2-2, team Sandbox credentials/authorized callback endpoint | claim → external request → record; verify notification/status+amount → apply; same-attempt recovery pada refresh, tanpa worker baru. Team merchant tunggal | Fake-provider tests signature/amount/dupes/timeout/reconcile; lalu **authorized** Sandbox E2E (bukan pada audit). Tepat satu allocation/payment apply; redirect tidak mengubah paid; private status persisted |

### Phase 3 — Results + Final MVP E2E

Outcome: owner melihat hasil paid-order nyata dan perjalanan lengkap lulus acceptance minimum.

| Task / PIC | Target, prioritas, blocker | File/modul utama; dependency | Pendekatan minimum | Validation / Definition of Done |
|---|---|---|---|---|
| P3-1 / Rafi query + Steven view | Real campaign KPI ringkas; P0/G5 | Owned campaign/detail UI, orders/payments query existing, `preorders/metrics.ts`; dependency definisi D, verified facts P2-4, attributed subset P2-1 | Satu query/projection deterministik + kartu orders/revenue/units-target/status; pisahkan manual, verified dan unavailable attribution | Fixture eksak berbagai cohort/window/tenant/replay; jumlah uang aman; Sandbox labels; UI readback setelah payment nyata, tanpa Evaluation/Memory |
| P3-2 / bersama, Rafi QA lead | Demo MVP dapat diulang; P1/verifikasi seluruh flow | Browser tests existing + focused journey test, disposable SQL cases, QA report; dependency runtime task terkait dan provider authorization | Empat scenario H + regression negatif terarah; gunakan scripts package existing untuk unit/typecheck/lint/build sesuai diff | 14 langkah positif dan negatif kritis punya bukti, R1/R2 ditutup sesuai scope, source/DB environment dinyatakan, unresolved blocker nol untuk sign-off; tidak mengklaim production readiness |

## G. Team Work Allocation

- **Rafi:** P1-1, owned C1 projection P1-2, owner auth review, SQL resolver P2-1, payment risk P2-2, query P3-1. Menjaga atomicity/ownership/F1.
- **Steven:** consumer C1, shared-session AI/Blueprint/Execution UI dan provenance P1-3, published-offer contract/golden tests, campaign results UI. Reuse Strategist/Simulator; tidak menyelesaikan Memory demi MVP.
- **Indro:** kontrak buyer P2-3, adapter/server callback/recovery P2-4. Dapat mengembangkan terhadap mock C4/C5 saat Rafi menyiapkan lingkungan/resolver; bukan menunggu semua AI selesai.
- **Paralel:** P1-1 || C1 contract/projection || buyer mock/UI; sesudah kontrak jelas P1-3 || P2-1 || P2-2 || Indro adapter fake. Query KPI dapat dibuat dari fixture sambil provider diintegrasikan. Runtime full flow menunggu dependency aktual; hanya P3-2 membutuhkan seluruh sambungan selesai. Koordinasikan perubahan file auth/transport agar tidak saling menimpa.

## H. MVP Acceptance Tests

Semua skenario baru berikut **NOT EXECUTED**. Unit/contract dengan provider fake tidak menggantikan satu authorized real-provider smoke.

| Skenario minimum | Langkah positif yang dicakup | Bukti penerimaan |
|---|---|---|
| S1 Owner/Core | **1** owner login; **2** create business; **3** create product (price/cost/photo); **4** configure capacity; **5** publish preorder | Reload tetap konsisten, terms/frozen price benar, owner asing tidak dapat membaca/mutasi; anonymous dialihkan/ditolak sesuai entry point |
| S2 Real AI/Campaign | **6** AI reads actual preorder; **7** recommendation usable; **8** owner edit/approve; **9** publish campaign/checklist | Context cocok DB, non-demo + commitments, provenance jujur, recommendation validated, persisted approved source versions dan price/budget/target; active/finished sesuai waktu |
| S3 Buyer/Payment | **10** buyer melihat harga promo benar; **11** submit order; **12** trusted Sandbox payment verified; **13** order/capacity update | Server quote/order sama; held → allocated tidak double count; reload private status benar; verified-but-unapplied tetap review. Satu transaksi provider setelah otorisasi tugas test |
| S4 Results | **14** owner melihat real paid KPI | Paid order/revenue/units/target dan optional attribution sama dengan record verified applied; tidak ada synthetic Evaluation/manual yang disamarkan sebagai Sandbox paid |

Negatif kritis digabung pada empat skenario tersebut:

- Foreign owner/anonymous terhadap source preorder, session, Blueprint, publish/task/KPI; business/actor ID dari client tidak mengalahkan session. Edit CAS NULL/zero/negative/stale tetap ditolak menurut F1.
- Dua request untuk last slot: tepat satu berhasil, quota/capacity tidak negatif; soldout/insufficient capacity/expired preorder ditolak. Scheduled/closed/expired campaign tidak memberi diskon invalid; preorder masih bisa menerima order base-price bila preorder sendiri masih eligible.
- Wrong/stale quote ditolak; refresh tidak memesan diam-diam di harga lain. Duplicate key+payload mengembalikan order sama, key+payload beda conflict; duplicate/reordered notification tidak melipatgandakan apply/units/email enqueue.
- Unsigned/forged notification, salah transaction/order/amount/environment tidak boleh menghasilkan paid; browser redirect juga tidak. Ambiguous charge timeout/status refresh menggunakan attempt yang sama; wrong private token tidak membocorkan keberadaan/PII order.
- Financial total melebihi bound, quantity invalid, bps invalid tetap ditolak sebelum write (reuse F1 cases). AI numeric text/output tidak boleh mengubah harga/kuota/money deterministik; stale context version/hash memerlukan reload/regenerate/konfirmasi yang sah.

R1 focused test: dua sesi dengan barrier pada lock order/payment, transaksi settlement dimulai sebelum expiry dan dilanjutkan sesudahnya; ulang pada wait capacity serta exact-boundary dan kontrol normal. Assert atomic before/after reservation/order/payment/email-job, bukan sekadar respons error.

R2 focused test: accept invalid-state menahan capacity berhadapan dengan apply yang menahan order; sertakan valid late accept dan expiry/trigger paths. Bounded timeout dengan cleanup container, capture SQLSTATE 40P01/timeout dan siapa memegang lock. Setelah perbaikan yang diizinkan, ulang normal/invalid/replay/last-slot. Tidak memerlukan stress suite tak terbatas atau worker baru. Retrying DB apply tidak boleh mengulang external charge.

Verification audit ini: hanya read/search source, Git/14-migration inventory, dokumen dan evidence historis. **Unit, selected AI integration, typecheck, lint, build, SQL, HTTP/browser, real Auth/Storage, Gemini, Midtrans dan email: NOT EXECUTED dalam audit ini.** Alasan: perubahan hanya satu Markdown dan pertanyaan gap sudah terjawab oleh source serta bukti existing; tidak menambah bukti dengan mengulang suite lama.

Bukti historis F1 (bukan fresh run): unit **1.103**, selected AI mock **69**, strict TypeScript/lint/build PASS; 14-migration disposable chain dan strict **352-column MATCH**, 19 financial/CAS groups/170 rejected statements dengan snapshot identik; A1/A2/A3/A4/Memory regression PASS. Itu membuktikan komponen yang diuji, bukan kesiapan platform/provider E2E. Rujukan: `docs/qa/POST_MERGE_A6_F1_FINANCIAL_CAS_INTEGRITY_REPORT_2026-11-08.md`.

## I. Deferred Work

| DEFER | Mengapa aman menunggu / bagian yang tetap dijaga |
|---|---|
| Verified Memory indexing/vector/historical learning | Tidak diperlukan untuk satu campaign dari data sekarang; optional source unavailable/not_requested; source-integrity guard tetap ada |
| Full AI Evaluation/narrative/advanced analytics/experimentation | KPI deterministik P3-1 cukup; jangan mengganti synthetic menjadi real tanpa evidence |
| Email sender otomatis | Buyer private token/status memberi jalur minimum; queue/enqueue/idempotency tetap dipertahankan. Jika kontrak buyer final ternyata butuh email untuk akses/status, tinjau dependency itu secara eksplisit |
| Worker/scheduler platform lengkap | Existing expiry + server request/status recovery cukup untuk direncanakan; validasi waktu/ambiguous charge tidak boleh dihilangkan |
| Payout/refund automation/multi-merchant/production settlement | MVP single team Sandbox; tidak ada kas/payout nyata |
| Enterprise roles/multi-business, UI redesign, advanced dashboard, broad SDK/layer refactor, speculative scale | Tidak menutup enam acceptance flow; gunakan owner model dan UI primitives existing |

Tidak ada kode opsional yang dihapus dan tidak ada guard yang dilemahkan. Batas deadline/capacity/auth/payment bukan hardening opsional.

## J. Environment / Database Constraints

Source sekarang **14 migration**. Bukti F0 target persisten **9 migration**; lima yang tidak ada relatif source kini adalah core preorder, A1 ACK, A2 claim, A3 publication, dan F1 bounds/CAS. F0 juga menemukan **dua published pickup snapshots legacy** (camelCase), nol canonical pada target itu. Menjalankan reader current terhadap target lama bukan reproduksi regresi aplikasi baru. F1 tidak melakukan rollout/backfill dan audit ini tidak mengakses ulang DB target tersebut.

F0 merekam target lama 351 kolom/27 public signatures vs contract current 352/50; normal Storage bucket/policy juga belum sesuai. Perbaikan source A1–F1 tidak berarti sudah ada pada instance itu. External worker consumer tetap tidak diketahui; audit ini tidak mengganti signature atau mengaktifkan consumer eksternal.

Rekomendasi lingkungan: real Supabase baru dalam temp workdir/project ID unik sesuai desain Layer2 F0, port API/DB/Studio/Next non-konflik (misalnya API 56321, Next 3301; cek ketersediaan, jangan mengasumsikan), resource/volume terpisah, 14 migration existing ke **instance baru saja**, tidak menyalin linked state/data/secret lama. Auth/PostgREST/Storage harus benar-benar jalan; bare PostgreSQL harness tetap untuk SQL, tidak menggantikan Layer2.

`localSupabaseConfig` saat ini fixed 54321. Perlu perubahan aplikasi kecil di tugas berikut agar origin loopback terpilih dapat dipakai secara eksplisit dan konsisten oleh SSR serta AI. Jangan proxy untuk menyamarkan target, mengizinkan sembarang remote origin, atau menghapus dev/security gates. HMAC/admission dan key diperlukan melalui process env rahasia terpisah; presence/validity diverifikasi tanpa mencetak nilainya. F0 hanya membuktikan HMAC tidak ada pada file/shell yang diperiksa, bukan seluruh effective Next environment.

Reuse desain/CLI yang sudah diperiksa di F0; existing `scripts/test-supabase-v21.mjs` dan fixture scripts lama hardcode stack/cache/env normal, jadi jangan dipakai langsung tanpa memeriksa/menargetkan scope. Setup kecil harus fail-closed pada identity/ports/resource target. CLI dapat mempublikasikan host binding luas: verifikasi actual bindings dan proteksi akses lokal sebelum mengisi credentials; jangan mengarang flag bind yang tidak tersedia. Cleanup hanya resource project baru, tanpa `stop --all`, normal reset, atau recursive delete target yang belum diverifikasi.

Tidak ada rollout otomatis. Kompatibilitas target lama/treatment dua legacy rows adalah tugas lingkungan terpisah bila target itu kelak hendak dipakai; tidak perlu mengubah data lama untuk demo instance baru. Migration body C8/payment tetap tunduk izin schema terpisah. Provider E2E memerlukan task terotorisasi, secrets Sandbox dan callback HTTPS yang dapat diverifikasi; tidak dilakukan sekarang.

## K. Final Recommendation

**Mulai hanya P1-1: siapkan lingkungan MVP baru yang cocok dengan source dan buktikan owner core smoke.** Ini menghilangkan prasyarat bersama bagi Steven, Rafi dan Indro; C1/Indro mock development dapat berjalan paralel. Jangan mencoba membuktikan current app pada DB persisten lama.

- **Scope tepat:** konfigurasi satu instance baru terisolasi dari desain F0, replay 14 migration existing hanya pada DB baru, minimum configurable loopback origin untuk AI transport, Next terpisah dengan process env rahasia, lalu login/create business/product/photo/capacity/publish/reload. Tidak memasang fitur AI/buyer/results sekaligus.
- **File/fungsi aktual:** `src/lib/supabase/transport.server.ts:localSupabaseConfig`; konsumen config diperiksa bersama `src/lib/supabase/{server,client,service-role}.ts`; root migrations **read-only**; `docs/qa/POST_MERGE_A6_F0_PLATFORM_TARGET_EVIDENCE_REPORT_2026-11-08.md` sebagai runbook awal. Form/action/guard existing menjadi smoke targets, bukan refactor targets. Jika perlu helper setup, satu helper terfokus dengan assert identity/resource; tidak membuat orchestration framework. Generated temp config berada di luar project normal; `.env.local` dan `supabase/config.toml` repository tetap tidak diedit.
- **Pendekatan minimum:** gunakan CLI existing dengan workdir/project ID unik; cek port/identity sebelum start dan migration; validasi pilihan origin loopback dengan fail-closed config test; jalankan app memakai env proses. Jangan ubah original migration, DB lama atau owner data. Replay existing schema pada instance baru tetap memerlukan otorisasi tugas lingkungan berikutnya, bukan izin implisit audit ini.
- **Acceptance:** project/container/volume/port baru terbukti terpisah; 14 ledger dan contract 352 kolom/expected RPC tersedia; Auth/Storage smoke sukses; core 1–5 berhasil dari UI dan persist setelah reload; foreign owner ditolak; SSR dan AI transport menunjuk origin baru yang sama tanpa menampilkan secret; old env/config/file hashes serta target lama tidak berubah; cleanup hanya resource baru. Jalankan lint/typecheck/unit config dan build bila source transport berubah. AI/provider dan checkout belum dinyatakan lulus oleh tugas ini.
- **Dependencies:** Docker/CLI dan kapasitas port, secrets khusus instance baru melalui process env, otorisasi eksplisit menjalankan lingkungan baru/menerapkan chain existing ke instance baru. Tidak ada kebutuhan production deploy atau pengubahan historical snapshots. Tugas perubahan fungsi C8/payment dibahas terpisah setelah ini.

**Set perubahan terkecil untuk MVP E2E:** satu lingkungan current-schema yang aman; satu adapter C1; session/route/UI owner ke AI–Blueprint–Execution existing dengan provenance benar; sambungan resolver offer/attribution SQL; public checkout/status + adapter Midtrans Sandbox di atas C4/C5; query/kartu KPI real; dan pengujian terarah deadline/lock sebelum sign-off. Pertahankan Auth/core/pricing/simulator/persistence/atomicity yang sudah tersedia. Full Memory/Evaluation, platform worker dan desain ulang UI menunggu.

Dokumen acuan: `AGENTS.md`, `AI_MODULE_HANDOFF.md`, `docs/schema.md`, `docs/requirements/PRD.md`, audit integrasi 2026-11-07, audit A6, laporan F0 dan F1; A1–A5 dipakai sebagai bukti dependency relevan, bukan alasan mengulang audit umum. **Satu file laporan ini saja dibuat; implementasi, `.env.local`, konfigurasi, migration, provider, database persisten, dan Git history tidak diubah.**
