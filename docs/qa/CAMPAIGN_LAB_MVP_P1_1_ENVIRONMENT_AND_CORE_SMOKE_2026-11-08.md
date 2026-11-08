# Campaign Lab MVP — P1-1 Environment & Owner Core Smoke

Tanggal laporan: 8 November 2026, Asia/Jakarta. Branch `merge/ai-campaign`; HEAD `5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762`.

## A. Result

**PASS untuk P1-1.** Satu run akhir browser Chrome tanpa intervensi berhasil menjalankan login → usaha → produk/foto Storage → kapasitas → draft → publikasi preorder → reload → logout → penolakan owner asing/anon. Pemeriksaan browser tambahan memastikan nama usaha, produk setelah reload, sisa kapasitas, status, kuota dan target tampil sesuai data tersimpan.

Ini bukti real Auth/PostgREST/PostgreSQL/Storage dan existing Server Actions, bukan mock atau SQL-only. Akun sintetis dibuat melalui **real Auth Admin HTTP**, kemudian login dilakukan melalui form aplikasi. UI registrasi dan konfirmasi email **NOT EXECUTED**; tidak ada email provider yang dipanggil. Tidak mengklaim P1-2/AI, buyer/payment, atau production readiness.

## B. Environment

| Item | Aktual |
|---|---|
| Supabase project ID | `cl-mvp-72e87c9aa2bc` |
| Project/workdir baru | `C:\Users\TUF GAMING\AppData\Local\Temp\campaign-lab-mvp-72e87c9aa2bc` |
| CLI | Installed binary `node_modules/@supabase/cli-windows-x64/bin/supabase.exe`, **2.122.0**; init/start/stop help diperiksa, tidak di-upgrade |
| Docker | Local Windows named pipe `npipe:////./pipe/dockerDesktopLinuxEngine`; engine Linux Docker Desktop |
| Next app aktif | Salinan source di `D:\Project\campaign-lab-mvp-72e87c9aa2bc-app`; Next 16.4.3 dev webpack, hostname `127.0.0.1` |
| URL app/API | `http://127.0.0.1:3301` / `http://127.0.0.1:56321` |
| DB/Studio/mail sink | `127.0.0.1:56322` / `127.0.0.1:56323` / `127.0.0.1:56324`; shadow candidate 56320, pooler/analytics tidak diaktifkan |
| PostgreSQL | **17.11**, database `postgres`, container `supabase_db_cl-mvp-72e87c9aa2bc` |
| Migration | **14**, disalin dari working tree termasuk untracked; filename/SHA256 sumber–salinan MATCH. Start CLI pertama menerapkan seluruh chain otomatis; restart mempertahankan ledger, tidak mengulang migration |
| Catalog nyata | **26 tabel / 352 kolom / 50 public RPC signatures**; existing strict schema comparator menghasilkan **352 MATCH, 0 drift** |
| Security/schema | RLS aktif pada 26 tabel; anon tidak memperoleh table write; overload publish 2/4 args, claim jobs legacy/typed, ACK dan empat private function F1 tersedia |
| Storage | Bucket public `product-photos`, batas 5 MiB, tiga policy owner insert/select/delete; upload owner dan public read bytes benar-benar diuji |

Normal project `campaign-lab` tidak dipakai sebagai target app. CLI home berada di `cli-home` dalam workdir baru; tidak menyalin linked metadata, `.env.local`, akun/data/volume lama atau kredensial provider. Child environment membatasi variabel sistem dan konfigurasi instance baru. Kredensial baru disimpan privat hanya di workdir sementara, tidak di source/report/log. Signature anon JWT diverifikasi memakai secret acak baru tanpa mencetak nilainya.

**Binding:** CLI menghasilkan wildcard meskipun network memiliki opsi default loopback. Firewall efektif memiliki rule Docker inbound; itu tidak dianggap cukup. Sebelum akun uji dibuat, empat container baru yang mempublikasikan port diganti secara scoped agar HostIp **127.0.0.1**, mempertahankan volume, alias network, dan file internal Kong. Listener Windows dan Docker bindings kemudian sama-sama terverifikasi loopback. Firewall dan daemon global tidak diubah.

