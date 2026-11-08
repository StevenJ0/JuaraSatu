# Batch A6 — Full Codebase Business Logic & Integration Audit

Tanggal: 7 November 2026, Asia/Jakarta. Mode: **AUDIT ONLY**. Branch: merge/ai-campaign. HEAD: 5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762.

## A. Executive Summary

**Overall audit: COMPLETED dalam cakupan statis yang dinyatakan. Integration verdict: PARTIALLY INTEGRATED.** Source core dan AI ada dalam satu aplikasi dan baseline database; beberapa transaksi internal sudah tersambung. Namun alur bisnis nyata dari usaha → strategi → checkout → pembayaran → evaluasi → pembelajaran berikutnya belum lengkap. Ini bukan persetujuan main, deployment, production, atau Final E2E.

Merge secara struktural menggabungkan kedua garis implementasi. Ancestry yang tersedia menunjukkan merge 58d606a dengan parent core c8d1501 dan AI 13ec118, kemudian port core ke baseline v2.1 melalui 429f603 dan perbaikan grant 9c36b61. Source keberadaan modul dan hasil compiler historis tidak membuktikan kompatibilitas semantik. A1–A5 menutup masalah ACK, claim isolation, publication writer, harness, types dan dokumentasi dalam scope pengujiannya; lima blocker produk C1/C8/C6/C7 serta entry point owner AI tetap ada.

Hambatan utama:

1. **C1:** consumer AI tetap memakai loader dua bisnis demo dengan 40 unit dan tanpa order/reservasi/kampanye aktif; DTO core nyata belum diadaptasi.
2. **C8:** resolver harga order masih mengembalikan diskon 0 dan campaign NULL; attribution resolver juga NULL. Campaign terpublikasi belum menjadi harga checkout.
3. **C6/C7:** Evaluation tetap sintetis. Public verified Memory approval dan retrieval source attestation sengaja tertutup; jangan membuka guard untuk membuat demo lulus.
4. **Entry aplikasi:** owner dashboard memakai sesi SSR core; AI memakai sesi development terpisah dan route production404. Buyer, checkout HTTP, Midtrans webhook, pengiriman email dan scheduler belum ditemukan pada aplikasi ini.
5. **Bug tambahan:** jalur manual order dapat melampaui batas Rp1 miliar; RPC owner menerima versi NULL dan melewati CAS. Kandidat kuat lain: waktu settlement sesudah lock wait, respons polling diskusi yang terlambat, dan financial scenario lama pada prompt replan. Dampak runtime kandidat tersebut belum direproduksi di A6.

### Ringkasan temuan

CONFIRMED berarti kontrak/perilaku source atau ketidakhadiran edge terbukti dari source yang ditunjuk; **bukan** otomatis reproduksi runtime. HIGH_CONFIDENCE berarti konsekuensi kuat tetapi memerlukan reproduksi; HYPOTHESIS belum dapat dipastikan pada data/operasi nyata. Severity menilai dampak terhadap produk yang diminta; gap fitur tidak otomatis kerentanan.

| Severity | CONFIRMED | HIGH_CONFIDENCE | HYPOTHESIS | Total |
|---|---:|---:|---:|---:|
| P0 | 0 | 0 | 0 | 0 |
| P1 | 7 | 1 | 0 | 8 |
| P2 | 4 | 3 | 2 | 9 |
| P3 | 1 | 0 | 0 | 1 |
| Total | **12** | **4** | **2** | **18** |

Enam gap produk utama di atas bukan enam bukti regresi merge. Tidak ada temuan baru yang cukup bukti untuk dilabeli MERGE_REGRESSION. Ketiadaan temuan P0 tidak menyatakan aplikasi aman menyeluruh.

## B. Scope, metode, dan batas bukti

Audit membaca schema terlebih dahulu, instruksi repository, PRD, handoff AI, laporan audit awal serta Stage0/A1/A2/A3/A4/A5, lalu menelusuri caller → validator → service → repository → RPC/trigger → consumer. Review terpisah core/SQL, AI/contracts, dan auth/UI dipadukan dan kandidat penting diperiksa ulang. Pedoman Ponytail Audit dan Security Audit dipakai untuk review berbasis kasus konkret. Format/artefak mengikuti tugas A6: hanya laporan ini.

Inventaris saat audit: **252 berkas TS/TSX di src (217 runtime, 35 source tests), 35 page/route entry files, 13 root migrations**, serta 110 berkas matching test TS/TSX atau mjs di src/tests. Angka inventaris bukan angka pembacaan lengkap atau test yang lulus. Daftar gabungan reviewer mencakup **130 unique runtime source files** dan satu source test auth; **7 unique root migrations** diperiksa penuh/bagian relevan. Delapan berkas test tambahan dibaca sebagian/penuh: lima test core, blueprint-manual-edit, memory-retrieval, browser campaign-blueprint. Total **9 test files dengan pembacaan substansial/targeted** bila source auth test disertakan. Judul test lain hanya dicari untuk pemetaan coverage.

Tiga migration A1/A2/A3 dibaca penuh; baseline initial_v21, core-on-v21, evaluation CAS, dan memory transactions diperiksa bagian yang relevan: **7/13**. Enam lainnya diinventaris/search, bukan diklaim direview penuh. Perincian ini membedakan cakupan parsial dari whole-file review. Sebanyak **16 dari35 page/route files** dibaca; layout, proxy, dan Server Actions juga diperiksa, tetapi tidak dicampur ke angka route.

Tidak semua komponen visual, CSS, barrel exports, generated type lines, debug transport internals, atau seluruh test dibaca baris demi baris. Routes/backend kritis dan 15 flow domain ditelusuri; shared Gemini transport dibaca pada jalur konfigurasi/deadline/response validation, tanpa verifikasi upstream. Pencarian referensi tidak menjamin menemukan dispatch di sistem eksternal yang tidak berada di repository.

**A6 tidak menjalankan kode aplikasi, unit test, lint, typecheck, build, SQL, browser, HTTP, provider, atau DB apa pun.** Kontrol eksekusi terisolasi yang diminta pedoman Security Audit tidak tersedia lengkap untuk menjalankan target di shell ini; audit dilanjutkan statis. Ini tidak menghalangi deliverable audit. Pemeriksaan baru hanyalah pembacaan source, inventory, Git read-only, pencocokan asal source historis, pemeriksaan presence konfigurasi tanpa nilai, dan hash keselamatan workspace. Semua PASS pengujian pada bagian M adalah **historical A1–A5**, bukan PASS A6 baru.

Persistent DB, migration history target, GoTrue/PostgREST/Storage HTTP, real Gemini, Midtrans Sandbox dan email tidak diakses. Tidak ada deployment readiness yang disimpulkan dari fresh PostgreSQL.

### B1. Manifest cakupan source

Setiap nama pada kolom kanan digabung dengan direktori kiri. Ini manifest pembacaan penuh **atau bagian relevan**, bukan klaim semua baris telah direview. Total130 runtime files; partial reads mencakup modul besar seperti repository, Gemini adapter, Blueprint panel. Berkas pendukung/config/dokumen tidak ditambahkan ke hitungan runtime.

<details>
<summary>130 berkas runtime yang diperiksa</summary>

| Direktori | Berkas |
|---|---|
| src/app/(auth)/ | layout.tsx |
| src/app/api/dev/blueprints/ | route.ts |
| src/app/api/dev/campaigns/ | route.ts |
| src/app/api/dev/discussions/auth/ | route.ts |
| src/app/api/dev/discussions/ | route.ts |
| src/app/api/dev/evaluations/ | route.ts |
| src/app/api/dev/memories/ | route.ts |
| src/app/auth/confirm/ | route.ts |
| src/app/dashboard/ | layout.tsx, page.tsx |
| src/app/dashboard/preorders/[id]/ | page.tsx |
| src/app/dev/campaign-simulator/ | page.tsx |
| src/app/dev/campaigns/ | page.tsx |
| src/app/dev/discussion/ | page.tsx |
| src/app/dev/evaluations/ | page.tsx |
| src/app/dev/memories/ | page.tsx |
| src/app/onboarding/ | page.tsx |
| src/app/reset-password/ | page.tsx |
| src/components/owner/ | owner-nav.tsx |
| src/features/ai-context/ | build-business-context.ts, context-hash.ts, contracts.ts |
| src/features/auth/ | actions.ts, confirm-redirect.ts, schemas.ts, session.ts |
| src/features/auth/components/ | sign-in-form.tsx, sign-out-button.tsx |
| src/features/business-memory/ | api.server.ts, contracts.ts, development-provider.ts, domain.ts, embedding.ts, gemini-embedding.server.ts, gemini.server.ts, indexing.server.ts, indexing.ts, repository.server.ts, retrieval.server.ts, service.ts |
| src/features/business/ | actions.ts, guard.ts, repository.ts, schemas.ts, service.ts |
| src/features/business/components/ | business-profile-form.tsx |
| src/features/campaign-blueprint/ | api.server.ts, blueprint-domain.ts, blueprint-service.ts, contracts.ts, development-provider.ts, gemini.server.ts, repository.server.ts, workflow.server.ts |
| src/features/campaign-blueprint/components/ | blueprint-panel.tsx |
| src/features/campaign-evaluation/ | api.server.ts, calculate.ts, context.ts, contracts.ts, development-provider.ts, engine.ts, gemini.server.ts, repository.server.ts, service.ts |
| src/features/campaign-execution/ | api.server.ts, projections.ts, published-offer.server.ts, repository.server.ts, service.ts |
| src/features/campaign-simulator/ | contracts.ts, simulate.ts |
| src/features/campaign-strategist/components/ | discussion-workspace.tsx |
| src/features/campaign-strategist/ | configured-provider.server.ts, development-context.server.ts, development-provider.ts, discussion-api.server.ts, discussion-auth.server.ts, gemini.server.ts, persistent-discussion-service.ts, prompt.ts, strategy-service.ts, supabase-discussion-repository.server.ts |
| src/features/capacity/ | actions.ts, availability.ts, repository.ts, service.ts |
| src/features/capacity/components/ | capacity-form.tsx |
| src/features/jobs/ | repository.ts, service.ts |
| src/features/orders/ | actions.ts, private-status.ts, repository.ts, schemas.ts, service.ts, status.ts |
| src/features/orders/components/ | manual-order-form.tsx |
| src/features/payments/ | repository.ts, schemas.ts, service.ts |
| src/features/preorders/ | actions.ts, context.ts, metrics.ts, repository.ts, service.ts |
| src/features/preorders/components/ | preorder-transition.tsx |
| src/features/pricing/ | calculate.ts, contracts.ts |
| src/features/products/ | actions.ts, photo-processing.ts, photo.ts, repository.ts, schemas.ts, service.ts |
| src/features/products/components/ | product-form.tsx |
| src/lib/ai/ | gemini-fetch.server.ts, gemini-json.server.ts, generation-claims.server.ts, generation-quota-policy.server.ts, narrative-safety.ts, prompt-text.ts |
| src/lib/ | env.ts, submit-without-reset.ts, wib-time.ts |
| src/lib/supabase/ | client.ts, proxy.ts, server.ts, service-role.ts, timestamps.ts, transport.server.ts |
| src/ | proxy.ts |

</details>

<details>
<summary>87 berkas runtime di luar pembacaan substantif A6</summary>

Pencarian nama/import atau cuplikan satu baris pada berkas berikut mungkin dilakukan untuk tracing; itu tidak dihitung sebagai review substantif. Prioritaskan route owner, form lifecycle dan kontrak yang disentuh pada implementasi berikutnya. Generated database types sudah diaudit di A5, tidak dibaca ulang penuh pada A6. CSS, assets, barrel lainnya, dan test di luar daftar9 juga tidak direview penuh.

| Direktori | Berkas |
|---|---|
| src/app/(auth)/forgot-password/ | page.tsx |
| src/app/(auth)/login/ | page.tsx |
| src/app/(auth)/register/ | page.tsx |
| src/app/dashboard/business/ | page.tsx |
| src/app/dashboard/capacity/[id]/ | page.tsx |
| src/app/dashboard/capacity/new/ | page.tsx |
| src/app/dashboard/capacity/ | page.tsx |
| src/app/dashboard/orders/[id]/ | page.tsx |
| src/app/dashboard/orders/new/ | page.tsx |
| src/app/dashboard/orders/ | page.tsx |
| src/app/dashboard/preorders/[id]/edit/ | page.tsx |
| src/app/dashboard/preorders/[id]/orders/new/ | page.tsx |
| src/app/dashboard/preorders/[id]/orders/ | page.tsx |
| src/app/dashboard/preorders/new/ | page.tsx |
| src/app/dashboard/preorders/ | page.tsx |
| src/app/dashboard/products/[id]/ | page.tsx |
| src/app/dashboard/products/new/ | page.tsx |
| src/app/dashboard/products/ | page.tsx |
| src/app/dev/campaign-simulator/ | error.tsx, preview-loading.tsx |
| src/app/ | error.tsx, layout.tsx, page.tsx |
| src/components/ | brand.tsx, form-field.tsx, form-message.tsx |
| src/components/owner/ | back-link.tsx, badge.tsx, card.tsx, kpi-card.tsx, owner-theme.tsx, saved-toast.tsx, toast.tsx |
| src/components/ui/ | button-link.tsx, icon.tsx |
| src/config/ | site.ts |
| src/features/ai-context/ | index.ts |
| src/features/auth/components/ | auth-shell.tsx, forgot-password-form.tsx, resend-confirmation.tsx, reset-password-form.tsx, sign-up-form.tsx |
| src/features/auth/ | errors.ts |
| src/features/business-memory/components/ | memory-workspace.tsx |
| src/features/business-memory/ | index.ts |
| src/features/business/ | categories.ts, slug.ts |
| src/features/campaign-blueprint/ | index.ts |
| src/features/campaign-evaluation/components/ | evaluation-workspace.tsx |
| src/features/campaign-evaluation/ | index.ts, performance.ts |
| src/features/campaign-execution/components/ | execution-workspace.tsx |
| src/features/campaign-execution/ | contracts.ts, index.ts |
| src/features/campaign-simulator/components/ | campaign-simulator.tsx |
| src/features/campaign-simulator/ | development-fixtures.ts, index.ts |
| src/features/campaign-strategist/ | contracts.ts, discussion-repository.ts, index.ts, persistence-contracts.ts |
| src/features/capacity/components/ | capacity-usage.tsx |
| src/features/capacity/ | schedule-form.ts, schemas.ts |
| src/features/marketing/ | demo-data.ts, landing-page.tsx, mobile-navigation.tsx, platform-footer.tsx, product-preview.tsx, result-preview.tsx |
| src/features/orders/ | capacity-options.ts, recap.ts |
| src/features/orders/components/ | order-actions.tsx, order-badges.tsx, order-list.tsx |
| src/features/preorders/ | capacity-options.ts, schemas.ts |
| src/features/preorders/components/ | close-preorder-form.tsx, preorder-form.tsx, preorder-status-badge.tsx |
| src/features/pricing/ | index.ts |
| src/features/products/ | sku.ts |
| src/lib/ai/ | gemini-debug.server.ts |
| src/lib/ | form-state.ts, format-idr.ts, units-input.ts |
| src/lib/supabase/ | database.types.ts |

