# Database Rules & Local Development Guide

**Project:** GTNIC 2026 — AI Campaign Strategist & Preorder Management  
**Stack:** Next.js + TypeScript + Supabase PostgreSQL/Auth + Supabase CLI + Docker  
**Tim:** 3 developer, satu GitHub repository  
**Berlaku mulai:** 30 Oktober 2026  
**Status:** Aturan kerja tim untuk pengembangan database

> **Prinsip utama: Database as Code.** Setiap developer bekerja menggunakan **Supabase lokal milik sendiri**. Perubahan database harus ditulis sebagai **SQL migration**, dikirim melalui **Pull Request (PR)**, direview, lalu di-merge. **Database Supabase Cloud bersama bukan tempat bereksperimen dengan schema.**

---

## 1. Arsitektur environment

| Environment | Pemilik / lokasi | Fungsi | Aturan |
|---|---|---|---|
| **Local A** | Docker komputer Anggota 1 | Products, capacity, orders | Bebas menguji perubahan di branch sendiri |
| **Local B** | Docker komputer Anggota 2 | AI, RAG, campaign planning | Bebas menguji perubahan di branch sendiri |
| **Local C** | Docker komputer Anggota 3 | Publishing, payment, analytics | Bebas menguji perubahan di branch sendiri |
| **Shared remote** | Satu project Supabase Cloud milik tim | Integrasi fitur dan demo | Hanya migration yang sudah di-merge; deploy oleh satu penanggung jawab |

- Setiap developer menggunakan **database lokal terpisah**. Database tersebut **tidak tersinkron otomatis** dengan database developer lain atau Cloud.
- **Git repository (`supabase/migrations/`) adalah sumber kebenaran perubahan schema**. `docs/schema.md` adalah dokumentasi kontrak yang harus diperbarui bersama migration.
- Menambahkan kolom/tabel di local Studio **tidak otomatis membuat migration**. Perubahan yang ingin dibagikan wajib dimasukkan ke file migration.
- Satu repo untuk aplikasi Next.js dan database; **tidak perlu tiga project Supabase Cloud** untuk pengembangan harian.

## 2. Baseline database

Migration pertama yang telah disepakati tim:

```text
supabase/migrations/20261030210000_initial_schema.sql
```

Baseline ini membangun **17 tabel aplikasi** (tidak termasuk `auth.users` bawaan Supabase):

| Domain | Tabel |
|---|---|
| Business & Auth | `businesses`, `business_members` |
| Product & Capacity | `products`, `production_capacity`, `capacity_reservations` |
| AI & Campaign | `campaigns`, `campaign_blueprints`, `ai_generations`, `campaign_tasks`, `campaign_contents` |
| Order | `orders`, `order_items`, `order_events` |
| Payment | `payments`, `payment_events` |
| Analytics | `campaign_costs`, `campaign_evaluations` |

**Baseline harus diperlakukan sebagai immutable:** setelah di-merge dan diterapkan bersama, **jangan edit, rename, atau hapus** migration tersebut. Tambahan RAG (`knowledge_documents`, `knowledge_chunks`) dan perubahan anggota lain dibuat dalam migration **baru**, bukan disisipkan ke initial schema.

> Perhatian: jangan menyertakan migration awal alternatif yang juga membuat 17 tabel yang sama. Dua baseline duplikat akan membuat `db reset` gagal.

**Keamanan baseline:** RLS sudah diaktifkan pada 17 tabel dan menyediakan policy **read untuk owner**. Penulisan data aplikasi tidak otomatis dapat dilakukan dari browser hanya dengan publishable key; server/API harus menerapkan autentikasi, otorisasi tenant, dan mekanisme write yang benar. Jangan mengendurkan RLS untuk mempercepat development.

## 3. Setup anggota baru (cukup sekali per komputer)

**Prasyarat:** Git, Node.js/npm sesuai versi project, dan Docker Desktop / runtime Docker yang **sedang berjalan**.

```bash
# 1. Clone repo dan masuk ke folder project
git clone <REPOSITORY_URL>
cd <NAMA_REPOSITORY>

# 2. Install dependency persis sesuai lockfile
npm ci

# 3. Jalankan seluruh layanan Supabase lokal
npx supabase start

# 4. Lihat URL, key, dan status layanan lokal
npx supabase status
```

