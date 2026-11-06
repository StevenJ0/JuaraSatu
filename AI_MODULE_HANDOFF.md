# Campaign Lab — Handoff Modul AI & Campaign Intelligence

Status bukti: 6 November 2026. Dokumen ini adalah konteks utama untuk integrasi; hasil pengujian bertanggal di bawah adalah bukti historis, bukan klaim bahwa working tree ini baru diuji ulang. `AGENTS.md`, `docs/schema.md`, PRD, kode, sembilan migration aktif, template konfigurasi, test, laporan QA, dan status Git telah diperiksa. `docs/schema.md` masih memakai label awal *target schema*; migration aktif dan verifikasi PostgreSQL lokal memberi bukti implementasi lokal, bukan bukti deployment bersama.

## 1. Executive Summary

Modul Strategist, alternatif strategi, Blueprint, Simulator, Execution Planner, Evaluation, dan Business Memory memiliki implementasi internal serta regresi lokal. Jalur AI yang tersedia adalah workspace `/dev/*` dan API `/api/dev/*`, dengan Supabase Auth/owner check dan persistence lokal. Strategist memakai konteks development berkuota tetap; Evaluation memakai KPI sintetis. Kandidat Memory sintetis boleh dibuat dan ditinjau, tetapi tidak boleh di-*approve* untuk indexing produksi. Jadi implementasi internal telah maju, sedangkan integrasi transaksi nyata, loop Memory positif, dan kelayakan produksi belum selesai.

F04 (narrative safety), F05 (durable duplicate inference), F06 (atomic quota), dan F07 (manual Blueprint) lulus pada lingkup uji lokal. `RATE_LIMIT_HMAC_KEY` saat inspeksi masih **tidak ada** di `.env.local`: generasi teks baru gagal tertutup dengan `AI_QUOTA_CONFIGURATION_REQUIRED`/HTTP 503. Jangan menyamakan migration yang pernah diterapkan pada Supabase lokal dengan migration pada database rekan tim/hosted.

## 2. Quick Start for the Receiving AI Agent

1. Baca `AGENTS.md`, dokumen ini, `docs/schema.md`, dan `docs/requirements/PRD.md`; baca kode dan migration aktif sebelum mengubah kontrak. Jangan menulis ulang F04–F07 tanpa reproduksi cacat.
2. Inventaris `git status`, `git diff`, seluruh untracked `src/`, `tests/`, `supabase/migrations/`, `.env.example`, dan `src/lib/supabase/database.types.ts`. Sebagian besar implementasi **belum tracked**, sehingga branch/commit sendiri tidak cukup untuk transfer.
3. Bandingkan migration database target dengan sembilan berkas pada §6, terutama dua migration 20261106. Verifikasi izin, constraint, dan benturan RPC; minta otorisasi tugas database terpisah sebelum perubahan schema/deployment migration.
4. Siapkan secret masing-masing lingkungan pada server, khususnya `RATE_LIMIT_HMAC_KEY` minimal 32 karakter. Jangan salin nilai `.env.local`, jangan commit secret, dan jangan mengaktifkan live provider hanya untuk mengejar test hijau.
5. Gerbang berikutnya: typecheck/lint/build, regresi mock yang aman, authenticated HTTP E2E terisolasi, lalu kontrak C1/C8 dan C6 nyata. Jangan menghapus guard owner, CAS, finansial, atau synthetic untuk mempercepat integrasi.

## 3. Module Implementation Status