</details>

Test yang dibaca: src/features/auth/session.test.ts; src/features/orders/service.test.ts; src/features/orders/resolve-cost.test.ts; src/features/payments/service.test.ts; tests/supabase/payments.test.ts; tests/supabase/owner-commands.test.ts; tests/integration/blueprint-manual-edit.test.ts; tests/unit/memory-retrieval.test.ts; tests/browser/campaign-blueprint.mjs. Tidak dijalankan.

Enam migration hanya inventory/search: 20261103090000_atomic_campaign_blueprint_creation.sql; 20261104091000_seal_completed_campaign_updates.sql; 20261104092000_reject_synthetic_finalization_memory_approval.sql; 20261104094000_memory_index_recovery.sql; 20261106090000_memory_generation_type.sql; 20261106100000_atomic_ai_generation_admission.sql. Pemeriksaan fungsi/caller yang terkait tidak sama dengan membaca seluruh migration.

## C. Module inventory dan integrasi aktual

Status CONNECTED adalah source path lokal yang nyata; tetap memerlukan bukti HTTP/browser. PARTIAL mempunyai bagian berfungsi dan edge hilang; DISCONNECTED mempunyai producer/consumer yang belum disambung; STUB/MOCK berisi placeholder/fixture; NOT IMPLEMENTED tidak ditemukan pada route/consumer inventory; UNKNOWN membutuhkan observasi yang belum diizinkan.

Ownership rujukan: Rafi untuk auth/business/products/capacity/preorders/orders/payment persistence/generic jobs; Steven untuk AI Context/Strategist/Blueprint/Simulator/Execution/Evaluation/Memory; Indro untuk buyer/checkout HTTP/Midtrans/email. Kontrak lintas modul dan platform adalah tanggung jawab bersama. Ini pemetaan tugas PRD/user, bukan bukti modul eksternal telah dikerjakan. Entry point aktual ada pada peta D; yang belum ada ditandai eksplisit.

| Module | Producer | Consumer | Contract utama | Status | Finding |
|---|---|---|---|---|---|
| Auth/owner | Supabase SSR identity, membership | owner layout/actions | user→business ownership | CONNECTED | — |
| Business profile/categories | owner actions/service/repository | dashboard/products | categories text[], membership | CONNECTED | — |
| Products/photos/cost | product service/storage | capacity/preorder snapshots | money/costQuality/photo paths | CONNECTED | 07 pada order consumer |
| Capacity | capacity rows + reservations | availability/order RPC | effective held + allocated | CONNECTED | 09/14 edges |
| Preorder draft/publish | canonical A3 writer | owner/public reader contracts | frozen price/pickup/version | CONNECTED | 08/17 |
| Orders/manual/fulfillment | owner actions + atomic RPC | dashboard/ledger | idempotency, CAS, snapshots | CONNECTED | 07/08 |
| Private buyer projection | token hash lookup | external tracking UI absent | minimal non-PII DTO | PARTIAL | 06 |
| Public order/checkout | core service/RPC | no app handler | expected server price/hold/token | PARTIAL | 02/06/07 |
| Payments persistence | service-only payment RPC | adapter absent | verified facts/event dedupe | PARTIAL | 06/09/14 |
| Jobs generic | typed queue + A1 ACK | expire function; scheduler absent | lease/attempt/type isolation | PARTIAL | 18 |
| Core C1 → AI Context | findPreorderContext / context DTO | seededDevelopmentContext | richer provenance/source versions | DISCONNECTED | 01 |
| AI Strategist | fixture-backed context + provider | persisted proposals/dev UI | scoped hash/claims/Zod | STUB/MOCK context, PARTIAL pipeline | 01/05/10/13 |
| Blueprint/alternatives | persisted proposal + owner edits | approval/materialization | versions/hash/deterministic facts | PARTIAL | 01/05/11/12 |
| Simulator | parsed scenario + shared pricing | dev simulator/Blueprint | hypothetical contribution | CONNECTED as simulation | 01 for real inputs |
| Campaign execution | approved Blueprint | tasks/content/published projection | source recheck/CAS | PARTIAL | 01/02/05 |
| C3 → C8 offer/attribution | published campaign projection | SQL checkout resolver | active window/price/campaign ID | DISCONNECTED; SQL STUB/MOCK | 02 |
| Evaluation C6 | syntheticCampaignAnalytics | evaluation service/report | evidence/window/cost/final CAS | STUB/MOCK analytics | 03 |
| Memory candidate/review | evaluation-derived source | dev Memory workspace | source/content hash/review | PARTIAL | 03/04 |
| Verified Memory approval/index | public guard + dedicated jobs | retrieval | authoritative final source | PARTIAL, guarded BLOCKED | 04 |
| Future strategy learning | owner/profile/source-filtered retrieval | strategist history | attestor + eligible memory | DISCONNECTED verified path | 04 |
| Public UI/Midtrans/email adapter | not found in app | core contracts exist | external team integration | NOT IMPLEMENTED here | 06/18 |
| Persistent deployment/catalog | target not inspected | actual running app | applied chain/grants/overloads | UNKNOWN | 15 |

## D. Full source flow maps

Paths below are relative to repository root. To keep SQL rows readable, **B** means supabase/migrations/20261103000000_initial_v21.sql; **K** means supabase/migrations/20261106160000_core_preorder_on_v21.sql; **A1**, **A2**, **A3** mean respectively 20261107090000_generic_job_acknowledgement_guards.sql, 20261107100000_job_claim_isolation.sql, 20261107110000_canonical_preorder_publication.sql in that same directory. Each alias plus line is an actual source reference. Missing edges are explicit; an internal available function is not represented as an active app endpoint.

### D1. Authentication dan business ownership

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/features/auth/components/sign-in-form.tsx:1; src/features/auth/actions.ts:35 | SignInForm → signInAction | form credentials | schema-validated login | SSR client |
| 2 | src/lib/supabase/server.ts:7; src/features/auth/actions.ts:46 | createSupabaseServerClient / signInWithPassword | credentials | SDK session cookies/error | redirect dashboard |
| 3 | src/app/dashboard/layout.tsx:8; src/features/business/guard.ts:28 | getCurrentBusinessProfile → requireBusinessOwner | SSR request | profil usaha setelah guard | owner layout/render |
| 4 | src/features/business/guard.ts:19; src/features/auth/session.ts:1; src/features/business/repository.ts:69 | requireUserId/getCurrentUserId(getClaims) → findOwnedBusinessId | SSR identity/client | userId/businessId atau redirect login/onboarding | guarded pages/actions/services |
| 5 | src/features/campaign-strategist/discussion-auth.server.ts:27 | authenticateDiscussion, separate branch | bearer/dev cookies | verified Auth identity + owner membership | AI boundary only; **no reuse edge from SSR cookies** |

### D2. Business profile

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/features/business/components/business-profile-form.tsx:1; src/features/business/actions.ts:23 | BusinessProfileForm → createBusinessAction | owner form | auth + schema result | create use case |
| 2 | src/features/business/service.ts:20 | createBusinessForOwner | userId/normalized profile | existing membership or slug retry/conflict recovery | repository create |
| 3 | src/features/business/repository.ts:92 | createBusinessWithOwner | normalized categories/profile/slug | create_business_with_owner result | action redirect/onboarding completion |
| 4 | src/features/business/actions.ts:42; src/features/business/repository.ts:108 | updateBusinessAction → updateBusinessProfile | owner scope/profile | scoped mutation/error | dashboard revalidation |
| 5 | src/features/business/repository.ts:81 | getBusinessProfile | businessId from guard | parsed profile | owner render, core contexts |

Categories use the documented array/legacy mirror contract, not an invented closed DB enum. No schema change proposed here.

### D3. Products dan photo/cost

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/features/products/components/product-form.tsx:1; src/features/products/actions.ts:46,68 | createProductAction/updateProductAction | fields/upload/expected version | owner scope + product/ref runtime parse | readPhotoUpload |
| 2 | src/features/products/photo.ts:45; src/features/products/actions.ts:50 | readPhotoUpload/requirePhoto | form file | signature/size validation; create requires photo | action invokes optimizer |
| 3 | src/features/products/photo-processing.ts:19 | optimizeProductPhoto | validated bytes | rotated/resized WebP full/thumb or NULL error | action calls product service |
| 4 | src/features/products/service.ts:31,64 | createProductWithPhoto/updateProductWithPhoto | parsed product/processed photo/owner/version | upload before persistence, current owned row/version check | repository write |
| 5 | src/features/products/repository.ts:133,145,166,186 | insertProduct/updateProduct/applyVersionedUpdate/uploadProductPhoto | business path/product/version | scoped insert or CAS update/new paths/conflict | service cleanup |
| 6 | src/features/products/service.ts:21,91 | discardPhoto/service completion | saved row/new or old path | cleanup failed upload or superseded photo after switch | action revalidation → capacity/preorder |

The file-start references identify the inspected module where several non-exported helpers participate; they do not claim a function declaration exactly at line1. Photo cleanup failures can leave an orphan; no demonstrated business data loss was established.

### D4. Production capacity

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/features/capacity/actions.ts:59 | create capacity action | form | owner+schema validated values | capacity service |
| 2 | src/features/capacity/service.ts:28 | createCapacity | product/date/cutoff/window | active owned product + valid WIB window | repository |
| 3 | src/features/capacity/repository.ts:126 | insertCapacity | scoped row | saved/duplicate | action UI revalidation |
| 4 | src/features/capacity/service.ts:50; src/features/capacity/repository.ts:143 | changeCapacitySchedule → updateCapacitySchedule | current version/new limits | CAS update atau version/commitment denial | DB guards B:754; K:125 |
| 5 | src/features/capacity/availability.ts:9 | summarizeCapacity | reservations + now | allocated + live held, remaining | preorder metrics/orderability |

### D5. Preorder draft → publication → reads

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/features/preorders/actions.ts:42,65 | createPreorderAction/updatePreorderAction | owner form/version | schema result | createPreorderDraft/updatePreorderDraft |
| 2 | src/features/preorders/service.ts:30,44; src/features/preorders/repository.ts:337 | draft service → savePreorderDraft | product/capacity/schedule/slug | save_preorder_draft RPC | K:1306 transaction |
| 3 | src/features/preorders/actions.ts:107; src/features/preorders/service.ts:71 | publishPreorderAction → runPreorderTransition | preorder/version | authenticated transition | repository.ts:385 |
| 4 | A3:58,4 | owner publish wrapper → private.publish_preorder_canonical | derived business/id/version | locked PO/PI/C; frozen snake_case pickup + price; published | DB return to action |
| 5 | src/features/preorders/repository.ts:192,242 | findPreorder / findPublicPreorder | business/id or slug/current time | parsed owner/public model | UI, public contract |
| 6 | src/features/preorders/repository.ts:257; K:1235 | read_preorder_offer | preorderId | currently normal-price offer | public DTO; **public page absent** |
| 7 | src/features/preorders/repository.ts:312; src/features/preorders/context.ts:105 | findPreorderContext → toPreorderContext | owned preorder/current time | core facts/units/asOf | **AI adapter missing** |

Failure branches include wrong owner/not found, missing/invalid version, non-draft state, schedule/date collision, inactive product, insufficient remaining capacity. A3 makes two publication overloads delegate to one writer; it does not migrate old rows.

### D6. AI Strategist discussion

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/app/api/dev/discussions/route.ts:1; src/features/campaign-strategist/discussion-api.server.ts:84 | POST → discussionPost | JSON/action | development auth + origin + body parse | ownedSession/ownedPreorder |
| 2 | src/features/campaign-strategist/discussion-auth.server.ts:53,60 | scope ownership checks | requested IDs/verified owner | business-bound session/preorder | discussion service |
| 3 | src/features/campaign-strategist/development-context.server.ts:18 | seededDevelopmentContext | scoped preorder | fixture provenance/hash/version snapshot | **no production C1 producer edge** |
| 4 | src/features/campaign-strategist/persistent-discussion-service.ts:16 | sendPersistentDiscussion/beginTurn | request key/version/hash/message | durable running turn or replay/conflict | repository/admission/provider |
| 5 | src/features/campaign-strategist/supabase-discussion-repository.server.ts:45; src/lib/ai/generation-claims.server.ts:32 | createSupabaseDiscussionRepository / generationClaims | identity/hash/preorder | owned atomic admission/checkpoint | strategy-service |
| 6 | src/features/campaign-strategist/strategy-service.ts:85; src/features/campaign-strategist/gemini.server.ts:6 | strategy generation | validated context/preferences | provider output → parsed/recomputed alternatives | complete/fail turn |
| 7 | src/features/campaign-strategist/components/discussion-workspace.tsx:70 | loadSession | session ID | persisted session/hash/history/URL | render; polling race A6-10 |

