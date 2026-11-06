# Campaign Lab — AI MVP Batch 1 & Batch 2 Fix Report

6 November 2026, Asia/Jakarta. Scope: **F04 Narrative Safety/Memory Grounding** dan **F07 Exact Manual Blueprint Edits** dari final audit. Tidak ada general audit atau implementasi temuan lain.

## 1. Executive Summary

- **Batch 1: PASS** untuk kasus cacat yang direproduksi, validasi domain lintas modul, grounded targets/estimates, dan Memory candidate grounding. Kebijakan bersama menormalisasi Unicode, memvalidasi nilai numerik menurut jenis fakta/label, membedakan ketidakpastian dari jaminan, dan menolak atribusi/eksekusi yang tidak didukung.
- **Batch 2: PASS** untuk manual edit → validation → repository/RPC payload → persisted readback melalui transport in-memory. `edits.plan` dipertahankan persis tanpa provider factory/SDK call, sementara create dan explicit replan tetap memakai provider. Parent provenance dan approval/CAS/financial guards dipertahankan.
- Regresi akhir: **697 PASS, 1 SKIPPED, 34 files**. Typecheck, lint, production build, dan parser validation 141 request Bruno lulus.
- **Live Gemini calls: 0. Embedding calls: 0. Database record/schema/RPC changes: 0.** Tidak ada commit/push/deploy.

PASS di sini berlaku untuk F04/F07 pada implementation dan safe regression evidence yang dijelaskan. Bukan klaim seluruh AI subsystem, production RAG, atau kualitas model universal sudah selesai. Laporan final audit lama tetap utuh sebagai bukti historis.

## 2. Root Cause

### F04

Strategist dan Memory memakai ASCII `\d` serta keyword checks yang berbeda; digit full-width, Arabic-Indic, Devanagari, dan mathematical digits dapat melewati sebagian guard. Blueprint hanya memeriksa unsafe caption, sedangkan goal/rationale/task prose dan field lain dapat mencapai persistence/UI tanpa pemeriksaan semantik yang sepadan. Evaluation sudah mempunyai normalization/negation checks yang lebih kuat, tetapi logikanya belum dibagi.

Memory memeriksa identity/source/version dan structured assessment, tetapi tidak membedakan klaim pengiriman nyata dari rencana/manual checklist. Tidak ada external posting/delivery/conversion evidence dalam MemorySource saat ini. Checklist complete sekalipun tidak membuktikan eksekusi eksternal atau kausalitas.

### F07

UI sebenarnya sudah membedakan manual versus replan: `edits.plan` ada untuk manual, tidak ada untuk susun ulang. Workflow tetap membangun provider dan service selalu memanggilnya. Fake mengembalikan plan manual; Gemini dapat mengembalikan plan berbeda yang tetap valid, sehingga exact edit hilang. Selain itu `.trim()` pada plan text mengubah spasi/newline di tepi konten yang diterima.

## 3. Implementation

### Batch 1 — shared policy dan boundary yang dilindungi

| File/fungsi | Perubahan |
|---|---|
| `src/lib/ai/narrative-safety.ts`: `normalizeNarrative`, `narrativeRejection`, `contradictsAssessments`, `hasAffirmativeClaim` | Pure policy bersama: NFKC, hapus format characters hanya untuk pemeriksaan, Unicode number detection, source-labelled numeric matching, guarantee/causal/negation checks, external execution distinction, contradictory assessments. Tidak mengubah teks output menjadi versi sanitized. |
| `campaign-strategist/strategy-service.ts`: `unsafeText`, `narrativeFacts`, `validateOptions`, generate/revalidate paths | Policy pada reply/limitations dan setiap alternative title/hypothesis/assumptions/risks. Allowed numeric facts berasal dari current context/owner constraints; parameter masing-masing alternatif tetap melalui preferences, date, capacity, dan deterministic simulator validation. Existing source/reference/privacy/publication checks dipertahankan. |
| `campaign-blueprint/blueprint-domain.ts`: `validateBlueprint` | Policy pada campaign title, goal, hypothesis, audience, rationale, risks, dependencies, owner checklist, assumptions, KPI definition/baseline note, evaluation plan, revision notes, task titles/descriptions, dan seluruh content bodies. Numeric facts memakai context dan offer/calculation server, bukan computed values hasil LLM. Existing unsupported promotion, channel, schedule dan financial guards tetap berlaku. |
| `business-memory/domain.ts`: `memoryInterpretation`, `validateMemoryInterpretation`, `validateStoredMemory` | Memvalidasi field satu per satu agar negation suatu field tidak mengesahkan klaim field lain. Source/classification/reference checks tetap; new candidate interpretation menolak klaim external execution yang tidak mempunyai bukti. Contradictory KPI/financial/checklist prose ditolak. |
| `campaign-evaluation/engine.ts`: `validateEvaluationNarrative` | Menggunakan policy dan assessment checks bersama, mempertahankan classification/reference bindings, rejection category/error contract, failed/invalid persistence, privacy dan review protections. Numeric prose hanya dapat mengutip jenis/nilai fakta yang dipasok summary. |
| `campaign-strategist/prompt.ts`; `campaign-blueprint/gemini.server.ts`; `campaign-evaluation/gemini.server.ts`; `business-memory/gemini.server.ts` | Prompt diselaraskan dengan numeric policy. Memory secara eksplisit membedakan planned recommendations, manual checklist, observed source KPIs dan external execution/causality yang belum terbukti. Guard server tetap menentukan acceptance. |

