# Manual testing Real Gemini melalui Bruno

Update Blueprint: [provenance nullable](GEMINI_BLUEPRINT_PROVENANCE_FIX.md). Completed store:false tanpa interaction ID sekarang diterima sebagai providerRequestId:null untuk Strategist dan Blueprint. Ini menggantikan batasan Blueprint pada catatan sebelumnya; output/domain dan idempotency tetap divalidasi.

Update INVALID_RESPONSE: [respons stateless tanpa interaction ID](GEMINI_STATELESS_RESPONSE_FIX.md). Strategist menerima providerRequestId:null bila Google tidak menyediakan ID; JSON/domain validation tetap berlaku. Blueprint masih mewajibkan ID sesuai kontrak existing.

Retest terbaru: [fix dispatcher yang hilang di Next.js](GEMINI_NEXT_TRANSPORT_FIX.md). Restart server; pada trace cari TRANSPORT/STARTED dispatcherInvoked:true. Provider/SDK/Next/socket dan satu GET metadata nyata telah diverifikasi. Generation tetap membutuhkan izin baru, version/hash aktual dan requestKey baru.

Update 5 November 2026: [perbaikan connection timeout dan retest port3000](GEMINI_CONNECTION_TIMEOUT_FIX.md). Dispatcher khusus Gemini sekarang memberi anggaran koneksi30 detik; deadline total tetap60 detik. GET/HEAD SDK nyata sudah diverifikasi, generation belum. Panduan historis port3100 di bawah tetap berlaku jika server Anda memakai port tersebut; samakan baseUrl dan Origin.

Audit 4 November 2026, Asia/Jakarta. Ini jalur manual terpisah dari regression workflow Fake. Tidak ada generation/embedding berbayar yang dijalankan dalam audit ini.

## Konfigurasi dan kesiapan

Sebelumnya Strategist memiliki adapter Gemini yang belum dipasang pada persistent route; auth/context development mensyaratkan flag Fake, identitas repository/response hardcoded Fake. Blueprint hanya memiliki Fake Provider dan metadata literal Fake. Mengubah environment saja sebelumnya menghasilkan503.

Sekarang Strategist dan Blueprint memilih provider dari environment server, dengan guard development/test + seeded context yang tetap berlaku. Provider Fake sendiri tetap menolak konfigurasi Gemini. Tidak ada fallback otomatis atau perubahan schema/migration/RLS/business rules. Approval, publikasi, kalkulasi dan provenance konteks tidak diserahkan kepada LLM.

Konfigurasi lokal yang telah dipasang:

```dotenv
CAMPAIGN_DISCUSSION_PROVIDER=gemini
CAMPAIGN_DISCUSSION_CONTEXT=seeded
CAMPAIGN_BLUEPRINT_PROVIDER=gemini
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_MS=60000
# GEMINI_API_KEY sudah tersedia di server; jangan salin ke Bruno atau dokumentasi.
```

SDK terpasang `@google/genai@2.32.0`, memakai `client.interactions.create` ke endpoint Gemini Developer API `https://generativelanguage.googleapis.com/v1beta/interactions`. JSON Schema disusun dari Zod, `store:false`, tanpa tools/streaming/automatic continuation. Maksimum output4096 tokens, satu attempt untuk konfigurasi manual, SDK retries disabled. Deadline total60 detik mencakup abort; Bruno menggunakan timeout90 detik. Jika timeout environment tidak diset, adapter memakai default20 detik; nilai di luar10–120000ms ditolak.