Timeout/invalid output becomes explicit failed generation, not fabricated assistant success. Interrupted generations require explicit recovery; context is checked again after latency.

### D7. Alternatives → Blueprint create/revise/approve

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/app/api/dev/blueprints/route.ts:1; src/features/campaign-blueprint/api.server.ts:25 | Blueprint boundary | selection/revision/approval JSON | auth/origin/schema + scoped repository | blueprintWorkflow |
| 2 | src/features/campaign-blueprint/workflow.server.ts:39; src/features/campaign-blueprint/repository.server.ts:50 | workflow/selection | persisted proposal key/version/hash | verified selection or rejection | validateBlueprintPreflight |
| 3 | src/features/campaign-blueprint/blueprint-service.ts:14 | validateBlueprintPreflight | campaign/version/source/edits | current context + independently calculated edited facts | generation/manual plan |
| 4 | src/features/campaign-blueprint/workflow.server.ts:23; src/features/campaign-blueprint/blueprint-service.ts:26 | generateBlueprint | manual plan OR claimed provider output | manual provenance OR generated plan | validateBlueprint |
| 5 | src/features/campaign-blueprint/gemini.server.ts:29 | provider generate | original alternative + latest edits | validated plan; stale scenario input A6-11 | blueprint-domain.ts:62 |
| 6 | src/features/campaign-blueprint/blueprint-domain.ts:62,94 | validateBlueprint/revalidateBlueprintFinancials | body + fresh context | numeric/narrative/window/version checks | repository.ts:85–105 RPC wrappers |
| 7 | src/features/campaign-blueprint/workflow.server.ts:69 | approve branch | confirmation/expected versions | revalidated approved Blueprint + materialized tasks/content | execution service |

Provider invocation is intentionally bypassed for a manual plan. Saving a manual revision is not a replan provider test.

### D8. Promotion simulator

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/app/dev/campaign-simulator/page.tsx:1 | development simulator entry | demo inputs | simulation view | simulator domain |
| 2 | src/features/campaign-simulator/simulate.ts:31; src/features/campaign-simulator/contracts.ts:54 | simulateCampaign | facts/current offer/scenario | parsed bound window + feasible/blockers | shared calculator |
| 3 | src/features/pricing/calculate.ts:27,54,81 | unit/order price, discount validation | base/bps/units/cost | deterministic floor/BigInt/bounds/contribution | simulation result |
| 4 | src/features/campaign-blueprint/blueprint-domain.ts:41 | validateBlueprintOffer | owner edits/current facts | same deterministic hypothetical scenario | Blueprint validation |

No order/reservation mutation occurs in simulation. Real-facts entry remains blocked by C1; no forecast or actual sales is inferred from assumed units.

### D9. Campaign execution/published offer

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/features/campaign-execution/api.server.ts:14,42 | boundary/executionPost | publish/close/task | auth/origin + synthetic gate | campaignExecutionService |
| 2 | src/features/campaign-execution/service.ts:66,38 | publish → inspect | approved blueprint/versions/context | source/financial/materialization validation | repository publication |
| 3 | src/features/campaign-execution/repository.server.ts:71 | publication RPC wrapper | validated snapshot/CAS | published campaign/activation snapshot | tasks/content/offer projection |
| 4 | src/features/campaign-execution/service.ts:88 | task branch | task version/completed | CAS or idempotent result | execution view |
| 5 | src/features/campaign-execution/published-offer.server.ts:9; src/features/campaign-execution/projections.ts:8 | readPublishedOffer/projectPublishedOffer | tenant/preorder/current time | active offer or none | dev API read |
| 6 | K:78,929 | private.current_order_offer → checkout | preorder | always 0/NULL | **missing C3→C8 runtime adapter** |

### D10. Buyer → checkout → private order

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/app/dashboard/preorders/[id]/page.tsx:157 | BuyerPreview | published slug | explicitly says buyer page unavailable | **no /p route/checkout UI** |
| 2 | src/features/preorders/repository.ts:242 | findPublicPreorder (available contract) | slug | public price/quota/frozen pickup | no active buyer route consumer found |
| 3 | src/features/orders/service.ts:95 | placePublicOrder (available contract) | parsed command/token/key | normalized request/token hashes | createPublicOrderRecord |
| 4 | src/features/orders/repository.ts:374 | createPublicOrderRecord | trusted server fields | create_preorder_order RPC | K:876 |
| 5 | K:902,908,915,921,931,935 | checkout transaction | slug/hash/token/expected price | replay or server schedule/price/capacity validation | private.insert_order K:938 |
| 6 | K:181,203; B:769,814 | insert_order / reservation/totals guards | frozen unit snapshots | order/item/live hold atomically | RPC result |
| 7 | src/features/orders/private-status.ts:1; src/features/orders/service.ts:1 | token lookup/private projection | bearer token → hash | minimal non-PII status, overdue mapping | **tracking UI absent** |

Owner manual flow is reachable: manual-order-form → orders/actions.ts:64 → service.ts:67 → repository.ts:330 → K:817 → insert_order. It allocates capacity without Midtrans. Standalone manual action87/service79/repository345/K953 uses its own date/capacity path. Manual payment confirmation is not sandbox provider settlement.

### D11. Payment facts → hold allocation/review

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/features/payments/service.ts:17 | C5 adapter contract comment | intended Midtrans request/notification | **no provider HTTP adapter/webhook found** | authenticity evidence stops here |
| 2 | src/features/payments/service.ts:33; src/features/payments/repository.ts:58; K:688 | claimPaymentAttempt | private token hash | create_charge/reuse_qr/wait/reconcile | missing charge adapter |
| 3 | src/features/payments/repository.ts:74 | recordPaymentChargeRecord | provider charge facts | persisted QR/transaction ID via RPC | private status consumer |
| 4 | src/features/payments/service.ts:45; src/features/payments/repository.ts:103 | applyVerifiedPayment | trusted verified fact DTO | canonical apply_verified_payment RPC | K:490 |
| 5 | K:518,521,530,550 | settlement transaction | event key/hash/status/amount | order/payment locks, dedupe, amount equality, hold eligibility | applied or review/duplicate/ignored |
| 6 | K:555–559 | apply branch | eligible held reservation | one allocation, applied payment, awaiting_confirmation, email job | order UI/worker |
| 7 | src/features/orders/actions.ts:163; src/features/orders/repository.ts:397; K:364 | acceptLatePaymentAction → accept_late_payment | owner/version/payment | capacity recheck/reallocation or denial | order review UI |

Canonical service-only SQL receives **already verified** facts; source existence does not prove webhook signature verification. No browser redirect establishes paid status.

### D12. Generic jobs/Memory jobs

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/features/jobs/service.ts:32; src/features/jobs/repository.ts:70 | runExpireJobs/enqueue | service client | due expiry jobs | **no scheduler entry found** |
| 2 | src/features/jobs/repository.ts:39; A2:1 | claimJobs/typed claim_jobs | validated non-Memory job types | SKIP LOCKED lease/attempt claims | serial expiry worker |
| 3 | src/features/jobs/service.ts:11; src/features/orders/repository.ts:407; K:1075 | runExpireJob/expire_or_cancel_order | order ID | idempotent expire/release event | ACK/fail |
| 4 | src/features/jobs/repository.ts:50,59; A1:1 | completeJob/failJob | id/attempt | live lease matching ACK or false/NULL | retry/dead state |
| 5 | src/features/business-memory/indexing.server.ts:24 | runMemoryWorker | owner/profile | dedicated claim_memory_jobs | source/lease/profile checks |
| 6 | src/features/business-memory/indexing.ts:15; indexing.server.ts:13 | indexClaimedMemoryJob/commit | source-bound embedding result | atomic complete_memory_index_job / failure | ready memory or recoverable failure |

Memory jobs never use generic ACK/claim; external consumers must also migrate away from legacy claim. Email/reconcile type admission is not implementation of their delivery/provider workers.

### D13. Evaluation

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/features/campaign-evaluation/api.server.ts:16,50 | boundary/evaluationPost | campaign/action/CAS | dev auth + synthetic mode | evaluationService |
| 2 | src/features/campaign-evaluation/repository.server.ts:32; context.ts:17 | snapshot/cost reads → buildEvaluationContext | execution window/cost completeness | context hash/source versions | deterministic calculation |
| 3 | src/features/campaign-evaluation/api.server.ts:21; development-provider.ts:10 | syntheticCampaignAnalytics | fixture scenario | **synthetic metrics, not real paid orders** | calculateEvaluation |
| 4 | src/features/campaign-evaluation/calculate.ts:8; engine.ts:48 | deterministic calculation/interpretEvaluation | validated metrics/costs | provisional totals + available/failed/invalid narrative | append CAS |
| 5 | src/features/campaign-evaluation/repository.server.ts:56; service.ts:101 | append/review/finalize branches | expected revision/hash/review | history/CAS; guarded synthetic finalization | Memory source only as synthetic |
| 6 | supabase/migrations/20261104090000_evaluation_cas_and_finalization.sql:164 | finalization guard | source/cohort/mode | rejects mixing real cohort with fixture | **verified C6 unavailable** |

### D14. Memory candidate → review → indexing → retrieval

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/features/business-memory/api.server.ts:18,30; service.ts:19 | memoryPost → generate | evaluation/source expected hash | owned source + canonical source-bound claim | provider interpretation |
| 2 | src/features/business-memory/domain.ts:7,32,51 | memorySource/generateMemoryInterpretation | reviewed evaluation facts | validated candidate/content hash | persistence then owner review |
| 3 | src/features/business-memory/service.ts:44,55 | review/approve | owner/content/source hashes | reviewed candidate; approval guarded | approval/enqueue RPC |
| 4 | supabase/migrations/20261104093000_memory_approval_and_indexing_transactions.sql:11,38 | private.check_memory_source | source evaluation/campaign | synthetic denied; verified producer unavailable | **positive public approval stops** |
| 5 | src/features/business-memory/indexing.server.ts:24; indexing.ts:15 | dedicated worker | approved source/profile/lease | pre/post-source checked embedding + atomic ACK | only if eligible job exists |
| 6 | src/features/business-memory/retrieval.server.ts:16,27,30 | retrieveMemoryHistory | owner/query/profile/attestor | cold_start or unavailable without attestor; verified matches only if attested | strategist history |

### D15. Subsequent campaign with historical evidence

| Step | File:line | Function | Input | Output | Next caller/consumer |
|---|---|---|---|---|---|
| 1 | src/features/campaign-strategist/development-context.server.ts:55 | optional history loading | new preorder scope/query | retrieveMemoryHistory call **without attestor** | retrieval guard |
| 2 | src/features/business-memory/retrieval.server.ts:20,27–35 | owner/profile/source filtering | eligible memory candidates | cold_start/unavailable; not fabricated verified evidence | context.history |
| 3 | src/features/ai-context/build-business-context.ts:1; src/features/campaign-strategist/prompt.ts:27 | buildBusinessContext/buildStrategyPrompt | newest facts + bounded history | validated prompt provenance | provider |
| 4 | src/features/campaign-strategist/strategy-service.ts:85 | strategy generation | prompt/current context | deterministic validation of next proposal | persisted discussion |

The fallback strategy path exists. **Verified historical-learning positive path is not connected**, because both authoritative C6 and source attestor are missing. A cold-start result is not proof that indexed history was consumed.

## E. Producer–consumer contract matrix

| Boundary | Types/null/status/version | Tenant & authority | Error/transaction | Evidence and gap |
|---|---|---|---|---|
| Core auth→owner | identity + nullable membership→redirect | server Auth user→owner business | fails before service mutation | inspected source; upstream HTTP not rerun |
| Profile→core/AI | categories[] vs AI singular category; no invented conversion | scoped business | current core reads valid; AI adapter absent | C1 must agree semantics |
| Product→preorder | mutable catalog vs frozen base/name/SKU; nullable cost + quality | owned active product | publish freezes; cost later ledger separate | A3 historical SQL/readers PASS |
| Capacity→checkout | effective hold expiry + allocated; snapshots not reservation | DB locks/trigger authority | atomic quota/capacity reject | last-slot SQL historical only |
| Core PreorderContext→AI C1 | missing cost value, product/item/capacity versions and production provenance in current public DTO | must derive all scope from owner | adapter cannot just cast DTO | A6-01 |
| Proposal→Blueprint | persisted source key/hash/version, draft/active version | owned proposal/campaign | invalid/stale rejected before persistence; post-provider recheck | A6-11 old prompt scenario |
| Manual plan→replan | plan present bypasses inference; no Gemini provenance | explicit owner edits | shared numeric/narrative validation | browser failure test incorrectly assumes inference |
| Simulator→financial snapshot | integer IDR, bps, nullable unknown cost | server deterministic; no LLM financial authority | calculation rejects out-of-range | SQL order cap missing A6-07 |
| Published campaign→C8 | active window + offer version + pricing campaign | server time/current published Blueprint | current SQL stub 0/NULL | no runtime edge to C3 |
| Checkout→order | quantity1..10000; expected unit price advisory; token hash + idempotency/request hash | service-only public contract | SQL recomputes; same key changed hash/token rejects | no public HTTP handler |
| Provider→payment | canonical seven fields vs retained legacy overload; nullable transaction/paidAt | signature verification must precede service-role RPC | dedupe + exact amount + monotonic paid | adapter absent; SQL is not signature verification |
| Owner→order mutation | positive expected version in forms; SQL allows NULL | same owner only | version bypass possible, A6-08 | no tenant bypass claimed |
| Payment→reservation | applied vs verified-but-unapplied; order/payment status separate | DB transactional | live hold or review; clock edge A6-09 | no fresh lock-wait test |
| Generic job→ACK | id+attempt+lease; fail_job nullable stale return despite generated scalar type | service-only, type allowlist | false/NULL are stale outcomes; retries1/5/15/60 | A1/A2 historical; external consumers unknown |
| Evaluation→finalization | metrics + source hash/window/review/CAS; synthetic explicit | SQL checks source/cohort | append/review/final atomic; verified source absent | C6 fixture only |
| Evaluation→Memory | final evaluation/version/content/source/profile bound | owner + public source guard | synthetic blocked; private helper tests not production approval | C7 dependency |
| Indexed Memory→AI | approved/ready/profile/source fresh; nullable attestor defaults absent | owner filter before ranking, per-source attestation | unavailable/cold_start explicitly | C7 positive retrieval blocked |
| Generated types→SDK | 26 tables/352cols/50 signatures; CHECK statuses remain string | compile contract, not authorization | runtime Zod remains necessary | core clients unparameterized, metadata NULL limits |