**Kebijakan angka bukan blanket digit ban.** Angka pada structured financial fields tetap dihitung dan divalidasi oleh kode yang sudah ada. Prose dapat memakai bentuk berlabel yang dikenal dan nilainya sesuai source:

- `Target kampanye adalah 40 unit.` → hanya jika 40 adalah target yang diberikan untuk konteks tersebut.
- `Estimasi biaya promosi Rp100.000.` → hanya jika 100000 cocok dengan owner/plan budget yang divalidasi.
- `Harga preorder Rp120.000.` dan `Diskon 5%.` → hanya jika cocok dengan harga/offer yang diberikan oleh caller domain.
- `Pengamatan mencatat 30 unit.` → hanya jika observation quantity tersedia dan cocok. Kemiripan dengan target/capacity tidak cukup untuk membenarkan actual sales.

NFKC membuat full-width/mathematical digit konsisten. Unicode decimal/number variants lain tetap terdeteksi oleh `\p{N}`; bila bentuknya tidak didukung parser angka berlabel, validasi menolak, tidak menafsirkan secara spekulatif. IDR menggunakan integer/grouping titik yang dikenal dan discount percentages menggunakan nilai yang cocok dengan basis points. Unsupported values, malformed numeric prefixes, currency/percentage/quantity claims lain gagal eksplisit. Tidak ada penggantian angka atau penghapusan unsafe text untuk membuat respons terlihat valid.

**Kompatibilitas Memory historis:** record tidak ditulis ulang. `validateStoredMemory` tetap memeriksa schema, binding, hash, source, references, dan narrative safety; pemeriksaan tambahan tentang external execution diterapkan pada `validateMemoryInterpretation` untuk candidate generation baru. Wording lama tentang pengiriman tetap bisa dibaca sebagai snapshot historis. Ini tidak memperbaiki atau mengesahkan wording lama; synthetic provenance/production exclusion dan approval/indexing/retrieval rules sama seperti sebelumnya. Test khusus memastikan historical read dan new-generation rejection dibedakan. Tidak ada request API yang menerima flag untuk melewati new-candidate guard.

### Batch 2 — manual edit tanpa provider

| File/fungsi | Perubahan |
|---|---|
| `campaign-blueprint/contracts.ts`: plan text schemas, `CampaignBlueprintSchema` | Nonblank/length validation tetap; plan strings tidak lagi di-trim agar exact manual text termasuk whitespace/newline terjaga. `provider: "manual"` ditambahkan pada **application JSONB contract**, memerlukan parent revision dan melarang model/providerRequestId Gemini baru. Legacy Fake/Gemini JSON tetap diterima. |
| `campaign-blueprint/blueprint-service.ts`: `generateBlueprint` | Manual branch memakai validated `edits.plan` langsung. AI branch tetap melalui provider, envelope/schema dan normal domain checks. Financial/source identity/KPI/revision metadata disusun server dan context dibaca ulang sesudah pemrosesan. Manual edit tanpa parent ditolak. |
| `campaign-blueprint/workflow.server.ts`: `revise` | Bila `edits.plan` ada, tidak membuat configured provider. Replay/source/CAS checks, repository revision dan approval workflow tetap sama. `create` tetap menggunakan provider. |
| `campaign-blueprint/components/blueprint-panel.tsx` | Menampilkan provenance manual pada current/history revision dan pesan zero-generation; banner dinetralkan karena sekarang ada manual revisions. Pesan INVALID_CONTENT mencakup semua plan prose yang dilindungi. Existing replan checkbox/intent dan layout tidak diganti. |