| Modul | Fitur/alur utama | Status terverifikasi | Integrasi yang masih dibutuhkan |
|---|---|---|---|
| AI Campaign Strategist | Diskusi persisten, strategi beralasan, grounding, pilihan tawaran, replay | Implementasi dan tes lokal; route development; generasi baru menunggu HMAC | Produser C1/C8 nyata; data order/kapasitas; entry point di luar `/dev` bila diminta |
| Alternative Strategy Analysis | Hingga tiga opsi `StrategyProposal.options` dalam hasil Strategist; memilih satu sumber Blueprint | Implementasi dalam Strategist, bukan service/endpoint tersendiri; tes lokal | Kualitas dan relevansi terhadap bisnis nyata belum diuji |
| Campaign Blueprint | Draft dari proposal tersimpan, revisi manual/AI, approval, materialisasi tugas/konten | Implementasi dan tes lokal termasuk F07, CAS dan RPC atomik; demo synthetic | Konteks/offer nyata dan validasi ulang terhadap checkout |
| Promotion Simulator | Perhitungan harga, kontribusi, kapasitas, perbandingan 2–3 skenario | Kalkulator deterministik dan tes lokal; UI memakai fixture | Harga/kapasitas nyata serta konsistensi checkout; simulasi bukan penjualan |
| Campaign Execution Planner | Publish/close, checklist, konten, jadwal | Lifecycle dan RPC lokal; publish pada API development memerlukan mode `synthetic` | Operasional eksekusi dan observasi order nyata; tidak otomatis posting eksternal |
| AI Campaign Evaluation | Perhitungan deterministik, narasi AI, review dan finalization | Persistensi/CAS lokal dengan data KPI development; tes lokal | Snapshot C6/order/payment yang terverifikasi untuk evaluasi nyata |
| Business Memory | Kandidat dari Evaluation, review/reject, guarded approval, job embedding, retrieval | Kandidat sintetis dan lower-layer worker/retrieval diuji; loop positif belum ada | Evaluation eligible, approval, worker, attestor sumber, retrieval ke Strategist |

Semua API terkait memvalidasi input dan identitas owner; output provider divalidasi sebelum penyimpanan. Provider Gemini dipanggil hanya saat konfigurasi dan admission mengizinkan. `fake` dan fixture tidak membuktikan performa riil.

## 4. Current AI Architecture

```text
C1 business/product/preorder + C8 effective offer + C6 metrics (saat ini fixture/absen)
  → buildBusinessContext → Strategist discussion → StrategyProposal.options
  → pilih proposal tersimpan → Blueprint draft/revisi → approval
  → campaign_tasks/campaign_contents → publish/close campaign
  → Evaluation (ringkasan deterministik + interpretasi AI) → owner review/finalize
  → Memory candidate → owner review → [verified source wajib untuk approval]
  → job embedding → retrieval tersaring → konteks Strategist berikutnya
```

| Transisi | Produser → konsumen dan entitas | Guard/bukti sumber saat ini |
|---|---|---|
| Fakta → strategi | C1/C6/C8 → `buildBusinessContext` → `campaign_ai_sessions`, `campaign_ai_messages`, `ai_generations` | Tenant, versi, freshness, offer, harga, kapasitas divalidasi; `seededDevelopmentContext` hanya dua bisnis demo, `targetUnits/quotaUnits/orderableUnits=40`, paid/held/allocated=0, C6 unavailable, C8 tanpa offer. **Belum fakta transaksi nyata.** |
| Strategi → Blueprint | `StrategyProposal.options` tersimpan → `campaigns`, `campaign_blueprints` | Session/generation/proposal key, konteks hash/versi, owner, tawaran/finansial; create atomik, revisi CAS. |
| Skenario → keputusan | `simulateCampaign`/`compareScenarios` → Strategist dan validasi Blueprint | Kalkulasi integer deterministik dari `src/features/pricing/`; hipotetis dan tidak menulis order/payment. |
| Approval → eksekusi | Blueprint approved → `campaign_tasks`, `campaign_contents`; publish/close `campaigns` | Owner, versi, window preorder, konflik, source/financial guards; API publish dibatasi mode synthetic. |
| Eksekusi → Evaluation | Campaign closed, tugas/konten/biaya → `campaign_evaluations` | Source snapshot/CAS dan ringkasan kode; analytics `development_fixture`, bukan paid order/payment aktual. Finalization synthetic berlabel dan tidak eligible untuk Memory produksi. |
| Evaluation → Memory | Evaluation terbaru/completed → `campaign_memories` | Kandidat, review/reject tersimpan; approval synthetic ditolak oleh service dan trigger DB. Tidak ada approved production candidate saat ini. |
| Memory → Strategist berikutnya | Approved/ready Memory → `job_runs`, vector, `match_campaign_memories` → history prompt | Scope tenant, profile/model, freshness dan source attestation wajib. Caller saat ini belum memasok attestor untuk jalur positif; cold start/unavailable benar, retrieval positif live **UNVERIFIED**. |