All timestamps must be compared as instants; WIB date grouping uses the existing helpers. supabase/timestamps.ts preserves PostgreSQL fractional timestamp fidelity rather than silently changing source hashes. No schema enum or financial fact is inferred from a UI label.

## F. Findings detail

IDs are local to A6. All reproduction descriptions below are **plans/static cases**, not commands executed against data. No automatic remediation is authorized. SQL/function changes mentioned require a separate explicitly approved database task under AGENTS.md.

### A6-01 — Real business facts do not reach AI C1

- **P1 / CONFIRMED / INTEGRATION_GAP.** Modul: core preorder/context, strategist, Blueprint, execution. Harapan: produk/biaya/kapasitas/hold/order/offer usaha terkini dengan versi tepercaya. Aktual: development-context.server.ts:18–38 membatasi dua ID demo, bentuk40unit serta tanpa order/kampanye published/reservasi aktif; line47 mengisi sales/commitment0 dan orderable40. Consumer: discussion-api.server.ts:103, Blueprint API, execution/api.server.ts:18–20.
- Akar masalah: belum ada producer/adapter konteks produksi antara preorders/repository.ts:312, context.ts:93 dan BuildBusinessContextInput. DTO core sengaja tidak memuat angka biaya dan beberapa versi sumber; mengganti nama field saja tidak cukup.
- Kasus source: pemilik biasa membuat preorder valid berkapasitas60 dengan satu order allocated; loader menolak konteks tersebut. Dampak: AI belum dapat bekerja pada keadaan bisnis nyata. Penolakan fixture di luar scope demo tetap kontrol yang benar.
- Dependency/perbaikan minimum: sepakati snapshot/biaya/otoritas C1, buat producer nyata dan adapter dengan scope owner; pertahankan entry fixture secara eksplisit. Regresi: dua tenant, hold expired, allocated/manual unpaid versus paid, biaya unknown/0/null, perubahan versi/konteks selama provider berjalan. Deployment: integrasi aplikasi dan konsistensi sumber; perubahan SQL hanya melalui tugas terpisah bila diperlukan/disetujui.

### A6-02 — Published offers and attribution stop before checkout C8

- **P1 / CONFIRMED / INTEGRATION_GAP.** Modul: projection execution, checkout/pricing/attribution. Harapan: kampanye published yang aktif menentukan harga server dan pricing campaign ID; attribution diputuskan terpisah sesuai aturan. Aktual: K:78–83 mengembalikan0/NULL; K:355–361 selaluNULL; checkout mengonsumsinya pada929/942 dan public offer read1247. Execution projections.ts:8–43 dan published-offer.server.ts:8 menyatakan adapter C8 belum selesai.
- Akar masalah: seam core masih placeholder. Kasus statis: kampanye diskon10% yang memenuhi syarat dipublikasikan; checkout tetap memakai harga normal beku dan campaign IDsNULL. Tidak ada transaksi reproduksi dijalankan. Dampak: penawaran berbeda dari checkout dan attribution tidak tersedia; jika UI menggunakan C3 langsung, expected-price check dapat mengembalikan OFFER_CHANGED.
- Perbaikan minimum/dependency: satu resolver active offer yang otoritatif untuk read/write dan pemeriksaan expiry/window; pisahkan pricing dari attribution. Memerlukan **izin SQL/function terpisah**. Regresi: organic/attributed, batas waktu, closed/expired walau status published stale, perubahan offer, pembulatan integer dan snapshot order. Deployment: reader/writer kompatibel dengan pemeriksaan catalog; perubahan UI saja tidak cukup.

### A6-03 — Evaluation C6 uses fixture metrics

- **P1 / CONFIRMED / INTEGRATION_GAP.** Modul: orders/payments/costs/evaluation. Harapan: paid/fulfilled revenue, window, attribution dan spend berasal dari bukti. Aktual: evaluation/api.server.ts:20–22 menyuntikkan syntheticCampaignAnalytics; development-provider.ts:9–24 membuat skenario fixture. calculate.ts menyediakan kalkulasi deterministik dan blocker provisional/final, belum producer analytics nyata.
- Akar masalah: producer C6 otoritatif belum ada. Kasus: pilihan exceeds_target menghasilkan metrik fixture tanpa bergantung pada ledger nyata. Dampak: laporan tidak boleh dipresentasikan sebagai penjualan teramati atau uang/profit aktual. Mode sintetis yang dijaga ini disengaja, bukan bukti analytics nyata rusak.
- Perbaikan minimum: kontrak window/ledger/revision verified dari fakta payment/order/fulfillment dan completeness, lalu adapter C6; dependency attribution C8 serta fakta buyer/payment. Regresi: review/unapplied/duplicate/cancel/fulfilled, nol versus unavailable, biaya produksi unknown, spend reviewed, tanpa klaim causal uplift, sumber berubah sebelum finalisasi. Perubahan SQL verified finalization memerlukan tugas/izin terpisah. Deployment: pertahankan provenance sintetis dan guard sampai bukti positif lulus.

### A6-04 — Verified Memory loop has no authoritative source/attestor

- **P1 / CONFIRMED / INTEGRATION_GAP.** Modul: Evaluation/Memory/indexing/retrieval/strategist. Harapan: evaluasi final otoritatif reviewed → memory approved terikat sumber → embedding ready → retrieval eligible. Aktual: Memory repository.ts:27–36 membangun sumber dari C6 sintetis; domain.ts:7–14 meneruskan synthetic; migration20261104093000:11–38 menolak synthetic lalu menghasilkan VERIFIED_C6_UNAVAILABLE. retrieval.server.ts:27–30 memerlukan attestor; strategist loader55–58 dan Memory API33 tidak memasoknya.
- Akar masalah/dependency: otoritas C6 belum ada, kemudian kontrak sumber C7. Kasus: kandidat sintetis dapat direview tetapi tidak menjadi verified history eligible. Dampak: loop pembelajaran penuh terblokir. Ini proteksi integritas sumber yang benar, bukan izin untuk melewatinya.
- Perbaikan minimum: selesaikan C6, lalu verified finalization/attestor serta lifecycle approval/index melalui kontrak SQL yang diizinkan terpisah. Regresi: synthetic/stale/foreign/draft/unreviewed/profile mismatch dikecualikan; sumber dicek setelah embed/match; kegagalan dan recovery lease tidak menciptakan ready palsu; sumber verified benar-benar diretrieve. Deployment: jangan membuka public approval sebelum otoritas sumber tersedia.

### A6-05 — Owner AI entry and session remain separate development surface

- **P1 / CONFIRMED / INTEGRATION_GAP.** Modul: auth/dashboard/dev AI/transport. Harapan: owner memasuki AI terintegrasi setelah login core. Aktual: auth/actions.ts:35–57 mengatur sesi SSR; discussion-auth.server.ts:27–49 membaca bearer/dev cookie dan login terpisah. owner-nav.tsx:7–14 hanya berisi link core; kelima halaman /dev menghasilkan notFound di luar development. transport.server.ts:24–27 membatasi Supabase ke lokal127.0.0.1:54321.
- Kasus: login core berhasil belum cukup mengakses AI lokal tanpa autentikasi kedua; halaman AI production404. Akar masalah: entry development sengaja terisolasi. Dampak: perjalanan owner AI produksi belum ada; bukan auth bypass.
- Perbaikan minimum: route/session owner memakai guard yang tersedia setelah C1/C8 siap; konfigurasi persistence yang dituju dan pertahankan fixture gated. Regresi: satu login, onboarding, penolakan foreign session/preorder/campaign, demo tidak terbuka tanpa sengaja. Deployment: tugas aplikasi/config; jangan sekadar menghapus guard development. Revocation/logout upstream belum terbukti di audit ini.

### A6-06 — Public buyer and Midtrans HTTP integration absent

- **P1 / CONFIRMED / NOT_IMPLEMENTED.** Modul: buyer/catalog/checkout/private tracking/charge/webhook. Perjalanan produk memerlukan entry tersebut. Aktual: tidak ada pada inventaris route; preorders/[id]/page.tsx:157 menyatakan halaman buyer belum tersedia. payments/service.ts:17–19 mendefinisikan boundary C5 tanpa memanggil provider. Consumer app untuk placePublicOrder, claimPaymentAttempt dan applyVerifiedPayment tidak ditemukan.
- Akar masalah: modul tim eksternal belum terintegrasi di repository ini; ownership PRD1120–1124 bukan bukti implementasi. Tidak dilabeli regresi merge. Kasus: /p/slug yang ditampilkan belum memiliki route; callback provider tidak mempunyai verified handler di sini. Dampak: transaksi publik E2E terblokir walaupun kontrak SQL tersedia.
- Perbaikan minimum: integrasikan buyer/checkout/token/tracking dan satu adapter merchant tim Midtrans Sandbox, verifikasi signature/nominal asli ketat, rate limit dan error provider; gunakan RPC atomik core. Regresi: callback signed/unsigned/wrongamount/replayed/late, token salah, expired/soldout, privasi PII, tenant, timeout/reconcile. Deployment: tugas aplikasi/provider/config terpisah, sandbox saja; tanpa payout nyata/merchant per UMKM.

### A6-07 — Manual order can exceed Rp1 miliar contract

- **P2 / CONFIRMED / PREEXISTING_BUG.** Modul: pricing/manual/standalone/public SQL order. PRD321/648 membatasi money/intermediate/total1e9. Aktual products/schemas.ts:12,18–22 menerima base600juta; orders/schemas.ts:27–34 menerima quantity2; jalur aktif actions.ts:64 → service.ts:67 → repository.ts:330 → K:817 mencapai K:190/200 dan menghasilkan1.2miliar. B:250–252/624 serta deferred totals menjaga konsistensi/positivitas, bukan upper bound. pricing/calculate.ts:54–66 menolak subtotal yang sama.
- Akar masalah: SQL order otoritatif tidak menerapkan bound bersama. Kasus statis valid memerlukan published preorder dan capacity/quota≥2; insert reproduksi tidak dijalankan. Dampak: jumlah tersimpan/DTO downstream melanggar rentang nominal. Tidak ada klaim overflow numerik atau pencurian.
- Bukti asal: parent429f603^ old20261104120000_order_lifecycle.sql sudah memiliki perkalian tanpa cap. Perbaikan minimum: bound nominal yang sama di aplikasi dan seluruh insert SQL melalui batch DB berizin terpisah; perubahan browser saja tidak cukup. Regresi: subtotal1e9/1e9+1, intermediate diskon melampaui batas meski final lebih kecil, public/manual/standalone, rollback termasuk reservation/event. Deployment: periksa read-only apakah sudah ada row di luar rentang sebelum memperketat validasi.

### A6-08 — NULL expected version bypasses owner RPC CAS

- **P2 / CONFIRMED / PREEXISTING_BUG.** Modul: transisi owner order/preorder. Harapan: mutasi owner wajib membawa versi nonNULL yang cocok. Aktual K:254 memeriksa versi hanya jika nonNULL; K:278 memakai <> nullable. advance_fulfillment, late accept/decline, cancellation, cost resolution dan draft update mencapai helper tersebut; grant authenticated K:1384–1423 membuka RPC terkait. App orders/schemas.ts:82–85 mewajibkan versi positif sehingga form biasa terlindungi. A3 publication17 sudah menolak NULL dengan benar.
- Kasus: owner sah memanggil RPC langsung dengan versionNULL setelah update lain; kondisi versi terlewati. Pemeriksaan ownership/state tetap berlaku; **bukan bypass lintas tenant**. Akar masalah: helper dipakai bersama expiry server yang sengaja menerimaNULL, tetapi wrapper owner tidak membedakan kebutuhan itu.
- Asal: predicate sama ada di old order_lifecycle.sql pada429f603^. Perbaikan minimum: wajibkan nonNULL pada entry owner, pertahankan semantik expiry service eksplisit; perlu izin SQL terpisah. Regresi: NULL/stale/current, foreign owner, aksi berulang, server expiryNULL. Deployment: inventaris overload/caller eksternal sebelum memperketat agar scheduler sah tidak rusak.

### A6-09 — Settlement may use stale transaction time after lock wait

