# Real Gemini: development request tracing

Update terbaru: [perbaikan jalur Next fetch](GEMINI_NEXT_TRANSPORT_FIX.md). TRANSPORT/STARTED sekarang dapat mencatat dispatcherInvoked:true dari adapter yang mendelegasikan ke Agent, bersama connectTimeoutMs:30000. Field ini bukan sekadar konfigurasi; verbose tetap gated development + GEMINI_DEBUG=true.

Follow-up transport 5 November 2026: [hasil DNS, fix dan verifikasi HTTP nyata](GEMINI_CONNECTION_TIMEOUT_FIX.md). Logging-phase di bawah adalah catatan historis; fase transport menambah Undici Agent khusus Gemini dan field aman connectTimeoutMs. Tidak ada generation pada kedua fase.

Implementasi 5 November 2026, Asia/Jakarta. Tujuannya memperlihatkan failure stage aktual pada request Bruno berikutnya. **Tidak ada generation/embedding nyata atau request jaringan Gemini yang dijalankan dalam tugas ini.** Contoh di bawah adalah cuplikan kasus mock, bukan hasil inference nyata. Penyebab request210ms sebelumnya belum diklaim terbukti atau diperbaiki.

## 1. Files modified

| File | Perubahan |
| --- | --- |
| src/lib/ai/gemini-debug.server.ts | Helper server-only: gate, correlation ID, JSON logging, error/response metadata dan redaksi/limits. |
| src/lib/ai/gemini-json.server.ts | Checkpoint konfigurasi, initialization, schema construction, SDK, transport dan interaction envelope; warning baseline tetap ringkas saat flag mati. |
| src/features/campaign-strategist/gemini.server.ts | Meneruskan optional request trace ke shared provider. |
| src/features/campaign-strategist/configured-provider.server.ts | Meneruskan trace pada provider Gemini terkonfigurasi, tanpa fallback. |
| src/features/campaign-strategist/contracts.ts | Optional debug dependency; type import dihapus saat build, tanpa field DTO/API baru. |
| src/features/campaign-strategist/discussion-api.server.ts | Trace per POST, auth/input/config checkpoint, session UUID tervalidasi dan final HTTP/failureStage. |
| src/features/campaign-strategist/strategy-service.ts | JSON parse, Zod envelope/option/proposal, context/domain checks dan rejected option codes. |
| src/features/campaign-strategist/persistent-discussion-service.ts | Repository load, claim/replay, failure recording dan completion; exceptions tetap diteruskan seperti sebelumnya. |
| tests/unit/gemini-debug.test.ts | Gate, redaksi, bounds, validation paths/types, safe error fields dan trace correlation. |
| tests/unit/gemini-debug-pipeline.test.ts | POST handler + SDK aktual dengan HTTP/auth/repository dimock: network, upstream, JSON/Zod/domain, persistence dan replay. |
| tests/unit/gemini-provider.test.ts | Tambahan initialization/pre-transport cases dan opt-in untuk assertion verbose. |
| tests/unit/gemini-sdk-transport.test.ts | Gate verbose eksplisit dan test production tidak mencetak verbose. |
| .env.example / .env.local | Contoh false; lokal hanya GEMINI_DEBUG=true yang diaktifkan. Secret lain tidak dicetak atau diubah. |
| docs/qa/BRUNO_REAL_GEMINI.md / GEMINI_PROVIDER_DIAGNOSTICS.md | Mengarahkan debugging ke panduan ini; hasil investigasi sebelumnya tetap historis. |

Tidak ada dependency baru, perubahan model/prompt, schema/migration/RLS/auth, retry count, idempotency semantics, domain guard, atau response publik.

## 2. Exact logging locations and flow

