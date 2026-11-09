# Campaign Lab — T2 Checkout Intent Stability & Safe Retry

Tanggal: 9 November 2026 (WIB). Branch `feat/mvp-final-gaps`, HEAD `dbe828455874a93d30a68469065af6e192efda44` saat implementasi. Tidak ada commit.

## A. Executive Result

**PASS — perbaikan source, unit, dan SQL pada target disposable terverifikasi; browser E2E menunggu T3.** Checkout pada form yang masih aktif sekarang mempertahankan satu pasangan token privat dan kunci idempotensi ketika `sessionStorage` gagal. Penolakan biasa atau respons hilang tidak memutar identitas. Navigasi sukses tetap ke `/o/[token]`; pembelian berikutnya mendapat pasangan baru.

## B. Root Cause

Sebelumnya setiap klik **Buat pesanan** memanggil `loadCheckoutIntent(slug)`. Helper membaca `sessionStorage`; jika getter melempar, fungsi `read()` mengembalikan `null`, lalu helper membuat token dan key baru. Jika setter juga gagal, pasangan itu tidak tersimpan. Klik kedua pada form yang sama memanggil helper lagi dan mengirim pasangan berbeda. Backend C4 hanya mengenali retry dengan identitas yang sama, sehingga respons yang hilang setelah commit bisa membuat request kedua tampak seperti pesanan baru.

Alur aktual: `/p/[slug]` memuat C1 dan merender `CheckoutForm` → pembeli mengisi form dan meninjau ringkasan → `placeBuyerOrderAction` memvalidasi input serta limit → `placePublicOrder` memanggil RPC C4 dengan hash token dan key → hasil `ok` menavigasi ke halaman privat, hasil `rejected` mempertahankan form. Harga, kapasitas dan status order tetap ditentukan server/database.

## C. Implemented Changes

| File | Perubahan T2 |
|---|---|
| `src/features/public-preorder/checkout-form.tsx` | `useRef` menyimpan pasangan aktif bersama slug; efek mount memulihkan/membuat sekali. Submit memakai ref, sehingga gagal baca/tulis storage dan rerender tidak memutar pasangan. Ref kedua menahan klik tumpang tindih sampai respons gagal/ditolak. Setelah `ok`, `finishCheckoutIntent` mencatat token lama dan menyiapkan pasangan baru sebelum navigasi. |
| `src/app/p/[slug]/page.tsx` | `key={preorder.slug}` memasang form baru saat preorder berbeda, sehingga state lokal A tidak terbawa ke B. |
| `src/features/public-preorder/checkout-intent.test.ts` | Uji helper untuk restore, kerusakan storage, rotasi sukses dan pemisahan slug. |
| `tests/unit/checkout-form.test.tsx` | Uji handler komponen aktual dengan harness hook React ringan pada environment Vitest Node existing. |
| `tests/supabase/buyer-checkout.test.ts` | Uji service C4 terhadap database T1 untuk respons hilang setelah commit, replay, satu order/hold dan token privat. |

Helper `checkout-intent.ts` tidak perlu diubah: ia tetap menyediakan token acak Web Crypto 32 byte, UUID key, validasi storage dan rotasi setelah sukses. Perbaikan ada pada masa hidup pasangan di komponen, bukan pada generator.

## D. Retry Lifecycle

1. Saat form mount, pasangan valid dipulihkan dari storage per slug atau dibuat sekali. Jika storage tak tersedia, ref komponen tetap menyimpannya.
2. Submit pertama dan setiap retry membaca ref yang sama. Getter/setter storage yang melempar, konten storage yang kemudian rusak, serta rerender tidak mengubah pasangan aktif.
3. Guard sinkron menolak klik kedua selama permintaan pertama belum selesai. Ini guard UX; idempotensi transaksional tetap di C4.
4. Respons `rejected` atau exception/response lost melepas guard untuk retry sambil mempertahankan pasangan. Penolakan validasi/harga/kapasitas tetap menampilkan pesan dan perilaku refresh yang sudah ada.
5. Hanya hasil `ok` dari server memanggil `finishCheckoutIntent`, menyimpan tautan token terakhir, menyiapkan pasangan baru, lalu `router.push('/o/' + token asli)`. Guard tetap aktif sampai navigasi memasang halaman lain.
6. Form baru setelah kembali dari halaman status memuat pasangan berikutnya. Slug preorder lain memasang form ber-key baru dan memakai key storage berbeda.

Saat storage tidak tersedia dan tab/komponen dihancurkan, ref hilang. T2 tidak menjanjikan recovery setelah reload/tab ditutup. Untuk intent aktif yang disimpan normal, storage tetap memberi recovery setelah reload.

## E. Tests and Evidence