- Karena CLI sudah ada di `devDependencies`, **anggota lain tidak perlu `npm install supabase --save-dev` lagi**.
- Karena `supabase/config.toml` sudah di-commit, **anggota lain tidak perlu `npx supabase init` lagi**.
- `supabase start` menerapkan migration dan seed lokal yang terkonfigurasi. Jika stack sudah pernah dijalankan dan ada migration baru, lihat bagian sinkronisasi di bawah.
- Buka **Supabase Studio lokal** pada URL yang ditampilkan `npx supabase status`, lalu pastikan tabel tersedia.

### Konfigurasi Next.js untuk pengembangan lokal

Simpan credential lokal di **`.env.local`** (jangan di-commit). Nama variabel harus mengikuti yang benar-benar dibaca kode aplikasi:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=<API_URL_DARI_SUPABASE_STATUS>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_ATAU_ANON_KEY_LOKAL>

# Jika dibutuhkan oleh kode server saja:
SUPABASE_SECRET_KEY=<SECRET_ATAU_SERVICE_ROLE_KEY_LOKAL>

# Khusus pengembang AI (server only):
GEMINI_API_KEY=<GEMINI_API_KEY_PRIBADI_ATAU_TIM>
```

Catatan: output dan jenis key lokal bergantung versi CLI/SDK. Jika kode menggunakan `NEXT_PUBLIC_SUPABASE_ANON_KEY`, jangan sekadar mengganti nama di env tanpa mengubah kode yang membacanya. **Jangan pernah memakai prefix `NEXT_PUBLIC_` untuk service-role/secret key.**

**Dilarang commit:** `.env`, `.env.local`, token autentikasi, database password, service-role/secret keys, dan kredensial provider. Gunakan `.env.example` hanya dengan placeholder tanpa nilai rahasia.

## 4. Perintah CLI sehari-hari

| Perintah | Fungsi | Dampak / catatan |
|---|---|---|
| `npx supabase start` | Menyalakan stack lokal | Perlu Docker |
| `npx supabase status` | Melihat URL dan status | Aman untuk inspeksi; jangan membagikan secret key-nya |
| `npx supabase stop` | Mematikan stack lokal | Data lokal biasanya tetap tersimpan |
| `npx supabase migration new <nama>` | Membuat migration baru | Membuat file SQL bertimestamp |
| `npx supabase db reset` | Bangun ulang DB **lokal** dari migrations + seed | **Menghapus data lokal sebelumnya** |
| `npx supabase gen types typescript --local` | Generate tipe database | Hasil perlu disimpan ke file yang disepakati |
| `npx supabase db push --dry-run` | Meninjau migration yang akan dikirim ke remote terkait | **Hanya penanggung jawab remote** |
| `npx supabase db push` | Menerapkan migration ke remote terkait | **Hanya penanggung jawab remote; wajib approval** |

**DILARANG:** `npx supabase db reset --linked` atau reset menggunakan remote URL. Flag tersebut dapat **menghapus data database Cloud**. Jangan menjalankan `db push` dari feature branch.

## 5. Workflow membuat perubahan schema

Misal Anggota 2 ingin menambah tabel Business Memory, sedangkan Anggota 1 ingin menambah kolom produk.

### Langkah A — Buat branch dan migration sendiri

```bash
git switch main
git pull origin main
git switch -c feat/ai-business-memory

npx supabase migration new add_business_memory
```

CLI membuat file seperti:

```text
supabase/migrations/<TIMESTAMP>_add_business_memory.sql
```

Tuliskan SQL perubahan **di file baru tersebut**, misalnya `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `CREATE POLICY`, atau extension yang dibutuhkan. **Jangan mengedit migration yang sudah di-merge/diterapkan.**

### Langkah B — Perbarui dokumentasi dan kode

Dalam PR yang sama, jika relevan:

1. Perbarui `docs/schema.md` agar sesuai SQL baru.
2. Perbarui query/repository, Zod schema, tipe TypeScript, dan test yang terdampak.
3. Jika menambah tabel privat, tentukan **RLS, policy, FK, indeks, dan aturan `business_id`** sebelum fitur dinyatakan selesai.
4. Jika menambah embedding, buat migration terpisah yang memuat pgvector, tabel vector, indeks, dan isolasi tenant. Jangan menyimpan informasi pelanggan sensitif ke embedding tanpa kebutuhan dan pengamanan yang jelas.

### Langkah C — Uji migration di database lokal

```bash
# Pastikan Supabase lokal sudah berjalan
npx supabase start

# Uji seluruh riwayat migration dari kondisi kosong
npx supabase db reset

# Opsional: generate ulang tipe TS ke lokasi yang disepakati
npx supabase gen types typescript --local > src/lib/supabase/database.types.ts

# Jalankan pemeriksaan aplikasi
npm run lint
npx tsc --noEmit
```