Resource aktif, semuanya berlabel project baru dan hanya terhubung ke `supabase_network_cl-mvp-72e87c9aa2bc`:

| Container | ID saat verifikasi |
|---|---|
| `supabase_db_cl-mvp-72e87c9aa2bc` | `c9474bd1db5d` |
| `supabase_kong_cl-mvp-72e87c9aa2bc` | `2b42b86edf4f` |
| `supabase_inbucket_cl-mvp-72e87c9aa2bc` | `2218f9b89336` |
| `supabase_studio_cl-mvp-72e87c9aa2bc` | `f84a87b906d5` |
| `supabase_pg_meta_cl-mvp-72e87c9aa2bc` | `a949af831834` |
| `supabase_storage_cl-mvp-72e87c9aa2bc` | `873b325f5c41` |
| `supabase_rest_cl-mvp-72e87c9aa2bc` | `7c5b72432313` |
| `supabase_auth_cl-mvp-72e87c9aa2bc` | `dd56af58bc53` |

Dua volume baru: `supabase_db_cl-mvp-72e87c9aa2bc`, `supabase_storage_cl-mvp-72e87c9aa2bc`. Tidak ada volume normal yang dipasang. Manifest lengkap nama/ID/mount/network/ports ada di `environment-manifest.json` dalam workdir baru. Platform dibiarkan aktif untuk tugas selanjutnya; layanan yang memiliki healthcheck sehat, PostgREST running dan HTTP berhasil.

## C. Changes Made

| File repository | Perubahan yang diperlukan |
|---|---|
| `src/lib/supabase/transport.server.ts:localSupabaseConfig` | Menggunakan URL terkonfigurasi pada port lokal berbeda. Hanya origin HTTP host literal `127.0.0.1`; menolak URL invalid, remote/host mirip, protokol lain, credentials, path non-root, query dan fragment. Invalid config tetap `SupabaseError(CONFIGURATION_ERROR, LOCAL_ONLY, 503)`. Origin dinormalisasi agar trailing slash aman. Port lama 54321 serta fallback nama publishable key tetap didukung |
| `tests/unit/local-supabase-config.test.ts` | 16 kasus valid/invalid, port lama/baru, missing config/key, typed failure, dan fallback key |
| Laporan ini | Bukti nyata dan prosedur reuse |

Tidak ada perubahan Auth/business/product/capacity/preorder logic, UI, ownership, RLS, generated types, migration, `supabase/config.toml` asli atau `.env.local`. Tidak ada dependency/objek database aplikasi baru di luar 14 migration existing.

Di luar repository hanya dibuat project/config/migration copies, salinan app, profile browser dan helper eksekusi sementara. `node_modules` app berupa junction ke dependency yang sudah terpasang; tidak ada instalasi paket baru. Salinan app pertama di `workdir\app` gagal karena webpack lintas drive C–D dan tidak dipakai lagi; app aktif pada drive D. Seluruh helper tetap terfokus pada project ID ini, bukan framework orchestration baru.

## D. Core Smoke Results

Run akhir: `owner-smoke-verified.mjs`, exit **0**, **14 kelompok PASS**; tambahan `owner-reads.mjs`, exit **0**, **4 kelompok PASS**. Browser memakai CDP Chrome lokal dan form/tombol aplikasi; tidak memalsukan response. HTTP/database readback memakai instance yang sama untuk membuktikan persistensi.