Route Handler mengurus auth, origin, parsing, respons; service mengurus aturan; repository memanggil Supabase; provider adapter mengurus Gemini/fake. Service role hanya di server untuk RPC tertentu, dengan owner check (`private.require_owner`/`is_business_owner`) dan RLS. F05/F06 mengklaim satu request serta kuota sebelum inference; tidak ada transaksi database yang meliputi panggilan jaringan Gemini.

## 5. Key Source Files

| Area | Berkas/fungsi penting |
|---|---|
| Konteks | `src/features/ai-context/contracts.ts` (`C1ContextSnapshotSchema`, `C6ContextSnapshotSchema`, `C8ContextSnapshotSchema`), `build-business-context.ts` (`buildBusinessContext`), `src/features/campaign-strategist/development-context.server.ts` (`seededDevelopmentContext`) |
| Strategist/alternatif | `src/features/campaign-strategist/discussion-api.server.ts` (`discussionGet`, `discussionPost`), `persistent-discussion-service.ts`, `supabase-discussion-repository.server.ts`, `strategy-service.ts`, `contracts.ts`, `gemini.server.ts`, `configured-provider.server.ts` |
| Blueprint | `src/features/campaign-blueprint/api.server.ts` (`blueprintGet`, `blueprintPost`), `workflow.server.ts`, `blueprint-service.ts` (`validateBlueprintPreflight`, `generateBlueprint`), `blueprint-domain.ts`, `repository.server.ts`, `components/blueprint-panel.tsx` |
| Simulator/finansial | `src/features/campaign-simulator/simulate.ts` (`simulateCampaign`, `compareScenarios`), `contracts.ts`, `development-fixtures.ts`, `src/features/pricing/` |
| Execution | `src/features/campaign-execution/api.server.ts`, `service.ts` (`campaignExecutionService`, `validateCampaignPublication`), `repository.server.ts`, `published-offer.server.ts` |
| Evaluation | `src/features/campaign-evaluation/service.ts` (`evaluationService`), `context.ts`, `engine.ts`, `repository.server.ts`, `gemini.server.ts`, `development-provider.ts` |
| Memory | `src/features/business-memory/service.ts` (`memoryService`), `domain.ts`, `repository.server.ts`, `indexing.server.ts` (`runMemoryWorker`), `retrieval.server.ts` (`retrieveMemoryHistory`, `matchMemoryVectors`), `gemini-embedding.server.ts` |
| Bersama/infrastruktur | `src/lib/ai/narrative-safety.ts`, `generation-claims.server.ts`, `generation-quota-policy.server.ts`, `gemini-json.server.ts`, `src/lib/supabase/transport.server.ts`, `src/lib/supabase/database.types.ts` |

Endpoint yang ada berawalan `/api/dev/discussions`, `/api/dev/blueprints`, `/api/dev/campaigns`, `/api/dev/evaluations`, `/api/dev/memories`; halaman ada pada `/dev/*`. Route development melakukan gate lingkungan; jangan menganggap API produksi tersedia.

## 6. Database Schema & Required Migrations

**Rantai aktif ialah `supabase/migrations/`, urut nama timestamp.** Snapshot `database/v2.1/` dan uraian `docs/schema.md` bukan pengganti deployment migration. Semua sembilan berkas berikut ada pada working tree saat inspeksi dan semuanya untracked.