- discussionPost() pada discussion-api.server.ts: createGeminiDebugTrace(), API_REQUEST, INPUT_VALIDATION, PROVIDER_CONFIGURATION, lalu debug.end() dalam finally.
- configuredDiscussionProvider() -> createGeminiStrategyProvider() -> createGeminiJsonProvider(): satu trace yang sama diteruskan melalui dependency optional.
- createGeminiJsonProvider().generate(): PROVIDER_CONFIGURATION -> PROVIDER_INITIALIZATION -> REQUEST_PREPARATION -> SDK_REQUEST. Call-through httpOptions.fetch mencatat TRANSPORT dan UPSTREAM_HTTP, tanpa membaca ulang atau memodifikasi response body.
- errorDiagnostics() pada gemini-debug.server.ts: actual constructor/name, status/statusCode terpisah, nested causes maksimal6 tingkat, allowlisted Node/Undici code, serta kategori pesan terkontrol. Pesan asli tidak dicetak. Safe provider error summary membaca metadata parsed error yang disediakan SDK, bukan log raw body.
- responseSummary(): interaction status, hashed ID, model yang cocok konfigurasi, SDK response type, output content types, bounded structural JSON preview dan safe provider error codes.
- generateCampaignStrategies(): JSON_PARSE -> ZOD_VALIDATION -> DOMAIN_VALIDATION; validateOptions() juga mencatat issue dan alasan penolakan alternatif tanpa nilai input/output.
- sendPersistentDiscussion(): PERSISTENCE load -> IDEMPOTENCY claim -> engine -> PERSISTENCE complete/fail. Return/throw dan pemanggilan repository tetap memakai implementasi existing.

Jalur synchronous: POST /api/dev/discussions -> authenticateDiscussion/checkWriteOrigin -> bounded body + ActionSchema -> ownership -> configured provider -> sendPersistentDiscussion/beginTurn -> generateCampaignStrategies -> adapter/Interactions -> JSON/Zod/domain -> completeTurn atau failTurn -> response HTTP. Tidak ada worker/router/retry baru. Request/body/bearer/cookie tidak dicetak. Response publik tetap misalnya {success:false,code:PROVIDER_UNAVAILABLE}.

| Kasus | Stage yang menunjukkan penyebab |
| --- | --- |
| A. Client tidak berhasil diinisialisasi | PROVIDER_CONFIGURATION atau PROVIDER_INITIALIZATION; transportInvoked=false |
| B. Request/schema gagal dibuat | REQUEST_PREPARATION; transportInvoked=false |
| C. SDK menolak sebelum HTTP callback | SDK_REQUEST; transportInvoked=false |
| D. Fetch dipanggil tetapi tanpa respons headers | TRANSPORT; responseReceived=false, NO_UPSTREAM_HTTP_RESPONSE |
| E. Respons HTTP4xx/5xx | UPSTREAM_HTTP; status dan safe headers, diikuti safe SDK/provider error summary |
| F. Interaction incomplete/failed/refused | INTERACTION_RESPONSE; status/errors metadata; koneksi tidak dituduh gagal |
| G. Generated text bukan JSON valid | JSON_PARSE |
| H. JSON/envelope/option tidak sesuai Zod | ZOD_VALIDATION, atau INTERACTION_RESPONSE untuk envelope SDK invalid |
| I. JSON lolos struktur tetapi ditolak domain | DOMAIN_VALIDATION; code/alasan penolakan dan counts |
| J. Output valid gagal disimpan | PERSISTENCE |
| RequestKey menunjuk turn failed/completed/running lama | IDEMPOTENCY + SDK_REQUEST:SKIPPED; tidak ada call Gemini baru |

END mencatat HTTP aplikasi, code dan failureStage. Pada request yang gagal, failureStage mempertahankan failure checkpoint pertama; checkpoint berikutnya tetap memperlihatkan jika failure recording juga bermasalah. Partial rejected options tidak otomatis menjadi failed request: behavior menerima alternatif valid tetap sama. Metadata tidak dilampirkan ke browser/API response.

## 3. Required environment flag

```dotenv
GEMINI_DEBUG=true
```

Verbose hanya aktif jika NODE_ENV tepat development **dan** GEMINI_DEBUG tepat true. .env.local lokal sudah diaktifkan pada tugas ini; baris lain, termasuk key/model/timeout, dipertahankan. .env.local tetap git-ignored. .env.example memakai false. Production/test atau flag false/tidak ada tidak mengeluarkan verbose trace/preview; warning existing hanya code/model/attempt/httpStatus.

Restart devserver yang sama bila environment belum direload. Jangan menjalankan instance devserver kedua. Jangan menyalakan GOOGLE_GENAI_DEBUG untuk kebutuhan ini: trace aplikasi sudah ter-redaksi, sedangkan debug mentah SDK dapat menampilkan payload/headers.

