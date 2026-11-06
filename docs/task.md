# TASK BRIEF — STEVEN (ANGGOTA 2)

**Role:** AI & Campaign Intelligence  
**PIC:** Steven  
**Versi acuan:** Campaign Lab PRD v2.1 / `schema.md` v2.1  
**Mode awal:** READ-ONLY AUDIT + PLAN, **bukan langsung coding**  
**Referensi utama:** PRD §7 M05–M08, §9, §15–§16, §20–§22; schema §6, §10–§11, §14, §18.

## 0. Cara memakai dokumen ini (WAJIB untuk AI agent)

**Baca dulu, audit dulu, susun rencana dulu.** Dokumen ini membagi pekerjaan, **bukan instruksi untuk langsung mengimplementasikan semua fitur**. Pada interaksi pertama dengan AI agent, lakukan *READ-ONLY DISCOVERY + PLANNING* dan berikan temuan, kontrak yang diperlukan, dependensi, daftar file terdampak, urutan vertical slices dan risiko. **Jangan mengubah file apa pun pada fase ini**. Setelah owner menginstruksikan secara eksplisit satu slice implementasi, kerjakan hanya slice itu.

### Urutan baca dan otoritas

1. Instruksi eksplisit terbaru dari pengguna, lalu `AGENTS.md` (juga yang berada di subfolder relevan).
2. `docs/database-rules.md` atau `database-rules.md` di lokasi aktual.
3. `docs/requirements/PRD.md` (target v2.1) atau berkas `Campaign_Lab_PRD_v2_1.md` yang tersedia. Baca utuh, khususnya §3, §7–16, §20–22, §26.
4. `docs/schema.md` (target v2.1) atau `schema.md` yang tersedia. Baca utuh **termasuk §18 open-review**.
5. Migration SQL aktual yang memang ada di checkout `supabase/migrations/`, bukan hanya nama di dokumen; baca seluruh chain, policies, function, grants, dan perbedaan skema 19 tabel lama vs 26 tabel target.
6. `package.json`, `tsconfig.json`, config Supabase/Next, kode aplikasi, panggilan antar-domain, test, dan dokumentasi API yang sudah ada. Verifikasi branch/working tree, tanpa menghapus perubahan anggota lain.

**Jika berkas PRD/schema belum tersedia di repository:** identifikasi path, laporkan dan minta sinkronisasi; jangan menebak field, membuat tabel diam-diam, atau mengklaim fitur berjalan.

**Prioritas konflik:** instruksi pengguna dan `AGENTS.md` yang berlaku mengendalikan izin; PRD menyatakan **perilaku target**; `schema.md` menyatakan **kontrak target**; migration/database aktual menyatakan **yang sudah terimplementasi**. Catat konflik secara eksplisit dan hentikan langkah yang memerlukan keputusan/izin tambahan. Tidak boleh mengedit applied migration atau mengubah SQL/RLS/RPC/index/grants tanpa tugas schema tersendiri yang mengizinkan.

### Batas engineering untuk semua anggota

- Satu **Next.js App Router modular monolith**; TypeScript strict dan **tanpa `any` / `as any` / `@ts-ignore`**. Tipe eksternal `unknown` + runtime validation; SOLID dan arsitektur bersih diterapkan pragmatis.
- Kode paling kecil yang lengkap, modular, bisa diuji; tidak melakukan sweeping refactor, membuat dependency baru, atau menulis seluruh modul sekaligus tanpa izin.
- Server adalah sumber kebenaran harga, diskon, ketersediaan, pembayaran, KPI. Gemini hanya memberi usulan/interpretasi, bukan otoritas transaksional.
- **Satu preorder satu produk/SKU, satu fulfillment date; satu campaign mempromosikan preorder yang sama.** Target penjualan bukan minimum produksi; 30 paid valid dari target 40 tetap dipenuhi 30, tanpa auto-cancel/refund akibat target meleset.
- Kapasitas per produk/tanggal, tetapi MVP membatasi **satu preorder published per bisnis/tanggal fulfillment**. Hold bukan paid; allocated/fulfilled harus tetap mengonsumsi kapasitas yang berlaku.
- Diskon campaign aktif berlaku untuk **semua checkout baru** pada preorder, bukan voucher. Attribution link terpisah dari harga yang diterapkan; order lama memakai snapshot.
- Pembayaran **Midtrans Sandbox** satu merchant tim, guest checkout dan email konfirmasi setelah verified+applied payment **P0 wajib**. Jangan mengklaim settlement uang nyata.
- RAG hanya `campaign_memories` milik bisnis sendiri, **embedding vector(768)**, tanpa `knowledge_documents`/`knowledge_chunks` target baru. Cold-start harus berfungsi tanpa memory.
- Jangan menyimpan/membocorkan secret, raw bearer token, PII ke AI, atau log yang tidak aman. Jangan reset DB, commit, push, merge, atau deploy tanpa izin.
- Fixture/mocks boleh membantu pengembangan, **bukan bukti provider/DB terintegrasi**. Sebutkan mana yang benar-benar diuji.