| Urutan migration | Kontrak AI yang dibawa; dampak jika hilang |
|---|---|
| `20261103000000_initial_v21.sql` | Dasar `businesses`, produk, kapasitas, preorder/order/payment, `campaigns`, sesi/pesan AI, `ai_generations`, `campaign_blueprints`, tugas/konten, biaya, Evaluation, Memory, `job_runs`, `rate_limit_buckets`, RLS/constraint/RPC dasar. Tanpanya seluruh persistence gagal. |
| `20261103090000_atomic_campaign_blueprint_creation.sql` | `create_campaign_with_initial_blueprint` menjaga parent dan initial sourced Blueprint dalam satu transaksi. Create Blueprint gagal bila RPC tidak ada. |
| `20261104090000_evaluation_cas_and_finalization.sql` | `record_campaign_evaluation_cas`, `finalize_campaign_evaluation`, guard sumber/insert/completion. Evaluation/finalization tidak aman/tidak dapat berjalan tanpanya. |
| `20261104091000_seal_completed_campaign_updates.sql` | Memperketat guard campaign completed; mencegah perubahan setelah finalization. |
| `20261104092000_reject_synthetic_finalization_memory_approval.sql` | Trigger `synthetic_finalization_guard`; pertahankan penolakan approval Memory dari Evaluation sintetis. |
| `20261104093000_memory_approval_and_indexing_transactions.sql` | Source check, `approve_campaign_memory`, `claim_memory_jobs`, `complete_memory_index_job`, guarded job/pipeline. Tanpanya approval/queue/writeback atomik gagal. |
| `20261104094000_memory_index_recovery.sql` | Memperbaiki claim/recovery lease dan writeback job; worker bergantung padanya. |
| `20261106090000_memory_generation_type.sql` | Memperluas CHECK `ai_generations_generation_type_check` agar menerima `memory` selain `strategies`, `discussion`, `blueprint`, `evaluation`. F05 Memory claim gagal CHECK tanpa berkas ini. |
| `20261106100000_atomic_ai_generation_admission.sql` | `public.admit_ai_generation(uuid,uuid,uuid,text,text,text,text,uuid,uuid,integer,text,text,text,text,text,integer) RETURNS jsonb`; service-role only. Menggabungkan `claim_ai_generation`/claim non-discussion dan tiga `take_rate_limit` dalam satu subtransaksi, memakai lock bisnis dan waktu DB, rollback claim/pesan/versi/bucket saat ditolak. Generasi baru F06 gagal bila RPC hilang. |

Entitas pokok: `ai_generations` menyimpan `generation_type`, `request_key`, `input_hash`, status/output/error; `campaign_blueprints` menyimpan versi, sumber, approval; `campaign_evaluations` menyimpan sumber dan hasil append-only; `campaign_memories` unik pada `(business_id, source_evaluation_id, source_version)`; `rate_limit_buckets` menghitung jendela; `job_runs` melacak embedding. `claim_ai_generation` tetap memegang semantik session/version/context untuk Strategist; `take_rate_limit` adalah primitif bucket yang dipanggil oleh `admit_ai_generation`, bukan tiga request aplikasi terpisah. `src/lib/supabase/database.types.ts` harus cocok dengan RPC target.

Checklist database: bandingkan applied migration list dan isi/fingerprint pada target; cocokkan tabel/constraint/RLS/permission dan signature RPC, khususnya `admit_ai_generation` serta CHECK `memory`; cari RPC duplikat/konflik dari cabang lain; rencanakan deployment migration berurutan hanya melalui tugas dan izin database terpisah; verifikasi kembali owner-only/service-role-only dan guard synthetic setelah deploy. **Penerapan migration lokal bukan deployment ke lingkungan bersama.** Laporan terakhir menyatakan sembilan migration diterapkan pada Supabase lokal; status rekan tim/hosted **UNVERIFIED**. Tugas dokumentasi ini tidak menjalankan migration.

## 7. Completed Improvements — F04, F05, F06, F07

| Temuan | Perubahan yang ada | Bukti dan batas |
|---|---|---|
| F04 narrative safety | `narrative-safety.ts` dipakai Strategist, Blueprint, Evaluation, Memory; NFKC/Unicode numeral, kecocokan angka dengan fakta berlabel, penolakan jaminan finansial, atribusi sebab, klaim eksekusi tanpa bukti, dan grounding Memory. | PASS pada regresi lokal Batch 1/2. Policy berbasis pola dan source yang tersedia; tidak menjamin seluruh makna kalimat bebas aman. |
| F07 manual Blueprint | `edits.plan` menyimpan teks persis termasuk whitespace/newline; nol panggilan provider; provenance `manual` dan parent Gemini tetap ada. Replan AI eksplisit terpisah; CAS, owner, approval, finansial tetap berlaku. | PASS pada regresi lokal Batch 1/2. UI menampilkan versi manual sebagai manual; beberapa label demo `Fake` masih hard-coded, jadi label provider secara menyeluruh belum tuntas. |
| F05 duplicate inference | Claim persisten Strategist, Blueprint create/replan, Evaluation, Memory; Memory memakai kunci kanonis `memory:<evaluationId>:<sourceVersion>`. Replay completed tanpa inference/biaya baru; status running ditangani sebagai konflik; checkpoint/failure/recovery dan fencing mencegah retry otomatis setelah ACK ambigu. | PASS pada unit dan PostgreSQL concurrency lokal (10 test PG dalam laporan terakhir). Tidak menjanjikan exactly-once universal untuk panggilan jaringan provider. |
| F06 atomic quota | HMAC key per bisnis, limit bersama 6/menit, 30/jam, 100/hari default atau override; hari Asia/Jakarta. `admit_ai_generation` menggabungkan claim + tiga allowance; denial rollback, HTTP 429 `AI_RATE_LIMIT_EXCEEDED` + `Retry-After`; replay/manual Blueprint/alias Memory tidak memakan charge baru. | Implementasi dan 9 test PostgreSQL atomik PASS. Runtime lokal masih PENDING karena HMAC tidak disetel; generasi baru 503 fail-closed. Upaya provider yang gagal setelah admission tetap dihitung. |