## 4. Example: transport failure

Cuplikan field dari kasus mock UND_ERR_CONNECT_TIMEOUT; output terminal asli adalah JSON satu baris lengkap, termasuk requestId, timing dan cause chain, agar tidak terlipat menjadi [Object].

```text
[GEMINI_DEBUG] {"stage":"TRANSPORT","result":"FAILED","httpStatus":null,"transportInvoked":true,"responseReceived":false,"upstreamHttpResponse":"NO_UPSTREAM_HTTP_RESPONSE","error":{"causeCode":"UND_ERR_CONNECT_TIMEOUT"}}
[GEMINI_DEBUG] {"stage":"END","result":"FAILED","httpStatus":503,"code":"PROVIDER_UNAVAILABLE","failureStage":"TRANSPORT"}
```

SDK menentukan nama/class wrapper aktual. Constructor/name untuk setiap cause dicatat jika dikenal; nama/code asing menjadi UnknownError/null. Fetch dipanggil bukan bukti byte terkirim atau request diterima Google. Tidak ada response Gemini yang dibuat-buat saat headers tidak diterima. Connect timeout tetap terlihat meskipun outer code aplikasi PROVIDER_UNAVAILABLE.

## 5. Example: upstream HTTP error

```text
[GEMINI_DEBUG] {"stage":"UPSTREAM_HTTP","result":"FAILED","httpStatus":400,"responseReceived":true,"headers":{"contentType":"application/json","retryAfterSeconds":null}}
[GEMINI_DEBUG] {"stage":"UPSTREAM_HTTP","result":"FAILED","code":"CONFIGURATION_ERROR","error":{"sdkStatus":400,"sdkStatusCode":400,"providerError":{"code":400,"status":"INVALID_ARGUMENT","messageCategory":"REQUEST_SCHEMA_REJECTED"}}}
[GEMINI_DEBUG] {"stage":"END","result":"FAILED","httpStatus":503,"code":"CONFIGURATION_ERROR","failureStage":"UPSTREAM_HTTP"}
```

Kategori pesan merupakan klasifikasi dari teks error SDK/provider yang dibatasi, bukan kutipan mentah dan bukan bukti entitlement/billing tersendiri. Structured fieldViolations yang tersedia memakai field path yang diizinkan. Upstream status dipertahankan terpisah dari status HTTP aplikasi. Header allowlist hanya content type/retry-after numerik; Authorization, Cookie, Set-Cookie dan header lain tidak dicetak.

## 6. Example: sanitized success response

```text
[GEMINI_DEBUG] {"stage":"INTERACTION_RESPONSE","result":"STARTED","response":{"interactionStatus":"completed","outputTextPresent":true,"outputContentTypes":["text"],"generatedJson":"PARSED","jsonPreview":"{\"schemaVersion\":\"[number:redacted]\",\"reply\":\"[string:redacted]\"}"}}
[GEMINI_DEBUG] {"stage":"JSON_PARSE","result":"SUCCESS"}
[GEMINI_DEBUG] {"stage":"ZOD_VALIDATION","result":"SUCCESS"}
[GEMINI_DEBUG] {"stage":"DOMAIN_VALIDATION","result":"SUCCESS","acceptedOptions":2,"rejectedOptions":0}
[GEMINI_DEBUG] {"stage":"PERSISTENCE","result":"SUCCESS","persisted":true}
[GEMINI_DEBUG] {"stage":"END","result":"SUCCESS","httpStatus":200,"code":"COMPLETED","failureStage":null}
```

Preview menampilkan **struktur dan tipe**, bukan nilai generated text, harga, jumlah target, tanggal, identitas atau data bisnis. Field names yang dikenal dipertahankan; unknown keys disembunyikan/dihitung. Batas: output text yang diperiksa maksimal64000 karakter; preview maksimal4096 karakter dan diberi jsonPreviewTruncated; depth5,20 object fields,2 item per array;20 validation issues/path12 tingkat;8 provider errors dan6 causes. Interaction ID di-hash16 hex untuk korelasi, bukan dicetak mentah. Angka scalar output juga di-redact. Session UUID yang sudah tervalidasi dan requestId buatan server dapat dicatat untuk menelusuri satu request.

## 7. Distinguishing networking from invalid AI output

