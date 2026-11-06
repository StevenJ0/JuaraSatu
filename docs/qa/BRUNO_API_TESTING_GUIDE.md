# Campaign Lab — panduan pengujian API dengan Bruno

Audit 4 November 2026, Asia/Jakarta. Koleksi: [bruno/campaign-lab](../../bruno/campaign-lab/README.md). Inventaris **setiap request**: [BRUNO_REQUEST_INVENTORY.md](BRUNO_REQUEST_INVENTORY.md). Kontrak berasal dari route, Zod, service dan tests aktual; bukan nama fitur yang dianggap otomatis memiliki endpoint.

Tambahan manual Real Gemini: [BRUNO_REAL_GEMINI.md](BRUNO_REAL_GEMINI.md). Folder10 menambah dua request opt-in biaya; koleksi kini **141 request**. Bagian workflow Fake berikut tetap untuk regression sintetis, bukan instruksi menjalankan skenario Fake terhadap server Gemini. Jangan set kedua flag konfirmasi provider sekaligus.

## 1. Hasil audit dan batas pengujian

- **6 route Next.js, 13 kombinasi method/path yang diekspor eksplisit**, semuanya `/api/dev/*`, development-only. Tidak ditemukan Server Action (`"use server"`) atau API produksi lain pada source aplikasi. Method otomatis framework bukan business handler tambahan dalam hitungan ini.
- 21 nilai `action` di lima POST bisnis. Banyak operasi GET memakai query pada route yang sama; calendar, task, content dan C3 bukan endpoint baru.
- Pricing C2, Simulator dan AI Context Builder **NOT EXPOSED VIA HTTP** sebagai modul mandiri. Tidak dibuat endpoint tambahan untuk Bruno.
- Koleksi berisi **139 request HTTP**: 135 kasus alur lokal/security, satu recovery kondisional, tiga alternatif bearer/direct Auth. Jumlah request bukan jumlah route.
- Auth/RLS/PostgreSQL nyata; strategi, evaluasi, memory dan embedding pada workflow ini memakai Fake/synthetic. Tidak ada paid Gemini call, perubahan provenance, RPC service-role dari client, order/payment palsu, reset atau remote mutation.
- Approval memory dari completion sintetis **harus ditolak**. Positive verified approval → indexing → available retrieval tetap BLOCKED oleh sumber C6/C7 yang belum tersedia. Hasil worker idle bukan keberhasilan indexing.

Bruno Desktop yang ditemukan: **4.3.0**; CLI `bru` tidak ditemukan. Native parser bawaan Desktop `@usebruno/lang 0.40.0` berhasil memparse seluruh file. HTTP smoke dijalankan oleh compatibility harness terhadap request hasil parse, **bukan eksekusi Bruno CLI atau interaksi GUI Bruno**. Validasi native syntax berbeda dari pembuktian seluruh runtime GUI.

## 2. Persiapan lokal

URL yang digunakan dan diverifikasi:

| Layanan | Alamat | Makna |
| --- | --- | --- |
| Next development | `http://localhost:3100` | Seluruh request aplikasi |
| Supabase HTTP | `http://127.0.0.1:54321` | Auth/PostgREST opsional |
| PostgreSQL | `127.0.0.1:54322` | Port SQL, **bukan HTTP URL** |

Gunakan stack Supabase lokal yang sudah ada. Jika Next belum berjalan:

```powershell
npm.cmd run dev -- --port 3100
```

Jangan menjalankan dua devserver pada cache/port yang sama. Database yang datanya masih lengkap tidak perlu seed ulang. Jika tabel public pernah dikosongkan dan login berhasil tetapi GET auth403, gunakan [pemulihan data lokal](BRUNO_DATA_RECOVERY.md); jangan reset database. Koleksi tidak membuat akun atau meminta service-role key.

Periksa mode server berikut secara privat pada konfigurasi lokal, tanpa mencetak key:

```dotenv
CAMPAIGN_DISCUSSION_PROVIDER=fake
CAMPAIGN_DISCUSSION_CONTEXT=seeded
CAMPAIGN_BLUEPRINT_PROVIDER=fake
CAMPAIGN_BLUEPRINT_APPROVAL=synthetic
CAMPAIGN_EXECUTION_MODE=synthetic
CAMPAIGN_EVALUATION_MODE=synthetic
CAMPAIGN_MEMORY_PROVIDER=fake
CAMPAIGN_MEMORY_RETRIEVAL=fake
```

GET context pun dapat memicu retrieval jika ada memory eligible dan provider server dikonfigurasi nyata. Karena itu koleksi meminta `confirmFakeProviders=true` sebelum request bisnis; jangan menyalakannya tanpa memeriksa mode di atas. Koleksi tidak mengubah `.env.local` atau model Gemini.

Siapkan/reuse preorder test terpisah yang masih berlaku:

```powershell
node scripts/prepare-campaign-execution.mjs --discussion
$fixtures = Get-Content node_modules/.cache/campaign-discussion/preorders.json -Raw | ConvertFrom-Json
$fixtures[0] | Select-Object businessId,preorderId
```

Command ini milik utilitas yang sudah ada: reuse fixture valid atau menambahkan fixture sintetis, tidak mengubah tanggal histori atau menghapus data. Isi `preorderId` dengan entri owner A. Daftar API discussion hanya memuat id/nama/status, bukan tanggal; `published` tidak membuktikan preorder belum kedaluwarsa.

Jika memakai akun pribadi sebagai owner demo A, jalankan command pemulihan dengan `--owner-a-user-id` dalam panduan pemulihan, atau tambahkan argumen yang sama pada command persiapan preorder di atas. Default command tetap mengharapkan akun fixture A resmi.

## 3. Membuka koleksi, environment dan login pertama

1. Bruno Desktop → **Open Collection** → folder `bruno/campaign-lab` yang berisi `bruno.json`.
2. Pilih environment **local**. Gunakan `baseUrl=http://localhost:3100` secara konsisten agar cookie tidak berpindah hostname.
3. Environment → **Secret Variables**: masukkan kredensial akun Auth yang saat ini menjadi owner demo A sebagai `ownerEmail` / `ownerPassword`. Setelah pemulihan dengan akun pribadi, gunakan akun pribadi tersebut. Owner B dipakai untuk negative tenant tests. Kredensial fixture resmi tersedia secara privat pada ignored `node_modules/.cache/database-v21-cutover/fixture-credentials.json`; jangan menyalinnya ke `.bru`, dokumentasi, log atau source control.
4. Set `allowAuth=true`. Kirim `00-Setup-Auth/01-Login-owner-A.bru`. Expected200 `{ "success": true }`.
5. Pastikan Bruno mengirim/menyimpan cookie. Kirim `02-Check-cookie-session.bru`. Expected200 `{ "authenticated": true }`.
6. Kirim `03-List-preorders-and-discussions.bru` setelah `confirmFakeProviders=true` dan cocokkan `preorderId` yang disiapkan.

| Variable | Isi / sumber |
| --- | --- |
| `baseUrl`, `supabaseUrl` | URL lokal nonsecret di atas |
| `ownerEmail`, `ownerPassword`, `ownerBEmail`, `ownerBPassword` | Secret Variables lokal Bruno; nilainya tidak ada pada file environment tracked |
| `supabaseAnonKey` | Secret lokal hanya untuk folder09 opsional; publishable/anon key, bukan service-role key |
| `accessToken` | Opsional: RAM melalui `bru.setVar`, atau private Secret Variable; tidak ditulis ke file |
| `preorderId` | Pilihan fixture owner A yang masih valid |
| `businessId`, `sessionId`, `generationId` | Ditangkap dari respons owner/server; businessId tidak dikirim sebagai otoritas tenant |
| `proposalVersion`, `proposalKey` | Dari GET proposals yang benar-benar tersimpan dan eligible; **tidak ada proposalId/alternativeId** |
| `campaignId`, `blueprintId`, `blueprintVersion`, `campaignVersion` | UUID dibuat untuk request baru lalu dikonfirmasi/diperbarui dari respons |
| `expectedVersion`, `discussionHash`, `blueprintHash`, `evaluationHash` | Token versi/hash aktual; GET ulang setelah perubahan |
| `expectedEvaluationIdJson`, `evaluationId` | Latest UUID/null dari evaluation response untuk CAS |
| `taskId`, `taskVersion`, `costId`, `costVersion` | Dari task/cost aktual |
| `sourceEvaluationId`, `memorySourceHash`, `memoryId`, `memoryHash` | Dari handoff dan memory tersimpan |
| `requestId`, `*Body`, `blueprintPlanJson` | Runtime: UUID baru atau payload asli khusus replay; tidak dipersist ke environment |