Key dan model diverifikasi dengan **GET metadata model saja**, HTTP200 untuk `models/gemini-3.8-flash`; tidak menjalankan inference. [Dokumentasi model resmi](https://aistudio.google.com/docs/models/gemini-3.8-flash) mengonfirmasi kode model dan structured outputs; [Interactions API](https://aistudio.google.com/docs/interactions-overview) serta [structured outputs](https://aistudio.google.com/docs/structured-output) menjadi referensi adapter. Metadata200 belum membuktikan generation, kuota/billing, latency dan output domain yang valid secara E2E.

`GEMINI_EMBEDDING_MODEL=gemini-embedding-2` hanya untuk embedding. Konfigurasi teks menolak model yang mengandung `embedding`; tidak menebak model default. API key tidak dikirim ke client/Bruno. `.env.local` tetap ignored.

Update 5 November 2026: adapter Real Gemini Evaluation/Memory dan transport embedding telah diimplementasikan. Lihat [laporan E2E terbaru](REMAINING_AI_E2E.md): dua Evaluation nyata HTTP200 masih ditolak domain; generation Memory dan finalization tetap BLOCKED. Satu probe embedding nyata lulus. Konteks C1/C6/C8 development tetap sintetis; response Gemini nyata tidak membuat KPI/payment/memory eligibility menjadi verified. Jangan menjalankan generation tambahan tanpa memenuhi izin dan batas biaya yang berlaku.

Jika Next tidak membaca ulang environment, restart satu devserver yang Anda gunakan dengan `npm.cmd run dev -- --port 3100`. Jangan menjalankan dua devserver. Untuk regression Fake, kembalikan dua flag provider ke `fake` dan pakai `confirmFakeProviders=true`; unit tests menggunakan konfigurasi/mocked transport eksplisit dan tidak mengirim request berbayar.

## Urutan Bruno

1. Pilih environment `local`, `baseUrl=http://localhost:3100`. Kredensial pribadi Owner A hanya pada Secret Variables. Business A tetap demo sintetis, bukan business produksi. Gunakan UUID preorder aktif dari [pemulihan data](BRUNO_DATA_RECOVERY.md).
2. Set `confirmFakeProviders=false`, `confirmRealGemini=true`, `allowAuth=true`, `allowMutations=true`. Biarkan `allowPaidRequests=false` selama login/read/create session. Sebelum setiap generation yang Anda setujui biayanya, ubah `allowPaidRequests=true`; kembalikanfalse setelah selesai. Flag ini adalah opt-in Bruno, bukan body field atau environment server.
3. Jalankan `00-Setup-Auth/01` login, `02` GET auth, lalu `03` GET discussions. GET discussions harus menunjukkan `provider:"gemini"`, `model:"gemini-3.8-flash"`, `syntheticContext:true`. Ini hanya membuktikan konfigurasi aktif, bukan bahwa generation sudah terjadi.
4. Buat session dengan `03-AI-Strategist/01-Create-session`, lalu GET `03-AI-Strategist/02-Load-session-context-hash` untuk `expectedVersion` dan `discussionHash` aktual. Tidak ada LLM call pada pembuatan session.
5. Tinjau payload dan biaya, aktifkan `allowPaidRequests=true`, lalu kirim `10-Real-Gemini/01-Ask-natural-question`. Message dapat diganti pertanyaan bebas berbahasa Indonesia, maksimal4000 karakter. Preferences tetap dibatasi kontrak.
6. GET session kembali untuk version/hash terbaru. Tinjau alternatif dan `rejectedOptions`; hanya alternatif yang lolos validasi boleh dipilih. Jalankan `04-Blueprint/01-List-and-select-persisted-proposal` untuk mengisi selection dari server, lalu kirim `10-Real-Gemini/02-Generate-real-blueprint` setelah menyetujui satu biaya generation lagi.
7. Baca hasil tersimpan lewat GET session dan `04-Blueprint/04-Read-blueprint-and-history`. Blueprint tetap `proposed`, campaign tetap `draft`; approval/publication tidak otomatis. Revision melalui API yang sama memakai `edits.notes` natural dan version tokens aktual; hapus `scenario` dari payload revision real.

Jangan Run All koleksi lama dalam mode Gemini. Request lama memakai instruksi regex Fake (`Pengingat unit 4 biaya 10000`) dan skenario normal/discount/revision/failure/invalid, serta expected status/output deterministik. Request real tidak memerlukan `scenario`: omission memiliki default netral internal `normal` untuk discussion dan `valid` untuk blueprint. Nilai non-netral ditolak dengan400 `FAKE_SCENARIO_DISABLED`, bukan dipakai untuk memilih provider atau meniru kegagalan. Payload lama yang netral tetap diterima; provider selalu ditentukan server. Harness Fake melewati tag `real-gemini` dan menolak environment Gemini.

## Payload lengkap

Semua POST aplikasi memakai cookie owner, `Content-Type: application/json` dan `Origin: http://localhost:3100`. Request dikirim ke aplikasi Next.js, bukan langsung ke Gemini. Placeholder numerik Bruno di bawah harus terinterpolasi sebelum JSON dikirim.

`POST /api/dev/discussions` untuk membuat session:

```json
{
  "action": "create",
  "preorderId": "{{preorderId}}"
}
```

Sesudah GET `/api/dev/discussions?sessionId={{sessionId}}`, kirim pertanyaan melalui `POST /api/dev/discussions`:

```json
{
  "action": "send",
  "sessionId": "{{sessionId}}",
  "requestKey": "{{requestId}}",
  "expectedVersion": {{expectedVersion}},
  "expectedContextHash": "{{discussionHash}}",
  "message": "Saya ingin mengingatkan calon pembeli melalui WhatsApp tanpa menurunkan harga. Strategi apa yang realistis untuk preorder ini? Jelaskan asumsi dan risikonya.",
  "preferences": {
    "budgetCapIdr": 50000,
    "allowDiscount": false,
    "channels": ["whatsapp"]
  }
}
```

Untuk follow-up, ganti message secara natural, gunakan requestKey baru dan GET ulang version/hash. Session history dimuat server; jangan mengirim `history`, businessId, harga, authoritative KPI atau model/provider dari client. RequestKey dan expected tokens mengikat input untuk replay. Request folder10 membuat UUID baru pada setiap Send; retry dengan UUID baru dapat menimbulkan biaya lagi. Untuk replay gunakan payload asli dan requestKey yang sama. Failed turns tidak otomatis diulang; muat ulang session sebelum request baru.

GET `/api/dev/blueprints?sessionId={{sessionId}}` mengembalikan selection eligible. Kemudian `POST /api/dev/blueprints`:

```json
{
  "action": "create",
  "selection": {
    "sessionId": "{{sessionId}}",
    "generationId": "{{generationId}}",
    "proposalVersion": {{proposalVersion}},
    "proposalKey": "{{proposalKey}}"
  },
  "campaignId": "{{campaignId}}",
  "requestId": "{{requestId}}"
}
```

Tidak ada field `alternativeId`/`proposalId`. Identitas campaign/request adalah UUID baru; selection berasal dari proposal tersimpan yang masih fresh. Jangan kirim angka finansial buatan client.

## Bukti respons dan debugging aman

- Strategist sukses: `success:true`, `persisted:true`, `replayed:false`, `proposal.model` sesuai model teks, `proposal.providerRequestId` non-null. GET ulang harus menunjukkan proposal yang sama; `ai_generations.model_id` juga memakai model terkonfigurasi. Balasan yang sekadar menyebut Gemini bukan bukti provider.
- Blueprint sukses: `active.blueprint_json.provider:"gemini"`, `model`, `providerRequestId`; `synthetic:true` tetap benar untuk sumber data demo. Metadata tersebut disimpan dalam JSON yang sudah ada, tanpa kolom baru. Blueprint Fake historis tetap terbaca dengan identitas aslinya.
- Jalur tetap request → auth/Origin/Zod → claim/idempotency/context → Gemini JSON → Zod/domain validation → Simulator/C2 → persistence → response. Blueprint juga memeriksa ulang jadwal/channel/caption/capacity/financials sebelum persistence; invalid output tidak disimpan sebagai sukses.
- Aktifkan `GEMINI_DEBUG=true` hanya untuk terminal development. Log `[GEMINI_DEBUG]` berupa JSON lengkap dari route sampai persistence, dengan cause/status, preview bertipe tanpa nilai bisnis, dan final failureStage. Production tetap tanpa verbose log. Baseline `Gemini request failed` tetap ringkas ketika flag mati. Panduan dan contoh: [Gemini debug logging](GEMINI_DEBUG_LOGGING.md). Jangan aktifkan debug mentah SDK atau membagikan Auth response/cookie.

| Kode aplikasi | Makna teknis / tindakan |
| --- | --- |
| `CONFIGURATION_ERROR`503 | Key/model/timeout tidak valid, atau upstream4xx non404/429. Lihat upstream status log:400 request/schema tidak diterima;401/403 key/permission;402 billing. Tidak membocorkan pesan upstream. |
| `MODEL_UNAVAILABLE`503 | Upstream404; periksa model terkonfigurasi dan akses akun, jangan mengganti dengan tebakan. |
| `PROVIDER_RATE_LIMITED`429 | Upstream429; tinjau quota/rate limit/billing dan lakukan retry baru secara sadar. |
| `PROVIDER_TIMEOUT`504 | Deadline total/abort; tidak ada fallback. Periksa latency; timeout bukan bukti provider tidak memproses request. |
| `PROVIDER_UNAVAILABLE`503 | Gangguan jaringan/upstream5xx atau respons tidak completed; log status membantu membedakannya. |
| `PROVIDER_REFUSED`503 | Safety refusal; revisi permintaan, jangan melewati validasi. |
| `INVALID_RESPONSE`502 / `INVALID_BLUEPRINT`502 | Envelope/JSON/Zod provider invalid; hasil tidak diperlakukan sebagai rencana valid. |
| `UNSAFE_TEXT`502 / `INVALID_CONTENT`400 / `INVALID_SCHEDULE`400 | Output melanggar guard domain; jangan melonggarkan business rules agar output lolos. |
| `STALE_CONTEXT` / `VERSION_CONFLICT`409 | GET ulang dan review sumber/version aktual sebelum request baru; bukan kegagalan Gemini. |

Verifikasi tanpa biaya: metadata model200, local auth/list200 dengan provider gemini, route blueprint mencapai resource check404 untuk UUID yang tidak ada; SDK-mocked tests mencakup natural message, provenance, C2, invalid caption, paid guard dan no fallback. Generation Strategist/Blueprint nyata serta kualitas jawaban masih memerlukan pengiriman request berbayar yang disetujui secara eksplisit. Tidak ada klaim E2E Gemini sudah lulus.