**Tidak diperlukan database change.** Provider discriminator di atas berada dalam `campaign_blueprints.blueprint_json` JSONB yang sudah ada; bukan kolom/SQL enum baru. Parent pointer, source generation, request/hash dan source versions tetap memakai field existing. SQL revision/approval tidak membatasi nested provider value pada Fake/Gemini. Nilai manual dibuat oleh service berdasarkan intent, bukan dipercayai dari client/provider output.

Manual revision tidak menyimpan model/interaction ID baru. Provenance Gemini asli tetap pada immutable parent Blueprint/version sebelumnya dan sumber Strategist tidak diganti. Revision baru tetap proposed dan wajib explicit approval; penyimpanan manual tidak mempublikasikan campaign atau mematerialisasi task/content secara langsung.

### Alur end-to-end yang berubah

**Manual:** API owner authentication/Origin/body → workflow source selection/replay/CAS → current context dan financial validation → exact `edits.plan` → prose/schedule/channel validation → repository `save_blueprint_revision` payload → reload. Provider factory, SDK interaction dan quota consumption tidak terjadi.

**AI create/replan:** boundary yang sama → selected source/current facts → configured provider → SDK → JSON/schema → prose/domain validation → source recheck → existing atomic create/revision RPC → reload. Invalid/failed output tidak mengganti versi valid sebelumnya. Provider dipanggil hanya melalui jalur yang memang meminta generasi.

**Memory:** eligible source → provider interpretation → identity/classification/reference + new grounding validation → existing draft persistence. Klaim pesan dikirim/aksi menghasilkan outcome tanpa bukti ditolak sebagai `UNSAFE_MEMORY_TEXT`; source facts/eligibility tidak diubah.

**Evaluation:** summary deterministik → provider → shared narrative policy + assessment/reference checks → existing available/invalid/failed analysis contract. Error classification dan persistence/review lifecycle dipertahankan.

## 4. Before / After

| Kasus | Sebelum | Sesudah |
|---|---|---|
| Strategist `Penjualan ９９ unit tercapai.` | Diterima | `UNSAFE_TEXT`; Arabic-Indic, Devanagari, mathematical dan format-character variants juga diperiksa |
| Blueprint goal `Dijamin laba Rp999999 karena kampanye ini.` | Diterima di luar caption | `INVALID_CONTENT`, termasuk rationale/task/risks/checklist/field relevan lain |
| Memory `Penjualan ９９ unit tercapai. Laba bersih terjamin berkat promosi.` | Diterima | `UNSAFE_MEMORY_TEXT` |
| Memory planned reminder diklaim telah dikirim | Diterima | New candidate ditolak; checklist complete juga tidak menjadi external execution proof |
| Legitimate target/estimate/uncertainty | Numeric prose sering ditolak blanket ASCII checks | Known labelled values diterima; `berpotensi`, negated guarantees, planned/negated execution dan risk warnings tetap berguna |
| Manual goal/caption pada Gemini mode | Provider dapat mengganti konten; whitespace di-trim | Exact accepted text tersimpan/readback sama; zero provider factory/SDK calls |
| Manual provenance | Dapat terlihat sebagai fresh Gemini plan | `provider=manual`, parent revision terikat, model/interaction ID baru tidak ada |
| Explicit replan/create | AI generation | Tetap AI generation dengan validation/source/financial/approval guards |

## 5. Test Evidence

### TDD / focused tests

- `tests/unit/ai-narrative-grounding.test.ts`: **43 initial tests: 35 FAIL / 8 PASS sebelum fix**. Failures memperlihatkan Unicode bypass, unsupported claims, field coverage, false completed execution, dan rejection valid numeric statements. Suite diperluas menjadi **54 tests** untuk caption prices/discounts, retained alternatives, historical Memory compatibility, future guarantees, source-bound observations, planned/negated execution, incomplete checklist dan qualifier yang tidak boleh mengesahkan klaim pada clause lain.
- Batch 1 focused domain/provider-mock run: **215 PASS / 8 files**. Batch 1 safe broader run sebelum Batch 2: **669 PASS / 32 files** pada titik tersebut, termasuk 46 tests F04 yang sudah ditambahkan saat itu. Delapan kasus tambahan masuk pada pemeriksaan akhir.
- `tests/integration/blueprint-manual-edit.test.ts`: setelah melengkapi mock source-table setup, baseline **8 FAIL / 6 PASS** sebelum fix F07. Existing Gemini path mengembalikan goal lama, membuat provider pada manual edit, dan mengabaikan invalid manual plan yang dipakai hanya sebagai prompt. Suite akhir **16 tests** mencakup exact multiple fields/readback, zero calls/no configuration dependency, provenance, source/parent/CAS, tenant denial, replay/conflict, invalid financial/capacity/schedule/text, replan success/failure, serta approval/revalidation/materialization RPC contract.
- Focused Blueprint run setelah F07: **40 PASS / 3 files** pada titik tersebut; dua pemeriksaan approval/provenance tambahan termasuk dalam final regression.
- Focused robustness run sebelum dua kasus clause-isolation terakhir: **159 PASS / 4 files** (`ai-narrative-grounding`, Evaluation narrative safety, Business Memory, manual Blueprint integration). Kedua kasus tambahan lulus pada full regression akhir.