- Cari requestId yang sama, lalu END.failureStage. Log beberapa request dapat interleave tanpa mencampur identitas.
- NO_UPSTREAM_HTTP_RESPONSE muncul pada failure tanpa respons, bukan pada setiap transport STARTED. causeCode membedakan DNS, TLS, socket atau timeout bila SDK mempertahankannya.
- UPSTREAM_HTTP dengan status nyata berarti ada respons. Status200 yang kemudian gagal decoding SDK dicatat sebagai INTERACTION_RESPONSE, bukan diklaim Google mengembalikan HTTP error.
- Interaction completed hanya membuktikan envelope selesai. JSON_PARSE, ZOD_VALIDATION, DOMAIN_VALIDATION dan PERSISTENCE harus diperiksa terpisah.
- Zod mencatat issueCount, path, code, expected type atau minimum/maximum constraint dan actualType. Tidak ada offending value atau custom message mentah.
- DOMAIN_VALIDATION:REJECTED dapat bersifat parsial. Lihat accepted/rejected counts dan result akhir; jangan menyebut setiap penolakan alternatif sebagai request gagal.
- IDEMPOTENCY failed + SDK_REQUEST SKIPPED berarti mengembalikan failed turn tersimpan. Respons503 cepat tidak membuktikan Gemini dipanggil pada request itu.

## 8. Testing results

- npm.cmd run test:unit: **480 tests,22 files lulus**, termasuk route/SDK aktual dengan HTTP/auth/repository mock.
- tsc --noEmit --incremental false: lulus.
- ESLint12 file kode/test terkait: lulus.
- npm.cmd run build: lulus dengan GEMINI_DEBUG lokal true; NODE_ENV production tetap menonaktifkan verbose. Formatter tambahan tidak terpasang; tidak menambah dependency.
- Coverage: initialization, request construction, SDK rejection before transport, UND_ERR_CONNECT_TIMEOUT, DNS, TLS, upstream400/401/403/429/500, success, incomplete, refusal, invalid JSON, Zod, domain, persistence, no response, nested/cyclic causes, redaction, concurrent trace IDs, production/flag-off, completed/failed idempotency replay.
- Tidak menjalankan live Bruno/DB integration scripts atau real Gemini inference. Tes mocked bukan bukti inference berhasil. Tidak melakukan commit/push/deploy/reset.

## 9. Exact next steps in Bruno

1. Gunakan devserver Campaign Lab yang sama pada port3000. Restart proses itu bila perubahan source/environment belum termuat. Flag lokal sudah true; pastikan server dijalankan lewat development, bukan production start.
2. Login/read session seperti biasa. GET ulang version/contextHash terkini. Create/read session tidak memanggil generation; jangan Run All koleksi dalam mode Gemini.
3. Periksa status turn lama lewat GET session terlebih dahulu. Jangan memakai POST sebagai probe bebas biaya: bila key belum recorded, ia dapat memulai inference. Bila request berizin ternyata merupakan replay, terminal menunjukkan claimStatus dan SDK_REQUEST:SKIPPED; itu bukan percobaan provider baru.
4. **Generation baru tetap memerlukan persetujuan Anda tersendiri.** Setelah menyetujui satu panggilan, gunakan requestKey baru, expectedVersion/contextHash terbaru, scenario netral/diomit, dan aktifkan guard Bruno confirmRealGemini/allowPaidRequests sesuai panduan. Kirim sekali; SDK route tetap1 attempt/retries:none. Timeout Bruno setidaknya90detik untuk deadline aplikasi60detik.
5. Baca seluruh [GEMINI_DEBUG] dengan requestId sama dan baris END. Bagikan hanya log ter-redaksi tersebut; bukan cookie, token, key, raw headers atau seluruh body. Jika hasil SDK tidak menyediakan alasan teknis, kategori bisa tetap UNCLASSIFIED; jangan menebak root cause.
6. Setelah selesai, set GEMINI_DEBUG=false dan reload/restart devserver yang sama. Jangan mengubah model/schema/guard untuk menyamarkan failure.

Penyebab asli response210ms belum diverifikasi lewat inference baru. Instrumentasi ini membuat bukti aktual tersedia pada percobaan manual berikutnya tanpa mengubah kontrak aplikasi.