| Klasifikasi | Pemeriksaan | Hasil |
|---|---|---|
| UNIT VERIFIED | Focused `npx.cmd vitest run src/features/public-preorder/checkout-intent.test.ts tests/unit/checkout-form.test.tsx src/features/orders/service.test.ts` | 36/36 PASS pada 3 file. |
| UNIT VERIFIED | Full `npm.cmd test` | 1.308/1.308 PASS pada 80 file. |
| UNIT VERIFIED | R01–R10 | Storage normal, getter/setter melempar, retry biasa, respons hilang simulasi, double click, pembelian baru, isolasi preorder, navigasi token asal dan storage rusak PASS. |
| INTEGRATION VERIFIED / DISPOSABLE SQL VERIFIED | `buyer-checkout.test.ts` pada Supabase T1 16-migration | Test baru PASS: respons pertama disimulasikan hilang setelah service berhasil commit; replay mengembalikan order lama; tepat 1 row order, 1 hold, hash token sama, 0 payment attempts. Full suite 209/209 PASS pada 13 file, 0 failed/pending. |
| Build quality | `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`, `git diff --check` | PASS; production build memuat `/p/[slug]` dan `/o/[token]`. |
| BROWSER VERIFIED | UI retry nyata melalui Chrome dan HTTP response loss | NOT EXECUTED; bagian T3. |

Test komponen memanggil `CheckoutForm` dan handler aslinya; hanya scheduler hook React dan server action yang disimulasikan, karena Vitest repository memakai environment Node tanpa DOM. Mock action pada R05 menyimpan identitas saat pemanggilan pertama lalu melempar seolah respons hilang; pemanggilan berikutnya harus memakai pasangan yang sama dan menavigasi ke token asli. Ini bukti source-level, bukan bukti HTTP/browser.

## F. Integrity Verification

Tidak ada perubahan pada RPC/migration/schema, `checkout-intent.ts`, server action, service/repository order, hash token, resolver harga C8, atribusi, kapasitas, pembayaran, rate limit, RLS atau provider. `placeBuyerOrderAction` masih memvalidasi request, menjalankan limit, lalu memakai C4; browser hanya membawa pasangan identitas, bukan menentukan harga atau keberhasilan pembayaran. Test order service existing tetap lulus.

Target integration dipilih lewat helper T1 dengan URL, anon/service key, DB container dan Mailpit override eksplisit. Project T1 `cl-t1-5c24f460eb0e` memiliki ledger 16. Database normal `campaign-lab` dan MVP lama `cl-mvp-72e87c9aa2bc` tetap pada ledger 9/14 dan identitas container/mount/network/port yang sama. T2 tidak menulis ke keduanya.

Sebelum integration, Docker melakukan restart serentak pada ketiga project; waktu start kedua DB lama berubah tetapi ID, mount, network, port, restart count DB dan ledger tidak berubah. Baseline T1 asli disimpan sebagai `protected-resources.t1-original.json` di direktori privat T1. Baseline waktu start guard lokal direkam ulang setelah pembandingan read-only, lalu `runtime.mjs status` kembali PASS. Ini perubahan metadata helper lokal saja, bukan migrasi atau perubahan data lama.

App T1 dinyalakan ulang dari repository saat ini dan `/login` merespons 200. `.env.local`, secret lokal, serta seluruh perubahan dan dokumen untracked yang sudah ada sebelum T2 dipertahankan. Dari 353 file baseline T1 terlindungi, hanya dua source file T2 yang memang ditargetkan berubah. Tidak ada panggilan Gemini, Midtrans, email eksternal, commit, deploy atau cleanup database lama.

## G. Known Limitations

- Tanpa storage persisten, intent yang hanya hidup dalam ref hilang ketika tab/komponen dihancurkan.
- Test R05 komponen mensimulasikan action response loss; test database memeriksa replay pada service C4. Browser HTTP loss end-to-end belum diuji.
- Guard double click mengurangi request ganda pada satu form; otoritas idempotensi, kuota dan harga tetap server/database.
- Local T1 `smoke.mjs` mengunci baseline source T1 yang sekarang sudah berubah karena T2. Untuk handoff pakai `runtime.mjs status`, build, dan perintah app; jangan menafsirkan mismatch hash T1 lama sebagai kegagalan source T2.

## H. T3 Handoff

Gunakan source `D:/Project/campaign-lab` pada branch di atas, app `http://127.0.0.1:3311`, API `http://127.0.0.1:57321`, database container `supabase_db_cl-t1-5c24f460eb0e`, Mailpit `http://127.0.0.1:57324`. Root helper lokal: `C:\Users\TUF GAMING\AppData\Local\Temp\campaign-lab-t1-5c24f460eb0e`. Jalankan `node "$t1Root\runtime.mjs" status` sebelum fixture, dengan `$t1Root` diisi path tersebut. Suite integration aman dijalankan melalui `node "$t1Root\runtime.mjs" integration --run-on-owned-t1`; helper menyuplai `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_KEY`, `TEST_DB_CONTAINER`, `TEST_MAILPIT_URL`. Bare `npm run test:integration` bisa memakai `.env.local` dan tidak boleh dipakai untuk target ini.

T3 perlu uji browser nyata: submit pertama sampai backend commit, putuskan/hilangkan respons HTTP secara terkendali, klik retry pada form yang sama dengan getter/setter storage diblokir, lalu periksa persis satu `orders`, satu `capacity_reservations` berstatus held, satu mapping hash token privat, nol payment attempt tambahan, dan halaman `/o/[token]` menampilkan order yang sama. Uji juga navigasi sukses → kembali → pembelian baru dengan pasangan baru, dan dua preorder berbeda. Bila menguji QR, gunakan seam Midtrans tiruan yang sudah ada; jangan membuat charge Sandbox nyata.

T2 berhenti di perbaikan source dan bukti yang tercatat di sini. Full browser acceptance T3–T8, Gemini/Midtrans live dan sign-off MVP tidak termasuk hasil ini.