| Step | Actual request/UI action | Result | Database evidence | Status |
|---|---|---|---|---|
| Auth account/login | Real `/auth/v1/admin/users` untuk dua owner sintetis; form `/login` → `signInAction` → GoTrue | Session SSR membawa owner baru ke onboarding | Auth identity baru dan owned membership setelah onboarding | PASS |
| Anonymous access | Browser membuka `/dashboard` tanpa cookie | Dialihkan ke `/login` | Tidak ada owner mutation | PASS |
| Business | Isi kategori, profil dan pickup di `/onboarding`; submit existing `createBusinessAction` | Dashboard menampilkan `P1-1 Dapur Verified` | Business/membership persisted; readback cocok | PASS |
| Product | Form `/dashboard/products/new`, harga 25000, estimated cost 12000 | Produk tampil; reload tetap ada | Product `4ee200bd-e9cd-4bc2-ad36-9f98c3d7fb9f`, base/cost sesuai | PASS |
| Photo | Upload PNG sintetis via field file; existing optimizer dan owner Storage upload; GET public object | HTTP 200, bytes nonempty, MIME WebP | `photo_path` persisted berakhiran `.webp` | PASS |
| Capacity | Form `/dashboard/capacity/new`, owned product, tanggal 2026-11-10, total 60 | Persisted; UI total/sisa 60 sebelum orders | Capacity `f4847f54-0f25-4743-8b38-e2b848b6568f` | PASS |
| Preorder draft | Form `/dashboard/preorders/new`, target 30, quota 50, jadwal valid | Draft tersimpan dari Server Action | Preorder `44c12f52-1eb5-4b7f-82d5-1fa2a514d5c2`, status draft sebelum publish | PASS |
| Publication A3 | Klik **Terbitkan preorder**, lalu konfirmasi **Ya, terbitkan preorder** → existing action/`publish_preorder` | Status published/Dibuka | Harga frozen 25000; canonical snapshot tepat `pickup_instructions`, `public_contact`, `intake_cutoff_at`, `fulfillment_window_end_at` | PASS |
| Reload | Full browser reload detail preorder; ulang read product/dashboard/capacity | Business/product/status/target/quota tetap benar | Record published dan item yang sama dibaca dari DB baru | PASS |
| Logout | Tombol Keluar existing | Session hilang, kembali login | Real Auth logout melalui app | PASS |
| Foreign owner app | Owner B login, punya business sendiri, membuka private product/preorder A | Data A tidak ditampilkan | Tidak ada cross-owner readback/mutation | PASS |
| Foreign/anon RPC | POST `publish_preorder` dengan JWT B; ulang tanpa session | Kedua permintaan ditolak | Preorder A tetap published milik A | PASS |
| Effective target/secrets | Browser request inventory, HTML dan seluruh script assets yang dimuat diperiksa | Hanya HTTP app/API terisolasi pada tab; service-role key tidak ditemukan di aset/HTML | Rows hasil Server Actions ditemukan pada DB baru; fingerprint DB lama tetap identik | PASS |

Business fixture akhir: `620d8079-2e76-479b-adce-756349acc452`, bukan seeded demo. Foto, daftar dan detail dibaca melalui layanan HTTP nyata. Tidak membuat pesanan/payment karena di luar P1-1.

Bukti di workdir baru: `smoke-results.json`, `reload-checks.json`, `smoke-identities.json`, `browser-network-summary.json`, `owner-ui-readback.txt`, `published-preorder.png`, `verification-summary.json`, `catalog.json`, dan manifest migration/resource. Screenshot benar-benar diambil lewat CDP; penerimaan di atas berdasarkan aksi/DOM/HTTP/DB, bukan klaim inspeksi visual screenshot.

Percobaan awal **tidak semuanya lulus**: bind ulang awal kehilangan file TLS Kong sehingga project baru direstart dengan volume tetap, lalu archive internal Kong dipertahankan saat rebind; request Auth pertama sempat terkena stale connection setelah DB restart dan retry berhasil. Script browser juga dikoreksi untuk selector form versus metadata/logout, native date events, hydration kategori, readiness redirect, nama tabel `production_capacity`, dan empat key snapshot aktual. Ini kegagalan setup/assertion awal, bukan alasan mengubah aplikasi/schema/test domain agar lolos. Run akhir memakai akun baru dan lulus tanpa bantuan manual; bukti run gagal lama bukan status akhir.