## 8. Runtime Configuration

Nilai secret tidak dicatat. Pemeriksaan presence/nonempty `.env.local` pada 6 November: `GEMINI_API_KEY`, `GEMINI_MODEL`, `SUPABASE_SERVICE_ROLE_KEY` ada; `RATE_LIMIT_HMAC_KEY` dan `AI_DAILY_GENERATION_LIMIT` tidak ada. Variabel publik Supabase dipakai untuk sesi; jangan tempatkan service key/Gemini/HMAC pada `NEXT_PUBLIC_*`.

| Variabel | Kegunaan dan kondisi |
|---|---|
| `RATE_LIMIT_HMAC_KEY` | **Wajib** untuk generasi teks baru; server-only, 32–4096 karakter, minimal 32 non-spasi setelah trim. Jika hilang/invalid: `AI_QUOTA_CONFIGURATION_REQUIRED` (503). Gunakan secret kuat dan stabil per lingkungan; rotasi mengubah namespace bucket. |
| `AI_DAILY_GENERATION_LIMIT` | Opsional; integer positif hingga 2.147.483.647, default **100**. Invalid memicu error konfigurasi di atas. Batas menit 6 dan jam 30 tidak dapat diubah lewat env ini. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Wajib saat provider Gemini dipilih; server-only. Tanpanya provider gagal konfigurasi; tidak diperlukan untuk test fake. |
| `GEMINI_TIMEOUT_MS`, `GEMINI_DEBUG` | Opsional; timeout provider dari `gemini-json.server.ts` (default 20.000 ms, template 60.000 ms); debug hanya untuk development bila `true`, jangan log secret. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (fallback `NEXT_PUBLIC_PUBLISHABLE_KEY`) | URL dan publishable key untuk session/Supabase transport. Transport saat ini memvalidasi origin lokal `http://127.0.0.1:54321`; integrasi host lain perlu review kode/kontrak, bukan sekadar mengganti URL. Publishable key boleh publik. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; diperlukan privileged RPC, jangan pernah masuk client/log/commit. Owner check tetap wajib walau RPC dipanggil service role. |
| `CAMPAIGN_DISCUSSION_PROVIDER`, `CAMPAIGN_DISCUSSION_CONTEXT` | Development gate Strategist: provider `fake`/`gemini` dan context `seeded`; tanpa kombinasi valid route tidak aktif. |
| `CAMPAIGN_BLUEPRINT_PROVIDER`, `CAMPAIGN_BLUEPRINT_APPROVAL` | Provider demo `fake`/`gemini`; `APPROVAL=synthetic` untuk approval demo lokal. |
| `CAMPAIGN_EXECUTION_MODE`, `CAMPAIGN_EVALUATION_MODE` | Mode `synthetic` untuk publish dan Evaluation development. |
| `CAMPAIGN_EVALUATION_PROVIDER`, `CAMPAIGN_MEMORY_PROVIDER` | Pilihan provider Evaluation/Memory, `gemini` untuk jalur configured; fake dibatasi development/test sesuai masing-masing adapter. |
| `CAMPAIGN_MEMORY_RETRIEVAL`, `GEMINI_EMBEDDING_MODEL` | Opsional; retrieval `gemini` memerlukan embedding model/API key, `fake` hanya test/development. Menyetelnya tidak membuat Memory eligible otomatis. |

