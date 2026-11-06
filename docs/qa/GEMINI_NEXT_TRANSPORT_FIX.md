# Gemini: dispatcher hilang pada patched fetch Next.js

5 November 2026, Asia/Jakarta. Status: **FIXED — APPLICATION TRANSPORT VERIFIED**.
Generation Gemini nyata, live POST Bruno dan persistence E2E belum dijalankan.

## Root cause yang terbukti

Perbaikan Agent sebelumnya membentuk `fetch(Request, { dispatcher: agent30s })`. SDK memang memanggil helper itu; masalah terjadi **sesudah helper**, di patched fetch **Next.js16.4.3** pada request context aktif.

Urutan source terpasang:

1. `@google/genai@2.32.0`, `dist/node/index.mjs:13814`: `getFetch()` mengambil `httpOptions.fetch`.
2. `buildGoogleGenAIClient():26144` membuat `HTTPClient({fetcher})`. Interactions memakai generated HTTPClient, bukan langsung legacy models transport.
3. `toGoogleGenAIRequestOptions():26370` menerima `fetchOptions` dan `fetch_options`; alias camelCase yang dipakai aplikasi valid.
4. `_createRequest():21650` membentuk `Request`, `_do()` melakukan clone, dan `HTTPClient.request():20672` memanggil `this.fetcher(req)` **tanpa init kedua**. Helper aplikasi menambahkan dispatcher pada titik ini.
5. `next/dist/server/lib/patch-fetch.js:310–321`: ketika input adalah Request dan ada init, Next menggabungkannya melalui `new Request(input, overrides)`, lalu mengosongkan init selain metadata Next. Dispatcher kini tersimpan secara opaque di Request.
6. `patch-fetch.js:646–673`: `doOriginalFetch()` membangun Request baru dari URL dan daftar field standar. Daftar tersebut tidak memuat dispatcher. Properti internal dispatcher ikut hilang.
7. Origin/native fetch menggunakan dispatcher global, dengan connect timeout bawaan10 detik. Agent Gemini30 detik **tidak dipanggil**.