- **P2 / HIGH_CONFIDENCE / PREEXISTING_BUG.** Modul: payment/reservation/waktu. PRD342 mengharuskan hold efektif **saat apply**. Aktual K:518–519 mengunci order/payment sebelum K:550 memeriksa expires_at > now(); waktu transaksi PostgreSQL tetap waktu mulai transaksi. K:555–559 berpotensi allocate/apply/enqueue sesudah deadline nyata bila transaksi dimulai sebelumnya dan menunggu lock.
- Reservation guard B memakai clock_timestamp untuk availability, tetapi NEW sudah allocated dan dapat lolos jika pool masih cukup; ini tidak membuktikan hold semula masih eligible. Kasus source: T1 menahan O; T2 memulai settlement sebelum expiry lalu menunggu; T1 dilepas setelah expiry dengan pool kosong. Prediksi: applied otomatis, seharusnya review. **Reproduksi dua sesi belum dijalankan.**
- Asal: predicate sama pada old20261106110000_payment_contract_alignment.sql di429f603^. Perbaikan minimum: evaluasi waktu aktual sesudah lock otoritatif mendekati keputusan; perhitungkan wait capacity berikutnya. Tugas SQL terpisah. Regresi: barrier/deadline crossing bounded, tepat batas, pembayaran normal, review tanpa email, tanpa oversell. Deployment: koordinasikan retry/reconcile adapter; paid_at provider bukan pengganti eligibility slot.

### A6-10 — Old discussion poll can replace newer selected session

- **P2 / HIGH_CONFIDENCE / PREEXISTING_BUG.** Modul: discussion UI/context/Blueprint panel. discussion-workspace.tsx:101–105 melakukan polling A di luar run()/busy lock86–90; pilihan B pada146–147 dapat selesai sebelum request A lama. loadSession70–75 hanya menolak versi lebih rendah untuk ID sama, sehingga A terlambat mengganti B beserta hash/history/preorder/URL. Respons sesi sama dengan versi lebih tua juga tetap menimpa hash/history meski versi session dipertahankan.
- Kasus statis: tahan respons poll A; buka dan selesaikan B; lepas A. Prediksi: diskusi/panel Blueprint yang terpilih salah; tidak ada klaim kebocoran tenant. Asal git blame13ec1181, sebelum integrasi merge. Dampak: pengguna melihat konteks tak diharapkan atau harus memilih ulang; bukan bukti mutasi backend ke tenant salah.
- Perbaikan minimum: guard sesi/request-generation aktif (opsional AbortController) untuk session/hash/history/preorder/URL bersama. Regresi: delayed promises pada pergantian sesi dan versi lebih tua pada sesi sama. Tanpa perubahan DB; browser/UI harus membuktikan hasil. Deployment: frontend biasa.

### A6-11 — Replan prompt carries original financial scenario after valid edits

- **P2 / HIGH_CONFIDENCE / PREEXISTING_BUG.** Modul: Blueprint/preflight/Gemini. blueprint-service.ts:20–24 menghitung alternative asal dan fakta edit terbaru terpisah; line35 mengirim alternative+edits tanpa facts.calculation. gemini.server.ts:31–35 menamai offer/units/budget/calculation asal sebagai validatedScenario, sedangkan ownerEdits memuat nilai baru. Ketidaksesuaian input terbukti; kegagalan output model tetap kondisional.
- Kasus: ubah10%→5%, unit8→5 dan budget tetap feasible; prompt masih menyajikan kalkulasi lama. Model dapat menyalin angka lama lalu ditolak blueprint-domain.ts:80–81 INVALID_CONTENT. Fakta finansial terstruktur dihitung ulang server; **tidak menyatakan harga checkout rusak**. Asal git blame13ec1181 pada service dan adapter, sebelum port merge; bukan perubahan tipe A5.
- Perbaikan minimum: satu skenario provider dari edits/calculation terbaru yang sudah valid; proposal asal dipisah sebagai provenance. Regresi: input adapter konsisten, narasi angka baru diterima/angka lama ditolak, jalur manual tetap tanpa provider. blueprint-manual-edit.test.ts:125–129 saat ini replan tanpa edit finansial. Tanpa perubahan DB; mock provider cukup untuk kontrak sebelum smoke provider nyata opsional.

### A6-12 — Blueprint browser failure test does not select replan

- **P2 / CONFIRMED / TEST_COVERAGE_GAP.** Modul: browser regression/Blueprint UI. tests/browser/campaign-blueprint.mjs:116–122 memilih failure/invalid lalu menyimpan tanpa memilih #blueprint-replan. blueprint-panel.tsx:123 mengatur penghapusan edits.plan; workflow.server.ts:23 dan blueprint-service.ts:31–32 melewati provider bila plan ada. Test mengharapkan pemanggilan provider, padahal jalur dapat tetap manual, sehingga assertion tidak membuktikan error path tersebut.
- Perbaikan minimum: aktifkan replan sebelum skenario provider, buktikan invocation dan versi aktif tidak berubah; uji revisi manual terpisah. Tanpa perubahan DB. Test sudah ada sebelum A6; browser belum dieksekusi ulang. Deployment: test-only; gate perlu rerun pada fixture app terisolasi.

### A6-13 — Local HMAC configuration dependency remains unresolved

- **P2 / CONFIRMED / DEPLOYMENT_GAP.** Modul: AI quota/admission/configuration. generation-quota-policy.server.ts:7,12 membutuhkan secret32..4096 dengan trimmed length≥32; jika tidak, AI_QUOTA_CONFIGURATION_REQUIRED secara fail-closed. Pemeriksaan presence-only A6 menemukan **tidak ada deklarasi RATE_LIMIT_HMAC_KEY di .env.local maupun override shell saat ini**. Nilai tidak dicetak. Env file lain, konfigurasi proses yang sedang berjalan dan cloud tetap UNKNOWN.
- Harapan: secret yang disetujui tersedia server-side sebelum generation memakai admission. Kasus kondisional bila effective environment tidak memuat key: generationClaims tidak mengadmit request meski provider siap. Bukan bukti semua deployment kekurangan key ataupun bypass otorisasi.
- Perbaikan minimum: konfigurasi melalui pengelolaan environment berizin, tanpa hardcode/commit secret; verifikasi presence efektif server tanpa log nilai. Regresi: key absent/short/valid serta namespace tenant/window quota; mock A5 tidak membuktikan runtime env lokal. Tanpa perubahan SQL; tugas config dipisah dari audit-only A6.

### A6-14 / U01 — Lock inversion confirmed; operational deadlock unproven

- **P2 / HYPOTHESIS untuk deadlock aktual / UNKNOWN_ORIGIN.** Modul: payment, late review, reservation trigger, capacity. Inversi source **terkonfirmasi**: accept C→O (K390/392); apply O→P→R→C (K518/519/550/556; B777). Matriks/prasyarat pada J.
- Accept valid memerlukan requires_review K400; apply pada order yang sudah requires_review melewati reservation update K571. Klaim bahwa dua pemanggilan normal dengan status valid pasti deadlock **belum terbukti**.
- Kandidat spesifik: owner memanggil accept invalid-state pada pending_payment; C terkunci sebelum validasi state, lalu menunggu O sementara settlement memegang O dan menunggu C. UI menyembunyikan aksi wrong-state tetapi RPC owner tetap terjangkau. Perlu test bounded dua sesi dengan barrier eksplisit. DB/log deadlock nyata tidak diperiksa.
- Perbaikan setelah reproduksi/desain seluruh writer: selaraskan lock order writer dan trigger, pertahankan kapasitas/atomicity; tugas SQL berizin terpisah. Retry/reconcile harus menangani40P01 tanpa charge ganda; pemulihan end-to-end provider belum terbukti. Deployment: jangan mengubah satu SELECT tanpa matriks regresi concurrent.

### A6-15 / U02 — Existing target upgrade compatibility unknown

- **P1 / HIGH_CONFIDENCE sebagai gap bukti rollout / DEPLOYMENT_GAP.** Modul: migration history/catalog/deployment. 429f603 menghapus13 migration core lama dan membuat core-on-v21; 9c36b61 mengedit permission dalam migration itu. Fresh13-chain PASS A5 tidak menunjukkan chain yang sudah diterapkan DB persisten atau apakah grant yang diedit telah diterapkan ulang. **Tidak mendiagnosis target rusak**.
- Bukti statis: Git history/root chain. Bukti yang hilang: applied versions, constraint/RLS/grant/function/snapshot target. Kasus: existing DB mencatat chain lama atau06160000 versi awal; isi migration source saja tidak membuktikan target telah diperbarui.
- Tugas minimum berikutnya: ekspor applied-history/catalog read-only berizin, bandingkan overload/default/ACL/hash body/policy Storage, lalu rancang forward-only upgrade terpisah. Tidak mengasumsikan reset/repair/replay. Regresi: fresh dan fixture upgrade representatif yang disetujui beserta recovery. Deployment **belum dapat sign-off** sampai target diketahui.

### A6-16 — Generated types do not type all core SDK calls

- **P3 / CONFIRMED / TEST_COVERAGE_GAP.** Modul: Supabase factories/core repositories. A5 memperbaiki tipe public catalog, tetapi factory dan banyak repository core masih memakai SupabaseClient tanpa parameter Database. transport.server.ts memakai Database serta alias conditional NULL admission; return scalar fail_job dari generator belum mewakili stale NULL di body SQL. Batas ini didokumentasikan pada laporan A5 bagianH.
- Akar masalah: propagasi tipe SDK/metadata generator berbeda dari kontrak runtime. Tidak ditemukan/ditambahkan defect query runtime atau explicit any baru. Perbaikan bila ditugaskan: parameterisasi client terkait bertahap, pertahankan Zod dan parsing overload/nullable; tidak perlu refactor massal untuk audit ini. Regresi compile negative cases serta HTTP overload nyata. Tanpa perubahan DB; compiler tidak membuktikan kompatibilitas produksi.

### A6-17 — Historical preorder pickup snapshots may remain incompatible

- **P2 / HYPOTHESIS / DEPLOYMENT_GAP.** A3 hanya memperbaiki writer ke depan. Publikasi legacy memakai pickupInstructions; reader aktif mengharapkan empat key snake_case (public parser preorders/repository.ts; A3:41). Row published persisten tidak diperiksa, jadi **tidak menyatakan ada row rusak**.
- Rencana read-only berizin: inventaris bentuk key/status/count tanpa data pelanggan, lalu uji salinan representatif melalui parser public/private aktual. Dampak bila row lama ada: pembacaan gagal atau data pickup tidak tersedia. Remediasi bergantung cohort terbukti; transformasi data memerlukan izin terpisah, tanpa backfill saat audit. Regresi: kedua overload menghasilkan snapshot baru yang sama dan keputusan kompatibilitas bentuk lama. Dependency deployment U02.

### A6-18 — Queue contracts have no complete running consumers here

- **P1 / CONFIRMED / NOT_IMPLEMENTED.** Modul: generic expiry/reconcile/email scheduling. jobs/service.ts:32 menyediakan runExpireJobs tetapi caller pada route/scheduler app tidak ditemukan. Typed claim mendukung reconcile_payment/send_paid_email, belum ditemukan consumer worker providernya. Memory memiliki run_worker development yang dipicu owner pada memory/api.server.ts:32; ini bukan bukti scheduling produksi.
- Harapan: hold/attempt jatuh tempo direkonsiliasi, notifikasi terkirim, retry bounded/teramati. Aktual: kontrak enqueue/claim/ACK SQL ada; orkestrasi runtime/delivery belum ditemukan di repository ini. Worker eksternal mungkin ada dan perlu diinventaris, bukan langsung dinyatakan rusak. Dampak: persistence expiry dan reconciliation/email E2E belum terbukti; availability yang memfilter waktu bukan loop worker lengkap.
- Perbaikan minimum: integrasikan scheduler/consumer dengan boundary service-only, typed claim, ACK sesuai attempt/lease dan side effect idempoten; jangan generic ACK Memory. Regresi: worker concurrent, lease hilang, provider reference/idempotency, max attempts/dead, startup recovery, tenant. SQL baru tidak diperkirakan untuk kontrak yang ada kecuali review berizin membuktikan kebutuhan; deployment operasional tetap diperlukan.

## G. Pricing and capacity integrity

### G1. Financial source of truth

Shared pricing src/features/pricing/calculate.ts:27–77 memakai BigInt untuk perkalian dan floor diskon **per unit**, lalu dikalikan quantity. SQL K:105–112 memakai floor yang sama. Rumus: discountPerUnit=floor(base×bps/10000), finalUnit=base−discountPerUnit, subtotal=base×quantity, discountTotal=discountPerUnit×quantity, total=finalUnit×quantity. Pembulatan tidak dipindah ke total keranjang. Discount valid maksimal9999bps dan base positif memastikan final unit minimal1 IDR. Tidak ada bukti zero-price dari input valid atau kesalahan floating-point pada jalur ini.

Snapshot order memisahkan base/final/discount/pricing campaign; deferred trigger B:814–835 membandingkan header dengan item dan menolak inkonsistensi. Namun konsistensi jumlah tidak sama dengan kepatuhan upper bound: A6-07 adalah gap nyata antara calculator TS dan authoritative SQL.

Cost unknown tetap NULL dengan costQuality unknown, bukan nol. Estimated/verified tidak otomatis bukti cash expense. Diskon membutuhkan cost dikenal dan contribution positif melalui shared validation; normal price dapat memperingatkan cost unknown. Simulator menghitung hypothetical scenario, bukan revenue aktual. Evaluation menghitung contribution dari fulfilled sales, biaya produksi dan reviewed promotion spend, dengan keterbatasan kelengkapan. Tidak mengklaim net profit, cash masuk, atau causal uplift. Biaya lain/fee yang tidak masuk definisi contribution PRD tidak dijadikan bug spekulatif.