Gunakan `.env.example` sebagai daftar placeholder, isi secret hanya pada env server milik penerima, dan verifikasi absence/presence tanpa mencetak nilainya. `.env.local` tetap ignored; jangan commit. Route `/api/dev/*` mengharuskan `NODE_ENV=development` pada auth boundary.

## 9. Testing & Verification

**Bukti historis terbaru (laporan Batch 04B, 6 November):** 780 safe unit/mock integration/loopback PASS, 1 metadata SKIP, 9 atomic admission PostgreSQL PASS, 10 F05 PostgreSQL PASS; total **799 PASS, 1 SKIP**. TypeScript typecheck, ESLint, production build (13 halaman), dan validasi 141 definisi request Bruno PASS. Dua regresi awal F06 yang memperlihatkan 7 admission terhadap batas 6 berubah menjadi PASS. PostgreSQL concurrency memakai database lokal; bukan hosted. Laporan-laporan perbaikan tidak memanggil Gemini atau embedding nyata. Full authenticated HTTP E2E setelah F06 dan live provider E2E belum selesai. Synthetic Memory test tidak membuktikan production eligibility. F08 `tests/integration/supabase-proposals.test.ts` pernah FAIL (fixture `synthetic-database-test` tidak ada) dan belum diperbaiki/diuji ulang secara reproduktif; jangan menyembunyikan fail dengan skip/seed diam-diam.

**Tugas handoff ini:** hanya inspeksi/read-only dan validasi dokumen; tidak menjalankan ulang suite, build, HTTP, database mutasi, Gemini, embedding, atau Bruno. Untuk penerima setelah sinkronisasi berkas, pemeriksaan aman yang tersedia: `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build`, lalu `npm run test:unit` **hanya jika koleksi Bruno masih ada** (dua unit test membacanya). Atur flag provider/DB smoke ke `0` dan periksa setup test sebelum menjalankan suite integrasi; gunakan lingkungan database disposable dan izin terpisah untuk test PostgreSQL yang menulis. Jangan menganggap angka PASS historis berlaku sesudah penghapusan Bruno atau merge.

## 10. Known Limitations & Integration Dependencies

| Gap | Kontrak yang dibutuhkan dan lokasi konsumen | Status/langkah |
|---|---|---|
| F01 konteks nyata | Produser bisnis/produk/preorder/kapasitas memberi C1 (`businessId`, `productId`, `preorderId`, item, harga snapshot, biaya/kualitas, target/quota/paid/held/allocated/orderable units, status/window, versi/freshness) dan C8 offer efektif, terikat owner/bisnis. Konsumen: `ai-context/contracts.ts`, `buildBusinessContext`, `development-context.server.ts`, Strategist/Blueprint/Simulator. | Produser lintas modul **belum terhubung**; dua bisnis fixture dan angka 40. Sepakati API sumber bersama modul bisnis, kapasitas, checkout; uji non-40, hold/order nyata, dan harga sama dengan checkout. Pemilik tim spesifik UNVERIFIED. |
| F02 KPI aktual | Produser order/payment/campaign memberi C6 analytics ber-scope `businessId/preorderId/campaignId`, paid units dalam window, baseline, attribution, biaya, timestamp/versi/provenance yang dapat diaudit. Konsumen `campaign-evaluation/contracts.ts`, `context.ts`, `repository.server.ts`, `service.ts`. | `syntheticCampaignAnalytics` masih development fixture; tidak boleh menyatakan uplift/kausalitas atau memasukkan simulasi sebagai penjualan. Bangun verified producer dan uji rekonsiliasi payment/order dalam tugas integrasi. |
| F03 loop Memory positif | Evaluation non-synthetic eligible → kandidat → owner review/approval → `job_runs` → vector ready → `match_campaign_memories` dengan source attestation → history Strategist berikutnya. Konsumen `business-memory/service.ts`, `repository.server.ts`, `indexing.server.ts`, `retrieval.server.ts`, `campaign-strategist/development-context.server.ts`. | Kandidat/review synthetic dan worker lower layer ada; synthetic approval ditolak; caller retrieval belum memberi attestor positif, sehingga eligible row pun unavailable. Perlu sumber C6 verified, wiring attestor, worker terjadwal/terotorisasi, lalu end-to-end positif terisolasi. Jangan bypass guard. |
| F08 fixture DB | `tests/integration/supabase-proposals.test.ts` mengharapkan proposal fixture aktif yang tidak tersedia. | Test lama belum reproducible dari DB bersih; siapkan fixture disposable eksplisit pada tugas terpisah, jangan menulis ke database bersama. |
| F09 label/QA | `blueprint-panel.tsx` sudah melabeli revisi manual dari `provider=manual`; tetapi teks `Fake` dan label `synthetic` masih ada pada beberapa UI demo, serta dokumen QA lama berbeda fase. | Audit seluruh label saat UI produksi diintegrasikan; dokumen ini menggantikan ketergantungan pada status QA lama. Jangan hapus provenance sintetis. |