Sumber primer: [Next.js16.4.3 patch-fetch](https://raw.githubusercontent.com/vercel/next.js/v16.4.3/packages/next/src/server/lib/patch-fetch.ts), [Undici7.16.0 Request](https://raw.githubusercontent.com/nodejs/undici/v7.16.0/lib/web/fetch/request.js), [connector default10 detik](https://raw.githubusercontent.com/nodejs/undici/v7.16.0/lib/core/connect.js). Source SDK terpasang diperiksa langsung; bukan asumsi dari interface SDK.

Ini menjelaskan perbedaan probe terdahulu: tanpa active Next work store, patched fetch mengambil jalur awal langsung ke origin. Spread init di bagian akhir Next memang mempertahankan dispatcher untuk URL/string, tetapi **tidak cukup untuk Request yang sebelumnya sudah dinormalisasi**. Laporan sebelumnya melewatkan cabang ini.

Pergantian model tidak memperbaiki masalah transport tersebut. `timeout_ms=60000` dan signal aplikasi tetap membatasi keseluruhan call, tetapi tidak mengganti connect timeout dispatcher global. Tidak ada bukti bahwa dispatcher Undici7.30.1 tidak kompatibel dengan native fetch embedded Undici7.16.0: setelah diteruskan dengan benar, keduanya bekerja bersama.

DNS lambat yang tercatat pada investigasi terdahulu tetap fakta jaringan terpisah. Hilangnya dispatcher di Next adalah penyebab terverifikasi mengapa budget30 detik sebelumnya **tidak berlaku pada jalur aplikasi**. Penyebab dasar resolver Windows kadang lambat belum ditentukan.

## Perubahan minimal

| File/fungsi | Perubahan |
| --- | --- |
| [gemini-fetch.server.ts](../../src/lib/ai/gemini-fetch.server.ts), `geminiFetch()` | Untuk Request Gemini, meneruskan **URL string + init** berisi method/header/body/signal dan field standar Request, kemudian dispatcher. Next tidak memasuki cabang cloning Request yang menghilangkan dispatcher. |
| [gemini-json.server.ts](../../src/lib/ai/gemini-json.server.ts), `createGeminiJsonProvider()` | Memberi callback diagnostik hanya ketika debug aktif. Callback berjalan saat adapter dispatcher mendelegasikan ke Agent sebenarnya. |
| [gemini-debug.server.ts](../../src/lib/ai/gemini-debug.server.ts), `safeDetails()` | Allowlist boolean `dispatcherInvoked`. Tidak mencetak request/response body, header atau credential. |
| [gemini-fetch.test.ts](../../tests/unit/gemini-fetch.test.ts) / [gemini-sdk-transport.test.ts](../../tests/unit/gemini-sdk-transport.test.ts) | Assertion menyesuaikan URL+init dan memeriksa body, method, schema, header/signal dan propagation tetap benar. |
| [gemini-transport.test.ts](../../tests/integration/gemini-transport.test.ts) | Provider terkonfigurasi + SDK aktual + patched fetch Next terpasang + socket TLS nyata; dua tes lokal dan satu GET metadata opt-in. |
| [gemini-debug.test.ts](../../tests/unit/gemini-debug.test.ts) | Memverifikasi boolean dispatcherInvoked/budget tercatat tanpa secret. |
| [fixture TLS](../../tests/fixtures/gemini-transport/README.md) | Sertifikat/key publik khusus loopback test, bukan credential aplikasi. CA dipercaya hanya pada socket test; hostname tetap diverifikasi. |

Angka **30000 ms tidak dinaikkan**. Satu Agent tetap reused; SDK request tetap `retries.strategy=none`, route configuration tetap `maxAttempts:1`, total deadline60000 ms. Tidak menambah dependency, global dispatcher, family/DNS override, perubahan model/environment, prompt, JSON/Zod schema, auth, idempotency atau business rules.

Body SDK diteruskan sebagai stream dengan `duplex:"half"` yang diwajibkan native fetch. Byte konten tidak diubah; framing HTTP dapat menjadi chunked. Tidak membaca atau mencetak prompt. Origin selain Google Gemini tetap diteruskan seperti sebelumnya.

## Bukti sebelum dan sesudah

Tes lokal menjalankan `configuredDiscussionProvider("normal", env).generate()` → `createGeminiStrategyProvider()` → `createGeminiJsonProvider()` → `client.interactions.create()` → callback aplikasi → `geminiFetch()` → patched fetch Next dengan active WorkStore → native fetch → Agent/socket.

Hanya socket TLS test yang diarahkan ke127.0.0.1 dengan CA fixture dan SAN host Google. Semua prompt/key/reply test sintetis. SDK/helper/provider dan Next patch tidak dimock. Spy Agent meneruskan implementasi aslinya. Tidak ada Google POST atau generation.

| Kasus | Hasil terukur | Agent.dispatch / koneksi |
| --- | --- | --- |
| Sebelum fix, server menunda TLS11200 ms | Provider gagal pada **10609 ms**, HTTP lokal belum dikirim; regression test merah | **0 / 1** |
| Setelah fix, TLS ditunda11200 ms | Provider menerima completed interaction sintetis dalam **11251 ms**, TLS terverifikasi | **1 / 1** |
| Setelah fix, TLS tidak pernah selesai | **UND_ERR_CONNECT_TIMEOUT pada30507 ms**, upstream statusnull, tanpa HTTP lokal | **1 / 1** |
| GET metadata Google nyata, SDK models.get + Request + helper + patched Next | **HTTP200 dalam11286 ms**, satu request, callback dispatcher sekali | **1 / koneksi Google nyata** |

[Artifact pengukuran sesudah fix](gemini-next-transport-verification.json), [artifact reproduksi sebelum fix](gemini-next-transport-before.json). Dua tes socket pertama membuktikan budget efektif melewati10 detik **dan benar-benar berakhir dekat30 detik**, bukan sekadar nilai konfigurasi atau mock. Tidak memakai fake timer atau mematikan certificate verification.

GET metadata sengaja memakai key/model server yang sudah dikonfigurasi tanpa menulis environment. Pembatas probe memastikan methodGET, path metadata model, origin Google, maksimum satu request, dan SDK retry attempts1. Metadata memakai operasi SDK models yang berbeda dari Interactions; bukti jalur `interactions.create` berasal dari tes loopback provider di atas. Tidak menganggap metadata200 sebagai keberhasilan inference.

## Pemeriksaan lain

- **485 unit tests /23 files passed**.
- **3 integration tests passed**, termasuk dua tes socket dan satu metadata opt-in, total53,81 detik.
- TypeScript `--noEmit --incremental false`: passed.
- `npm.cmd run lint`: passed, seluruh repository.
- `npm.cmd run build`: passed; route discussion dan blueprint tetap dynamic.
- Preservation: hash27 file environment/schema/database unchanged; semua552 lock entries lama mempertahankan versi, tanpa paket baru pada follow-up ini.
- Tidak ada live POST Bruno, reset database, commit, push, deploy, generation atau retry otomatis.

Perintah lokal tanpa akses Google:

```powershell
node_modules/.bin/vitest.cmd run tests/integration/gemini-transport.test.ts
```

Dua tes lokal berjalan; metadata default **skipped**. Untuk mengulang GET metadata secara eksplisit:

```powershell
$env:GEMINI_METADATA_CHECK='1'
$env:GEMINI_TRANSPORT_REPORT='1'
node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/integration/gemini-transport.test.ts
```

Tidak perlu mengulang probe untuk menyelesaikan tugas ini; verifikasi di atas sudah dijalankan.

## Retest Bruno dan batasan

Restart satu Next devserver untuk memastikan build terbaru aktif. Pertahankan model/env yang dipilih pengguna dan `GEMINI_DEBUG=true`. Saat satu generation baru telah diizinkan, GET session untuk version/hash terbaru; gunakan requestKey baru. Key gagal lama tetap replay tanpa generation. Jangan menghapus failed turn atau mengulang otomatis.

Pada satu trace Bruno, cari checkpoint **TRANSPORT/STARTED dengan dispatcherInvoked:true dan connectTimeoutMs:30000**. Checkpoint ini berasal dari jalur dispatch nyata, berbeda dari PROVIDER_CONFIGURATION. Kemudian amati UPSTREAM_HTTP atau error chain. Total deadline tetap60 detik. Jika koneksi melewati30 detik, kegagalan masih mungkin dan harus dilaporkan sebagai kegagalan jaringan; jangan menutupinya dengan retry/model switch.

Kontrak E2E tetap: POST discussions → auth/Origin/input/ownership → persistent turn claim/replay → strategy provider → SDK/transport → JSON/Zod/domain validation → repository complete/fail → HTTP aplikasi. HTTP status upstream tetap dicatat bila tersedia; kode/status response publik tidak diubah.

**Batas klaim:** tes mengintegrasikan provider dan Next fetch context, bukan request autentikasi ke devserver aktual beserta database. Generation Google dan persistence E2E menunggu retest berizin. Penyebab kelambatan DNS Windows tetap belum dihilangkan.

**Status akhir: FIXED — APPLICATION TRANSPORT VERIFIED.**

