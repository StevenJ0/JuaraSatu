# Debug Gemini PROVIDER_UNAVAILABLE

Follow-up terbaru: [root cause patched fetch Next dan perbaikan terverifikasi](GEMINI_NEXT_TRANSPORT_FIX.md). SDK memanggil helper, tetapi Next menghilangkan dispatcher ketika membangun ulang Request. Tes provider kini membuktikan connect timeout efektif30 detik.

Update transport 5 November 2026: [connection-timeout fix dan bukti SDK nyata](GEMINI_CONNECTION_TIMEOUT_FIX.md). DNS terukur11103 ms dapat melampaui connect timeout bawaan10 detik; transport dengan budget30 detik sudah diverifikasi. Penyebab request139 ms historis di bawah tetap tidak dapat direkonstruksi.

Follow-up: verbose checkpoints sekarang memakai gate `NODE_ENV=development` dan `GEMINI_DEBUG=true`. Lihat [panduan debug terbaru](GEMINI_DEBUG_LOGGING.md). Temuan dan hasil probe di bawah adalah catatan investigasi sebelumnya; bukan bukti generation terbaru.

Pemeriksaan 5 November 2026, Asia/Jakarta. Tidak ada generation/embedding nyata, fallback Fake, retry inference, perubahan model, schema, migration, RLS, environment, atau data database pada tugas ini.

## Root cause yang terbukti dan yang belum diketahui

Penyebab asli request Bruno yang gagal sekitar 139 ms **belum dapat ditentukan** dari log lama. `httpStatus:null` hanya berarti extractor lama tidak memperoleh status; itu bukan bukti Google mengembalikan HTTP503 atau request pasti gagal sebelum dikirim. Original exception/cause tidak tersimpan untuk dipulihkan. Durasi139ms sendiri tidak membuktikan DNS, TLS, timeout, billing, atau schema rejection.

Dua masalah observabilitas/mapping terbukti pada shared adapter:

1. ErrorShapeSchema lama hanya membaca status/statusCode/name terluar. SDK Interactions membungkus error berlapis, sehingga cause.code dan asal kegagalan hilang.
2. Seluruh shape ditolak bila satu field tidak cocok. Reproduksi mocked dengan status:null dan statusCode:429 sebelumnya menjadi PROVIDER_UNAVAILABLE dan statusnull. Sekarang status divalidasi sendiri: PROVIDER_RATE_LIMITED dengan httpStatus429 tetap dipertahankan.

Scope fix adalah metadata diagnostik dan ketepatan klasifikasi error, bukan klaim generation telah pulih. Nama/model/timeout/key presence valid pada konfigurasi lokal yang diperiksa; izin inference/billing/kuota dan request Bruno asli belum diuji ulang.

## Jalur aktual dan file

- src/app/api/dev/discussions/route.ts me-re-export discussionPost dari src/features/campaign-strategist/discussion-api.server.ts.
- discussionPost: authenticateDiscussion -> checkWriteOrigin -> readDiscussionBody/ActionSchema -> ownedSession -> configuredDiscussionProvider -> sendPersistentDiscussion.
- configuredDiscussionProvider memilih Gemini dari konfigurasi server; geminiConfiguration menetapkan maxAttempts:1. createGeminiStrategyProvider di gemini.server.ts mengikat GeminiReplySchema ke createGeminiJsonProvider.
- sendPersistentDiscussion memuat history dan beginTurn/idempotency. Hanya claim baru memanggil generateCampaignStrategies -> provider.generate -> client.interactions.create.
- createGeminiJsonProvider di src/lib/ai/gemini-json.server.ts membuat SDK client, mengonversi Zod ke JSON Schema, membuat request, menerima SDK result, lalu memvalidasi envelope. Exceptions melewati errorDiagnostics -> errorCode -> safe console.warn. Envelope valid tetapi status bukan completed juga mengembalikan PROVIDER_UNAVAILABLE; jalur tersebut berbeda dari exception yang menghasilkan log Gemini request failed.
- generateCampaignStrategies meneruskan failure code. sendPersistentDiscussion menandai turn failed lewat repository.failTurn; discussionPost/errorStatus memetakan PROVIDER_UNAVAILABLE menjadi HTTP503 aplikasi. Upstream status asli dipertahankan di log, bukan diteruskan mentah menjadi status HTTP aplikasi. Kontrak response/persistence tidak berubah.