Konfigurasi HMAC, HTTP E2E, live Gemini/embedding, jadwal worker, serta deployment target tetap **UNVERIFIED/PENDING** sesuai bagian masing-masing. Tidak ada bukti checkout/payment atau real campaign attribution yang terhubung ke pipeline AI ini.

## 11. Pre-Merge Checklist

- [ ] Periksa branch `main`, local HEAD `e4a6ecbe075c4f439f1823932d903e0e694ca5a5`, dan diff pada `.gitignore`, `docs/requirements/PRD.md`, `docs/schema.md`, `package.json`, `package-lock.json`; tidak ada staged file saat inspeksi. Jangan menganggap perubahan dokumentasi schema sebagai izin mengubah DB.
- [ ] Inventaris/sertakan untracked penting: `.env.example`, `src/app/api/`, `src/app/dev/`, `src/features/`, `src/lib/` termasuk `database.types.ts`, `supabase/migrations/` sembilan file, `tests/`, `vitest.config.mts`, `scripts/`; pastikan file yang relevan tidak hilang dari transfer/merge. `bruno/`, `docs/qa/`, `docs/plans/`, `docs/examples/`, `database/` juga untracked saat inspeksi.
- [ ] Bandingkan migration target dan schema rekan tim; resolusi konflik RPC/constraint/RLS harus eksplisit dan disetujui. Verifikasi 20261106090000 sebelum 20261106100000. Status shared/hosted **UNVERIFIED**.
- [ ] Set secret server sendiri; HMAC masih absen pada lokal yang diperiksa. Jangan stage `.env.local`.
- [ ] Jalankan typecheck/lint/build serta regresi aman pada tree hasil merge; investigasi fail F08 dan dampak Bruno cleanup. Uji authenticated HTTP dengan owner/non-owner, replay/running, 429, 503, stale CAS di lingkungan terisolasi.
- [ ] Review overlap dengan modul produk/preorder/order/payment/kapasitas. Pertahankan tenant scope, offer checkout, source/version, dan financial validation. Tidak ada commit/push/merge/deploy dalam tugas ini.

## 12. Cleanup Impact

| Rencana hapus oleh owner | Ada? / import runtime | Referensi yang patah dan keputusan |
|---|---|---|
| `bruno/` (dan mungkin `bruno.zip`) | Ada; tidak ditemukan import runtime `src/` | **Kondisional untuk runtime, tidak aman bagi test saat ini.** `tests/unit/business-memory-bruno.test.ts` dan `tests/unit/gemini-development.test.ts` membaca koleksi; `scripts/validate-bruno-collection.mjs`, `smoke-bruno-collection.mjs`, dan `test-business-memory-e2e.mjs` bergantung pada koleksi/hasil parsing. `scripts/prepare-bruno-development.mjs` bernama Bruno tetapi menyiapkan fixture DB dan cache, tidak membaca koleksi. `npm run test:unit` akan gagal pada dua test itu setelah koleksi dihapus. Validasi 141 definisi request menjadi bukti historis saja. Tidak ditemukan CI repo (`.github` tidak ada); CI eksternal UNVERIFIED. |
| `docs/qa/` | Ada; tidak ditemukan import runtime | **Kondisional.** Laporan bukti hilang; `scripts/diagnose-gemini-network.mjs` dan opsi `GEMINI_TRANSPORT_REPORT=1` pada `tests/integration/gemini-transport.test.ts` menulis ke path ini dan dapat gagal bila folder tak ada. Beberapa dokumen slice menautkan QA lama. Ringkasan angka/status kritis telah dipertahankan di sini. |
| `docs/plans/` | Ada; tidak ditemukan import runtime/test | **Kondisional.** Tautan dari `SLICE_5.md`, `SLICE_7.md`, `SLICE_8.md`, `SLICE_8B.md` akan patah; alasan perubahan RPC/gap database hilang. Kontrak migration dan keputusan guard utama diringkas pada §6/§10. |
| `docs/example/` | **Tidak ada**; yang ada `docs/examples/` | Penghapusan path singular tidak berdampak. Jika maksudnya `docs/examples/`, tidak ditemukan import runtime/test, tetapi tautan contoh JSON dari dokumen slice akan patah dan snapshot contoh hilang. Aman untuk runtime, kondisional untuk dokumentasi/QA; jangan perlakukan snapshot sebagai seed portabel. |