## E. Regression

| Check | Eksekusi aktual | Hasil |
|---|---|---|
| TypeScript strict | `npm.cmd run typecheck` | PASS |
| ESLint | `npm.cmd run lint` | PASS |
| Unit subset awal | `npm.cmd run test:unit -- --run tests/unit/local-supabase-config.test.ts` | PASS, **723 tests / 33 files**; script ini ikut menjalankan seluruh `tests/unit`, bukan hanya file config |
| Unit lengkap | `npm.cmd test -- --run` | PASS, **1.119 tests / 68 files**, termasuk 16 kasus config baru |
| Production build | `npm.cmd run build` | PASS; output build normal, tidak deploy/start production; `.env.local` hanya dibaca sesuai Next, tidak ditulis |
| Real catalog | Existing `catalog.sql` read-only + `verifySchemaColumns` | PASS, **352 MATCH / 0 drift**, 26 tabel/50 public RPC; RLS/grants dasar dan kontrak A1/A2/A3/F1 diperiksa |
| Real platform HTTP/browser | Run owner + UI readback pada app/DB baru | PASS seperti D |
| Specialized concurrency/AI mock/provider suites | Tidak diperlukan untuk perubahan config ini | NOT EXECUTED; angka F1 historis tidak diklaim sebagai fresh run |

## F. Safety

- Baseline **688 file**, mencakup tracked/untracked dan `.env.local`, diambil sebelum implementasi. Verifikasi akhir: **687 identik**, satu transport existing diubah, tidak ada file hilang; hanya test dan laporan ini yang ditambahkan (total 690). Perubahan lama A1–F1 dan laporan MVP sebelumnya dipertahankan.
- Fingerprint read-only data `public`, `auth`, `storage`, dan migration ledger normal sebelum/sesudah **identik**; tidak ada SQL mutation terhadap DB normal/remote. Hash dihitung dari pg_dump read-only dalam memori tanpa mencetak data.
- Seluruh **12 container normal** tetap memiliki ID/mount/network sama; waktu start container normal stabil tidak berubah. Container vector normal sudah restarting sebelum tugas dan dikecualikan hanya dari perbandingan waktu restart; tidak di-stop/restart oleh tugas ini.
- Original env/config, 14 migration SQL, generated types dan dokumen schema tidak diubah. Tidak ada reset normal, linked project, global prune, stop-all, atau pemakaian volume normal.
- Tidak memanggil Gemini, Midtrans atau provider email. App process tidak mewarisi kredensial provider. Tidak mengaktifkan AI/worker, tidak mengubah guard dev maupun ownership.
- Satu perintah pembacaan config awal ditolak automatic approval review karena berpotensi mencetak secret. Tidak dijalankan; pemeriksaan dilanjutkan melalui nama opsi/metadata dan capture privat tanpa menampilkan nilai. Tidak ada penolakan tersisa yang menghalangi hasil.
- Tidak ada commit/push/merge/rebase/reset/stash/deploy. Branch/HEAD tidak berubah.

## G. Environment Reuse

**Lingkungan aktif dan boleh dipakai P1-2.** Buka `http://127.0.0.1:3301`; kredensial akun sintetis ada hanya pada file privat `owner-verified-accounts.private.json` di workdir baru. Baca lokal bila diperlukan; jangan salin isinya ke chat, laporan atau Git. `private-env.json` dan `platform-status.private.json` juga rahasia dan tidak boleh dicetak.

App aktif adalah **salinan source**, bukan live watcher repository utama. Untuk perubahan berikutnya, implementasikan di repository utama lalu hentikan app uji dan jalankan `node <workdir>\start-app.mjs`; helper menyinkronkan source/config app dan menggunakan process env instance baru, tanpa menyalin `.env.local`. Port 3301 harus kosong sebelum start. Helper ini tidak menjalankan migration atau provider. Parent app PID tercatat di `app-process.json` (saat laporan 21792, listener child 32512); verifikasi tree/command line/port sebelum menghentikan, jangan mengandalkan PID lama setelah restart.