### Format respons AI agent pada putaran pertama

1. **Dokumen dan file yang benar-benar dibaca** (path). Jika gagal baca, sebutkan.
2. **Status implementasi saat ini**, terpisah dari target PRD dan asumsi.
3. **Gap & blockers** (P0/P1) plus perbedaan schema/migration.
4. **Kontrak producer/consumer** yang perlu disepakati sebelum coding; sebut reviewer.
5. **Rencana incremental per vertical slice**, file yang mungkin disentuh, test dan acceptance setiap slice.
6. **Dependency atau pertanyaan yang benar-benar memblokir**; jangan bertanya ulang untuk keputusan yang sudah tertulis di PRD.
7. **Klarifikasi bahwa tidak ada file, migration, commit atau deploy diubah pada fase audit.**

## 1. Produk yang sedang dibangun

Contoh inti: UMKM membuka preorder kaos **kuota 40**, baru **30 unit paid valid**. Sistem menampilkan paid target gap = 10 dan *orderable* yang juga mengurangi hold aktif. Owner bisa meminta Gemini menyarankan promosi, berdiskusi dan menguji what-if lewat calculator, memilih proposal, meninjau blueprint/kalender dan approve; Indro kemudian membuka campaign pada **preorder yang sama**. Buyer membeli via checkout publik, pembayaran Sandbox tervalidasi dan email dikirim. KPI preorder vs campaign dihitung terpisah; evaluasi final bisa menjadi memory private untuk strategi berikutnya.

**Milestones tim:** G0 contract+provider/schema audit → G1 core preorder → G2 payment+email → G3 AI campaign/approval/publish → G4 dua analytics+evaluation+memory → G5 QA/release. Pengerjaan paralel boleh memakai typed fixtures yang didokumentasikan; integrasi final harus memakai service dan database nyata.

## 2. Scope milik Steven

### S1. Shared pricing & simulation engine — P0/G0–G3

- Pure deterministic calculator untuk `discount_per_unit_idr=floor(base_price * discount_bps/10000)`, final price, total, contribution skenario, affordability and bounds. Gunakan IDR integer / BigInt guard, no floating money.
- Discount hanya valid bila cost diketahui dan contribution/unit positif sesuai PRD; normal-price dengan cost unknown boleh dengan warning dan contribution null. Skenario unit tidak melebihi *orderable*, tetapi bukan forecast.
- Calculator dipakai **simulator + pricing validation oleh Rafi/Indro**; jangan membuat service penjualan baru atau update data saat slider digeser.
- Hasil simulator harus cocok dengan harga *checkout* untuk snapshot input yang sama. Diskusi Gemini boleh mengusulkan parameter tetapi angka dihitung oleh service, bukan dipercaya dari LLM.

**Acceptance:** golden product Rp120.000 biaya Rp75.000 diskon 10% menghasilkan harga Rp108.000, kontribusi/unit Rp33.000; 8 unit+biaya promo Rp50.000 → kontribusi skenario Rp214.000.

### S2. SQL Business Context builder & private retrieval — P0/G3–G4

- Dari kontrak **C1 Rafi**, baca bisnis, produk, cost quality, target/quota, paid/held/allocated/available, cutoff, active offer; dari **C6 Indro**, baca KPI agregat yang bersumber SQL.
- Metadata `calculatedAt`, `version`, `contextHash` yang stabil pada fakta substantif, no PII buyer/provider secret.
- Retrieval hanya dari `campaign_memories` **milik bisnis tersebut**; pgvector **768 dimensi** dengan *query embedding profile* sama; tenant filter sebelum ranking/limit. Sumber memory berisi evaluation/version/provenance.
- **Tidak memakai `knowledge_documents`, `knowledge_chunks`, global marketing guides, atau memory fiktif**. Bisnis baru: hanya current SQL facts + Gemini dengan cold-start yang jujur.

**Acceptance:** dua bisnis tidak dapat saling membaca memory; memory historis tidak dipakai sebagai harga atau stok terbaru; model/dim mismatch menghasilkan kegagalan yang jelas, tidak silent coercion.

### S3. Gemini Strategy Generation + multi-turn discussion — P0/G3

