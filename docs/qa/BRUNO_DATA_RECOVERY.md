# Pemulihan data lokal untuk Bruno

Diverifikasi 4 November 2026 pada `supabase_db_campaign-lab`, project `campaign-lab`, workspace `D:\Project\campaign-lab`. Supabase HTTP `http://127.0.0.1:54321`; aplikasi `http://localhost:3100`. Hanya data sintetis lokal; schema, migrations, RLS, akun Auth dan password tidak diubah.

Login POST hanya memvalidasi kredensial dan memasang cookie. GET `/api/dev/discussions/auth` juga mewajibkan membership owner. Setelah TRUNCATE public, identitas Auth tetap valid tetapi query membership kosong sehingga GET403. Sebelum pemulihan, login dan GoTrue user200, query membership200 dengan `[]`, GET auth403; tanpa cookie/bearer valid401. Pemeriksaan Origin berlaku untuk write, bukan GET. Mode development/provider dan target Supabase juga sudah diperiksa.

## Menjalankan ulang dengan pemilik yang dipilih

Pengguna mengizinkan akun pribadi berikut menggantikan membership fixture A. Akun fixture A lama tetap ada di Auth tanpa membership. Satu business hanya memiliki satu owner sesuai schema.

```powershell
node scripts/prepare-bruno-development.mjs --owner-a-user-id=bd8a2cd2-cc4a-438b-bc72-03cbebd45a30
```

Runner memverifikasi label Docker/workspace, URL lokal dan akun Auth yang sudah tersedia, lalu memakai `supabase/seed.sql` dan `scripts/prepare-campaign-execution.mjs --discussion`. Argumen owner diteruskan ke seed sebagai setting sesi SQL; tidak membuat function/kolom/config database persisten. Transfer hanya diperbolehkan dari membership fixture A asli ke akun pilihan, pada business demo A yang cocok. Konflik owner lain ditolak dan transaksi seed di-rollback. Tanpa argumen, default tetap fixture A resmi dan akan menolak kondisi membership pribadi saat ini.

Seed menggunakan insert dengan conflict handling, tidak menimpa histori/harga/tanggal. Helper preorder memakai kembali fixture aktif dari cache atau database; setelah kedaluwarsa, menambahkan fixture terpisah dengan tanggal mendatang melalui RPC publish yang sudah ada. Hasil aktual tersedia di ignored `node_modules/.cache/bruno-recovery/ready.json` dan `node_modules/.cache/campaign-discussion/preorders.json`.

Jangan memakai `scripts/test-supabase-v21.mjs --setup-fixtures` untuk pemulihan ini: mode tersebut dapat membuat akun dan mengganti password fixture. Jangan jalankan harness integrasi yang mengasumsikan owner A resmi terhadap konfigurasi pribadi ini; gunakan lingkungan uji terpisah dengan fixture resmi.

## UUID dan data aktif

| Field | Owner A pribadi | Owner B fixture |
| --- | --- | --- |
| Auth user | `bd8a2cd2-cc4a-438b-bc72-03cbebd45a30` | `22222222-2222-4222-8222-222222222222` |
| Business | `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1` | `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1` |
| Product | `4bde3642-0e34-4d30-b3eb-8f4371b71ebb` | `68ecd934-16b3-46cb-a17a-c1d78a8d652b` |
| Capacity | `ee0f8775-e92f-429e-8d4c-b886a1dc5804` | `2a33c928-d231-488a-ac86-b206abdaded2` |
| Preorder | `2aab6606-4b1b-4905-8cca-3e18459414c1` | `b650247a-47f6-4b80-a50f-043b19657674` |
| Preorder item | `c18a0104-e802-4b94-8123-25d40f009807` | `555dc6fb-7422-43c1-b0d4-2c16d869afd7` |

Keduanya published, snapshot Rp120.000, target/quota/kapasitas 40. Biaya variabel A Rp75.000 (`verified` sintetis), B tetap unknown. Penjualan aktif sampai **10 November 2026 sekitar 20:54 WIB**, cutoff **11 November 20:54 WIB**, fulfillment **13 November 2026**. Untuk tanggal berikutnya baca manifest hasil runner, jangan menyalin UUID historis secara permanen.

Jumlah setelah pemulihan: Auth 3, businesses 2, business_members 2, products 4, production_capacity 4, preorders 4 (dua draft baseline + dua published aktif), preorder_items 4, campaigns 2 (draft baseline). Sessions/messages/generations/blueprints/tasks/contents/costs/evaluations/memories/orders/payments/reservations/job_runs semuanya 0. Tidak dibuat transaksi/payment palsu.

## Verifikasi dan mulai manual testing

- Seed ulang identik: UUID, tanggal dan jumlah rows tidak berubah; cache yang hilang dibangun ulang dari database tanpa duplikasi. UUID salah dan konflik default owner ditolak.
- RLS dengan role authenticated untuk akun pribadi A dan B: masing-masing satu membership, preorder sendiri terlihat, preorder tenant lain tidak terlihat.
- HTTP otomatis Owner B: login200, GET auth200, GET discussions200, preorder A tersembunyi. Tanpa cookie dan bearer invalid401. Akun fixture A lama: login200 tetapi kedua GET403 setelah transfer.
- Akun pribadi: pengguna mengonfirmasi kedua GET200 di Bruno menggunakan cookie login yang sudah ada. Password/token akun pribadi tidak diambil untuk harness.
- Unit tests432 passed; lint dan TypeScript typecheck passed. Build tidak dijalankan ulang untuk perubahan seed/utilitas/dokumentasi ini.

Di Bruno, gunakan `baseUrl=http://localhost:3100`, isi kredensial pribadi pada Secret Variables `ownerEmail`/`ownerPassword`, dan kredensial fixture B pada pasangan `ownerBEmail`/`ownerBPassword`. Pastikan mode server Fake/synthetic sesuai [panduan utama](BRUNO_API_TESTING_GUIDE.md).

Set `preorderId` A sesuai tabel. Bersihkan runtime variables resource dari pengujian sebelum TRUNCATE (session/campaign/blueprint/evaluation/memory/hash/version): nilainya sudah tidak ada di database. Runtime variable dapat menimpa environment; jika nilai preorder lama masih dipakai, set sementara di pre-request `bru.setVar("preorderId", "2aab6606-4b1b-4905-8cca-3e18459414c1")`, lalu hapus baris sementara tersebut setelah pengujian. Mulai lagi folder `00-Setup-Auth`, lalu alur folder03–08 secara berurutan; jangan langsung melanjutkan folder07 memory lama. Aktifkan flag mutasi/lifecycle sesuai operasi yang ditinjau.

Pricing/Simulator/Context (Slice1–3) tidak memiliki endpoint HTTP mandiri; gunakan UI/unit tests yang tercantum pada panduan utama. Workflow Slice4–8 memakai Fake/synthetic, dan approval memory sintetis memang harus ditolak. Belum ada history baru yang dibuat untuk manual testing.