**Catatan:** Perintah `db reset` hanya untuk DB lokal, tetapi akan menghapus seluruh data pengujian lokal. Gunakan seed dummy untuk data yang perlu dibuat berulang. Periksa bahwa path `src/lib/supabase/` ada sebelum menjalankan output redirect, dan sesuaikan perintah pemeriksaan dengan script project.

### Langkah D — Pull Request dan review

```bash
git add supabase/migrations docs/schema.md src
# Review git diff terlebih dahulu; commit tidak boleh mencakup secret
git commit -m "feat(db): add business memory schema"
git push -u origin feat/ai-business-memory
```

Buat PR ke `main`, **minta minimal satu anggota lain mereview**, lalu merge jika sudah memenuhi checklist di bagian 7. Perintah Git di atas dijalankan oleh developer secara sadar; AI agent tidak boleh melakukan commit/push tanpa izin eksplisit.

## 6. Saat ada migration baru dari teman

Sebelum melanjutkan pekerjaan:

```bash
git switch main
git pull origin main

# Kalau ingin memperbarui DB lokal dari awal:
npx supabase db reset
```

Jika masih bekerja di feature branch, integrasikan `main` terbaru ke branch menggunakan Git merge/rebase sesuai kesepakatan tim. Kemudian jalankan `npx supabase db reset` untuk menguji **gabungan seluruh migration**.

**Jangan meng-copy tabel atau kolom teman secara manual lewat Supabase Studio.** Ambil perubahan melalui Git dan jalankan migration.

### Jika dua migration bertabrakan

- **Menambah kolom berbeda pada tabel sama:** biasanya kompatibel, tetap uji gabungannya.
- **Nama kolom sama tetapi tipe berbeda:** diskusikan kontrak final; jangan membuat perubahan acak agar migration lolos.
- **Rename/drop kolom yang digunakan modul lain:** perlu koordinasi dan perubahan aplikasi dalam PR yang terencana.
- **Bentrok timestamp migration:** selesaikan sebelum migration diterapkan remote; jangan rename migration yang sudah direkam remote.
- **Migration gagal setelah merge:** jangan mengubah file migration lama yang sudah deployed. Buat migration koreksi baru, atau koordinasikan pemulihan bila masalah hanya terjadi sebelum deployment mana pun.

**Git merge sukses tidak berarti migration PostgreSQL pasti sukses.** Karena itu `db reset` setelah integrasi adalah pemeriksaan penting.

## 7. Checklist wajib sebelum PR schema di-merge

- [ ] Perubahan berasal dari branch fitur, bukan perubahan langsung di shared remote.
- [ ] Setiap perubahan schema ada di migration **baru**, bertimestamp, dan namanya jelas.
- [ ] Migration lama **tidak** diubah.
- [ ] `npx supabase db reset` berhasil dari rangkaian migration lengkap.
- [ ] `docs/schema.md` dan tipe TypeScript diperbarui bila relevan.
- [ ] Foreign key, unique, check, default, dan indeks dipikirkan sesuai kebutuhan.
- [ ] Tabel/data privat memiliki RLS dan policy yang sesuai.
- [ ] Query lintas bisnis dibatasi menggunakan `business_id` dan otorisasi yang diuji.
- [ ] Perubahan kompatibel dengan modul anggota lain; breaking change disetujui.
- [ ] Tidak ada API key, password, PII pelanggan, atau data produksi dalam commit/seed/log.
- [ ] Test terkait berjalan; hasil atau keterbatasannya ditulis di PR.
- [ ] Minimal satu reviewer anggota lain menyetujui.

**Format deskripsi PR yang disarankan:**

```md
## Tujuan
Mengapa perubahan schema diperlukan?

## Perubahan
- Tabel/kolom/index/policy yang dibuat atau diubah
- Modul yang terdampak

## Dampak dan risiko
- Breaking change?
- Backfill atau data migration diperlukan?
- Perubahan RLS/akses?

## Verifikasi
- [ ] supabase db reset
- [ ] lint / typecheck / test relevan
- [ ] reviewer menyetujui
```

## 8. Aturan khusus keamanan data