Adapter juga dipakai Blueprint. Perubahan dilakukan sekali di shared adapter dan diverifikasi terhadap kedua caller; business validation dan retry/fallback policy tetap. Default generic lama dapat menerima dua attempts, tetapi konfigurasi route Gemini manual tetap satu attempt dan SDK retries strategy:none.

## Diagnostic logging aman

Log Gemini request failed sekarang berisi code/model/attempt, httpStatus, sdkStatus, sdkStatusCode, errorName, causeName, causeCode, errorChain maksimal6 level, stage, transportInvoked, responseReceived dan elapsedMs. Status valid dari cause atau HTTP response yang diamati tetap tersedia bila status SDK luar kosong/invalid. Nama error/kode teknis memakai allowlist; nilai lain UnknownError/null. Tidak ada exception.message, stack, headers, URL/query, prompt, API key, cookie, token atau raw response yang dicetak.

| Metadata | Interpretasi |
| --- | --- |
| stage=sdk_initialization/request_construction; transportInvoked=false | Gagal lokal sebelum fetch dipanggil. |
| stage=sdk_call; transportInvoked=false | Gagal di SDK sebelum callback HTTP teramati; lihat safe errorChain. |
| transportInvoked=true; responseReceived=false | SDK memanggil fetch, tetapi belum ada response headers. Cause bisa DNS/TLS/socket/abort. Ini tidak membuktikan server menerima atau tidak menerima request. |
| responseReceived=true; httpStatus terisi | Ada respons HTTP upstream; status tetap tercatat meskipun decoding SDK gagal. |
| causeCode=ENOTFOUND/EAI_AGAIN | Bukti error resolver pada attempt terkait. |
| causeCode berupa CERT_*/ERR_TLS_* yang diizinkan | Bukti error TLS pada attempt terkait; jangan menonaktifkan certificate verification. |
| httpStatus=400/401/403/404/429/5xx | Bedakan request/auth/model/quota/upstream menurut status, tanpa menebak dari HTTP503 aplikasi. |

Wrapper httpOptions.fetch hanya memanggil fetch asli dan mengamati status/tahap; tidak menyimpan payload, mengubah endpoint, atau menambah retry. AbortSignal/total deadline tetap memakai implementasi existing. Unknown names/codes sengaja tidak dicetak; allowlist dapat ditambah setelah tipe baru ditinjau aman.

## Kesesuaian SDK dan request

SDK terpasang @google/genai@2.32.0; package/lock tidak diubah. dist/node/node.d.ts dan dist/node/index.mjs mengonfirmasi model/input/system_instruction, response_format:{type:text,mime_type:application/json,schema}, generation_config.max_output_tokens, store:false, stream:false dan tools:[]. automatic_continuation:false dikonsumsi bridge SDK dan tidak dikirim sebagai field REST.

Options timeout_ms, retries:{strategy:none} dan fetchOptions.signal dikenali bridge SDK. fetchOptions merupakan alias deprecated tetapi masih dikonversi ke fetch_options; tidak ditemukan bukti parameter ini menyebabkan kegagalan. Test SDK asli memverifikasi konstruksi request Strategist sampai callback fetch, termasuk JSON Schema aktual. Itu belum membuktikan server menerima setiap constraint schema; hal tersebut membutuhkan inference yang belum diizinkan.

