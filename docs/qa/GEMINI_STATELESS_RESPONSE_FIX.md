# Gemini INVALID_RESPONSE: stateless interaction tanpa id

Follow-up: [Blueprint nullable provenance](GEMINI_BLUEPRINT_PROVENANCE_FIX.md) kini juga mengizinkan providerRequestId:null. Batasan Blueprint wajib ID pada laporan historis di bawah sudah digantikan oleh perubahan tersebut.

5 November2026, Asia/Jakarta. Scope: POST /api/dev/discussions. Tidak ada generation/embedding atau request jaringan Google pada tugas ini.

## Root cause dan bukti

Validator `EnvelopeSchema` pada [gemini-json.server.ts](../../src/lib/ai/gemini-json.server.ts) mewajibkan `id` dari **Interaction Google**. Field tersebut bukan bagian `GeminiReplySchema`/JSON strategi dan bukan requestKey atau ID generation lokal.

Log live yang diberikan pengguna menunjukkan HTTP200, status completed dan output_text tersedia, tetapi id undefined. Reproduksi dengan **SDK2.32.0 aktual + mocked HTTP** menghasilkan gejala identik sebelum fix: INTERACTION_RESPONSE gagal pada path id, sehingga JSON strategi belum mencapai validasi use case. generatedJson=PARSED pada trace lama hanya preview diagnostik, bukan bukti validasi domain berhasil.

Kontrak upstream tidak konsisten:
- [Reference resmi Interaction](https://aistudio.google.com/api-reference/interactions-api#Resource:Interaction) dan SDK terpasang `dist/genai.d.ts` (Interaction.id) menandai id wajib.
- [Dokumentasi storage](https://ai.google.dev/gemini-api/docs/interactions-overview) menyatakan store:false menonaktifkan penyimpanan/chaining. Aplikasi memang memakai store:false.
- [Issue upstream #1281](https://github.com/googleapis/java-genai/issues/1281) melaporkan omission id untuk store:false; tim Google mengonfirmasi reproduksi. Ini bukti discrepancy layanan/kontrak, bukan perubahan resmi bahwa id selalu opsional.
- Source SDK `normalizeInteractionShape()`/`addOutputProperties()` mempertahankan field id bila ada dan menambahkan output_text dari steps; tidak menciptakan ID bila wire response tidak menyediakannya. Test SDK aktual dengan dan tanpa id membuktikan perilaku ini.

Tidak ada generation baru untuk merekam respons live. Kesimpulan didasarkan pada log pengguna, source SDK terpasang, sumber primer upstream, serta reproduksi terisolasi. Tidak mengklaim telah memeriksa raw response live yang tidak disediakan.

## Perbaikan minimal

- `EnvelopeSchema.id` menjadi opsional **untuk adapter yang selalu mengirim store:false**. Jika id diberikan, validasi string1–256 karakter tetap berlaku; null eksplisit, angka, string kosong dan terlalu panjang ditolak.
- Result adapter memakai `requestId: id ?? null`. Tidak memakai UUID lokal, header request ID, atau ID lain sebagai interaction ID.
- Strategist memakai kontrak `providerRequestId:string|null` yang **sudah ada**; tidak mengubah schema strategi/database atau business rules.
- Shared adapter juga dipakai Blueprint. [configuredBlueprintProvider()](../../src/features/campaign-blueprint/gemini.server.ts) diberi guard null eksplisit agar aturan existing yang mewajibkan ID provider tetap menghasilkan INVALID_RESPONSE/502. Blueprint stateless tanpa ID belum dapat disimpan tanpa keputusan kontrak terpisah.
- [Request Bruno Strategist](../../bruno/campaign-lab/10-Real-Gemini/01-Ask-natural-question.bru) menerima ID valid atau null eksplisit; field undefined/malformed tetap gagal assertion.

Alur: discussionPost → sendPersistentDiscussion (claim/replay) → generateCampaignStrategies → shared Gemini adapter → SDK response envelope → JSON.parse → GeminiReplySchema/domain validation → repository.completeTurn → HTTP200. Hanya metadata ID yang diselaraskan; output rusak tetap gagal dan dicatat melalui failTurn.

## Pengujian

Tiga regression tests tanpa ID gagal sebelum perubahan, sesuai log pengguna. Setelah perubahan:

- **493 unit tests /23 files passed**.
- SDK aktual + mocked HTTP: completed dengan ID valid tetap dipertahankan; completed tanpa ID dan output JSON valid diterima sebagai requestId:null.
- Mocked POST handler + SDK aktual + fake repository: strategi valid tanpa ID menghasilkan HTTP200, persisted:true, replayed:false, providerRequestId:null; JSON/Zod/domain/persistence checkpoints berhasil.
- ID malformed tetap INVALID_RESPONSE; JSON rusak tanpa ID tetap HTTP502 dengan failureStage JSON_PARSE.
- Blueprint tanpa ID tetap INVALID_RESPONSE/502 sesuai aturan provenance existing.
- Typecheck, ESLint penuh dan production build: passed, exit0.
- Preservation environment/schema/database/dependency: hash27 file protected unchanged; versi552 lock entries unchanged, tanpa dependency baru.

Test ditambahkan pada [gemini-sdk-transport.test.ts](../../tests/unit/gemini-sdk-transport.test.ts), [gemini-provider.test.ts](../../tests/unit/gemini-provider.test.ts), [gemini-debug-pipeline.test.ts](../../tests/unit/gemini-debug-pipeline.test.ts), dan [gemini-development.test.ts](../../tests/unit/gemini-development.test.ts). Persistence pada test memakai repository mock; bukan write database nyata.

## Retest Bruno

1. Restart satu devserver agar kode terbaru aktif. Pertahankan model gemini-3.6-flash dan store:false; tidak perlu mengubah environment.
2. Login sebagai owner, GET session untuk expectedVersion/contextHash terbaru. Refresh context melalui action existing bila stale.
3. Setelah izin satu generation baru, kirim request 10-Real-Gemini/01 sekali dengan requestKey baru. Failed key lama tetap replay; jangan hapus turn/reset database.
4. Harapkan INTERACTION_RESPONSE SUCCESS → JSON_PARSE/ZOD_VALIDATION/DOMAIN_VALIDATION/PERSISTENCE SUCCESS dan HTTP200 persisted:true. interactionIdHash:null/providerRequestId:null diperbolehkan jika ID tidak disediakan. Error domain/output lain tetap mungkin.
5. Jika gagal, simpan trace teredaksi; jangan otomatis mengulang. Generation nyata dan persistence E2E belum diuji pada tugas ini.

Tidak ada commit, push, deploy, reset, perubahan prompt/model, atau perubahan schema database.