Integration suite baru menggunakan **actual workflow, repository serialization/readback dan installed Gemini SDK dengan HTTP mock**. PostgreSQL/RPC transport dibuat in-memory; approval materialization response dimodelkan oleh mock. Ini memverifikasi application/RPC contract dan guard propagation, **bukan bukti SQL transaction/RLS race atau actual database writes baru**. Existing SQL/RPC definitions tidak diubah.

### Final safe regression — command aktual

```powershell
# Process-local only; tidak menulis .env.local.
$env:EVALUATION_PERF_REPORT=''
$env:GEMINI_TRANSPORT_REPORT=''
$env:GEMINI_METADATA_CHECK='0'
$env:CAMPAIGN_GEMINI_SMOKE='0'
$env:MEMORY_EMBEDDING_SMOKE='0'

node_modules/.bin/vitest.cmd run tests/unit tests/integration/remaining-ai-contracts.test.ts tests/integration/evaluation-provider-validation.test.ts tests/integration/blueprint-provider-provenance.test.ts tests/integration/blueprint-manual-edit.test.ts tests/integration/gemini-transport.test.ts
node_modules/.bin/tsc.cmd --noEmit --incremental false
npm.cmd run lint
npm.cmd run build
node scripts/validate-bruno-collection.mjs
```

| Pemeriksaan | Hasil |
|---|---|
| Unit | **659 PASS**; mencakup Strategist, Blueprint, Memory, Evaluation, pricing, simulator, transport, diagnostics dan fixtures terkait |
| SDK/workflow mocked integration | **34 PASS**, termasuk 16 manual-edit cases baru; HTTP provider dan database ports dimock |
| Real local loopback TLS/Next transport | **4 PASS**; hanya loopback, tidak ada request Google |
| Total Vitest | **697 PASS, 1 SKIPPED / 34 files**,44.80s; satu metadata Google case sengaja skipped |
| TypeScript | PASS, exit0; strict tidak dilemahkan |
| ESLint | PASS, exit0 |
| Next production build | PASS, exit0; compiled, typecheck,13 pages generated. Tidak mengubah font/model/timeout/deployment config |
| Native Bruno validation | PASS, parser0.40.0,141 HTTP request definitions; syntax/routes/methods/variables/guards diperiksa, collection requests tidak dieksekusi. Diagnostic Crashpad akses file ditolak tidak menggagalkan parser; exit0 |
| `git diff --check` tambahan | Exit1 karena trailing whitespace/Markdown hard breaks dan blank EOF yang sudah ada pada perubahan PRD/schema pengguna sejak baseline. Kedua file tetap identik dengan SHA-256 baseline; tidak dirapikan atau diubah pada tugas ini. Check Git ini juga tidak mencakup source untracked; typecheck/lint di atas memeriksa source aktual. |

Tidak menjalankan provider smoke/embedding/metadata test, persistent DB fixture suites, Bruno mutation runners, atau browser authoring suites. Setup-nya dapat memanggil provider configured nyata atau memutasi database, sehingga tidak sesuai batas tugas ini. Known historical fixture failure `supabase-proposals.test.ts` dari final audit tidak dijalankan ulang atau diubah untuk membuatnya hijau; F08 tetap di luar scope.

## 6. Compatibility