Referensi resmi: [Interactions API](https://aistudio.google.com/docs/interactions-overview), [structured output](https://aistudio.google.com/docs/structured-output). Kontrak versi terpasang dan test mock menjadi bukti utama adapter.

## Pemeriksaan tanpa biaya inference

| Pemeriksaan | Hasil aktual | Batas bukti |
| --- | --- | --- |
| Environment server | Provider gemini, model gemini-3.8-flash, timeout60000, key tersedia; proxy/Vertex/custom-base/debug/TLS overrides tidak terdeteksi | Tidak mencetak secret atau memverifikasi inference entitlement. |
| DNS | IPv4/IPv6 ter-resolve, 33ms | Satu pengukuran saat ini. |
| TLS | Authorized TLSv1.3, 104ms | Bukan bukti kondisi request Bruno sebelumnya. |
| GET model metadata | HTTP200, 446ms | Metadata saja. |
| SDK GET ID diagnostik tidak valid | HTTP400, 245ms; BadRequestError(status400/statusCode400) -> GetInteractionByIdClientError(statusCode400) | Request read-only SDK mencapai endpoint, bukan generation. |
| Real SDK + HTTP mocked | Request Strategist berhasil dikonstruksi; upstream403/404/429/503 dan DNS cause tertangkap; satu fetch per attempt | Tidak ada jaringan dari test. |
| Privacy/mapping | status:null tidak menghilangkan statusCode429; cyclic cause dibatasi; unknown names/codes dan raw message/body disembunyikan | Metadata saja. |
| Unit regression | 448 tests pada20 files lulus;32 tests di3 file Gemini terfokus lulus | Provider/transport mock, bukan keberhasilan Gemini nyata. |
| TypeScript | tsc --noEmit --incremental false lulus | Tidak menulis build-info baru untuk typecheck. |
| ESLint | Empat file kode/test terkait lulus | Formatter tambahan tidak terpasang. |
| Next.js build | npm run build lulus | Tidak mengirim POST generation. |

Probe awal dari sandbox tool ditolak EACCES. Probe read-only dengan izin jaringan berhasil seperti tabel; EACCES sandbox itu tidak boleh diklaim sebagai root cause Bruno. Tidak ada firewall/TLS/DNS settings yang diubah.

Integration API yang mengirim action:send tidak dijalankan karena environment aktif Gemini dan dapat memicu inference berbayar. Tidak mengganti environment menjadi Fake untuk menjalankan script tersebut. Tidak melakukan commit, push, deploy atau reset database.

## Verifikasi Bruno berikutnya

1. Pastikan devserver yang sama memuat kode terbaru dan port3000 (atau baseUrl server aktual); reload/restart bila modul belum diperbarui. Tugas ini tidak memulai instance kedua.
2. Login dan GET discussions/session untuk version/contextHash terbaru. GET tidak memanggil generation. RequestKey lama bisa mengembalikan hasil idempotensi lama tanpa memanggil adapter; failed turn tidak diulang otomatis.
3. **Hanya setelah Anda menyetujui satu generation baru**, gunakan pertanyaan/requestKey baru, expectedVersion/contextHash terbaru, scenario netral/diomit, dan guard Bruno confirmRealGemini/allowPaidRequests sesuai panduan. Kirim satu kali; jangan Run All atau auto-retry. Timeout Bruno setidaknya90detik untuk deadline aplikasi60detik.
4. Ambil hanya satu objek log Gemini request failed yang baru. errorName/errorChain/causeCode/stage/transportInvoked/responseReceived/httpStatus menunjukkan apakah failure lokal, transport, decoding, atau upstream. Respons aplikasi503 tetap generic; periksa httpStatus upstream di log.
5. Bila sukses, lanjutkan validasi proposal/provenance dan domain guards existing. Bila gagal, gunakan bukti cause/status baru untuk perbaikan spesifik, tanpa mengganti model, melonggarkan schema atau berpindah Fake.

Generation asli belum dijalankan ulang; root cause139ms dan keberhasilan inference belum diverifikasi.