Harga input browser hanya expected price; checkout K:931 menghitung ulang terhadap frozen base dan resolver server. Ini kontrol yang benar, tetapi resolver C8 masih stub. Attribution campaign dan pricing campaign adalah fakta berbeda; keduanya tidak boleh diisi dari teks AI atau query string tanpa validasi. Semua pembayaran tetap satu merchant Midtrans Sandbox, bukan uang nyata.

### G2. Capacity accounting

src/features/capacity/availability.ts:9 menghitung allocated selalu dan held hanya bila expiresAt>now. src/features/preorders/metrics.ts:44 menggabungkan remaining capacity dan remaining preorder quota dengan min/max; paidUnits hanya allocated yang payment-nya paid. Live hold + allocated manual-unpaid masuk awaiting, tidak otomatis paid. Target gap max(target−paid,0) berbeda dari kuota tersisa.

K checkout mengambil capacity lock sebelum assert_orderable/insert; B:769–805 reservation guard mengunci capacity, item dan order lalu memeriksa kapasitas/kuota. Ini dukungan atomik nyata, bukan hanya pengecekan UI. Peralihan held→allocated mengubah reservation yang sama, tidak menambahkan reservation kedua. Expired held tidak lagi dihitung sebagai kapasitas efektif walaupun worker belum mengubah state; worker tetap diperlukan untuk lifecycle/audit/payment reconciliation.

Order manual mengalokasikan kapasitas meskipun pembayaran eksternal belum dikonfirmasi. Start production membekukan production-cost ledger satu kali; cancellation sesudah produksi tidak melepaskan allocated capacity (B789–790/K1126–1129). Ini mencegah kapasitas produksi diklaim kembali secara fiktif. Cost resolver mengubah order_production_costs, bukan historical order-item price; tidak ditemukan konflik deferred totals dari jalur itu.

Unit last-slot races memiliki bukti SQL historis A4/A5, bukan fresh browser concurrency. A6-09 dan U01 membatasi klaim keselamatan semua kombinasi writer. Capacity snapshot yang diberikan AI adalah informasi, **bukan reservasi**; approval Blueprint tidak boleh menyatakan stok telah dipesan.

## H. Lifecycle and state consistency

| Entity | Source of truth / allowed progression | Guard/failure/replay | Status audit |
|---|---|---|---|
| Preorder | draft→published via A3; close/cancel/complete RPC K609/624/727/765 | owner/version; publish schedule/snapshot; complete checks pending/active work | source connected; NULL CAS other owner mutations08; historical17 |
| Blueprint | proposed revision→explicit approval; new revision invalidates suitability of older active version | persisted proposal/hash, campaign/Blueprint CAS, confirmation, numeric revalidation; manual provenance separate | pipeline partial; current context01 and prompt11 |
| Campaign | draft→published→closed→completed through reviewed finalization | approved/materialized plan + current window; close/task CAS; completed update seal | synthetic entry only; C8/C6 dependencies |
| Order | public pending_payment→awaiting_confirmation→active fulfillment; terminal expired/cancelled or requires_review | server price/hold, owner fulfillment actions; unresolved payment facts preserved | core persistence connected; public entry absent |
| Fulfillment | pending_confirmation→production/ready/fulfilled through explicit actions | payment/state eligibility and immutable cost recording; no automated paid from browser | source inspected, HTTP not verified |
| Payment | attempt initiated/QR/pending → paid_sandbox or provider terminal; verified vs applied separated | exact amount, event idempotency, no paid downgrade; late/second settlement review | SQL evidence historical; authenticity adapter absent; clock09 |
| Reservation | held→allocated or released; direct allocated for manual | live expiry, quota/capacity lock, no post-production release | atomic support exists; locking14 |
| Evaluation | append provisional history→review append→CAS final row + campaign completion | source/window/review/cost completeness; failed/invalid narrative explicit; synthetic cohort restriction | verified C6 unavailable |
| Memory | candidate draft→owner review→guarded approval+job→ready embedding | source/content/profile/lease consistency; synthetic cannot approve; stale remains readable as stale | public positive path blocked, not silently faked |
| Generic job | queued/retryable_failed→running→succeeded/retryable_failed/dead | A1 attempt/live lease; A2 typed SKIP LOCKED; fifth attempt exhaustion | contracts fixed; running consumers18 |
| Memory index job | dedicated claim→atomic memory+job completion, retry/recovery | double source validation, embedding profile/dimension/hash, stale lease rejection | lower-level tests historical; verified producer absent |
| AI generation | durable admitted/running→checkpoint→completed or explicit failed/interrupted | same key/hash replay, different hash conflict, atomic quota before inference | source checks present; config13; no new HTTP proof |

No evidence found that a normal redirect marks a public order paid, synthetic simulation is inserted as a sale, or fulfillment status is intentionally substituted for provider payment status. Those are source observations, not a guarantee for absent external integrations.

## I. Security and tenant isolation

Core auth/owner guard uses SSR identity and membership, not client businessId. Business/profile/product/capacity/preorder/order actions inspected invoke owner guard and runtime schemas. Repositories scope owned reads/updates by businessId and entity, and SQL owner functions derive current owner. AI boundary verifies Auth identity, finds owner membership and explicitly binds sessions/preorders to business; all five API wrappers delegate to guarded feature boundaries, with write-origin checks. Bearer requests and cookie requests have different origin acceptance rules; this is development policy, not proof of general internet deployment readiness.

Service role is reserved for privileged transport/admission/payment/worker paths. canonical apply_verified_payment and generic jobs are service-only in source grants. Private helpers use empty search_path; A3 invoker helper is not directly executable by application roles. RLS and column grants are part of historical A4/A5 SQL verification, including foreign owner rejection and Storage object-policy SQL subset. RLS protects rows but does not replace checking a service-role caller: provider adapters and schedulers must authenticate before invoking privileged code.

Public order access is bearer token→SHA256 lookup, with minimal status projection at src/features/orders/private-status.ts:37. It excludes customer name/email/contact and internal costs/reasons. Idempotency replay also compares token hash at K915. Hashing a token does not authenticate a payment; verified provider facts require their own trusted adapter. Not found: active Midtrans signature handler, public callback rate limit, production job endpoint or their tests through HTTP. These are missing surfaces, not demonstrated insecure handlers.

LLM outputs are parsed/narrowed, financial scenarios recomputed, source/context hashed, unsafe/unsupported narratives rejected. Shared Gemini JSON adapter sets no tools, bounded deadline/output and validates response envelope; configured runtime maxAttempts1 differs from generic maximum2. Prompt text is untrusted/redacted; this review did not red-team model output, prove exhaustive prompt-injection resistance, inspect every debug logging field, or check provider SDK advisories. No new any/casts/suppressions were introduced because no source was edited.

**No supported cross-tenant exploit was established in inspected boundaries.** No claim of complete security certification, all-RLS correctness, upstream auth revocation, Storage HTTP correctness or production secrets hygiene is made. Known direct NULL-version mutation affects same-owner concurrency, not access to another business. .env.local values were never printed/copied; only key presence was checked.

## J. Transaction and concurrency review — U01

### J1. Actual lock acquisition order

PO=preorder, PI=preorder_item, C=capacity, O=order, P=payment, R=reservation. Trigger acquisitions must be counted in the same transaction, not omitted from caller graph.

| Writer | Lock order observed | Exact source |
|---|---|---|
| Canonical publish | PO update→PI update→C update | A3:15,22,24 |
| Public checkout | PO share→C update→new O/item→R insert→trigger C/PI/O | K:902,908,938; K:203; B:777,779,781 |
| Manual preorder | PO share→C update→new O/item/R→trigger | K:839,848,866 |
| Standalone manual | C update→new O/item/R→trigger C/O | K:977,1017 |
| Late accept | PO share→C update→O update→P update→R update→trigger PI/O | K:386,390,392,395,409; B:777–781 |
| Verified apply | O update→P update→R update/lock→trigger C/PI/O | K:518,519,548,556; B:777–781 |
| Expire/cancel | O update→R update→trigger C/PI/O | K:1083,1095,1127; B:777–781 |
| Reservation guard | caller already modifies R→C→PI if linked→O; capacity version mutation | B:769–805 |
| Generic ACK/fail | one job row | A1:10,39 |
| Typed claim | exhausted/ready job rows, SKIP LOCKED | A2:26–41 |

Schema documentation describes preferred broad ordering (docs/schema.md:1766–1779); actual writers differ. The matrix proves **C→O versus O→C inversion**, not every possible cycle. A3's publication consistency does not solve all payment/order locking.

### J2. U01 preconditions and reproduction plan

Jangan mengasumsikan late-accept valid dan settlement valid bekerja pada pending order yang sama. Late-accept memerlukan requires_review; settlement pada keadaan already-review dapat melewati update R. Kandidat siklus yang didukung source justru memakai owner sah memanggil late-accept pada pending_payment: capacity terkunci sebelum validasi state.

Pada tugas test disposable dua sesi yang diizinkan kemudian: siapkan pending order dengan hold live dan capacity; settlement memperoleh O sementara accept memperoleh C; gunakan barrier agar accept menunggu O dan settlement mencapai C melalui trigger R. Batasi lock_timeout/statement_timeout, kumpulkan SQLSTATE/deadlock graph, rollback kedua sesi dan pastikan tidak ada state order/payment/reservation/email separuh diterapkan. Ulangi kombinasi status valid secara terpisah, termasuk expire/cancel, capacity bersama untuk order berbeda, publication dan edit capacity. Bila siklus tidak tereproduksi dengan prasyarat terkontrol, persempit/tutup hipotesis berdasarkan bukti.

PostgreSQL membatalkan transaksi korban deadlock; kebijakan retry provider yang aman end-to-end belum terbukti karena adapter tidak ada. Retry harus memakai identitas provider/order/event yang sama dan rekonsiliasi durable; transaksi DB yang dibatalkan bukan alasan membuat charge baru. Provider eksternal tidak boleh dipanggil di dalam transaksi yang memegang lock DB.

### J3. Idempotency, replay and rollback

- Public checkout K910–918 checks existing key/hash/token **before current preorder state**, supporting lost-response replay after closure. Changed key payload/token rejects; same request reuses existing order. Manual order also checks request hash.
- Payment event dedupe under O/P locks plus unique payment/event identity serializes identical facts. Amount mismatch does not apply, late/second settlement is recorded/reviewed, paid facts are not downgraded. This is not signature verification.
- Owner mutations use CAS in app; NULL loophole08 remains at RPC. Blueprint/campaign/Evaluation compare context/version/provenance before state transitions; changes during provider latency must be rejected, not silently accepted.
- AI admission/claims coordinate request identity, hash and quota transactionally; checkpoint/reconciliation avoids automatic repeat inference after ambiguous save. Recovery terminates stale work explicitly; it cannot prove upstream provider never charged a timed-out request. Distributed exactly-once is not claimed.
- A1 ACK/fail evaluates lease after job-row lock with clock_timestamp and refuses Memory. Stale false/NULL must be honored by every worker. Existing expire summary ignores ACK boolean, which could overstate its summary after lease loss; it was not elevated to a separate confirmed data-corruption finding because expiry is idempotent and scheduler absent.
- Memory atomic approval/job and completion helpers are tested at lower layer historically. Public source guard still blocks synthetic; private positive fixtures are not proof of approved verified production source.

## K. Existing known findings reassessment

| Item | Status A6 | Evidence / qualification |
|---|---|---|
| C1 / PM01 | CONFIRMED OPEN, 01 | real core DTO not consumed by seeded context |
| C8 / PM02 | CONFIRMED OPEN, 02 | discount/attribution SQL placeholders remain |
| C6 / PM03 | CONFIRMED OPEN, 03 | analytics injection synthetic only |
| C7 / PM04 | CONFIRMED OPEN, 04 | verified source/attestor unavailable; guards preserved |
| PM05 publication | RESOLVED for future writes in A3 tested scope | both overloads delegate canonical; historical rows17 UNKNOWN |
| PM06 legacy claim | RESOLVED in A2 tested scope | old signature0A000; typed validation excludes Memory; external workers18 UNKNOWN |
| PM07 generic ACK | RESOLVED in A1 tested scope | attempt/live lease/Memory guards; not redeployed remotely by this audit |
| PM08 generated types | RESOLVED in A5 catalog scope | official output/26tables/352cols/50signatures; SDK propagation16 remains |
| PM09 harness | RESOLVED for disposable Layer1 | bootstrap/contracts/concurrency passes A4/A5; actual Supabase Layer2 NOT EXECUTED |
| PM13 schema docs | RESOLVED for verified columns/defaults scope | A5 strict352 MATCH, zero drift; planned product prose still not implementation proof |
| PM10 replan browser | CONFIRMED OPEN, 12 | selector not enabled before failure scenarios |
| PM11 HMAC | LOCAL DEPENDENCY OPEN, 13 | current .env.local/shell absence; effective server env elsewhere UNKNOWN |
| PM12 owner/dev UI | CONFIRMED OPEN, 05 | route/session/local transport separation |
| U01 locks | inversion CONFIRMED, deadlock HYPOTHESIS, 14 | state caveat plus concrete invalid-state owner RPC plan in J |
| U02 rollout | UNKNOWN TARGET / EVIDENCE GAP, 15 | fresh chain cannot establish upgrade compatibility |
| Actual public/worker consumers | NOT IMPLEMENTED in this app, 06/18 | no route/runtime app caller found; external repos unknown |
| Historical snapshot shape | UNCERTAIN, 17 | no persistent row inspection/backfill |

Historical test PASS does not close C1/C8/C6/C7 or prove persistent rollout. A6 did not reverse previous fixes or claim them deployed.

## L. UI and backend integration

Owner dashboard has protected profile/product/capacity/preorder/orders workflows and shared navigation. Sampled ProductForm, CapacityForm, ManualOrderForm and PreorderTransition use pending disabling and server errors; successful core mutations revalidate dashboard layout. Backend validation remains authoritative even when HTML form controls constrain values. Dashboard BuyerPreview advertises a future route, not an implemented buyer journey.