- Deterministic pricing/simulator/Evaluation arithmetic tidak diubah. Tests tetap memeriksa frozen price, cost null versus zero, overflow, discount margin, budget/capacity dan stale-source guards. Prose tidak dapat mengganti structured totals.
- Business identity tetap berasal dari owner boundary; repository user reads memakai RLS dan business filter yang ada; privileged writes tetap melalui repository/RPC. Foreign-owner manual revision tidak mencapai provider atau privileged writer pada scoped test.
- Source proposal/hash/version dan campaign/parent CAS diperiksa seperti sebelumnya. Manual approval membaca ulang sumber dan financial snapshot; stale context tetap ditolak. Read-only/closed/completed/publication lifecycle guards tidak dilemahkan.
- Parent Blueprint JSON/provenance tidak ditimpa. Manual save membuat proposed revision baru, exact replay tidak menambah versi, payload conflict tetap error. Approval/materialization tetap tugas RPC existing.
- Real Gemini create/replan metadata tetap memakai actual returned model dan nullable interaction ID. Manual mode tidak membuat ID/provider result palsu dan tidak memerlukan API key tersedia untuk membentuk provider.
- Evaluation classification, source references, rejected-output provenance/persistence, owner review dan finalization contracts tetap tercakup regression. Synthetic tetap synthetic.
- Memory draft canonical/replay/review/reject/synthetic-approval guards tetap tercakup regression. Tidak ada perubahan approval, embedding, indexing, retrieval, freshness attestor atau production eligibility logic.

## 7. Remaining Risks

1. **Policy berbasis pola bahasa, bukan pembuktian kebenaran semantik universal.** Parafrasa, bahasa lain, mixed clauses atau istilah baru dapat memerlukan coverage tambahan. Unsupported prose ditolak secara eksplisit; tidak dijamin semua hallucination dapat dideteksi regex. Controlled live quality evaluation belum dijalankan karena larangan provider calls.
2. Numeric allowance sengaja memakai **label/jenis/nilai source yang diketahui**, bukan menerima angka hanya karena muncul di mana pun dalam context. Bentuk penulisan lain, angka terbilang atau Unicode numeric scripts yang tidak diparse dapat ditolak. Gunakan structured numeric fields/known labelled forms untuk kasus tersebut; jangan membuat fallback yang menebak nilainya.
3. Historical Memory execution wording tidak diperbaiki retroaktif dan tidak menjadi bukti eksekusi baru. Snapshot tetap bisa dibaca; semua source/synthetic exclusion rules tetap berlaku. Rekonsiliasi/pengeditan record historis membutuhkan tugas terpisah, bukan mutasi diam-diam.
4. SQL CAS/approval/tenant protections tidak diuji ulang dengan write E2E di database aktif. Application tests memakai existing actual repositories dengan mocked transport. Tidak ada dasar mengklaim positive production Memory pipeline dari hasil ini.
5. F01/F02/F03/F05/F06/F08/F09 secara umum tetap di luar scope. Penyesuaian banner/label Blueprint hanya diperlukan agar manual revision tidak diberi label Fake/generated yang salah. Tidak ada pekerjaan real-order context, actual KPI, verified finalization, indexing/retrieval, quota atau distributed generation claim dalam batch ini.
6. Tidak ada schema/RPC change yang diperlukan untuk kedua fix ini. Jika kontrak database/client di luar repository membatasi nested JSONB provider ke Fake/Gemini, consumer tersebut perlu menerima `manual`; tidak ada bukti constraint demikian pada SQL/caller yang tersedia di repository.

## 8. Scope Confirmation

Changed application files: shared narrative policy; Strategist service/prompt; Blueprint domain/service/contracts/workflow/provider prompt/panel; Evaluation engine/provider prompt; Memory domain/provider prompt. Added tests: `tests/unit/ai-narrative-grounding.test.ts` dan `tests/integration/blueprint-manual-edit.test.ts`. Report ini adalah dokumentasi baru; final audit/QA historis tidak ditimpa.

SHA-256 baseline383 files dibandingkan setelah implementasi: **12 existing source files berubah,3 file source/test baru,0 file baseline dihapus**; seluruh perubahan berada pada F04/F07. Schema/migration/database types, dependencies/lockfile, runtime config dan `.env.local` tetap sama dengan baseline. Tidak ada SQL/auth/mutation API command dalam batch ini, tidak ada live provider/embedding request, billing change, reset, record rewrite, commit, push atau deploy.

**Final verdict:** F04 dan F07 sudah diperbaiki secara memadai untuk kebutuhan MVP yang diuji, dengan deterministic financial rules, ownership, CAS dan lifecycle protections tetap berlaku. Ini menutup dua temuan tersebut pada scope implementasi/regresi; tidak mengubah verdict kesiapan seluruh AI subsystem pada audit sebelumnya.