- Alternatif yang feasibility-checked: `normal_price` atau `percent_discount`; `marketing_approach` berupa `scheduled_reminder`, `value_content`, `limited_discount` (sesuai PRD). 1–3 opsi yang valid, bukan memaksa 3 bila infeasible.
- Chat berkelanjutan: owner bertanya, mengganti diskon, budget, dates/channels, mengulang pendekatan; stored message sequence dan proposal version; reload dapat melanjutkan; stale version `409`.
- Tabel: `campaign_ai_sessions`, `campaign_ai_messages`, `ai_generations` (sebelum campaign dibuat, nullable campaign id).
- All Gemini output `unknown` → Zod/runtime parse → business guard; model tidak mengeksekusi SQL atau otomatis memilih/publish. Perbedaan option mechanism dan marketing approach eksplisit.
- Seleksi proposal = **aksi UI eksplisit**, bukan memproses kata 'setuju' di chat sebagai approval/publish.

**Acceptance:** diskusi multi-turn menghasilkan proposal snapshot yang tervalidasi, tidak menciptakan order/payment/kuota dan tidak membuat campaign ter-publish.

### S4. Campaign draft, full blueprint, revision & atomic approval — P0/G3

- Setelah pemilik memilih proposal, rancang draft `campaigns` terhubung **preorder yang sudah ada**; 1 campaign untuk 1 preorder; campaign tetap draft hingga **publish oleh Indro**.
- Gemini menghasilkan blueprint **untuk proposal terpilih**: offer+approach, hipotesis, target tambahan unit, budget, risiko, penjadwalan, daftar task dan caption. Seluruh preview sebelum approve.
- Buat revision versioned `campaign_blueprints` dengan hash/facts guard. Approval harus satu transaksi yang menyetujui version, memproyeksikan offer ke campaign yang tervalidasi, dan mematerialisasikan `campaign_tasks`/`campaign_contents` sekali (retry-safe). Jika RPC belum ada, ajukan schema task terpisah, jangan multi-step unsafe workaround.
- Tabel: `campaigns` (draft planning), `campaign_blueprints`, `campaign_tasks`, `campaign_contents`, `ai_generations`.

**Acceptance:** blueprint v1→v2, approve versi terpilih, approved max1, task dan caption tidak terduplikasi; approval **bukan** publish.

### S5. Campaign Execution Calendar — P0/G3

- Owner-only kalender/list, tasks scheduled, caption+copy, checklist completed, guarded edits, loading/empty/error/success yang nyata; tick bukan bukti konten pernah diposting.
- Pastikan plan sebelum approval hanya preview JSON, sedangkan setelah approval kalender berasal dari persisted `campaign_tasks`/`campaign_contents`.
- **Tidak** otomatis post Instagram/WhatsApp, tidak membuat gambar AI, tidak memodifikasi order pada task completion.

### S6. AI Evaluation — P0/G4

- Menerima **snapshot KPI deterministik C6 Indro** dari preorder/campaign, baseline+attribution+pricing eligibility, campaign costs/production-cost completeness, execution task progress.
- Gemini membuat interpretasi, keterbatasan, risiko, repeat/refine/explore. Tidak mengklaim kausalitas/forecast, dan tidak menghitung ulang nominal yang diberikan backend.
- Simpan append-only `campaign_evaluations` dengan metrics schema/version, metrics JSON, analysis JSON atau null jika AI gagal, calculated/evaluated timestamps dan provenance ke `ai_generations`.

**Acceptance:** KPI tetap tampil ketika Gemini gagal; historical evaluation GET tidak memanggil Gemini lagi; hasil tidak menyamakan attribution dengan efek promosi.

### S7. Campaign Memory RAG lifecycle — P0/G4

- Dari final evaluation, buat ringkasan terstruktur (proposal/blueprint chosen, execution status, KPI, learning+limitations), owner review+approve, **embedding 768**, store di **`campaign_memories`** dengan source version/hash/profile dan `embedding_status`.
- Ingestion harus idempotent, retryable, tidak menyimpan customer PII; private retrieval hanya bila owner business valid dan memory approved+ready. Retrieval baru menghasilkan sumber relevan, tidak memblokir pengulangan strategi lama.
- Tidak memperlakukan memory sebagai current price/capacity; tidak mengarang global knowledge untuk cold-start.

**Acceptance:** memory setelah final evaluation dapat ditemukan oleh prompt relevan dalam bisnis yang sama, business lain ditolak, stale/dim mismatch dikelola jelas.

## 3. Batas ownership Steven

| Area | PIC sebenarnya | Peran Steven |
|---|---|---|
| Auth/business, product, capacity, preorder, order/reservations/fulfillment | Rafi | Consumer context dan reviewer validasi harga |
| Current public offer, campaign publish/close, link resolver | Indro | Producer approved blueprint+draft configuration; konsultasi conflict/approval |
| Public preorder/checkout UI, Midtrans/webhook, paid email | Indro | Tidak membuat payment endpoint atau email adapter |
| SQL KPI snapshot, campaign costs UI, analytics charts | Indro | Consumer untuk evaluation/memory; review definisi KPI |
| Migration / vector SQL / approval RPC | Lintas tim dengan izin | Rancang kontrak dan test; jangan mengubah schema tanpa tugas eksplisit |