AI workspaces communicate with their actual /api/dev endpoints; services persist discussion, proposals, Blueprint revisions, tasks/costs/Evaluation/Memory candidates. They are intentionally development-only, with synthetic context banners and separate login. These interfaces **coexist** with owner core rather than form a unified owner journey. Add navigation only after session and real-data boundaries are ready; a link alone does not resolve integration.

Replan has two meanings that tests must distinguish: editing an existing plan without inference, and requesting new provider tasks/content. Title read-only in Blueprint is an intentional contract (service.ts title validation plus panel control), not a broken save. UI10 may lose selected session even though backend tenant scoping still holds. Prompt11 can reject a financially edited replan despite deterministic financial calculations being valid.

No screenshot, visual/a11y/responsive/keyboard/browser execution occurred. Owner/backend source integration was inspected; no claim that all controls render/work on a device. Future UI acceptance should include actual request payload/error/conflict/reload persistence and owner session reuse, not just screenshots.

## M. Testing and coverage gaps

### M1. Commands/checks actually used in A6

Read-only PowerShell Get-Content, rg/rg --files, Git branch/rev-parse/log/show/blame ancestry checks, file metadata/SHA256 comparison, and presence-only env check. Some exploratory searches used nonexistent/glob paths (e.g. context-loader.server.ts or preorders/lifecycle.ts); these returned not-found and were replaced by actual file inventory. **They are not evidence of missing implemented functionality.** No npm/node target entry, DB harness, Supabase CLI startup, browser, network or provider command ran.

Package scripts were read: npm run typecheck = next typegen && tsc --noEmit; lint=eslint; build=next build; test=vitest run; test:integration uses vitest.integration.config.mts. Default config includes src tests + tests/unit, **not all tests/integration or HTTP/browser scripts**. test:integration includes tests/supabase only. Names containing integration do not by themselves establish real services. Some existing Supabase tests temporarily replace offer functions; they require a separately reviewed disposable target and do not prove production C8.

### M2. Historical verification only

Sources: [Stage0](../qa/POST_MERGE_STAGE_0_ENV_RECOVERY_REPORT_2026-11-07.md), [A1](../qa/POST_MERGE_BATCH_A1_JOB_INTEGRITY_REPORT_2026-11-07.md), [A2](../qa/POST_MERGE_BATCH_A2_JOB_CLAIM_ISOLATION_REPORT_2026-11-07.md), [A3](../qa/POST_MERGE_BATCH_A3_PREORDER_PUBLICATION_REPORT_2026-11-07.md), [A4](../qa/POST_MERGE_BATCH_A4_DATABASE_HARNESS_REPORT_2026-11-07.md), [A5](../qa/POST_MERGE_BATCH_A5_DATABASE_TYPES_SCHEMA_SYNC_REPORT_2026-11-07.md). These reports state their original revision/environment limits; no fresh rerun is claimed.

| Check | Latest documented evidence | A6 execution |
|---|---|---|
| TypeScript | A5 PASS strict compiler including compile-only SDK overload calls | NOT RUN |
| ESLint | A5 PASS | NOT RUN |
| Next production build | A5 PASS | NOT RUN |
| Default unit suite | A5 1,101 tests/67 files PASS | NOT RUN |
| Selected mock integration | A5 69 tests/7 files PASS | NOT RUN |
| Full fresh PostgreSQL chain | A5 three fresh runs, all13 root migrations, strict352 MATCH/0drift | NOT RUN |
| A1 ACK suite | historical15groups +5 lock races | NOT RUN |
| A2 claim suite | historical18groups +4 overlaps +F05 lock contention | NOT RUN |
| A3 publication suite | historical14SQLgroups +4 lock races +MVCC overlap +5 actual-reader tests | NOT RUN |
| Current A4 contracts | historical8groups plus concurrency scenarios; SQL RLS/grants/Storage subset | NOT RUN |
| Memory8B lower layer | historical10groups +5 races, source/profile/hash/lease/recovery guards | NOT RUN |
| Historical migration checkpoint | 100pgTAP assertions and7 Memory groups before later guard migrations | NOT current positive Memory approval |
| Official types | two identical generation outputs, catalog26tables/352columns/66publicFK/50signatures | NOT REGENERATED |
| Supabase Layer2 | NOT EXECUTED in A4/A5 | NOT RUN |
| HTTP E2E/browser/live provider | no fresh proof inherited for complete merged real-data journey | NOT RUN |

Catalog A5 also records290constraints,107indexes,30public policies,45public triggers,99public/private functions. These are verified fresh disposable catalog counts, not current persistent observations. Current SQL fixture proves order/payment persistence using synthetic provider facts; it does not prove callback authenticity or email delivery. Layer1 Storage role/table stand-ins evaluate object policies SQL only, not Storage server behavior.

### M3. Business-flow coverage matrix

U=unit/pure source tests, Mock=dependency-stub integration; SQL=disposable engine tests. H denotes historical evidence above; exists means source test present/read/inventoried, not run by A6. HTTP/browser columns are **current actual integrated-path evidence**, not counting script existence as PASS.

| Business flow | Unit | Mock integration | SQL | HTTP | Browser E2E | Main gap |
|---|---|---|---|---|---|---|
| Owner auth/profile | schemas/session tests H | limited | owner RLS/grants H | UNKNOWN actual GoTrue | UNKNOWN | single owner→AI login |
| Product/photo/capacity | core tests H | repository doubles H | capacity constraints H; Storage SQL subset | UNKNOWN Storage | UNKNOWN | storage metadata/ACL via HTTP |
| Preorder publication | parsers/metrics H | core stubs H | A3 both overloads+locks H | UNKNOWN PostgREST overload | UNKNOWN owner app→DB | target rollout/history |
| Manual order/pricing | calculator/order tests H | owner service H | A4 order/capacity H | UNKNOWN | UNKNOWN |1e9+1 cap and NULL CAS new cases |
| Public checkout | core DTO/hash tests H | available contract | atomic persistence/lastslot H | NO implemented endpoint found | NO buyer UI | C8 + external module |
| Payment/late review | service/status tests H | verified facts mocked | replay/late/reallocation H | NO verified webhook found | NO buyer payment UI |09deadlinewait/14locks/authenticity |
| Generic jobs | ACK parser/service tests H | repository mocked | A1/A2 H | NO scheduler found | N/A | consumer rollout, lease-aware side effects |
| Strategist/admission | AI unit H | selected duplicate/quota H | admission/replay/quota H | UNKNOWN current merged dev runtime | scripts exist, NOT RUN | C1/env13 |
| Blueprint/manual/replan | domain tests H | manual16/provenance3/duplicate selected H | atomic revision/materialization source/checkpoint H | UNKNOWN current dev runtime | script12 incorrect path | scenario11/current edits, stale source |
| Execution/offer | projection/simulator tests H | service tests exist | publication invariants source | UNKNOWN | scripts exist, NOT RUN | C3→C8 runtime |
| Evaluation | deterministic/narrative tests H | synthetic integration H | CAS/synthetic restrictions H | UNKNOWN dev synthetic; NO verified producer | scripts exist, NOT RUN | C6 real ledger |
| Memory | source/retrieval/worker tests H | claims/recovery H | lower-layer Memory8B H | UNKNOWN dev; positive verified BLOCKED | scripts exist, NOT RUN | authority/attestor C7 |
| Next campaign learning | context/prompt tests H | historical-memory doubles | tenant vector primitive source | NO verified loop proof | NO complete loop proof | actual eligible source then retrieval |

### M4. Flow readiness summary

SQL YES(H) means **contract subset historically verified**, never whole UI-to-DB flow or unresolved cases. Real Data YES means source reads/persists actual business rows rather than fixture metric values, not persistent production access.

| Flow | Source Connected | Real Data | SQL Verified | HTTP Verified | Browser Verified | Status |
|---|---|---|---|---|---|---|
| Auth/ownership | YES core | YES source | YES(H) membership/RLS subset | UNKNOWN | UNKNOWN | PARTIAL verification |
| Profile/products | YES | YES source | YES(H) constraints/RLS subset | UNKNOWN | UNKNOWN | PARTIAL verification |
| Capacity/preorder publish | YES | YES source | YES(H) A3/current subset | UNKNOWN | UNKNOWN | CONNECTED source |
| Manual order/fulfillment | YES | YES source | YES(H) subset, new gaps untested | UNKNOWN | UNKNOWN | CONNECTED with bugs |
| Real C1→AI | NO | NO active AI producer | NO integrated contract | NO | NO | BLOCKED01 |
| Strategy→Blueprint | YES dev | NO context fixture | YES(H) claims/CAS subset | UNKNOWN | UNKNOWN | PARTIAL |
| Simulator | YES as pure domain | NO default fixture | NOT APPLICABLE pure calculation | NOT APPLICABLE pure calculation | UNKNOWN | CONNECTED simulation |
| Execution→checkout offer | NO | NO effective campaign resolver | NO real C8 | NO | NO | BLOCKED02 |
| Buyer→checkout | NO entry | YES internal persistence source | YES(H) internal subset | NO entry | NO entry | BLOCKED06 |
| Verified payment→allocation | NO adapter; YES core | NO real provider observed | YES(H) synthetic fact subset | NO adapter | NO | BLOCKED06/09 |
| Generic job→delivery | NO scheduler/consumers | UNKNOWN external | YES(H) claim/ACK subset | NO app entry found | NOT APPLICABLE | PARTIAL18 |
| Actual Evaluation | NO producer | NO | NO verified C6 | NO | NO | BLOCKED03 |
| Verified Memory approval→index | NO eligible source | NO | YES(H) negative/lower helper only | NO positive proof | NO | BLOCKED04 |
| Future verified learning | NO attestor | NO | NO full chain | NO | NO | BLOCKED04 |

## N. Dependency-aware remediation plan — proposal only

Effort S=terbatas/local, M=beberapa boundary, L=lintas domain/authority/rollout. Ini ukuran relatif, **bukan janji durasi**. PIC berikut mengikuti tanggung jawab PRD/user: Rafi core; Steven AI; Indro buyer/provider/email; tim bersama untuk kontrak database/deployment. Ownership akhir harus dikonfirmasi pada task implementasi, tidak diasumsikan pekerjaan eksternal sudah tersedia.

| Order / batch | Scope/findings, prerequisites, modules | Minimum proposed work & tests | DB implications / risk / completion criteria / effort |
|---|---|---|---|
| 0. Platform evidence preparation |15/17/16; current source available; Rafi+Steven/platform | authorize target **read-only** history/catalog export; design isolated Layer2 Auth/PostgREST/Storage stack; inventory external claim/ACK consumers; compare body/grant/overload/snapshot shapes | no persistent mutation; production secret/config kept server-side. Done when target state known and reproducible platform fixture approved. Risk wrong target; M |
| A6-F1 financial+CAS fixes |07/08 confirmed bugs; PRD/schema contract agreed; Rafi pricing/orders/preorders | apply money/intermediate bounds to every authoritative insert; reject NULL owner versions preserving service expiry; boundary/rollback/directRPC/foreign-owner tests | **separate authorized SQL/function task required**. Don't edit old deployed files as rollout shortcut. Done all paths cap/CAS consistent; risk legacy callers/out-of-range historical rows; M |
| A6-F2 payment reproduction then fix |09/14; isolated two-session fixture and F1 assumptions; Rafi core + Indro retry contract | prove deadline-crossing lock wait and U01 barriers, then implement consistent actual-time/lock ordering if supported; repeat valid/invalid states and all reservation writers | separate DB authorization; no provider inside locks. Done bounded reproductions resolve with unchanged invariants/replay; risk deadlock/oversell if partial rewrite; M–L |
| A6-F3 UI/provider input + regression repair |10/11/12; source static cases; Steven UI/Blueprint | active-request guard; feed freshly calculated edited scenario to provider; enable browser replan for error tests; delayed response and captured prompt tests | no DB expected. Done mock contracts pass and isolated browser verifies manual/replan/conflict/reload; risk UI state/provider provenance regression; S–M |
| Platform Layer2 verification | A1–A5 + F1/F2 implementation ready; disposable Supabase only | run real GoTrue identity, authenticated/service RPC overload resolution, RLS/column grants and Storage upload/read/delete behavior; verify no hosted/persistent URL | no schema invention; full approved migrations only in empty disposable stack. Done HTTP assertions and cleanup evidence exist; risk accidental persistent fixture targeting; M |
| B1 real Core→AI facts |01; F1, contract agreement, isolated platform; Steven+Rafi | implement scoped consistent C1 including cost/source revisions/commitments, avoid unsafe cast of old DTO; fresh facts after latency; retain fixture mode | DB need determined by agreed snapshot requirements; stop/request separate task if schema needed. Done paid/held/allocated/current cost/versions matched actual core in two-tenant HTTP tests; M–L |
| B2 offer/checkout/attribution |02/06; F1/F2, approved C8 contract; Steven+Rafi+Indro | active published resolver read/write parity, distinct pricing/attribution identities; public checkout/token/privacy + Midtrans Sandbox adapter/webhook/reconcile | C8 SQL functions need separate authorization; no new merchant/payout. Done price/expiry/replay/last-slot/authenticity scenarios pass through actual handlers; risk wrong quote/attribution; L |
| B3 owner AI entry |05/13; B1/B2 ready, effective server config checked; Steven+Rafi | reuse owner session/guard/navigation, configure local/deployed modes deliberately, keep demo gates; add one-login/foreign-owner HTTP/browser tests | no DB expected; never expose service key. Done owned real preorder can complete strategy/Blueprint/execution from dashboard; risk removing demo guards prematurely; M |
| Platform workers |18; B2 adapter identities + A1/A2 consumer inventory | integrate scheduler, expire/reconcile/email consumers, typed allowlist claims + attempt/lease ACK, idempotent delivery/recovery; test lease loss/max attempt/duplicate side effects | existing queue contracts first; separate SQL task if change justified. Done real sandbox reconciliation and test mail sink delivery observed, not merely enqueued; M–L |
| C1 authoritative outcome pipeline |03; B2 actual payment/attribution, production ledger/cost review; Steven+Rafi+Indro | define paid-window vs attributed vs fulfilled-revenue cohorts, evidence/revision/completeness; implement C6 producer and final source recheck | verified finalization requires separately authorized DB contract; do not coerce fixtures to verified. Done computed KPIs match independent ledger oracle and stale/incomplete source fails; L |
| C2 verified Memory feedback |04; authoritative C6 reviewed/finalized, source attestor contract; Steven+Rafi | valid public approval+enqueue, owner review/source freshness, worker atomic result/recovery/profile; retrieval attestor then next strategy citation | guard changes only in separate approved DB task. Done actual non-synthetic source approved/indexed/retrieved; synthetic still denied; risk evidence laundering; L |
| Controlled rollout |15/17 plus all approved SQL batches; platform evidence and historical cohort decision | explicit forward upgrade for known target; least-privilege grants/body hashes/overloads checked; historical snapshot compatibility decision; observe workers; documented recovery | **requires explicit deployment/database authorization**, no action in A6. Done target catalog/data compatibility verified and recovery plan reviewed; L risk data/history |
| Final E2E | all preceding relevant criteria, isolated real platform/sandbox/test sink; whole team | run O17-step journey plus negatives, record revision/mode/requests/durable states/cleanup | no production data or real payment charges. Done independent assertions across entire loop; effort L, unresolved dependency means blocked rather than mock PASS |