Safe shutdown harian yang mempertahankan data/binding:

1. Cocokkan delapan exact container ID di B/manifest dengan label `com.supabase.cli.project=cl-mvp-72e87c9aa2bc`, mount dan network. Cocokkan parent/child app dengan metadata tersebut.
2. Hentikan hanya tree app uji itu. Dengan Docker host lokal eksplisit, jalankan `docker --host npipe:////./pipe/dockerDesktopLinuxEngine stop` diikuti **delapan exact ID yang sudah diverifikasi**. Container/network/volume dipertahankan; normal stack tidak termasuk.
3. Untuk melanjutkan, start **exact DB ID** dahulu; tunggu `pg_isready`/healthy, lalu start tujuh ID lainnya dan tunggu API/Storage/Auth siap. Binding 127.0.0.1 tetap karena container yang sama dipakai kembali. Jalankan `node <workdir>\platform.mjs status` untuk capture privat; lalu `node <workdir>\start-app.mjs` bila app belum aktif. Verifikasi API 56321 dan app 3301 sebelum menulis data.

Jika harus merekonstruksi container via CLI, gunakan absolute binary di B dan `--workdir` absolut project baru. Scoped `stop --project-id cl-mvp-72e87c9aa2bc` mempertahankan volume tetapi menghapus container/network; jangan gunakan `--no-backup` untuk lingkungan sukses ini. Buat ulang hanya network project baru dengan label/opsi yang sama, lalu jalankan `node <workdir>\platform.mjs start` dan `node <workdir>\bind-loopback.mjs`. **Jangan memasukkan data sebelum binding loopback, health dan identity diverifikasi ulang.** Helper binding mempertahankan archive internal Kong dan volume; bila DB direcreate, periksa koneksi Auth/Storage/PostgREST dan restart hanya consumer project baru bila masih memakai koneksi lama. CLI start sendirian dapat kembali membuka wildcard ports.

Tidak pernah memakai `supabase stop --all`, reset normal, global Docker prune, atau menghapus volume asli. Cleanup direktori/temp resources tidak dijalankan pada lingkungan sukses; path dan ownership harus diverifikasi ulang sebelum penghapusan apa pun. Jangan hapus workdir ini karena menyimpan konfigurasi/kredensial baru yang dibutuhkan untuk reuse. Direktori temp dapat dibersihkan OS di kemudian hari; file tersebut belum dipromosikan menjadi environment permanen.

Pilihan konfigurasi mengikuti CLI help installed dan [dokumentasi konfigurasi lokal Supabase](https://supabase.com/docs/guides/local-development/cli/config); actual lifecycle/binding dibuktikan pada instance ini, tidak diasumsikan dari dokumentasi versi terbaru.

## H. Remaining Issues

Tidak ada blocker P1-1 yang tersisa. UI self-registration/mail confirmation belum diuji; akun uji dibuat lewat Auth Admin sesuai scope. Pengujian ini bukan sertifikasi seluruh auth recovery/security paths.

P1-2 masih diperlukan untuk context AI nyata; auth/session AI dev, provenance, C8, buyer/payment dan hasil campaign tetap di luar pekerjaan ini. Environment lama tetap 9-chain dan tidak cocok untuk source current. Scope awal yang gagal dan helper sementara tidak menggantikan run akhir yang lulus.

## I. Final Verdict

**YA. Owner dapat login, membuat usaha, produk dengan foto Storage, kapasitas, lalu membuat dan menerbitkan preorder pada Supabase baru yang sesuai schema.** Bukti: satu run browser akhir exit 0, real persisted rows dan canonical snapshot/harga, full reload, penolakan owner asing/anon, strict catalog MATCH, serta regression source PASS.

App: **http://127.0.0.1:3301**. Task berhenti di P1-1; P1-2 belum diimplementasikan.
