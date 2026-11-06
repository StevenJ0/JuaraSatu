# Blueprint Gemini: Interaction ID nullable

5 November2026, Asia/Jakarta. Perubahan hanya kontrak metadata provider Blueprint. Tidak ada generation Gemini nyata, retry baru, migration atau reset.

## 1. Root cause

Shared adapter sudah menerima completed/store:false tanpa interaction.id dan mengembalikan requestId:null. Blueprint masih menolaknya pada:
- configuredBlueprintProvider().generate(): guard response.requestId === null → INVALID_RESPONSE/502.
- GeminiBlueprintResultSchema: providerRequestId harus string.
- CampaignBlueprintSchema: string opsional, tetapi refinement Gemini mengharuskan nilai truthy.
- generateBlueprint(): tipe provenance string.
- Assertion Bruno real Blueprint: providerRequestId harus truthy.

Reference/SDK upstream menandai ID wajib, tetapi omission store:false juga direproduksi Google pada [issue1281](https://github.com/googleapis/java-genai/issues/1281). Tidak ada ID palsu atau substitusi dari UUID internal.

## 2. Provenance decision

Nullable aman untuk metadata ini:
- ID Google tidak dipakai oleh FK, ownership, transaksi, approval, context binding, atau replay.
- Identitas Blueprint tetap row.id/revision.requestId internal, dengan requestHash, campaignId/businessId/preorderId dan version/parent version.
- Source tetap generationId/messageId/proposalHash/proposalVersion/sessionId; source_ai_generation_id mengacu pada generation Strategist asal, bukan menyamar sebagai interaction ID Blueprint Google.
- contextHash dan sourceVersions tetap diverifikasi sebelum/sesudah provider dan pada RPC.
- provider/model, status synthetic, waktu source proposal dan waktu penyimpanan database created_at tetap dipertahankan. Tidak menambahkan klaim timestamp generation Google baru.
- Audit internal tetap tersedia. ID null berarti korelasi menggunakan ID Google tidak tersedia; ini bukan bukti verifikasi independen ke Google.

Schema existing campaign_blueprints menyimpan blueprint_json sebagai JSONB object NOT NULL. Generated NonNullable<Json> melarang null pada keseluruhan kolom, tetapi mendukung null di field nested. SQL/RPC tidak mensyaratkan providerRequestId. Unique key, FK, RLS, owner checks dan request hash tidak berubah. Tidak perlu mengubah database types, repository atau migration.

## 3. Changes

- [contracts.ts](../../src/features/campaign-blueprint/contracts.ts): GeminiBlueprintResultSchema.providerRequestId menjadi string|null wajib; CampaignBlueprintSchema menerima null tetapi tetap mewajibkan field eksplisit serta model untuk Gemini. Fake tetap harus tanpa metadata tersebut. String kosong/angka/terlalu panjang tetap ditolak.
- [gemini.server.ts](../../src/features/campaign-blueprint/gemini.server.ts): hapus guard null; response.requestId diteruskan apa adanya.
- [blueprint-service.ts](../../src/features/campaign-blueprint/blueprint-service.ts): tipe provenance menjadi string|null.
- [Bruno real Blueprint](../../bruno/campaign-lab/10-Real-Gemini/02-Generate-real-blueprint.bru): assertion menerima ID valid atau null eksplisit; undefined/malformed tetap ditolak.
- [gemini-development.test.ts](../../tests/unit/gemini-development.test.ts), [campaign-blueprint.test.ts](../../tests/unit/campaign-blueprint.test.ts), dan [integration provenance](../../tests/integration/blueprint-provider-provenance.test.ts): regression coverage.

Alur tetap: blueprintPost → auth/Origin/body → workflow.create/revise → source selection/replay → generateBlueprint → configured Gemini provider → shared adapter/SDK → JSON/Zod/domain + context recheck → repository.create/revise → atomic RPC → load dan response. Null adalah metadata hasil provider; tidak dikirim sebagai ID internal atau diisi ke requestKey.

## 4. Tests

- Dua regression tests null gagal sebelum perubahan, sesuai lokasi guard/schema.
- **502 unit tests /23 files passed**: completed dengan/tanpa ID, interaction ID malformed, incomplete/refused, JSON invalid, caption/domain validation, metadata Gemini wajib/Fake absent.
- **3 integration tests passed**: SDK aktual + HTTP mock + workflow dan repository aktual dengan Supabase transport mock. Valid/null melewati serialisasi RPC dan reload; sumber/context/request hash tetap ada; replay memanggil provider/RPC sekali; payload conflict ditolak; JSON invalid tidak mencapai write.
- Gabungan: **505 tests /24 files passed**.
- Typecheck, ESLint seluruh repository, Next production build: passed.
- Integration PostgreSQL existing dicoba, tetapi dua kasus terhenti sebelum RPC: fixture preorder lama tidak terlihat/tersedia untuk akun test. Pencarian source demo aktif melalui JWT test juga kosong. Tidak memperbaiki data/ownership/schema demi test. Penambahan sementara pada suite lama dikembalikan; suite asli dipertahankan.
- Dengan demikian roundtrip SQL nyata belum terverifikasi; constraint/RPC diperiksa dari migration, sedangkan persistence flow diuji melalui transport mock.
- Hash27 file protected environment/schema/database dan seluruh552 dependency versions tidak berubah. Tidak ada data campaign yang ditulis oleh percobaan PostgreSQL yang gagal.

## 5. Remaining risks

Upstream503 tidak ditangani oleh perubahan ini. Completed response masih dapat gagal bila JSON/domain/window/context invalid, atau output terpotong. Inference Google dan persistence E2E nyata belum diuji; fixture akun/preorder integration perlu ditinjau terpisah. Tidak ada automatic fallback/retry atau perubahan prompt/model/pricing.

## 6. Bruno retest

1. Restart satu devserver; pertahankan Gemini model/environment existing.
2. Login owner dan GET /api/dev/blueprints?sessionId=... untuk selection eligible. GET campaignId lama untuk memastikan apakah attempt sebelumnya sudah tersimpan.
3. Jika campaign tidak ada dan request lama sudah selesai, satu generation berizin dapat memakai campaignId sama + requestId baru. Jika sudah tersimpan, gunakan hasil lama atau exact replay; jangan create dengan requestId baru.
4. Request 10-Real-Gemini/02 otomatis mengganti kedua UUID. Untuk reuse campaignId, gunakan salinan manual dengan UUID eksplisit dan guard opt-in tetap aktif. POST /api/dev/blueprints dengan action:create, selection aktual, cookie owner, Origin dan Content-Type JSON. Kirim sekali.
5. Harapkan campaign draft, Blueprint proposed, provider:gemini, model existing, providerRequestId:null bila ID tidak ada. GET history harus mempertahankan null dan source/context/request provenance. Approval/publication tetap terpisah.
6. Jika503 atau failure lain, jangan otomatis mengulang atau menghapus turn/data.

Tidak ada commit, push atau deploy.