B1/B2 contract design and frontend controlled-response fixes may progress independently in later authorized tasks. Do not build C7 success on synthetic C6, and do not run public payment E2E before authenticity/idempotency contracts exist. Persistent rollout is separate from disposable validation.

## O. Final E2E acceptance matrix — design, NOT EXECUTED

Environment definitions: **L1** isolated empty PostgreSQL harness (contracts only); **L2** dedicated disposable Supabase with real GoTrue/PostgREST/Storage + Next app, two owner accounts, test mail sink; **SB** team Midtrans Sandbox with explicitly scoped credentials and signed notifications, never real payments. AI fake adapter may make tests deterministic while consuming **real business rows**, explicitly retaining provider provenance. A separate opt-in Gemini smoke tests provider interoperability; fake inference is not proof of live provider behavior or a shortcut to synthetic verified outcomes. **C7 positive tests require actual authoritative non-synthetic evaluation facts**, irrespective of AI provider used.

Today means source prerequisite exists and could be tested in an approved prepared fixture, not that environment is currently running. No row below was executed by A6.

| # / step | Current implementation & required inputs | Expected persisted output/assertions | Missing dependency / environment / testable today? |
|---|---|---|---|
|1 Owner authenticates | core SSR path; valid credentials, fresh L2 owner | identity/cookies verified; foreign user denied; no service key in client | L2 real Auth needed; source-ready, NOT RUN |
|2 Business profile exists | onboarding/create_business_with_owner; normalized categories/profile | one owned business + membership; profile durable after reload | L2 RPC/grants needed; source-ready, NOT RUN |
|3 Product created | core form, image, price/costQuality | owned product and correct Storage full/thumb; cost null/0 distinguished | L2 Storage HTTP needed; source-ready, NOT RUN |
|4 Capacity configured | product/date/cutoff/window/units/version | valid active owned product; cutoff<fulfillment end and correct WIB date; conflict rejected | L2; core source-ready, NOT RUN |
|5 Preorder created/published | core draft/form + A3; quota/target/schedule/version | immutable base/name/SKU, four-key snake_case pickup, published state; both overload behavior | target migration15/history17; L1 historical PASS subset, L2 NOT RUN |
|6 AI consumes real context | currently fixture-only; owned published preorder + actual paid/held/allocated/cost/versions | context same tenant and current revisions, no hardcoded40/0; hash changes with facts | B1/01+13; L2, **NO** full real path |
|7 AI produces strategy | dev pipeline exists; request key/preferences/real context | one durable generation and alternatives; financial facts recomputed; invalid output not success | step6/session05/env13; L2, dev-only partial |
|8 Blueprint reviewed/approved | persisted selection, valid edited scenario, confirmation/versions | active approved source-bound version + materialized tasks/content; edited facts consistent |01/05/11/12; L2, synthetic partial only |
|9 Offer/execution terms persisted | publication pipeline; approved window/CAS | one actual published snapshot; tasks linked; server active-offer projection agrees with resolver | B2/C8; L2, C3 partial, **NO checkout contract** |
|10 Buyer orders correct price | no buyer route; slug/qty/token/key/expected quote | frozen order/item/campaign price + single live hold; wrong price rejected; replay same order |06/02/07; L2, **NO app path** |
|11 Verified payment completes | no adapter; valid signed SB notification/amount/event | one paid_sandbox fact; original amount/signature checked server; event dedupe; redirect cannot pay |06/09/14; L2+SB, **NO HTTP path** |
|12 Capacity allocated correctly | core apply exists; live hold/current actual DB time | same reservation held→allocated once, no double counting; order awaiting_confirmation, one email job |11 plus09/14; L1 historical subset, L2+SB not full today |
|13 Attribution recorded | resolver currentlyNULL; validated campaign ref + active rules | pricing campaign and attribution campaign stored separately; organic behavior defined |02/B2; L2, **NO real resolver** |
|14 Evaluation gets authoritative KPIs | currently synthetic; reviewed costs+production/paid/attribution ledger | independent oracle matches window paid units, attributed units, fulfilled sales and contribution; source/revision/CAS captured |03/C1 outcome batch; L2, **NO verified path** |
|15 Verified Memory source approved | guarded public source; final reviewed C6, content/source/profile hashes | one eligible non-synthetic approved Memory plus matching index job in one transaction |04 +14; L2, **NO public positive source today** |
|16 Atomic indexing completes | dedicated worker exists; eligible job/live lease/provider profile | embedding ready AND job succeeded atomically; source checked after embedding; failures recover safely | step15, scheduler/embedding config; L1 historical lower layer only, L2 positive blocked |
|17 Next AI retrieves historical evidence | retrieval/fallback exists, no attestor; next preorder/owner query | approved/ready/current-profile/source-attested memory retrieved and cited; stale/foreign excluded; newest facts remain authoritative |04/B1/C2; L2, **NO verified loop today** |

### O1. Negative journeys and required independent assertions

| Journey | Setup/action | Required outcome and persisted-state check | Current evidence / next environment |
|---|---|---|---|
| Foreign business | ownerA requests B product/preorder/session/campaign/evaluation/memory, including direct RPC | no foreign read/mutation; not-found/forbidden; source rows unchanged | source controls + historical SQL subset; L2 HTTP needed |
| Expired preorder | server at exact end/cutoff with stale open browser | no new checkout/hold; existing idempotent replay still allowed | core SQL source/historical subset; actual public handler absent |
| Sold out | quota/capacity fully allocated, release not allowed after production | no order persisted, no capacity negative | L1 historical races subset; L2 buyer needed |
| Last slot simultaneous | two independent buyers keys/tokens same final slot | exactly one success; loser capacity denial; one reservation | L1 H, repeat actual L2 handlers |
| Incorrect price | expected quote stale/tampered, including discount changed | OFFER_CHANGED before insert; server quote authoritative | K931 source; C8 real producer missing |
| Rp1e9 boundary | manual/public/standalone totals at/max+1 with feasible quantity | over-limit rejects atomically including events/reservations | new A6-07 regression required |
| Version NULL/stale | direct owner RPC NULL/stale/current + server expiryNULL | owner NULL/stale denied; current and intentional server expiry allowed | new08 regression required |
| Repeated payment | same event, changed payload, different event for same settlement, second payment | one applied/allocation/email; duplicates recorded/conflict as specified; paid never downgraded | historical SQL subset; L2+SB authenticity needed |
| Late payment | expired/released hold even provider paid_at earlier; lock wait crosses expiry | review/unapplied; no automatic slot/email; owner accept rechecks capacity | H ordinary late; new09 lockwait +14 required |
| Wrong signature/amount | fake callback or mismatched original gross amount | no trusted apply; no paid mutation; safe error/audit | provider handler absent, L2+SB |
| Stale Blueprint | active/source/version/cost/capacity changed before approve/publish | conflict/stale, no partial tasks/publication; provider output doesn't override source | unit/mock/SQL H subset; L2 browser |
| Duplicate AI request | concurrent same key/hash, conflicting hash, ambiguous finalization/retry | one durable admission and provider invocation per claim; conflicting request denied; no automatic reinference | selected mock+SQL H; actual HTTP still needed |
| Quota exhausted | minute/hour/WIBday boundary + concurrent requests | atomic denial before provider and no extra turn/quota partial state; Retry-After safe | H mocked/SQL; effective env13 then L2 |
| Provider timeout/invalid | controlled slow/malformed adapter and explicit recovery | failed/interrupted state, previous proposal/Blueprint retained, retry policy bounded | unit/mock H; browser12/prompt11 regression needed |
| Polling wrong selection | delay sessionA response after selectingB | state/hash/history/URL and Blueprint remainB; same-session older version doesn't regress auxiliary data | new10 UI test required |
| Invalid Evaluation source | changed ledger/version/window/cost completeness after generate/review | no finalization on stale/unreviewed/incomplete evidence; no fake verified flag | negative SQL H; positive C6 missing |
| Synthetic Memory approval | reviewed fixture evaluation/candidate | public approval rejects; no approved row/job bypass | historical Memory negative guards; L2 HTTP needed |
| Failed embedding/lease | transient provider fail, wrongdimension/profile, source changes, expired lease | no false ready; bounded retry/dead; stale ACK rejected; recovery atomically reschedules | Memory8B H lower layer; positive source blocked |
| Campaign expiry/closure | stale status published after endsAt or explicit close | effective offer none; old order snapshots stable; no new discounted quote | projection source; C8 real resolver missing |
| Historical snapshot | authorized export representative legacy/current shapes only | explicit reader compatibility or approved migration decision; no silent loss pickup | no rows inspected; U02 read-only task |

Complete Final E2E must correlate actual request IDs/provider-event identities/campaign/source versions with persisted rows and observe cleanup. Browser UI success alone, fixture injection, mock checkout resolver or private helper Memory approval cannot satisfy these acceptance criteria.

## P. Git and database safety

Audit baseline recorded682 repository tracked/untracked files plus explicitly included local env where applicable, SHA256 per file; initial dirty A1–A5 work was preserved. Branch/HEAD above were read repeatedly and unchanged. The sole authorized output is this new Markdown report; final baseline comparison is recorded below after validation. No application source, migration, schema.md, PRD, AGENTS.md, handoff, previous QA report or environment was edited.

No commit, stage, push, merge, rebase, reset, stash, release, deployment, Supabase startup, migration, DB reset/seed, remote/persistent catalog query or data write occurred. Git operations were reads only. No Gemini/Midtrans/email provider invoked. Existing source/history observations do not imply any persistent data repair/deployment. No secret values were printed or included in report.

Perbandingan SHA256 akhir: **seluruh681 berkas baseline selain .env.local identik; satu berkas baru yaitu laporan ini; tidak ada penghapusan**. Hash .env.local berbeda dari baseline saat audit. Agent tidak menulis berkas tersebut dan tidak mencoba mengembalikannya; sumber perubahan di luar operasi audit tidak diselidiki. Pemeriksaan presence HMAC diulang tanpa mencetak nilai dan tetap tidak menemukan deklarasinya. Karena itu klaim keselamatan adalah tidak ada perubahan aplikasi/migration oleh agent, bukan klaim bahwa semua edit pengguna di IDE berhenti selama audit. Branch/HEAD tetap sama. Tidak ada remediation kode, Batch B/C atau Final E2E dimulai.

Pemeriksaan artefak baru lulus:17 bagian A–Q,15 flow D1–D15,18 ID temuan dengan hitungan severity/confidence sesuai tabel, tidak ada trailing whitespace/karakter pengganti encoding. Git diff --check exit0 (peringatan normalisasi LF/CRLF pada dirty files lama tidak diubah). Ini validasi laporan/source state, bukan menjalankan test aplikasi.

## Q. Final verdict

**PARTIALLY INTEGRATED.** Struktur Git dan kompatibilitas compiler/build historis A5 didukung bukti, tetapi konektivitas domain lengkap dan konsistensi aturan bisnis belum terpenuhi. Codebase memiliki persistence owner/core yang terhubung dan pipeline AI development yang substansial, disertai defect money/CAS serta kandidat kuat concurrency/UI/kontrak provider. C1, C8, C6, C7, auth/navigation AI owner, modul publik/provider, worker berjalan dan bukti rollout target tetap prasyarat.

**Belum siap Final E2E penuh, main sign-off sebagai integrasi lengkap, atau production.** Targeted unit/mock/disposable SQL verification can proceed in separately authorized implementation tasks; that is different from final integrated acceptance. Urutan: gather target/platform evidence → confirmed financial/CAS and reproduced concurrency fixes → UI/provider-input/test repair → real C1 and C8/public payment → owner entry/workers → authoritative Evaluation → verified Memory → controlled rollout →17-step Final E2E with negatives. Each dependency and evidence boundary is in N/O.

Audit berhenti pada laporan dan rencana ini. Risiko belum terverifikasi tetap dinyatakan sebagai risiko; guard sintetis dan batas tenant tidak dibuka untuk mempercepat demonstrasi.