1. **Multi-tenant isolation:** seluruh data privat harus dibatasi menurut `business_id` yang dimiliki user terautentikasi. Jangan mengandalkan filter frontend semata.
2. **RLS tetap aktif.** Untuk insert/update/delete melalui backend dengan kredensial istimewa, server wajib memverifikasi identitas, kepemilikan, dan validitas payload sebelum query. Secret key tidak pernah sampai browser.
3. **Public preorder:** customer tidak login; hanya lewat Next.js Route Handler yang aman, bukan membuka policy SELECT semua order kepada `anon`.
4. **Payment:** gunakan Midtrans Sandbox untuk demo. Webhook diverifikasi dan diproses secara idempotent; jangan mengedit tabel transaksi langsung agar dashboard terlihat bagus.
5. **Keuangan:** nilai IDR disimpan sebagai integer (`bigint`) dan transaksi menyimpan snapshot harga/biaya.
6. **RAG:** embedding kampanye privat tetap terikat tenant. Knowledge global hanya boleh berupa materi yang disetujui untuk dibagikan umum. Jangan melakukan semantic search lintas UMKM tanpa otorisasi.
7. **Seed:** gunakan data sintetis, bukan kontak pelanggan sungguhan atau kredensial nyata.

## 9. Kebijakan Shared Supabase Remote

**Penanggung jawab deployment:** ditunjuk tim (satu orang pada satu waktu).

Prosedur bila migration akan diterapkan ke Cloud:

1. Pastikan seluruh perubahan sudah di-review dan di-merge ke `main`.
2. Pastikan kondisi remote dan migration lokal selaras. **Jika remote pernah diubah manual melalui Dashboard, jangan langsung `db push`; rekonsiliasi drift terlebih dahulu.**
3. Jalankan migration dari `main` dalam lingkungan lokal/test dan periksa hasilnya.
4. Setelah persetujuan tim, penanggung jawab melakukan `supabase link` ke project yang benar (jika belum), memeriksa `npx supabase db push --dry-run`, lalu menjalankan `npx supabase db push`.
5. Catat migration yang diterapkan dan uji fitur integrasi yang terdampak.

**Tidak boleh:** masing-masing anggota menghubungkan CLI ke remote lalu bebas menjalankan `db push`, menjalankan `db reset --linked`, atau mengubah schema Cloud lewat SQL Editor di luar proses yang disepakati.

## 10. Keselarasan dengan `AGENTS.md`

Dokumen `AGENTS.md` awal melarang AI agent mengubah schema tanpa **tugas dan izin eksplisit**. Kebijakan tersebut **tetap berlaku**: untuk tugas biasa, agent hanya membaca database contract. Ketika developer secara eksplisit memberi tugas perubahan schema, agent boleh **menyiapkan proposal/file migration pada branch lokal** dalam cakupan izin tersebut, tetapi **tidak boleh deploy ke remote, commit, atau push** tanpa instruksi eksplisit yang terpisah.

> Jika `AGENTS.md` masih memakai larangan absolut meskipun sudah ada izin perubahan schema, revisi aturan agent itu secara eksplisit bersama tim sebelum meminta agent membuat migration. `database-rules.md` tidak secara otomatis menimpa instruksi agent yang lebih ketat.

## 11. FAQ cepat

**Q: Apakah setiap orang perlu project Supabase Cloud sendiri?**  
Tidak. Untuk development harian cukup local Supabase masing-masing. Satu Cloud project digunakan untuk integrasi/demo.

**Q: Apakah setiap kali CRUD produk/order harus membuat migration?**  
Tidak. Migration hanya untuk **perubahan struktur/aturan DB** (tabel, kolom, indeks, RLS, RPC, constraint). CRUD data normal menggunakan API aplikasi.

**Q: Apakah perubahan tabel lewat Studio lokal otomatis ter-push ke GitHub?**  
Tidak. Tangkap sebagai migration dengan CLI (`db diff`) atau tulis migration SQL secara manual; lakukan review hasil diff sebelum commit.

**Q: Apakah setelah `git pull` data lokal otomatis ikut berubah?**  
Tidak. File migration ikut terunduh, tetapi DB lokal harus menerapkannya; `db reset` adalah cara sederhana, dengan konsekuensi menghapus data lokal.

**Q: Kalau anggota lain sedang mengubah kolom tabel yang sama?**  
Boleh paralel, tetapi komunikasi kontrak tetap wajib. Setelah PR digabung, jalankan migration dari awal untuk mendeteksi benturan SQL.

**Q: Boleh mengubah migration yang sudah diterapkan?**  
Tidak. Tambahkan migration baru agar histori tetap konsisten di seluruh komputer dan remote.

---

## 12. Referensi resmi

- [Supabase CLI — Getting Started](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase — Local Database Migrations](https://supabase.com/docs/guides/local-development/database-migrations)
- [Supabase — Local Development Workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli)

**Ringkasan aturan:** **Local first → migration baru → `db reset` → PR + review → merge `main` → remote deploy terkontrol.**
