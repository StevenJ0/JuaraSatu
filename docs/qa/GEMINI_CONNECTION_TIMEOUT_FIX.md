# Gemini connection timeout — hasil investigasi dan perbaikan

Koreksi follow-up: [dispatcher hilang pada patched fetch Next.js](GEMINI_NEXT_TRANSPORT_FIX.md). Verifikasi laporan lama ini hanya membuktikan Node mandiri; belum membuktikan provider dalam active Next request context. Klaim bahwa Next selalu mempertahankan dispatcher ternyata hanya berlaku untuk URL/string + init. Reproduksi aplikasi kini membuktikan Request + init kehilangan dispatcher; perbaikannya dan tes socket30 detik ada pada laporan baru.

5 November 2026, Asia/Jakarta. Repository: `D:\Project\campaign-lab`.
Status: **FIXED — TRANSPORT VERIFIED**. HTTP transport nyata sudah diverifikasi; inference dan POST aplikasi E2E belum diuji. Semua probe menggunakan GET/HEAD tanpa kredensial nyata, tanpa generation/embedding atau retry.

## A. Root Cause

**Mekanisme yang terverifikasi:** DNS Windows kadang membutuhkan lebih dari 10 detik, sedangkan koneksi native fetch Node/Undici secara default memiliki anggaran 10 detik. `GEMINI_TIMEOUT_MS=60000` adalah deadline keseluruhan SDK/aplikasi; nilai itu tidak otomatis menaikkan batas koneksi internal fetch.