Dokumen ini menyimpan status, kontrak, dan bukti penting tanpa menjadikan folder yang mungkin dihapus sebagai satu-satunya sumber. Owner yang melakukan cleanup perlu memutuskan nasib test/script/link tersebut; tugas ini **tidak menghapus** apa pun.

## 13. Recommended Next Development Steps

**Prasyarat merge:** (1) inventaris diff/untracked dan konflik, (2) bandingkan sembilan migration dengan target, (3) verifikasi schema/izin/RPC, (4) konfigurasi HMAC dan secret server, (5) typecheck/lint/build, (6) regresi mock aman serta dampak Bruno, (7) authenticated HTTP E2E terisolasi untuk owner/denial/replay/quota/CAS.

**Integrasi berikutnya:** (8) hubungkan produser C1/C8 dari bisnis, produk, preorder, capacity, checkout dengan harga server yang sama; (9) hubungkan C6 dari paid order/payment dan attribution yang terverifikasi; (10) setelah Evaluation eligible, buktikan Memory approval → queue → embedding → retrieval dengan attestor → grounding Strategist positif. Tambahkan tes regresi berbasis data non-demo dan sumber terverifikasi pada tiap perbatasan. Pekerjaan lintas tim dan izin database dibahas sebagai tugas terpisah.

## 14. Safety Rules for Future AI Agents

- Ikuti `AGENTS.md`; baca kontrak schema dan kode nyata. Jangan mengarang tabel/RPC, mengubah schema/migration, menjalankan SQL mutasi, atau menerapkan migration tanpa tugas dan izin eksplisit terpisah.
- Jangan stage/commit/push/merge/deploy atas asumsi; jangan membocorkan `.env.local`, service-role key, Gemini key, atau HMAC. Service role tetap server-only dan owner check tidak boleh dilepas.
- Jangan melemahkan RLS, tenant scope, CAS/idempotency, source attestation, financial/capacity validation, synthetic approval guard, atau rate-limit admission. Jangan memberi klaim production eligibility pada fixture.
- Validasi input dan output provider dengan runtime schema; tidak ada `any`/type suppression. Kalkulasi harga/KPI/kapasitas deterministik, bukan kesimpulan bebas LLM; simulasi bukan transaksi.
- Hindari provider/embedding berbayar, test DB mutatif, Bruno mutation runner, reset, dan smoke eksternal tanpa izin serta lingkungan yang tepat. Jangan menyimpulkan exactly-once jaringan dari durable claim lokal.

## 15. Final Readiness Verdict

| Dimensi | Putusan |
|---|---|
| Implementasi AI internal | **Siap untuk handoff/review**, F04–F07 lulus lingkup lokal; tujuh modul ada dengan batas demo yang jelas. |
| Runtime lokal | **Parsial**: HMAC absen, generasi teks baru 503; cached replay/readback dan jalur sintetis tertentu tetap mungkin sesuai gate. |
| Merge | **Belum siap diasumsikan**: banyak source/test/migration untracked, target DB dan konflik belum dibandingkan. |
| Integrasi lintas tim | **Belum selesai**: C1/C8, C6, dan Memory loop positif memerlukan produser serta bukti baru. |
| Produksi | **Belum siap/UNVERIFIED**: route development, data sintetis, HTTP E2E/live provider/hosted migration belum diverifikasi. |

**Ya**, agen penerima dapat memakai dokumen ini sebagai konteks utama untuk melanjutkan **dengan aman**, asalkan ia memverifikasi working tree dan database target sebelum merge/implementasi. Dokumen ini tidak menyatakan integrasi atau deployment telah selesai.