`vars:secret` hanya menyimpan nama variable. Bruno mengelola nilainya secara lokal; script memakai `bru.setVar`, bukan `bru.setEnvVar` yang dapat menulis file pada Bruno v4. Lihat [Secret Variables resmi](https://docs.usebruno.com/secrets-management/secret-variables) dan [perubahan v4](https://www.usebruno.com/v4-release).

### Opt-in request

| Flag, default `false` | Izin yang Anda nyalakan secara eksplisit |
| --- | --- |
| `allowAuth` | Login/logout/switch cookie akun lokal |
| `confirmFakeProviders` | Anda sudah memeriksa mode server Fake/synthetic |
| `allowMutations` | Membuat/mengubah data workflow test lokal |
| `allowNegative` | Menjalankan kasus yang sengaja menghasilkan error |
| `allowLifecycle` | Approval/publish/close/finalize eksplisit; termasuk percobaan negatif yang menyasar operasi itu |
| `allowRecovery` | Hanya recovery generation running yang benar-benar memenuhi prasyarat; bukan alur biasa |
| `allowDirectAuth` | Alternatif Supabase/bearer folder09; tidak diperlukan untuk cookie workflow |

Untuk alur sintetis berurutan folder03–08, aktifkan lima flag pertama dengan sengaja. Setelah selesai, kembalikan flag mutasi/lifecycle menjadi false. **Jangan Run All tanpa meninjau**: defaults menolak transport mutasi, sementara recovery dan bearer alternatif memang memerlukan pilihan tersendiri. Pre-script menggunakan `throw` agar perlindungan berlaku saat Send individual juga, bukan hanya runner skip.

## 4. Inventaris route aktual

Semua request aplikasi menggunakan owner cookie atau bearer valid, kecuali login dan pemeriksaan negatif yang secara eksplisit tidak terautentikasi. POST/DELETE memakai `Origin: {{baseUrl}}`; JSON body memakai `Content-Type: application/json`. Bearer tanpa Origin dapat diterima oleh boundary bisnis, tetapi jika Origin dikirim nilainya tetap harus cocok.

| Modul | Method | URL relatif ke baseUrl | Request/query | Sukses | Error utama | Availability |
| --- | --- | --- | --- | --- | --- | --- |
| Auth | POST | `/api/dev/discussions/auth` | email/password |200 `{success:true}` + cookies |400 input,401 credentials,403 Origin,404 production |dev |
| Auth | GET | `/api/dev/discussions/auth` | none |200 `{authenticated:true}` |401/403/404/503 |dev |
| Auth | DELETE | `/api/dev/discussions/auth` | none; Origin wajib |200 `{success:true}`; cookies dihapus |403 Origin,404 production |dev |
| Strategist | GET | `/api/dev/discussions` | none atau `sessionId` |200 list atau session/history/currentHash |400 UUID,401,404 foreign,503 |dev |
| Strategist | POST | `/api/dev/discussions` | action create/send/refresh/recover |200;202 running |400,401,403,404,409; provider429/502/503/504 |dev/Fake |
| Blueprint | GET | `/api/dev/blueprints` | `sessionId` atau `campaignId` wajib |200 proposals atau persisted blueprint view |400 `INVALID_BLUEPRINT`,401,404,503 |dev/Fake |
| Blueprint | POST | `/api/dev/blueprints` | create/revise/approve |200 persisted view + replay metadata |400 validation,409 version/source,502 invalid provider,503 |dev/Fake |
| Execution | GET | `/api/dev/campaigns` | none, `campaignId`, atau `preorderId` |200 list, ExecutionView, atau C3 |400,401,404,503 |dev/synthetic |
| Execution | POST | `/api/dev/campaigns` | publish/close/task |200 ExecutionView + replayed |400,401,403,404,409 lifecycle/version/conflict,503 |dev/synthetic |
| Evaluation | GET | `/api/dev/evaluations` | none atau campaignId + scenario |200 list atau EvaluationView |400,401,404,503 |dev/synthetic |
| Evaluation | POST | `/api/dev/evaluations` | create_cost/void_cost/review_costs/generate/review/finalize |200 `{replayed}` atau EvaluationView |400,401,403,404,409 CAS/source/state,503 |dev/Fake |
| Memory | GET | `/api/dev/memories` | none, campaignId, atau memoryId |200 list/handoff/MemoryView |400,401,404,503 |dev/Fake |
| Memory | POST | `/api/dev/memories` | generate/review/approve/retrieve/run_worker |200 view/history/worker result |400,401,403,404,409 eligibility/hash,502/503 |dev/Fake |

Tidak ada path parameter `[id]`, PATCH atau PUT route bisnis pada implementasi ini. Jika beberapa query selector dikirim bersama, route memiliki precedence; kirim hanya selector yang ditunjukkan request. Semua body action bersifat strict: jangan menambahkan businessId, actorUserId, authoritative KPI atau harga sebagai field baru.

Full per-request table, payload link, expected status/code, safety category dan opt-in: [BRUNO_REQUEST_INVENTORY.md](BRUNO_REQUEST_INVENTORY.md). Semua native request juga memiliki Docs berisi request pendahulu dan prasyarat variable.

## 5. Slice 1–3: batas HTTP dan pengujian yang tersedia

| Modul | Cara menguji | Yang tidak dapat dipanggil Bruno |
| --- | --- | --- |
| Pricing C2 | `tests/unit/pricing.test.ts`; dipakai strategy/blueprint server | Fungsi hitung harga/order quantity/rounding/policy mandiri |
| Simulator | `/dev/campaign-simulator`; `tests/unit/campaign-simulator.test.ts`; `node tests/browser/campaign-simulator-comparison.mjs` | simulate/compareScenarios tanpa route HTTP |
| Context Builder | `tests/unit/ai-context.test.ts`, `memory-context.test.ts`; create/load discussion dan evaluation GET secara tidak langsung | `buildBusinessContext(input)` sebagai REST endpoint |

Jalankan `npm.cmd run test:unit` untuk normal/discount, independent assumed units/spend, unknown vs zero cost, discount policy, non-stacking, capacity, numeric bounds, context hash/freshness/current-vs-hypothetical. Browser simulator memakai asumsi hipotetis, bukan prediksi permintaan. `session.contextHash` tersimpan berbeda fungsi dari `currentHash` yang mungkin null ketika producer tidak tersedia. Tidak ada API yang menerima C1/C6/C8 produksi buatan client.

## 6. Auth: cookie utama dan bearer opsional

**Tujuan:** login, membedakan identitas dari otorisasi, membuktikan isolasi owner. Endpoint/method/header terdapat pada tabel §4. Payload login:

```json
{"email":"{{ownerEmail}}","password":"{{ownerPassword}}"}
```

Login mengembalikan200 `{success:true}` dan cookies HttpOnly `campaign-lab-dev-access` / `campaign-lab-dev-refresh`. Cookie tidak dibaca melalui JavaScript response atau dipindah ke environment; Bruno cookie jar menyimpan/mengirimnya. Route GET auth membuktikan cookie berikutnya dikenali. Logout hanya menghapus cookie aplikasi, **bukan mencabut semua bearer/session GoTrue**.

Folder08 menguji logout → missing auth401, invalid bearer401 (tanpa cookie-refresh fallback), invalid credentials401, kemudian login A lagi. Setelah request owner B, ID resource A dipertahankan sehingga session/blueprint/campaign/evaluation/memory dan percobaan write memberi404 `NOT_FOUND` sesuai implementasi.

Alternatif folder09, **di luar alur cookie**:

| Method/URL | Headers/body | Response / persistence |
| --- | --- | --- |
| POST `{{supabaseUrl}}/auth/v1/token?grant_type=password` | `apikey: {{supabaseAnonKey}}`, JSON email/password akun test |200 raw Auth tokens; hanya access_token ditangkap ke RAM. Jangan capture/export refresh_token atau simpan response sebagai contoh |
| GET `{{baseUrl}}/api/dev/discussions` | `Authorization: Bearer {{accessToken}}` |200 melalui boundary aplikasi yang sama |
| GET `{{supabaseUrl}}/rest/v1/business_members?select=business_id,user_id,role&limit=1` | apikey + bearer owner |200 owner membership di bawah RLS; bukan service-role |

Tidak ada request langsung ke `approve_campaign_memory`, `claim_memory_jobs`, `complete_memory_index_job` atau RPC privileged lain. Worker dijalankan melalui aplikasi yang mengautentikasi owner dan menyimpan secret di server.

## 7. Slice 4: Persistent Discussion

**Tujuan:** strategi dan pesan tersimpan, multi-turn, hash/version, replay dan failure metadata. Route `/api/dev/discussions`, GET/POST; auth/headers §4. Urutan folder03, setelah login dan pemilihan preorder.

Create:

```json
{"action":"create","preorderId":"{{preorderId}}"}
```

Send (template Bruno; variable number tidak dikutip):

```json
{
  "action":"send","sessionId":"{{sessionId}}","requestKey":"{{requestId}}",
  "expectedVersion":{{expectedVersion}},"expectedContextHash":"{{discussionHash}}",
  "message":"Diskon unit 6 biaya 25000",
  "preferences":{"budgetCapIdr":50000,"allowDiscount":true,"channels":["whatsapp"]},
  "scenario":"discount"
}
```

| Operasi | Body fields / constraint | Respons penting / reload |
| --- | --- | --- |
| create | preorderId UUID; sessionId UUID optional | `{session:DiscussionView}`; capture id/business/preorder/version/contextHash |
| send | requestKey `[A-Za-z0-9_-]`1..128; message1..4000; version positive; hash64hex; strict preferences; scenario normal/discount/revision/failure/invalid |200 `{success:true,status:"completed",proposal,replayed,persisted:true}`;202 `{success:true,status:"running",generationId}`; failure `{success:false,code}` |
| refresh | sessionId, expectedVersion | `{session}`; retains history and advances version |
| recover | sessionId, generationId, expectedVersion | `{session}` only for actual running turn older120seconds; otherwise409 `TURN_IN_PROGRESS` |

GET without query returns `preorders`, active `sessions`, `provider:"development-fake"`, `syntheticContext:true`. GET `?sessionId=...` returns `session` with messages/generations, `currentHash`, `historicalMemory` and development metadata. Read after each send/failure to capture actual version; provider failure can persist a user message and advance version despite HTTP504/502.

Normal → revision → failure → invalid → final discount are deliberately separate turns. Replay uses the **original serialized body**, not a regenerated requestId/version. Conflicting same key yields409 `IDEMPOTENCY_CONFLICT`; new key + stale version yields409; wrong hash yields409 `STALE_CONTEXT`. Reload validates persistence. Recovery success is conditional/BLOCKED in the ordinary collection; never fake a running claim through privileged SQL.

## 8. Slice 5: persisted selection, Blueprint, revision, approval

**Tujuan:** membuat blueprint dari proposal tersimpan, merevisi dengan C2 financial checks, lalu approval yang tidak sekaligus publish. Route `/api/dev/blueprints`, GET/POST, owner auth/header §4. Jalankan folder04 setelah proposal valid terbaru.

GET `?sessionId={{sessionId}}` returns `{proposals:[{selection,title,contextHash,eligible}],currentHash}`. Script memilih actual eligible `selection`:

```json
{
  "action":"create",
  "selection":{"sessionId":"{{sessionId}}","generationId":"{{generationId}}","proposalVersion":{{proposalVersion}},"proposalKey":"{{proposalKey}}"},
  "campaignId":"{{campaignId}}","requestId":"{{requestId}}","scenario":"valid"
}
```

| Action | Fields / aturan |
| --- | --- |
| create | selection persis di atas; campaignId/requestId UUID baru; scenario valid/failure/invalid. Tidak menerima arbitrary proposal JSON |
| revise | campaignId,requestId,expectedCampaignVersion,expectedBlueprintId,expectedBlueprintVersion,edits,scenario. Parent UUID/version berpasangan |
| approve | campaignId,blueprintId,expectedBlueprintVersion,expectedCampaignVersion,confirm **true** |

Complete `edits` contoh (berasal dari active response):

```json
{
  "title":"{{blueprintTitle}}","marketingApproach":"{{marketingApproach}}",
  "discountBps":{{discountBps}},"budgetCapIdr":{{budgetCapIdr}},"targetAdditionalUnits":{{targetAdditionalUnits}},
  "startsAt":"{{startsAt}}","endsAt":"{{endsAt}}","channels":["whatsapp"],"notes":"Revisi sintetis Bruno"
}
```

Title harus sama dengan nama campaign tersimpan. Discount bps0..9999, budget integer0..1e9, target1..10000, channel whatsapp/instagram unik, notes≤500. Server tetap memeriksa policy, kapasitas, jadwal/window dan source freshness. Untuk task/caption/KPI narrative gunakan optional **complete `plan`** sesuai BlueprintPlanSchema; request `Revise-caption-using-stored-plan` mengambil seluruh actual plan dan mengubah satu caption. Tidak ada generic campaign edit PATCH atau KPI aktual yang boleh dikarang.

GET `?campaignId=...` returns `{campaign,active,history,materialized,currentHash}`. POST returns persisted view + `replayed` / `savedBlueprintId`. `active.blueprint_json` menyimpan financial calculation, executionWindow, KPI plan, tasks/contents, risiko dan provenance. Approval creates materialized tasks/contents tetapi `campaign.status` tetap `draft`. GET ulang memastikan hal ini.

Negatives: invalid UUID/body400 `INVALID_BLUEPRINT`; provider failure503 `PROVIDER_UNAVAILABLE`; invalid output502 `INVALID_BLUEPRINT`; stale/conflicting version409; publish sebelum approval409 `BLUEPRINT_NOT_APPROVED`. Source/currentHash null bukan izin melewati review. Source of truth: [contracts](../../src/features/campaign-blueprint/contracts.ts), [workflow](../../src/features/campaign-blueprint/workflow.server.ts).

## 9. Slice 6: publishing, C3, calendar, checklist dan closing

**Tujuan:** publish eksplisit dan execution state persisten. Route `/api/dev/campaigns`, GET/POST, owner/header §4; folder05 setelah blueprint approved.

```json
{
  "action":"publish","campaignId":"{{campaignId}}","blueprintId":"{{blueprintId}}",
  "expectedBlueprintVersion":{{blueprintVersion}},"expectedCampaignVersion":{{campaignVersion}},
  "expectedContextHash":"{{blueprintHash}}","confirm":true
}
```

| Request | Body/query | Respons / persyaratan |
| --- | --- | --- |
| GET list | none | `{campaigns,synthetic:true}` |
| GET detail | campaignId | ExecutionView: campaign, blueprint, frozen preorder/item, tasks, contents, calendar.days/progress, c3, eligibility, calculatedAt, synthetic |
| GET C3 | preorderId | PublishedOffer: state none/scheduled/active/expired/closed/invalid/unavailable; eligible; nullable configuration |
| POST task | action task,campaignId,blueprintId,taskId,expectedTaskVersion,completed boolean |200 ExecutionView; task must belong to published blueprint; published/closed lifecycle only |
| POST close | action close,campaignId,expectedCampaignVersion,confirm true |200 closed view; exact immediate replay supported |

Task completed/reopened is an owner checklist statement, not a social post. Caption reads/copy in UI do not require another REST action. Calendar/tasks/contents/progress are returned together, not separate URLs. Use GET after update; taskVersion advances independently. C3 active/scheduled depends on real current dates; C3 projection does not prove checkout applies campaign pricing.

Negatives: unapproved publication, wrong version, stale facts, another active campaign, expired window, invalid lifecycle and foreign owner. Collection supplies deterministic unapproved/stale/state/tenant cases; actual expired/conflicting campaigns need separate valid isolated setup or existing execution integration suite. Do not rewrite dates to force failures. Replay close **before finalization**; completed lifecycle is a later state, not another valid close replay.

## 10. Slice 7/7B: costs, evaluation CAS, review dan finalisasi

**Tujuan:** membedakan asumsi rencana, KPI sintetis, actual reported spend, review, CAS dan completion atomik. Route `/api/dev/evaluations`, GET/POST, owner/header §4; folder06 setelah campaign closed.

GET `?campaignId={{campaignId}}&scenario=exceeds_target` returns EvaluationView:
`{context,summary,measurementWindow,history,unsupportedCount,latestEvaluationId,finalization,synthetic:true}`. `context` berisi snapshot, costs, costsCompleteness, analytics dan contextHash. History entries `{row,stale,memoryExclusions}`. Row menyimpan metrics_json/analysis_json, review dan finalization audit.

Scenario GET: `exceeds_target`, `below_target`, `high_spend`, `incomplete_checklist`, `missing_cost`, `provisional`, `unavailable`. Ini fixture, bukan query untuk membuat penjualan. Attribution, pricing discount dan window paid units memiliki arti berbeda. Unavailable/missing cost tetap null, bukan nol.

```json
{
  "action":"generate","campaignId":"{{campaignId}}","requestId":"{{requestId}}",
  "expectedCampaignVersion":{{campaignVersion}},"expectedEvaluationId":{{expectedEvaluationIdJson}},
  "expectedContextHash":"{{evaluationHash}}","analyticsScenario":"exceeds_target","providerScenario":"valid"
}
```

| Action | Complete required fields selain action | Response |
| --- | --- | --- |
| create_cost | campaignId,requestId,category advertising/printing/other,description1..500,amountIdr integer0..1e9,incurredAt ISO not future | `{replayed:boolean}`; GET untuk melihat row |
| void_cost | campaignId,costId,expectedCostVersion,reason1..500 | `{replayed}`; row lama tetap ada, bukan DELETE |
| review_costs | campaignId,expectedCampaignVersion,confirm true | `{replayed}`; explicit empty ledger confirmation dapat berarti known zero |
| generate | fields pada JSON di atas; expectedEvaluationId nullable/default null; providerScenario valid/failure/invalid | EvaluationView + replayed; failed/invalid analysis juga disimpan dengan HTTP200 |
| review | campaignId,requestId,evaluationId,expectedCampaignVersion,expectedContextHash,confirm true | append-only reviewed child, bukan mengubah row lama |
| finalize | **fields sama dengan review**, action finalize | audited final snapshot + closed→completed atomik; mode development_synthetic saja |

Contoh cost:

```json
{"action":"create_cost","campaignId":"{{campaignId}}","requestId":"{{requestId}}","category":"advertising","description":"Bruno isolated synthetic expense","amountIdr":50000,"incurredAt":"{{incurredAt}}"}
```

Urutan folder06: unknown spend → confirm zero → cost → replay → void → replacement → confirm complete → KPI scenarios → saved failed/invalid interpretations → stale CAS/version/hash negatives → valid snapshot → unreviewed finalization rejection → **ubah checklist campaign ini melalui API** → stale-source review rejection → fresh evaluation → review → finalisasi sintetis → replay → reload.

Expected conflicts termasuk `STALE_EVALUATION_VERSION`, `VERSION_CONFLICT`, `STALE_CONTEXT`, `OWNER_REVIEW_REQUIRED`, `CLOSED_CAMPAIGN_REQUIRED`. Nilai `requestId` review adalah UUID child; finalisasi memakai UUID request baru, bukan mengubah evaluation parent. Setelah completed, ordinary cost/task/campaign writes ditolak; tidak ada reopen/reset request di koleksi. Final audit `mode=development_synthetic` tetap membuat memory produksi ineligible.

DTO lengkap: [evaluation contracts](../../src/features/campaign-evaluation/contracts.ts); transaksi dan batas produksi: [Slice 7B](../../src/features/campaign-evaluation/SLICE_7B.md).

## 11. Slice 8/8B: memory draft, review, eligibility dan retrieval

**Tujuan:** memory bersumber dari evaluasi yang sah, draft/audit persisten, penolakan sintetis, indexing status jujur dan cold-start. Route `/api/dev/memories`, GET/POST, owner/header §4; folder07 setelah completed final evaluation.

| GET selector | Response |
| --- | --- |
| none | `{campaigns:[{id,name,status:"completed"}],memories:[MemoryView],synthetic:true}` |
| campaignId | `{source:MemorySource|null,sourceError:string|null,memories:[MemoryView]}`; dated draft tetap terbaca saat source usang |
| memoryId | MemoryView `{row,stale,approval:{eligible,blockers},indexing:{code,canRun,job},synthetic}` |

Generate:

```json
{
  "action":"generate","campaignId":"{{campaignId}}","evaluationId":"{{sourceEvaluationId}}",
  "expectedContextHash":"{{memorySourceHash}}","requestId":"{{requestId}}","scenario":"valid"
}
```

| Action | Body tambahan | Expected |
| --- | --- | --- |
| generate | di atas; scenario valid/failure/invalid/missing_evidence |200 MemoryView + replayed; failure503, invalid/missing evidence502 sebelum draft pertama |
| review | memoryId,expectedContentHash,requestId,decision reviewed/rejected,confirm true |200; audit diperbarui, SQL status tetap draft |
| approve | memoryId,expectedContentHash,confirm true |**409 `SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN`** untuk workflow ini |
| run_worker | hanya `{action:"run_worker"}` |200 `{status:"idle",claimed:0,succeeded:0,failed:0,results:[]}` pada fixture ini; secara umum satu job maksimum |
| retrieve | query trimmed3..1200,limit optional1..5 |200 `{history:{status:"cold_start",businessId,checkedAt}}` pada fixture ini |

Approved-ready memory masa depan dapat memberi `available` dengan source references; `no_match` berarti eligible source ada tanpa hasil; `unavailable` berarti provider/DB/attestation gagal. Jangan menyebut semua kegagalan sebagai cold-start. Worker actual result juga dapat `processed` dengan per-job succeeded/failed, tetapi jalur eligible itu belum dibuktikan dari campaign sintetis.

Run provider failure cases **sebelum** candidate pertama: setelah canonical draft ada, generation retry dapat mengembalikan draft yang sama tanpa memanggil provider. Tidak ada immutable text-revision endpoint; owner review/reject/re-review didukung. Hash lama409 `MEMORY_SOURCE_CONFLICT`; genuinely stale source menolak write tetapi tetap terbaca. Pengujian source-revision memory aktual ada di integration suite, tidak membutuhkan client PATCH privileged.

Verifikasi persistence: GET memoryId setelah generate/review/reject/reload; `review_status=draft`, `indexing.job=null`, approval false, synthetic true. Vektor queued pada draft bukan bukti enqueue. Buka discussion berikutnya melalui folder03 baru untuk melihat historicalMemory cold-start tanpa mengarang citation. Source of truth: [memory contracts](../../src/features/business-memory/contracts.ts), [Slice 8B](../../src/features/business-memory/SLICE_8B.md).

## 12. Negative/security, konflik dan failure yang aman

Folder08 berakhir dengan login A lagi. Request negatif yang benar dianggap **PASS** jika status/code sesuai, termasuk404 untuk foreign resource.

| Kasus | Expected / batas |
| --- | --- |
| Missing auth setelah logout / invalid bearer / invalid login |401 UNAUTHENTICATED |
| Wrong Origin |403 FORBIDDEN, target tetap localhost |
| Invalid UUID/malformed JSON/missing fields/extra scope/unsupported enum/out-of-range |400; blueprint biasanya INVALID_BLUEPRINT, modul lain INVALID_INPUT |
| Body >16KiB (>64KiB khusus Blueprint) |400 INVALID_INPUT; ukuran diuji pada discussion tanpa data privat |
| Duplicate exact / conflicting duplicate |replayed200 /409 IDEMPOTENCY_CONFLICT; payload replay asli disimpan hanya RAM |
| Stale version/hash/source/CAS |409; tidak ada stale child/transition sukses |
| Owner B membaca/menulis ID A |404 NOT_FOUND, bukan asumsi semua denial403 |
| Completed write / invalid publication state |409 lifecycle error |
| Synthetic approval |409; memory tetap draft dan tidak ada job |
| Gemini Fake timeout/invalid |discussion504/502; blueprint503/502; evaluation200 dengan failed/invalid; memory503/502 tanpa draft sukses |

Database outage, genuine expired/conflicting publication, timed-out running recovery, verified approved retrieval dan real embedding tidak dipaksakan melalui SQL/client-side provenance edit. Lihat [BLOCKED](../../bruno/campaign-lab/BLOCKED.md) dan existing integration/SQL suites. Tidak ada concurrency guarantee yang dibuktikan hanya dengan menjalankan satu request Bruno; gunakan pengujian PostgreSQL untuk lock/lease/atomicity.

## 13. Expected responses dan contoh aktual

Respons error bisnis memakai `{ "success": false, "code": "..." }`; status mapping berbeda antar modul dan telah dicatat per request. Jangan mengasumsikan semua failure HTTP200 atau semua auth denial403.

[Contoh response aktual yang diproyeksikan](../examples/bruno-local-smoke.json) berasal dari controlled smoke: persisted strategy, approved-but-draft blueprint, synthetic completed audit, memory draft, approval409, worker idle dan cold-start. Field lain sengaja tidak disalin; ini **bukan full JSON Schema**, bukan contoh token/Auth response, dan bukan verified business results. Schema penuh tetap file Zod yang ditautkan per modul.

## 14. Validasi dan hasil eksekusi

```powershell
node scripts/validate-bruno-collection.mjs
node scripts/smoke-bruno-collection.mjs --read-only
# Explicit opt-in: creates this local synthetic workflow and seals its own campaign.
node scripts/smoke-bruno-collection.mjs --allow-local-mutations
```

Validator memakai Bruno Desktop headlessly (`ELECTRON_RUN_AS_NODE=1`) untuk native parser, tanpa membuka GUI/memasang dependency. `BRUNO_EXECUTABLE` dan `BRUNO_LANG_PATH` dapat diarahkan ke instalasi lokal lain. Jika parser tidak tersedia, validasi gagal secara eksplisit; jangan mengklaim native parse lulus dari bracket counting.

Hasil saat penyusunan:

- 139 request + environment/collection lulus native parser0.40.0; variable references, method/URL aktual, opt-in guard dan syntax scripts diperiksa.
- Auth/read-only smoke: tiga request200, tidak mengubah data bisnis.
- Controlled local smoke: **135 request passed**, menjalankan scripts hasil native parse dengan Node VM compatibility harness dan HTTP nyata. Mencakup seluruh alur dan negatif, dengan Auth/RLS/persistence nyata serta Fake providers.
- Empat request tidak dieksekusi: recovery running yang kondisional dan tiga bearer/direct Auth alternatif. Native syntax-nya diperiksa.
- **Bruno CLI tidak terpasang; eksekusi resmi CLI/GUI tetap belum diverifikasi.** Tidak ada pemasangan dependency. Cookie handling GUI perlu diverifikasi saat user menjalankan dua request Auth pertama.
- Tidak ada production-approved memory/semantic retrieval E2E atau paid Gemini test. Tidak ada source/business logic, schema atau migration yang diubah oleh tugas ini.
- Pemeriksaan aplikasi relevan: 432 unit tests, ESLint, TypeScript typecheck dan 15 production-route guards lulus. Build tidak diulang untuk perubahan koleksi/dokumentasi tanpa perubahan aplikasi; production guards memakai build lokal yang sudah tersedia.

Runtime evidence rinci di ignored `node_modules/.cache/bruno-audit/smoke-result.json`, tanpa passwords/tokens/cookies. Local example adalah projection dari response, bukan data yang dibuat untuk meluluskan assertion. Request test gagal akan menghentikan compatibility workflow, tanpa reset/delete otomatis.

Untuk coverage non-HTTP: `npm.cmd run test:unit`. Untuk atomicity/lease: existing `node scripts/test-database-v21.mjs` memakai database disposable; bukan request Bruno dengan service-role credential. Full manual UI workflow tersedia di [LOCAL_QA_SLICES_1_8.md](LOCAL_QA_SLICES_1_8.md).

## 15. Mengulang tanpa merusak data

Mulai session/campaign test baru melalui folder03–04, pertahankan histori lama. Pakai replay request hanya untuk payload aslinya; jangan mengganti UUID/version pada replay. Jangan meneruskan cost/task edits setelah finalisasi. Jika context usang, lakukan GET/refresh yang sesuai, pilih proposal current yang eligible dan review ulang. Jika preorder kedaluwarsa, siapkan fixture baru melalui utilitas yang ada; jangan memundurkan tanggal atau menurunkan validasi. Untuk kasus negatif yang memerlukan campaign draft/closed tertentu, buat workflow terpisah dan ikuti prasyarat request, bukan memakai campaign user sembarang.

Native variable/scripting references: [JavaScript API](https://github.com/usebruno/bruno-docs/blob/main/testing/script/javascript-reference.mdx), [dynamic UUID variables](https://docs.usebruno.com/testing/script/dynamic-variables), [secret handling](https://docs.usebruno.com/secrets-management/secret-variables). Installed parser fixtures were also inspected to verify actual v4.3 `.bru` syntax.