Runtime aktual: Node **v24.11.0**, embedded Undici **7.16.0**, SDK **2.32.0**, Next **16.4.3**. DNS order `verbatim`, automatic family selection aktif dengan interval attempt **250 ms**. Source [connector Undici 7.16.0](https://raw.githubusercontent.com/nodejs/undici/v7.16.0/lib/core/connect.js) menetapkan default 10000 ms; timer koneksi mencakup lookup asynchronous sebelum secureConnect. Lihat juga [Node net v24.11.0](https://nodejs.org/download/release/v24.11.0/docs/api/net.html).

Bukti independen, bukan hanya dugaan dari durasi log:

1. HEAD nyata dengan HTTPS Node dan family otomatis mencatat **lookup 11103 ms**, TCP connected pada 11167 ms, TLS pada 11220 ms, HTTP404 pada 11290 ms; sertifikat terverifikasi. Semua timing adalah kumulatif dari awal. Ini menunjukkan waktu terutama habis pada DNS sebelum koneksi, bukan generation Google. [Artifact fase jaringan](gemini-network-phases.json).
2. GET read-only melalui SDK aktual, dengan callback DNS sengaja ditunda **11200 ms** pada child process diagnostik, mereproduksi rantai asli: `APIConnectionError → ConnectionError → TypeError → ConnectTimeoutError (UND_ERR_CONNECT_TIMEOUT)`, tanpa HTTP response, satu fetch, **10833 ms**. [Sebelum fix](gemini-network-delayed-2026-11-05T05-36-59.495Z.json).
3. Probe yang sama setelah fix menerima **HTTP400 dalam 11610 ms**, satu fetch. Ini respons Google untuk key/interaction diagnostik invalid, bukan inference berhasil. [Sesudah fix](gemini-network-delayed-2026-11-05T05-38-54.238Z.json).

Delay pada poin 1 diukur nyata tanpa injeksi. Delay pada poin 2–3 adalah eksperimen terkontrol untuk menguji mekanismenya. Penyebab lebih dalam mengapa resolver Windows kadang lambat belum ditentukan; request Bruno asli tidak memiliki trace DNS per fase untuk membuktikan setiap kejadian berasal dari lookup.

Pada kegagalan yang direproduksi, fetch sudah dipanggil tetapi belum ada koneksi TLS siap untuk mengirim HTTP dan belum ada response upstream. HTTP503 berasal dari mapping aplikasi `PROVIDER_UNAVAILABLE`, bukan respons503 Google. Jangan menganggap status upstream null sebagai HTTP503 upstream.

DNS mengembalikan delapan A dan delapan AAAA; sampel IPv4 dan IPv6 keduanya mencapai Google dengan TLS valid. Tidak ada bukti untuk menyalahkan IPv6 atau mengubah family selection. Tidak semua 16 alamat diuji satu per satu.

Proxy environment yang relevan tidak ditemukan; WinINET proxy/PAC nonaktif dan WinHTTP direct. Curl tidak memperlihatkan CONNECT proxy. Tidak ada bukti jalur proxy berbeda sebagai penyebab. Firewall Windows aktif, tidak ditemukan rule aplikasi outbound Node eksplisit; ini tidak mengecualikan rule umum atau software keamanan lain. Adapter aktif Wi-Fi, VMware dan Hyper-V terdeteksi; tidak terlihat adapter VPN yang jelas. Route utama Wi-Fi tetap dipertahankan. Tidak ada perubahan OS DNS, proxy, firewall, route, VPN atau trust store.

## B. Fix Implemented

| File / fungsi | Perubahan |
| --- | --- |
| [gemini-fetch.server.ts](../../src/lib/ai/gemini-fetch.server.ts), `geminiFetch()` | Satu Agent lazy/reused, `connect.timeout=30000`, hanya origin HTTPS Google Gemini. Native fetch dan AbortSignal caller tetap dipakai. |
| [gemini-json.server.ts](../../src/lib/ai/gemini-json.server.ts), `createGeminiJsonProvider()` | Custom `httpOptions.fetch` SDK yang sudah ada meneruskan request ke helper; checkpoint konfigurasi mencatat connection budget. |
| [gemini-debug.server.ts](../../src/lib/ai/gemini-debug.server.ts), `safeDetails()` | Allowlist angka `connectTimeoutMs`, tanpa logging body/header/secret. |
| package.json / package-lock.json | Tambah satu dependency exact `undici@7.30.1`, menyediakan public Agent API untuk native fetch. SDK tidak diganti. |
| [gemini-fetch.test.ts](../../tests/unit/gemini-fetch.test.ts) | Empat test isolasi origin, reuse, preservation request/signal, propagation tanpa retry/global mutation. |
| [gemini-sdk-transport.test.ts](../../tests/unit/gemini-sdk-transport.test.ts) | Memastikan SDK aktual meneruskan dispatcher. |
| [diagnose-gemini-network.mjs](../../scripts/diagnose-gemini-network.mjs) | Harness GET/HEAD terbatas, fresh Node processes, default/IPv4-preferred/IPv4-only/IPv6-only/SDK/curl, optional controlled DNS delay. |
| Dokumen QA terkait | Tautan laporan dan instruksi Bruno terbaru. |

Ini memperbaiki anggaran koneksi yang lebih pendek daripada keterlambatan DNS terukur, tanpa hardcode IP atau memaksa IPv4. Konfigurasi route tetap satu attempt, SDK `retries.strategy=none`, deadline total tetap **60000 ms**, TLS verification tetap aktif. Origin lain tidak menerima dispatcher ini. Tidak ada `setGlobalDispatcher`, perubahan global DNS order atau retry baru.

Node tidak menyediakan export Agent dari embedded Undici; dependency diperlukan untuk konfigurasi dispatcher melalui public API. Paket terpasang mendukung Node >=20.18.1, kompatibel dengan runtime aktual. [Dokumentasi Agent](https://raw.githubusercontent.com/nodejs/undici/v7.16.0/docs/docs/api/Agent.md) dan [custom dispatcher native fetch](https://nodejs.org/api/globals.html#custom-dispatcher).

Parameter `interactions.create`/JSON Schema tidak berubah. SDK terpasang meneruskan `httpOptions.fetch`; Next patch-fetch mempertahankan properti dispatcher saat menyalin init. Native fetch yang sama dipakai untuk wire transport; error HTTP kemudian dibungkus SDK. Pemakaian SDK default juga diuji terpisah.

### Jalur E2E yang dipertahankan

`POST /api/dev/discussions` masuk ke re-export route → [discussionPost()](../../src/features/campaign-strategist/discussion-api.server.ts) → authentication dan Origin guard → body/ActionSchema → ownership session → [configuredDiscussionProvider()](../../src/features/campaign-strategist/configured-provider.server.ts) → [sendPersistentDiscussion()](../../src/features/campaign-strategist/persistent-discussion-service.ts) → repository load/beginTurn → [generateCampaignStrategies()](../../src/features/campaign-strategist/strategy-service.ts) → [createGeminiStrategyProvider()](../../src/features/campaign-strategist/gemini.server.ts) → shared `createGeminiJsonProvider().generate()` → `client.interactions.create()` → SDK custom fetch → `geminiFetch()` → Google HTTPS.

Completed envelope melewati JSON/Zod/domain validation, lalu repository.completeTurn dan HTTP200. Provider error melewati safe diagnostics/error mapping; failTurn mencatat kegagalan dan aplikasi mengembalikan kode/status existing. Upstream HTTP status dipertahankan pada diagnostik jika tersedia; response publik tidak diubah. Key gagal yang sama tetap direplay tanpa generation baru. Tidak ada penghapusan turn, perubahan transaksi, schema, RLS, business rule, model atau prompt.

## C. Verification Results

Baseline valid: [9 perbandingan jaringan](gemini-network-baseline-2026-11-05T05-31-27.115Z.json).

| Pemeriksaan nyata | Hasil |
| --- | --- |
| DNS | A/AAAA tersedia; lookup otomatis pernah 11103 ms, probe sesudahnya 1–3 ms. |
| Node native fetch GET tanpa auth | HTTP403, 207 ms. |
| Node IPv4-preferred fetch GET | HTTP403, 169 ms; keberhasilan ini tidak membuktikan IPv6 rusak. |
| Node HTTPS IPv4-only HEAD | HTTP404, 283 ms; TLS terverifikasi. |
| Node HTTPS IPv6-only HEAD | HTTP404, 121 ms; TLS terverifikasi. |
| SDK custom fetch baseline GET | HTTP400, 388 ms. |
| SDK default transport GET | HTTP400, 446 ms. |
| Windows curl default / IPv4 / IPv6 HEAD | HTTP404 dalam 151 / 202 / 199 ms. |
| Controlled DNS 11200 ms sebelum → sesudah | Connect timeout 10833 ms → HTTP400 11610 ms. |
| SDK + helper sesudah fix, lima proses baru | **5/5 HTTP400**, 667 / 399 / 398 / 505 / 416 ms, satu fetch per proses. |

[Artifact lima proses](gemini-network-verify-2026-11-05T05-39-11.990Z.json). SDK read-only memakai `interactions.get` dengan ID nonexistent dan key dummy literal. Status400/403/404 membuktikan koneksi/HTTP saja; bukan izin generation, kuota atau output valid.

| Pemeriksaan kode | Hasil |
| --- | --- |
| `npm.cmd run test:unit` | **484 tests, 23 files passed**, termasuk SDK/error/status/redaction/deadline/idempotency replay dan empat test helper baru. |
| `node_modules\.bin\tsc.cmd --noEmit --incremental false` | Passed, exit0. |
| ESLint enam file terkait | Passed, exit0. |
| `npm.cmd run lint` | Passed, exit0 (seluruh repository). |
| `npm.cmd run build` | Next production build passed, exit0. |
| Preservation hash | **27 file environment/schema/database unchanged**. Seluruh **551 lock entries lama** mempertahankan versinya; satu paket baru Undici. |
| Live POST/database integration | Tidak dijalankan: tidak diperlukan untuk transport dan dapat memanggil generation/mengubah data. |

Probe dibatasi maksimal15 request per standard run, 9 quick, 5 verify atau 1 delayed; child SDK maksimal satu fetch, fixed Google origin, GET/HEAD saja. Tidak menggunakan API key asli atau mencetak env values, prompt, raw provider response, token/cookie. File JSON hanya metadata aman.

Catatan harness: dua run awal memiliki bug diagnostik, bukan bukti network failure. Forced `process.exit` setelah respons pada Windows memicu libuv assertion; diganti natural exit. Field curl `http_connect=000` semula menghasilkan JSON numerik invalid; sekarang string. Artifact awal [05-27-46](gemini-network-baseline-2026-11-05T05-27-46.879Z.json) dan [05-30-55](gemini-network-baseline-2026-11-05T05-30-55.494Z.json) dipertahankan untuk transparansi dan **tidak dipakai sebagai baseline kesimpulan**.

Untuk mengulang pemeriksaan tanpa generation, dari root Campaign Lab: `node scripts/diagnose-gemini-network.mjs --verify` (5 GET). `--quick` membandingkan sembilan probe. `--delayed` hanya satu GET dengan DNS delay child process; tidak mengubah konfigurasi Windows. Ini bukan automatic retry aplikasi.

## D. Remaining Risks

- **Inference nyata belum diverifikasi.** SDK read-only di luar Next route + mock pipeline + build tidak membuktikan live POST, output model, billing/quota atau persistence E2E.
- Penyebab resolver Windows lambat belum dihilangkan. DNS/connect lebih dari30 detik atau gangguan jaringan lain masih bisa gagal; total request dibatasi60 detik.
- Sampel IPv4/IPv6 dan lima proses adalah satu jendela observasi, bukan SLA atau audit seluruh alamat/rule firewall. Perubahan proxy/VPN/jaringan masa depan perlu diagnosis baru.
- Satu dependency baru harus ikut deployment install. Tidak ada commit, push, deploy, reset database atau generation dalam tugas ini.

## E. Exact Bruno Retest Instructions

**Jalankan generation hanya setelah ada izin baru untuk satu percobaan.** Siapkan read-only checks dahulu; jangan Run All atau mengulang otomatis. Port3000 belum mempunyai listener saat pemeriksaan terakhir, sehingga tidak diklaim sudah siap menerima request. Mulai/restart satu devserver yang dipakai dengan `npm.cmd run dev -- --port 3000`.

Environment server yang tetap dipakai:

```dotenv
CAMPAIGN_DISCUSSION_PROVIDER=gemini
CAMPAIGN_DISCUSSION_CONTEXT=seeded
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_MS=60000
GEMINI_DEBUG=true
# GEMINI_API_KEY tetap server-only; jangan disalin ke Bruno/log.
```

1. Bruno `baseUrl=http://localhost:3000`, gunakan owner login/cookie yang valid untuk session. `confirmFakeProviders=false`, `confirmRealGemini=true`, `allowMutations=true`; tetap `allowPaidRequests=false` selama persiapan.
2. Existing session boleh dipakai. GET `http://localhost:3000/api/dev/discussions?sessionId={{sessionId}}` untuk version/hash aktual. Jika context telah berubah, gunakan 03-AI-Strategist/15-Refresh-current-context lalu GET kembali. Jangan memperbaiki dengan SQL/reset. Isikan `expectedVersion` numerik dan `discussionHash` dari state terbaru.
3. Setelah izin satu generation: `allowPaidRequests=true`, pilih `10-Real-Gemini/01-Ask-natural-question`; timeout90000 ms. Pre-script request tersebut membuat UUID baru setiap Send. **Key gagal lama tetap replay; jangan hapus turn.**
4. Kirim **sekali**: **POST `http://localhost:3000/api/dev/discussions`**. Headers: `Content-Type: application/json`, `Origin: http://localhost:3000`, cookie owner dari login. Kredensial tetap Secret Variables/cookie jar.
5. Body (Bruno harus menginterpolasi placeholder sebelum kirim):

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

6. Periksa log satu correlation ID: configuration `connectTimeoutMs:30000`/`timeoutMs:60000` → TRANSPORT → UPSTREAM_HTTP. Respons HTTP Google saja belum cukup: keberhasilan memerlukan completed interaction, JSON/Zod/domain valid, persistence berhasil, dan HTTP200 dengan `success:true`, `persisted:true`, `replayed:false`, model Gemini dan providerRequestId.
7. Jika gagal, simpan hanya diagnostik aman dan response code; **jangan klik Send lagi**. Set `allowPaidRequests=false`. GET session untuk state terbaru tanpa generation. Tidak ada fallback Fake.

## F. Final Status

**FIXED — TRANSPORT VERIFIED**

Transport SDK nyata sudah menerima respons Google lima kali dan melewati DNS delay yang sebelumnya mereproduksi error asli. Status ini khusus perbaikan batas koneksi; real Gemini generation dan E2E aplikasi masih menunggu satu retest berizin.