**Jangan** membuat duplicate `orders`, provider adapter Midtrans, atau memaksa global RAG dengan `knowledge_documents` lama. Jangan membuat campaign dan mengklaim published karena proposal disetujui.

## 4. Kontrak producer→consumer wajib

- **C1 (Rafi→Steven):** structured preorder facts (business/product/price/cost/quality/available/deadline/status/version) tanpa PII.
- **C2 (Steven→Rafi+Indro):** pure price calculator dan discount validator, golden fixtures dan versioned DTO. Indro current offer menentukan **apakah** diskon aktif; kalkulator menentukan **berapa** harga.
- **C3 (Steven→Indro):** `ApprovedBlueprintSnapshot`/`CampaignPublishReady` dengan `campaignId`, `preorderId`, `offerType`, `discountBps`, periode, version, KPI, audit dan error kalau stale. Indro hanya publish jika versi approved sesuai.
- **C6 (Indro→Steven):** `PreorderAnalyticsV1` dan `CampaignAnalyticsV1` snapshot, timestamp, source status, no double count, `costsCompleteness`.
- **C7 (Steven→Indro):** `CampaignEvaluation` dan `CampaignMemory` read-only projection untuk history/dashboard; data private tenant scoped.
- **C8 (Indro→Steven):** current offer window untuk memastikan AI tidak menyarankan diskon terhadap campaign/time yang tidak valid.

**Escalate:** perubahan `campaigns`/approval schema, kalkulator, KPI definitions, status transitions dan memory RPC harus di-review kedua consumer sebelum implementasi.

## 5. Urutan vertical slice yang disarankan

1. **S0 Audit:** PRD/schema/migration/app code gap, Gemini SDK installed or not, embedding model 768 compatibility, provider contract.
2. **S1 Pure math:** shared simulator calculator dan golden tests, fixture tanpa provider.
3. **S2 Typed context + discussion prototype:** DTO validasi, SQL adapters melalui kontrak Rafi, multi-turn Gemini mocked+real adapter setelah izin.
4. **S3 Proposal → blueprint:** selected proposal, multiday calendar preview, revisions, atomic approval contract/implementation hanya jika DB siap+diizinkan.
5. **S4 Execution:** calendar persist, copy caption, task status, integrasi Indro campaign publish.
6. **S5 Evaluation & private memory:** consume Indro metrics, immutable evaluation, owner approval, embedding 768, retrieval tenant isolated.
7. **S6 E2E:** satu owner flow penuh dengan preorder dari Rafi dan publikasi/pembayaran/KPI dari Indro; failure states.

**Parallelisasi:** S1 plus schema/query fixtures bisa dikerjakan terpisah saat Rafi mengembangkan core dan Indro provider spike; **tidak mengklaim end-to-end integrated sebelum benar-benar terhubung**.

## 6. Checklist pengujian khusus Steven

- [ ] Golden pricing 120k/75k/10%/8 units/50k cost menghasilkan Rp108k/unit dan kontribusi Rp214k; rounding+unknown/negative guards.
- [ ] Context hanya bisnis sendiri, tidak membawa PII; current data mengalahkan memory lama.
- [ ] Gemini invalid JSON/unsupported types tidak menulis campaign atau approve.
- [ ] Multi-turn discussion persisten dan stale version `409`, tidak approve hanya karena pesan 'setuju'.
- [ ] Selected proposal berbeda dari approved blueprint, berbeda dari published campaign.
- [ ] Blueprint revision dan atomik approval rollback/idempotent; tasks/content tepat sekali.
- [ ] Calendar checklist persisted, copy caption manual, tidak auto-post.
- [ ] KPI SQL vs AI interpretation terpisah; evaluation history append-only.
- [ ] Business Memory approved+ready, `vector(768)`, no global docs, retrieval filter tenant sebelum ranking.
- [ ] Repeat/refine/explore tidak menolak strategi yang sebelumnya dipakai.
- [ ] Cold-start tanpa memory menghasilkan rekomendasi berlabel dan tidak mengarang sumber retrieval.

## 7. Output saat implementasi diizinkan

Laporkan source code+contracts changed, tests real/mock, Gemini model/profile yang benar-benar terverifikasi, biaya/latency jika diukur, schema blockers, provider fallbacks dan consumer sign-off. Jangan commit/push/deploy atas inisiatif agent.

**Mulai sekarang:** baca semua dokumen dan repo **dahulu**, kembalikan audit+plan sesuai §0, **jangan coding otomatis**.
