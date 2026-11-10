
# juarasatu — Database Schema & Data Contract

**Version:** 2.1  
**Date:** 1 November 2026 (diperbarui 10 November 2026)  
**Source of Truth:** PRD v2.1 ([docs/requirements/PRD.md](requirements/PRD.md))  
**Database:** PostgreSQL + Supabase  
**Auth:** Supabase Auth  
**Vector Database:** pgvector — 768 dimensions  
**Architecture:** Next.js Modular Monolith  
**Migration:** satu file, `supabase/migrations/20261110120000_initial_schema.sql`, berisi seluruh schema yang dipakai aplikasi (tabel, constraint, index, trigger, fungsi/RPC, RLS, hak akses role API, dan Storage `product-photos`).  
**Status:** Dokumen ini sesuai dengan database yang dibangun dari migration tersebut (diperiksa 10 November 2026): 26 tabel, 353 kolom, tipe data, NULL/NOT NULL, dan nilai default cocok; 50 signature fungsi publik. Migration init diuji pada project Supabase kosong dan hasilnya identik dengan database aplikasi yang berjalan (dump schema, hak akses per tabel/kolom/fungsi, policy Storage).

---

# 1. Overview

juarasatu adalah platform manajemen preorder yang membantu UMKM merencanakan, menjalankan, dan mengevaluasi campaign pemasaran menggunakan AI.

Konsep utama:

1. UMKM membuat akun melalui Supabase Auth.
2. UMKM melengkapi profil bisnis.
3. UMKM mendaftarkan produk dan kapasitas produksi.
4. UMKM membuka preorder dengan kuota dan target penjualan.
5. Pelanggan memesan dan melakukan pembayaran melalui Midtrans Sandbox.
6. UMKM memantau KPI preorder.
7. AI membantu merancang campaign jika pemilik ingin meningkatkan penjualan.
8. Pemilik berdiskusi dengan AI dan menggunakan Campaign Simulator.
9. Hasil strategi dibuat menjadi Campaign Blueprint dan kalender.
10. Pemilik menyetujui dan mempublikasikan campaign.
11. Pelanggan baru tetap memesan melalui preorder yang sama.
12. Sistem menghitung KPI dan mengevaluasi campaign.
13. Hasil evaluasi menjadi Business Memory untuk campaign berikutnya.

## 1.1 Core Business Rules

- Satu user hanya dapat menjadi owner satu bisnis pada MVP.
- Satu bisnis memiliki satu owner pada MVP.
- Pelanggan tidak wajib register.
- Satu preorder hanya berisi satu produk/SKU.
- Satu preorder memiliki satu tanggal fulfillment.
- Kapasitas produksi dicatat per produk dan tanggal.
- Satu bisnis hanya boleh memiliki satu preorder published pada tanggal fulfillment yang sama.
- Satu campaign mempromosikan satu preorder.
- Satu preorder boleh memiliki banyak campaign historis.
- Hanya satu campaign published pada satu preorder dalam waktu yang sama.
- Campaign tidak menciptakan preorder baru.
- Target preorder bukan minimum produksi.
- Jika target 40 unit dan yang dibayar valid hanya 30 unit, 30 unit tersebut tetap dipenuhi.
- Preorder tidak otomatis dibatalkan apabila target belum tercapai.
- Diskon campaign berlaku bagi semua checkout baru pada preorder ketika campaign aktif.
- Campaign link digunakan untuk atribusi, bukan voucher.
- Semua harga dan perhitungan finansial ditentukan backend.
- Gemini tidak boleh mengubah order, pembayaran, kapasitas atau status approval secara langsung.
- Email konfirmasi pembayaran berhasil wajib pada MVP.
- Midtrans digunakan dalam mode Sandbox.
- Business Memory hanya berasal dari pengalaman campaign bisnis sendiri.
- Tidak menggunakan `knowledge_documents` dan `knowledge_chunks` dalam target schema.
- Embedding Business Memory menggunakan 768 dimensi.

---

# 2. Database Domains

Target database memiliki 26 tabel aplikasi dan satu tabel `auth.users` yang dikelola Supabase.

| Domain | Tables |
|---|---|
| Authentication & Business | businesses, business_members |
| Products & Preorder | products, production_capacity, preorders, preorder_items |
| Campaign & AI | campaigns, campaign_ai_sessions, campaign_ai_messages, ai_generations, campaign_blueprints, campaign_tasks, campaign_contents |
| Orders | orders, order_items, capacity_reservations, order_events |
| Payment | payments, payment_events |
| Financial & Analytics | campaign_costs, order_production_costs, campaign_evaluations |
| AI Memory | campaign_memories |
| Infrastructure | job_runs, rate_limit_buckets, domain_events |

Total: **26 application tables**.

Catatan: jumlah tersebut adalah desain target. Beberapa tabel infrastruktur dapat ditambahkan bertahap sesuai kebutuhan milestone.

---

# 3. Database Conventions

## 3.1 Primary Keys

Semua tabel aplikasi menggunakan:

```sql
id uuid PRIMARY KEY DEFAULT gen_random_uuid()
```

Pengecualian berlaku untuk tabel dengan composite primary key seperti `rate_limit_buckets`.

## 3.2 Tenant Isolation

Seluruh data milik UMKM harus mempunyai `business_id`, kecuali tabel sistem global yang memang tidak terkait satu UMKM.

Foreign key lintas tabel privat harus mempertahankan kesesuaian tenant.

Gunakan composite foreign key jika diperlukan:

```sql
FOREIGN KEY (parent_id, business_id)
REFERENCES parent_table (id, business_id)
```

Parent membutuhkan UNIQUE constraint yang mendukung foreign key tersebut.

## 3.3 Money

Semua nominal disimpan dalam integer rupiah menggunakan `bigint`.

Contoh:

```text
120000 = Rp120.000
75000  = Rp75.000
```

Hindari floating-point untuk perhitungan harga dan pembayaran.

## 3.4 Discount

Diskon menggunakan basis points.

```text
1000 bps = 10%
500 bps  = 5%
```

Rumus:

```text
discount_per_unit =
  floor(base_price * discount_bps / 10000)

final_price =
  base_price - discount_per_unit
```

## 3.5 Date and Time

- Database menyimpan timestamp menggunakan `timestamptz`.
- Penyimpanan waktu dalam UTC.
- UI menggunakan timezone Asia/Jakarta.
- Tanggal pemenuhan menggunakan tipe `date`.
- Interval waktu menggunakan half-open interval `[starts_at, ends_at)`.

## 3.6 Versioning

Entitas yang dapat diedit menggunakan:

```text
version integer NOT NULL DEFAULT 1
```

Update harus memvalidasi `expectedVersion`.

Jika versi tidak sesuai, backend mengembalikan `409 CONFLICT`.

## 3.7 Data Integrity

- Tidak melakukan hard delete pada histori transaksi.
- Harga order disimpan sebagai snapshot.
- Status pembayaran hanya berubah melalui operasi yang tervalidasi.
- Payment events dan evaluations bersifat append-only.
- Foreign key histori menggunakan perilaku yang menjaga data historis.
- JSONB harus divalidasi menggunakan runtime schema.

---

# 4. Authentication & Business

## 4.1 Supabase `auth.users`

Tabel ini dikelola otomatis oleh Supabase Auth.

Digunakan untuk:

- Register
- Login
- Logout
- Email verification
- Password reset
- Session management

Tidak perlu membuat tabel `users` baru.

Relasi user ke bisnis disimpan melalui `business_members`.

## 4.2 `businesses`

Menyimpan informasi bisnis UMKM.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | varchar(120) | NOT NULL |
| slug | varchar(140) | NOT NULL, UNIQUE |
| category | varchar(80) | NOT NULL |
| categories | text[] | NOT NULL |
| description | text | NULLABLE |
| public_contact | varchar(120) | NULLABLE |
| pickup_instructions | text | NOT NULL |
| timezone | varchar(64) | DEFAULT Asia/Jakarta |
| is_demo | boolean | DEFAULT false |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Rules:

- `slug` harus unik.
- Informasi rekening bank tidak disimpan.
- Kontak publik hanya ditampilkan berdasarkan persetujuan owner.
- Setiap bisnis memiliki satu owner pada MVP.
- `categories` tidak mempunyai column default. CHECK `businesses_categories_valid` memerlukan array satu dimensi berisi 1–3 label non-NULL; panjang label setelah trim 1–80, unik tanpa membedakan kapital/spasi tepi. Tidak ada enum kategori database. Trigger `business_category_sync` mengisi array dari legacy category bila NULL dan menyinkronkan `category` ke 80 karakter pertama elemen pertama. Generated Insert tetap memerlukan kedua kolom karena generator mengikuti column defaults/nullability, bukan efek trigger.

## 4.3 `business_members`

Menghubungkan Supabase Auth dengan bisnis.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| user_id | uuid | FK auth.users |
| role | text | DEFAULT owner |
| created_at | timestamptz | DEFAULT now() |

Constraints:

```text
UNIQUE(user_id)
UNIQUE(business_id)
CHECK(role = 'owner')
```

Alur:

```text
Register
  ↓
auth.users
  ↓
Business Onboarding
  ↓
INSERT businesses
  ↓
INSERT business_members
  ↓
Dashboard
```

Insert bisnis dan owner membership harus dilakukan secara atomik.

`business_members` bukan tabel untuk pelanggan yang membeli preorder.

---

# 5. Product & Production Capacity

## 5.1 `products`

Menyimpan katalog produk UMKM.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| name | varchar(160) | NOT NULL |
| sku | varchar(80) | NOT NULL |
| description | text | NULLABLE |
| photo_path | text | NULLABLE |
| gallery_photo_paths | text[] | NOT NULL, DEFAULT '{}', maksimal 4 |
| base_price_idr | bigint | NOT NULL, > 0 |
| variable_cost_idr | bigint | NULLABLE, >= 0 |
| cost_quality | text | NOT NULL |
| is_active | boolean | DEFAULT true |
| version | integer | DEFAULT 1 |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Constraints:

```text
UNIQUE(business_id, sku)

cardinality(gallery_photo_paths) <= 4
cardinality(gallery_photo_paths) = 0 OR photo_path IS NOT NULL

cost_quality:
  unknown
  estimated
  verified
```

Business Rules:

- Produk merupakan satu SKU standar.
- Satu produk punya paling banyak 5 foto: `photo_path` adalah foto utama, `gallery_photo_paths` berisi foto tambahan secara berurutan
  (CHECK `products_gallery_photo_paths_max` dan `products_gallery_requires_primary`). Pemilik (`authenticated`) mendapat hak INSERT dan UPDATE kolom
  `gallery_photo_paths`, sama seperti `photo_path`; RLS products tidak berubah.
- Varian size dan warna kompleks tidak termasuk MVP.
- Produk tidak dihapus permanen setelah memiliki transaksi.
- Edit harga produk tidak mengubah harga preorder yang sudah dipublikasikan.
- Edit biaya tidak mengubah snapshot biaya pada order lama.
- `variable_cost_idr = NULL` berarti biaya belum diketahui.
- Biaya Rp0 berbeda dengan biaya yang belum diketahui.

## 5.2 `production_capacity`

Menyimpan kapasitas produksi per produk dan tanggal.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| product_id | uuid | FK products |
| fulfillment_date | date | NOT NULL |
| total_units | integer | >= 0 |
| intake_cutoff_at | timestamptz | NOT NULL |
| fulfillment_window_end_at | timestamptz | NOT NULL |
| version | integer | DEFAULT 1 |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Constraints:

```text
UNIQUE(
  business_id,
  product_id,
  fulfillment_date
)

intake_cutoff_at < fulfillment_window_end_at
```

Contoh:

| Product | Date | Capacity |
|---|---|---|
| Kaos Oversized | 7 Nov | 40 |
| Hoodie | 8 Nov | 30 |

Kapasitas bukan jumlah penjualan.

Kapasitas tersedia dihitung dari kapasitas total dikurangi allocated reservations dan effective held reservations.

Untuk MVP, hanya satu preorder published per bisnis pada tanggal fulfillment yang sama.

Pembatasan tersebut harus ditegakkan pada proses publish preorder, tidak harus dengan UNIQUE `(business_id, fulfillment_date)` di tabel kapasitas.

---

# 6. Preorder Management

## 6.1 `preorders`

Menyimpan event preorder yang dibuat UMKM.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| name | varchar(160) | NOT NULL |
| slug | varchar(160) | UNIQUE |
| status | text | NOT NULL, DEFAULT draft |
| fulfillment_date | date | NOT NULL |
| starts_at | timestamptz | NOT NULL |
| ends_at | timestamptz | NOT NULL |
| published_at | timestamptz | NULLABLE |
| closed_at | timestamptz | NULLABLE |
| completed_at | timestamptz | NULLABLE |
| pickup_terms_snapshot | jsonb | NULLABLE |
| version | integer | DEFAULT 1 |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Statuses:

```text
draft
published
closed
completed
cancelled
```

Lifecycle:

```text
draft
  ↓
published
  ↓
closed
  ↓
completed
```

Business Rules:

- Preorder dapat berjalan tanpa campaign.
- Satu preorder berisi satu produk pada MVP.
- Preorder memiliki target dan kuota.
- Target bukan minimum produksi.
- Gagal mencapai target tidak membatalkan order.
- Satu preorder published per bisnis/tanggal fulfillment.
- Preorder tidak boleh menerima order setelah batas waktu.
- Ketentuan penting dibekukan saat preorder dipublikasikan.
- Preorder yang sudah menerima pesanan tidak boleh dihapus.

## 6.2 `preorder_items`

Menyimpan produk, harga, target, dan kuota preorder.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| preorder_id | uuid | FK preorders |
| product_id | uuid | FK products |
| capacity_id | uuid | FK production_capacity |
| target_units | integer | > 0 |
| quota_units | integer | > 0 |
| base_price_snapshot_idr | bigint | > 0 |
| product_name_snapshot | varchar(160) | NOT NULL |
| sku_snapshot | varchar(80) | NOT NULL |
| version | integer | DEFAULT 1 |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Constraints:

```text
UNIQUE(preorder_id)

target_units > 0

quota_units >= target_units
```

Contoh:

```text
Preorder:
  Kaos Oversized November

Product:
  Kaos Oversized Hitam L

Target:
  40 pcs

Quota:
  40 pcs

Harga:
  Rp120.000

Fulfillment:
  7 November
```

Jika hanya 30 pcs terjual valid, UMKM tetap memenuhi 30 pcs tersebut.

Preorder tidak otomatis gagal secara operasional hanya karena target pemasaran tidak tercapai.

---

# 7. AI Campaign Management

## 7.1 `campaigns`

Menyimpan kegiatan pemasaran untuk preorder yang sudah ada.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| preorder_id | uuid | FK preorders |
| name | varchar(160) | NOT NULL |
| slug | varchar(160) | UNIQUE |
| status | text | NOT NULL |
| offer_type | text | NOT NULL |
| marketing_approach | text | NOT NULL |
| discount_bps | integer | DEFAULT 0 |
| budget_cap_idr | bigint | >= 0 |
| primary_kpi | text | NOT NULL |
| target_additional_units | integer | > 0 |
| starts_at | timestamptz | NOT NULL |
| ends_at | timestamptz | NOT NULL |
| published_at | timestamptz | NULLABLE |
| closed_at | timestamptz | NULLABLE |
| completed_at | timestamptz | NULLABLE |
| active_blueprint_id | uuid | NULLABLE |
| published_blueprint_id | uuid | NULLABLE |
| baseline_json | jsonb | NULLABLE |
| baseline_calculated_at | timestamptz | NULLABLE |
| metrics_schema_version | integer | NULLABLE |
| costs_completeness | text | NOT NULL |
| version | integer | DEFAULT 1 |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Offer Types:

```text
normal_price
percent_discount
```

Marketing Approaches:

```text
scheduled_reminder
value_content
limited_discount
```

Campaign Statuses:

```text
draft
published
closed
completed
cancelled
```

Rules:

- Campaign selalu berhubungan dengan satu preorder.
- Campaign tidak membuat preorder baru.
- Satu preorder dapat memiliki banyak campaign historis.
- Hanya satu campaign published untuk satu preorder pada waktu yang sama.
- Periode campaign harus berada dalam periode preorder.
- Campaign hanya boleh publish setelah blueprint approved.
- Harga campaign tidak mengubah harga produk historis.
- Konfigurasi campaign dibekukan setelah publish.
- Diskon aktif berlaku untuk semua checkout baru pada preorder, termasuk organic buyer.
- Campaign link berfungsi sebagai attribution source.
- `baseline_json` menyimpan kondisi preorder saat campaign dipublikasikan.

## 7.2 `campaign_ai_sessions`

Menyimpan sesi diskusi antara pemilik UMKM dan AI.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| preorder_id | uuid | FK preorders |
| campaign_id | uuid | FK campaigns, NULLABLE |
| status | text | active / closed |
| summary_text | text | NULLABLE |
| context_version_hash | text | NOT NULL |
| version | integer | DEFAULT 1 |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Rules:

- Sesi dapat dibuat sebelum campaign ada.
- Sesi selalu terkait satu preorder.
- Diskusi boleh menghasilkan beberapa opsi.
- Pemilik dapat melanjutkan diskusi setelah refresh.
- Ringkasan chat tidak boleh mengandung data pribadi pelanggan.

## 7.3 `campaign_ai_messages`

Menyimpan pesan diskusi AI.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| session_id | uuid | FK campaign_ai_sessions |
| sequence | integer | > 0 |
| role | text | user / assistant |
| body_text | text | NOT NULL |
| proposal_json | jsonb | NULLABLE |
| context_hash | text | NULLABLE |
| ai_generation_id | uuid | FK ai_generations, NULLABLE |
| created_at | timestamptz | DEFAULT now() |

Constraints:

```text
UNIQUE(session_id, sequence)
```

Rules:

- Pesan bersifat immutable.
- Revisi strategi dicatat sebagai proposal atau pesan baru.
- `proposal_json` harus divalidasi.
- Tidak menyimpan hidden chain-of-thought.
- Chat tidak boleh otomatis approve atau publish campaign.

## 7.4 `ai_generations`

Menyimpan metadata dan hasil pemanggilan Gemini.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| preorder_id | uuid | NULLABLE |
| campaign_id | uuid | NULLABLE |
| session_id | uuid | NULLABLE |
| generation_type | text | NOT NULL |
| request_key | text | NOT NULL |
| input_hash | text | NOT NULL |
| model_id | text | NOT NULL |
| status | text | NOT NULL |
| output_json | jsonb | NULLABLE |
| error_code | text | NULLABLE |
| started_at | timestamptz | NULLABLE |
| finished_at | timestamptz | NULLABLE |
| created_at | timestamptz | DEFAULT now() |

Generation Types:

```text
strategies
discussion
blueprint
evaluation
memory
```

Statuses:

```text
running
success
failed
invalid_output
```

Constraints:

```text
UNIQUE(
  business_id,
  generation_type,
  request_key
)
```

Rules:

- Gemini output dianggap untrusted sebelum validasi.
- AI tidak boleh menjalankan SQL atau mengubah payment.
- AI tidak boleh melakukan approval atau publish.
- Informasi pelanggan dan secret tidak dikirim ke Gemini.
- Hasil valid disimpan untuk provenance dan debugging aman.
- Memory memakai canonical request key `memory:<evaluationId>:<sourceVersion>` agar alias request ID berbagi satu claim; hash mengikat sumber dan input.
- `admit_ai_generation` dipakai untuk klaim provider-backed baru; replay/checkpoint dan perubahan status tetap memakai lifecycle generation yang sama.

---

# 8. Campaign Blueprint & Execution

## 8.1 `campaign_blueprints`

Menyimpan rencana campaign yang dipilih pemilik UMKM.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| campaign_id | uuid | FK campaigns |
| version | integer | NOT NULL |
| approval_status | text | NOT NULL |
| blueprint_json | jsonb | NOT NULL |
| source_ai_generation_id | uuid | NULLABLE |
| context_hash | text | NOT NULL |
| approved_by_user_id | uuid | FK auth.users, NULLABLE |
| approved_at | timestamptz | NULLABLE |
| created_at | timestamptz | DEFAULT now() |

Approval Statuses:

```text
proposed
approved
discarded
```

Constraints:

```text
UNIQUE(campaign_id, version)
```

Hanya satu approved blueprint per campaign.

Blueprint minimal mencakup:

- Selected strategy
- Offer mechanism
- Marketing approach
- Campaign goal
- KPI target
- Rationale
- Assumptions
- Risks
- Campaign schedule
- Tasks
- Channels
- Captions
- Call-to-action

Business Rules:

- Semua aktivitas harus bisa dipreview sebelum approval.
- Revisi menghasilkan versi blueprint baru.
- Approval hanya melalui tindakan eksplisit pemilik.
- Approval dan materialisasi kalender dilakukan atomik.
- Approval tidak otomatis mempublikasikan campaign.

## 8.2 `campaign_tasks`

Menyimpan tugas pada kalender campaign.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| campaign_id | uuid | FK campaigns |
| blueprint_id | uuid | FK campaign_blueprints |
| task_key | text | NOT NULL |
| title | text | NOT NULL |
| description | text | NULLABLE |
| channel | text | NULLABLE |
| due_at | timestamptz | NOT NULL |
| completed_at | timestamptz | NULLABLE |
| version | integer | DEFAULT 1 |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Constraints:

```text
UNIQUE(blueprint_id, task_key)
```

Rules:

- Task dibuat setelah approval blueprint.
- Checklist disimpan pada `completed_at`.
- Menandai selesai tidak membuktikan promosi benar-benar diposting.
- Task tidak boleh diduplikasi jika approval request diulang.
- Task edit harus menggunakan optimistic concurrency.

## 8.3 `campaign_contents`

Menyimpan konten pemasaran.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| campaign_id | uuid | FK campaigns |
| blueprint_id | uuid | FK campaign_blueprints |
| content_key | text | NOT NULL |
| channel | text | NOT NULL |
| content_type | text | NOT NULL |
| body | text | NOT NULL |
| version | integer | DEFAULT 1 |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Content Types:

```text
headline
caption
cta
```

Constraints:

```text
UNIQUE(blueprint_id, content_key)
```

Rules:

- Konten dapat disalin secara manual oleh pemilik.
- Tidak ada auto-posting Instagram atau WhatsApp pada MVP.
- Edit konten tidak boleh diam-diam mengubah harga atau aturan penawaran.
- Hubungan konten ke task dapat menggunakan referensi blueprint atau relasi tambahan setelah review schema legacy.

---

# 9. Orders & Reservations

## 9.1 `orders`

Menyimpan header pesanan pelanggan.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| preorder_id | uuid | FK preorders, NULLABLE |
| attribution_campaign_id | uuid | FK campaigns, NULLABLE |
| pricing_campaign_id | uuid | FK campaigns, NULLABLE |
| public_order_number | text | UNIQUE |
| private_token_hash | text | UNIQUE, NULLABLE |
| idempotency_key | text | NULLABLE |
| request_hash | text | NULLABLE |
| source | text | public / manual |
| customer_name | text | NOT NULL |
| customer_email | text | NULLABLE |
| customer_contact | text | NULLABLE |
| fulfillment_date | date | NOT NULL |
| payment_mode | text | NOT NULL |
| external_payment_status | text | NULLABLE |
| external_payment_confirmed_at | timestamptz | NULLABLE |
| order_status | text | NOT NULL |
| fulfillment_status | text | NOT NULL |
| subtotal_idr | bigint | NOT NULL |
| discount_total_idr | bigint | NOT NULL |
| total_idr | bigint | NOT NULL |
| payment_due_at | timestamptz | NULLABLE |
| confirmed_at | timestamptz | NULLABLE |
| production_started_at | timestamptz | NULLABLE |
| ready_at | timestamptz | NULLABLE |
| fulfilled_at | timestamptz | NULLABLE |
| cancelled_at | timestamptz | NULLABLE |
| cancel_reason | text | NULLABLE |
| review_reason | text | NULLABLE |
| version | integer | DEFAULT 1 |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Order Statuses:

```text
pending_payment
awaiting_confirmation
active
expired
cancelled
requires_review
```

Fulfillment Statuses:

```text
pending_confirmation
confirmed
in_production
ready
fulfilled
cancelled
```

Payment Modes:

```text
midtrans_sandbox
external_manual
```

Rules:

- Public order wajib terkait preorder.
- Guest buyer tidak perlu Supabase Auth.
- Email wajib untuk public checkout.
- Public order membutuhkan private token dan idempotency key.
- Manual order boleh dicatat pemilik.
- Manual order tetap menggunakan pool kapasitas yang sesuai.
- Harga dihitung oleh backend dan disimpan sebagai snapshot.
- Pembayaran Sandbox tidak boleh diklaim sebagai pembayaran nyata.
- Payment dan fulfillment merupakan state yang berbeda.
- Pelanggan tidak dapat melihat order orang lain.

## 9.2 `order_items`

Menyimpan detail item pesanan.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| order_id | uuid | FK orders |
| preorder_item_id | uuid | FK preorder_items, NULLABLE |
| product_id | uuid | FK products |
| product_name_snapshot | text | NOT NULL |
| sku_snapshot | text | NOT NULL |
| quantity | integer | > 0 |
| base_unit_price_idr | bigint | NOT NULL |
| discount_bps_snapshot | integer | NOT NULL |
| discount_per_unit_idr | bigint | NOT NULL |
| final_unit_price_idr | bigint | NOT NULL |
| variable_cost_per_unit_idr | bigint | NULLABLE |
| cost_quality_snapshot | text | NOT NULL |
| line_total_idr | bigint | NOT NULL |
| pricing_campaign_id | uuid | FK campaigns, NULLABLE |
| created_at | timestamptz | DEFAULT now() |

Rules:

- Public order hanya berisi satu item pada MVP.
- Harga dan biaya saat order dibuat menjadi snapshot historis.
- Edit katalog tidak mengubah pesanan lama.
- Harga final dihitung dari base price dikurangi diskon per unit.
- Total order berasal dari perhitungan server.

## 9.3 `capacity_reservations`

Menyimpan reservasi kapasitas untuk order.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| order_id | uuid | FK orders |
| order_item_id | uuid | FK order_items, UNIQUE |
| preorder_item_id | uuid | FK preorder_items, NULLABLE |
| capacity_id | uuid | FK production_capacity |
| quantity | integer | > 0 |
| state | text | NOT NULL |
| expires_at | timestamptz | NULLABLE |
| released_at | timestamptz | NULLABLE |
| release_reason | text | NULLABLE |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

States:

```text
held
allocated
released
```

Meaning:

- `held`: kapasitas ditahan selama pembayaran.
- `allocated`: kapasitas sudah dialokasikan ke pesanan yang sah.
- `released`: kapasitas dilepaskan.

Contoh:

```text
Capacity: 40
Allocated: 30
Held: 2

Available: 8
```

Rules:

- Reservation bukan jumlah produk yang sudah terjual.
- Held reservation wajib memiliki expiry.
- Expired hold tidak mengurangi kapasitas tersedia.
- Allocation tidak boleh terjadi dua kali.
- Fulfilled order tetap mengonsumsi alokasi.
- Pembatalan setelah produksi tidak otomatis mengembalikan kapasitas.
- Perubahan reservation dilakukan dengan transaksi atomik.

## 9.4 `order_events`

Menyimpan histori perubahan order.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| order_id | uuid | FK orders |
| command_key | text | NULLABLE |
| event_type | text | NOT NULL |
| from_state | text | NULLABLE |
| to_state | text | NULLABLE |
| actor_type | text | NOT NULL |
| actor_user_id | uuid | FK auth.users, NULLABLE |
| details_json | jsonb | NULLABLE |
| occurred_at | timestamptz | DEFAULT now() |

Rules:

- Event bersifat append-only.
- Tidak menyimpan secret atau data pelanggan yang tidak diperlukan.
- Webhook replay dan retry tidak boleh menghasilkan perubahan status ganda.

## 9.5 `order_production_costs`

Mencatat biaya produksi yang benar-benar timbul.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| order_item_id | uuid | FK order_items |
| cost_kind | text | variable_production |
| quantity | integer | NOT NULL |
| cost_per_unit_idr | bigint | NULLABLE |
| amount_idr | bigint | NULLABLE |
| quality | text | NOT NULL |
| incurred_at | timestamptz | NOT NULL |
| resolved_by_user_id | uuid | NULLABLE |
| resolution_note | text | NULLABLE |
| created_at | timestamptz | DEFAULT now() |

Constraints:

```text
UNIQUE(order_item_id, cost_kind)
```

Rules:

- Biaya dicatat satu kali saat produksi dimulai.
- Biaya yang sudah timbul tidak dihapus ketika order dibatalkan.
- Biaya unknown tidak dianggap Rp0.
- Tidak mendukung partial production pada MVP.

---

# 10. Payments

## 10.1 `payments`

Menyimpan payment attempts Midtrans Sandbox.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| order_id | uuid | FK orders |
| provider | text | NOT NULL, DEFAULT midtrans_sandbox |
| provider_order_id | text | UNIQUE |
| provider_transaction_id | text | UNIQUE, NULLABLE |
| attempt_number | integer | NOT NULL |
| amount_idr | bigint | NOT NULL |
| status | text | NOT NULL |
| is_active_attempt | boolean | NOT NULL |
| qr_content | text | NULLABLE |
| qr_expires_at | timestamptz | NULLABLE |
| provider_paid_at | timestamptz | NULLABLE |
| verified_at | timestamptz | NULLABLE |
| applied_at | timestamptz | NULLABLE |
| review_reason | text | NULLABLE |
| version | integer | DEFAULT 1 |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Statuses:

```text
initiating
pending
paid_sandbox
expired
failed
cancelled
```

Constraints:

```text
UNIQUE(provider_order_id)
UNIQUE(order_id, attempt_number)
```

Additional partial unique constraints:

- Maksimal satu active payment attempt per order.
- Maksimal satu applied payment per order.

Rules:

- Beberapa payment attempts dapat terjadi.
- Hanya satu payment boleh diaplikasikan ke fulfillment.
- Provider settlement tambahan tetap dicatat sebagai fakta untuk review.
- Webhook harus diverifikasi.
- Browser redirect tidak cukup untuk menyatakan pembayaran berhasil.
- Provider timeout harus direkonsiliasi menggunakan reference yang sama.

## 10.2 `payment_events`

Menyimpan histori notifikasi provider.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| payment_id | uuid | FK payments |
| provider_event_key | text | NOT NULL |
| payload_hash | text | NOT NULL |
| provider_status | text | NOT NULL |
| signature_valid | boolean | NOT NULL |
| verified_at | timestamptz | NOT NULL |
| processed_at | timestamptz | NULLABLE |
| outcome | text | NOT NULL |
| created_at | timestamptz | DEFAULT now() |

Constraints:

```text
UNIQUE(payment_id, provider_event_key)
```

Rules:

- Verifikasi signature.
- Verifikasi amount, reference, status, dan environment.
- Duplicate webhook tidak mengalokasikan kapasitas dua kali.
- Notifikasi lama tidak menurunkan status pembayaran.
- Pembayaran terlambat membutuhkan review jika hold sudah tidak valid.

---

# 11. Email Confirmation

Email konfirmasi berhasil merupakan fitur wajib MVP.

## 11.1 Flow

```text
Guest Checkout
    ↓
Order Created
    ↓
Capacity Held
    ↓
Midtrans Sandbox Payment
    ↓
Verified Webhook
    ↓
Payment Applied
    ↓
Order Updated
    ↓
Email Job Enqueued
    ↓
Transactional Email Provider
    ↓
Buyer Receives Confirmation
```

## 11.2 Required Email Information

Email minimal mencakup:

- Nama bisnis
- Nomor order
- Nama produk
- SKU
- Quantity
- Harga normal
- Diskon
- Harga final
- Total pembayaran
- Status pembayaran Sandbox
- Tanggal fulfillment
- Petunjuk pickup
- Kontak bantuan UMKM yang disetujui

Jangan mengklaim pembayaran Sandbox sebagai pembayaran uang nyata.

Email sukses hanya dikirim setelah verified payment benar-benar applied.

## 11.3 Email Idempotency

Gunakan `job_runs` sebagai durable email queue.

Dedupe key:

```text
order_id:template_version
```

Webhook berulang tidak boleh menghasilkan beberapa logical email jobs.

Provider timeout dapat menghasilkan status ambigu, sehingga retry harus mempertimbangkan idempotency dan hasil provider.

Jangan menyimpan raw bearer tracking token dalam outbox atau email tanpa rancangan token issuance yang aman.

---

# 12. Campaign Financial Costs

## 12.1 `campaign_costs`

Menyimpan biaya promosi aktual.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| campaign_id | uuid | FK campaigns |
| category | text | NOT NULL |
| description | text | NULLABLE |
| amount_idr | bigint | >= 0 |
| incurred_at | timestamptz | NOT NULL |
| voided_at | timestamptz | NULLABLE |
| void_reason | text | NULLABLE |
| version | integer | DEFAULT 1 |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Categories:

```text
advertising
printing
other
```

Rules:

- `budget_cap_idr` bukan actual expense.
- Hanya biaya aktual yang dicatat.
- Koreksi biaya menggunakan void atau replacement, bukan menghapus histori.
- Jika biaya berubah, completeness evaluation harus diperiksa kembali.
- Biaya produksi tidak dicatat ulang sebagai biaya promosi.

---

# 13. Analytics

juarasatu menggunakan dua jenis analytics.

## 13.1 Preorder Analytics

Mengukur keseluruhan performa preorder.

Minimal metrics:

| Metric | Description |
|---|---|
| orders_created | Total pesanan dibuat |
| pending_orders | Pesanan menunggu pembayaran |
| paid_units | Unit pesanan yang sudah dibayar valid |
| held_units | Unit dalam reservation aktif |
| allocated_units | Unit yang sudah dialokasikan |
| available_units | Kapasitas/kuota yang masih dapat dipesan |
| fulfilled_units | Unit pesanan yang selesai dipenuhi |
| target_units | Target penjualan |
| quota_units | Batas maksimum preorder |
| paid_target_gap | Kekurangan unit terhadap target |
| paid_goal_ratio | Rasio pencapaian target |
| valid_order_value_idr | Nilai order paid-valid |
| fulfilled_sales_value_idr | Nilai order fulfilled |
| campaign_spend_actual_idr | Total biaya campaign aktual |
| estimated_contribution_idr | Estimasi kontribusi |
| daily_paid_units | Perkembangan paid units per hari |

Contoh:

```text
Target: 40
Paid valid: 30
Held: 2
Available: 8

Target achievement: 75%
Target gap: 10
```

Target gap dan available units merupakan dua metrik berbeda.

## 13.2 Campaign Analytics

Mengukur performa campaign tertentu.

Minimal metrics:

| Metric | Description |
|---|---|
| baseline_preorder_paid_units | Paid units sebelum campaign |
| current_preorder_paid_units | Paid units saat snapshot |
| net_paid_progress_change | Perubahan net paid units |
| paid_units_in_window | Paid units dalam periode campaign |
| attributed_paid_units | Paid units dari campaign link |
| discounted_paid_units | Paid units dengan harga campaign |
| discount_value_applied_idr | Total diskon aktual |
| completed_tasks | Task selesai |
| total_tasks | Jumlah task |
| task_completion_ratio | Rasio penyelesaian task |
| actual_spend_idr | Biaya aktual campaign |
| budget_cap_idr | Batas budget |
| target_additional_units | Target tambahan penjualan |
| target_completion_ratio | Pencapaian target tambahan |
| scoped_fulfilled_sales_value_idr | Revenue fulfilled dalam financial scope |
| scoped_production_cost_incurred_idr | Biaya produksi terkait scope |
| estimated_campaign_contribution_idr | Estimasi kontribusi campaign |

## 13.3 Attribution vs Pricing

Dua konsep ini harus dipisahkan.

Contoh:

Campaign diskon 10% sedang aktif.

| Buyer | Source | Harga | Attribution | Pricing |
|---|---|---|---|---|
| Ani | Campaign link | Diskon 10% | campaign ID | campaign ID |
| Rina | Regular preorder link | Diskon 10% | NULL | campaign ID |
| Dina | Sebelum campaign aktif | Normal | NULL | NULL |

`attribution_campaign_id` tidak otomatis membuktikan bahwa campaign menyebabkan penjualan.

## 13.4 Analytics Rules

- Semua perhitungan numerik dilakukan backend.
- Gemini tidak menjadi sumber angka.
- Aggregation harus mencegah duplicate join/fan-out.
- Revenue dan biaya produksi dihitung berdasarkan status yang benar.
- Missing cost menghasilkan nilai unknown/null, bukan otomatis Rp0.
- Data Sandbox dan dummy harus diberi label.
- Tidak mengklaim causality atau ROAS tanpa data yang memadai.

---

# 14. AI Campaign Evaluation

## 14.1 `campaign_evaluations`

Menyimpan snapshot hasil perhitungan dan interpretasi Gemini.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| campaign_id | uuid | FK campaigns |
| blueprint_id | uuid | FK campaign_blueprints |
| metrics_schema_version | integer | NOT NULL |
| metrics_json | jsonb | NOT NULL |
| analysis_json | jsonb | NULLABLE |
| limitations_json | jsonb | NOT NULL |
| source_ai_generation_id | uuid | NULLABLE |
| evaluation_kind | text | NOT NULL |
| calculated_at | timestamptz | NOT NULL |
| evaluated_at | timestamptz | NOT NULL |
| created_at | timestamptz | DEFAULT now() |

Evaluation Types:

```text
provisional
final
```

Rules:

- KPI dihitung sebelum diberikan kepada Gemini.
- Gemini hanya menginterpretasikan hasil.
- Evaluation history bersifat append-only.
- Membuka laporan lama tidak memanggil Gemini lagi.
- Evaluation tetap dapat disimpan jika Gemini gagal.
- Final evaluation memerlukan campaign yang sudah ditutup dan data operasional relevan yang cukup lengkap.
- Evaluasi tidak boleh menyimpulkan hubungan kausal tanpa bukti.

---

# 15. Business Memory & RAG

## 15.1 `campaign_memories`

Menyimpan pengalaman campaign yang dapat diambil kembali dengan semantic retrieval.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | FK businesses |
| campaign_id | uuid | FK campaigns |
| source_evaluation_id | uuid | FK campaign_evaluations |
| source_blueprint_id | uuid | NULLABLE |
| source_version | integer | NOT NULL |
| summary_text | text | NOT NULL |
| lessons_json | jsonb | NOT NULL |
| limitations_json | jsonb | NOT NULL |
| content_hash | text | NOT NULL |
| review_status | text | NOT NULL |
| embedding_status | text | NOT NULL |
| embedding | vector(768) | NULLABLE |
| embedding_model | text | NULLABLE |
| embedding_profile | text | NULLABLE |
| embedding_version | integer | NOT NULL |
| approved_at | timestamptz | NULLABLE |
| indexed_at | timestamptz | NULLABLE |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

Constraints:

```text
UNIQUE(
  business_id,
  source_evaluation_id,
  source_version
)
```

Review Status:

```text
draft
approved
```

Embedding Status:

```text
queued
ready
failed
stale
```

## 15.2 Embedding

Gunakan pgvector dengan dimensi tetap:

```sql
extensions.vector(768)
```

Jika pgvector terpasang pada schema `extensions`.

Model embedding dan pengaturan output dimensionality harus diverifikasi agar benar-benar menghasilkan 768 dimensi.

Jangan memasukkan embedding dengan dimensi berbeda atau mengubahnya secara arbitrer.

## 15.3 Business Memory Flow

```text
Campaign Completed
    ↓
Final Campaign Evaluation
    ↓
Memory Summary Generated
    ↓
Owner Review & Approval
    ↓
Embedding Generation (768)
    ↓
Stored in campaign_memories
    ↓
Private Semantic Retrieval
    ↓
Gemini Uses Relevant Past Experience
```

## 15.4 Retrieval Rules

- Hanya mengambil memory milik bisnis terkait.
- `review_status = approved`.
- `embedding_status = ready`.
- Embedding model/profile harus kompatibel.
- Tenant filtering dilakukan sebelum ranking/limit.
- Memory tidak menjadi sumber harga atau kapasitas terkini.
- Tidak menggunakan global knowledge documents.
- Tidak membuat fake memory untuk UMKM baru.

## 15.5 Cold-Start

Jika bisnis belum memiliki memory:

```text
SQL Business Context
    +
Gemini General Knowledge
    ↓
Campaign Strategy
```

Jika sudah memiliki memory:

```text
SQL Business Context
    +
Private Campaign Memory Retrieval
    +
Gemini
    ↓
Context-Aware Campaign Strategy
```

## 15.6 Repeat, Refine, Explore

Memory tidak boleh melarang strategi yang sama.

AI boleh:

- Repeat: menggunakan kembali pendekatan relevan.
- Refine: memperbaiki strategi sebelumnya.
- Explore: mencoba pendekatan baru.

Semua rekomendasi harus mempertimbangkan keterbatasan data dan konteks bisnis terbaru.

---

# 16. Infrastructure Tables

## 16.1 `job_runs`

Menangani pekerjaan persisten yang aman terhadap retry.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| job_type | text | NOT NULL |
| entity_id | uuid | NULLABLE |
| business_id | uuid | NULLABLE |
| dedupe_key | text | NOT NULL |
| status | text | NOT NULL, DEFAULT queued |
| attempt_count | integer | NOT NULL, DEFAULT 0 |
| next_run_at | timestamptz | NOT NULL, DEFAULT now() |
| locked_until | timestamptz | NULLABLE |
| last_error_code | text | NULLABLE |
| provider_reference | text | NULLABLE |
| created_at | timestamptz | DEFAULT now() |
| finished_at | timestamptz | NULLABLE |

Job Types:

```text
expire
reconcile
embed_memory
send_paid_email
```

Statuses:

```text
queued
running
succeeded
retryable_failed
dead
```

Constraints:

```text
UNIQUE(job_type, dedupe_key)
```

Rules:

- Job dapat di-retry tanpa menggandakan efek.
- Worker claim dilakukan secara atomik.
- Job memiliki lease dan retry limit.
- Email confirmation menggunakan `send_paid_email`.
- Jangan menggunakan in-memory queue sebagai satu-satunya sumber kebenaran.
- Jangan menyimpan secret atau PII dalam error metadata.

## 16.2 `rate_limit_buckets`

Menyimpan rate limit state bila menggunakan implementasi PostgreSQL.

| Column | Type | Constraints |
|---|---|---|
| bucket_key_hash | text | PK composite |
| window_start | timestamptz | PK composite |
| count | integer | NOT NULL |
| expires_at | timestamptz | NOT NULL |

Primary Key:

```text
(bucket_key_hash, window_start)
```

Rules:

- Gunakan hashed/HMAC identifiers.
- Tidak menyimpan raw IP, email, atau token.
- Increment dilakukan secara atomik.
- Implementasi distributed store lain yang setara boleh digunakan setelah review.

### Atomic AI generation admission (Batch 04B)

`public.admit_ai_generation(p_business_id uuid, p_actor_user_id uuid, p_generation_id uuid,
p_generation_type text, p_request_key text, p_input_hash text, p_model_id text, p_preorder_id uuid,
p_session_id uuid, p_expected_version integer, p_context_hash text, p_message text,
p_minute_key_hash text, p_hour_key_hash text, p_day_key_hash text, p_daily_limit integer) → jsonb`.
Fungsi hanya dapat dijalankan `service_role`; ia memeriksa owner lewat `private.require_owner`,
melock business row, lalu menggunakan waktu PostgreSQL untuk fixed minute, hour, dan hari
Asia/Jakarta. Strategist memanggil `claim_ai_generation` existing di dalam subtransaksi yang
sama; Blueprint, Evaluation, dan Memory memasukkan `ai_generations` dengan identitas kanonis.
Hanya klaim baru yang memakai `take_rate_limit` untuk ketiga bucket (6/menit, 30/jam, daily
cap tervalidasi server). Hasil `claimed` memberi izin inference hanya kepada pemanggil yang
menerima ACK; `running`/hasil terminal adalah replay. Hasil `denied` memuat `window` dan
`retryAfter` dari jam database, setelah klaim, pesan, perubahan session version, dan ketiga
increment di-rollback. Tidak ada transaksi SQL yang ditahan selama provider berjalan.
Quota terhitung saat admission commit, walaupun provider kemudian gagal atau ACK hilang.
Hash bucket HMAC dan cap berasal dari server terautentikasi; raw secret tidak dikirim ke SQL.

## 16.3 `domain_events`

Audit generik untuk domain event penting.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| business_id | uuid | NULLABLE |
| entity_type | text | NOT NULL |
| entity_id | uuid | NOT NULL |
| command_key | text | NULLABLE |
| event_type | text | NOT NULL |
| actor_type | text | NOT NULL |
| actor_user_id | uuid | NULLABLE |
| safe_details_json | jsonb | NULLABLE |
| occurred_at | timestamptz | NOT NULL, DEFAULT now() |

Rules:

- Append-only.
- Tidak menyimpan PII.
- Penggunaan dapat ditunda ke P1 jika audit domain penting sudah tersedia.
- Menunda tabel audit generik tidak berarti menghapus audit order/payment yang wajib.

---

# 17. Financial Calculations

## 17.1 Shared Calculator

```text
discount_per_unit_idr =
  floor(base_unit_price_idr * discount_bps / 10000)

final_unit_price_idr =
  base_unit_price_idr - discount_per_unit_idr

subtotal_idr =
  quantity * base_unit_price_idr

discount_total_idr =
  quantity * discount_per_unit_idr

total_idr =
  quantity * final_unit_price_idr

scenario_contribution_idr =
  (final_unit_price_idr - variable_cost_per_unit_idr)
  * assumed_additional_units
  - assumed_promotion_cost_idr
```

Rumus yang sama harus digunakan pada:

- Promotion Simulator
- Campaign Offer Validation
- Campaign Publishing
- Checkout
- Financial Analytics

## 17.2 Campaign Simulator Rules

Simulator:

- Menggunakan harga dan biaya dari database.
- Mendukung perubahan diskon, asumsi unit, dan biaya promosi.
- Tidak memprediksi jumlah pembeli.
- Tidak membuat order.
- Tidak mengubah payment.
- Tidak membuat reservation.
- Tidak mengubah actual campaign costs.
- Hasil skenario tidak otomatis dianggap hasil bisnis sebenarnya.
- Gemini dapat menjelaskan perhitungan, tetapi kalkulasi dilakukan oleh service deterministik.

---

# 18. Capacity & Availability

## 18.1 Effective Reservations

```text
effective_held =
  SUM(quantity WHERE state='held'
    AND expires_at > database_now)

allocated =
  SUM(quantity WHERE state='allocated')
```

## 18.2 Availability Formula

```text
capacity_available =
  capacity.total_units
  - allocated
  - effective_held

event_available =
  preorder_item.quota_units
  - event_allocated
  - event_effective_held

orderable_units =
  MIN(capacity_available, event_available)

paid_target_gap =
  MAX(target_units - eligible_paid_units, 0)
```

## 18.3 Example

```text
Preorder:
  Kaos Oversized

Target:
  40

Quota:
  40

Paid:
  30

Held:
  2

Available:
  8

Target Gap:
  10
```

Target gap tidak sama dengan jumlah yang masih bisa langsung dibeli.

## 18.4 Concurrency

- Semua order harus memeriksa kapasitas dalam transaksi atomik.
- Lock row yang relevan sebelum menghitung availability final.
- Re-read status setelah lock.
- Jangan melakukan read capacity dan insert reservation sebagai transaksi terpisah tanpa proteksi.
- Idempotency key harus mencegah order ganda.
- Expired reservation tidak boleh terus memblokir stok.
- Late payment harus menjalani review jika kapasitas sudah dilepas.

---

# 19. Atomic Database Operations

Operasi berikut merupakan kontrak target, bukan klaim RPC sudah tersedia.

| Operation | Responsibility |
|---|---|
| create_business_with_owner | Create business dan owner membership secara atomik |
| publish_preorder | Validasi dan publish preorder |
| create_preorder_order | Create order, item, hold, dan token secara atomik |
| create_manual_order | Catat pesanan manual dengan capacity guard |
| approve_blueprint | Approve blueprint dan materialize task/content |
| publish_campaign | Validasi penawaran dan baseline |
| claim_payment_attempt | Membuat atau memakai attempt aktif |
| apply_verified_payment | Apply payment, allocate hold, enqueue email |
| expire_or_cancel_order | Expire/cancel dan release aman |
| advance_fulfillment | Update status fulfillment legal |
| accept_late_payment | Re-allocate melalui validasi kapasitas ulang |
| read_metrics_snapshot | Menghasilkan KPI konsisten |
| claim_jobs | Mengambil pekerjaan yang siap diproses |

## 19.1 Lock Ordering

Gunakan urutan lock konsisten:

```text
production_capacity
    ↓
preorders / preorder_items
    ↓
campaigns
    ↓
orders
    ↓
payments / reservations
```

## 19.2 Payment Integration Boundary

Midtrans API dipanggil di luar transaksi PostgreSQL.

Flow:

```text
Order + Hold Commit
    ↓
Payment Attempt Stored
    ↓
Midtrans API Call
    ↓
Verified Webhook / Reconciliation
    ↓
Atomic Payment Application
    ↓
Email Job Created
```

HTTP dan database tidak memiliki satu transaksi atomik bersama.

Karena itu, timeout provider harus ditangani dengan reconciliation.

---

# 20. Security & Row Level Security

## 20.1 Owner Access

Owner hanya dapat membaca atau mengubah data bisnis miliknya.

Identitas owner berasal dari Supabase Auth dan hubungan `business_members`, bukan dari `business_id` yang dikirim browser.

## 20.2 Guest Access

Guest hanya dapat:

- Melihat public preorder projection.
- Melihat campaign yang dipublikasikan.
- Membuat preorder lewat endpoint tervalidasi.
- Melakukan checkout melalui server.
- Melacak order sendiri menggunakan private token.

Guest tidak boleh membaca tabel privat secara langsung.

## 20.3 RLS Principles

- ENABLE RLS untuk tabel privat.
- Default deny.
- Owner tenant isolation.
- Composite FK untuk menjaga kesesuaian tenant.
- Payment, reservation, dan approved flags tidak dapat diubah langsung oleh browser.
- Privileged RPC harus memverifikasi authorization.
- SECURITY DEFINER memakai fixed search_path dan restricted grants.

## 20.4 Business Memory Security

- Retrieval hanya dari `business_id` milik owner.
- Filter tenant sebelum similarity ranking.
- Customer PII tidak dimasukkan ke embedding.
- Memory tidak dibagikan lintas UMKM.

## 20.5 Sensitive Data

Jangan menyimpan atau mencetak:

- API keys
- JWT secrets
- Raw private order tokens
- Provider secret keys
- Customer PII dalam AI prompts
- Raw payment payload yang tidak diperlukan

---

# 21. Required Database Indexes

Index utama yang harus direview dan diimplementasikan sesuai query aktual:

```text
business_members(user_id)
business_members(business_id)

products(business_id, sku)

production_capacity(
  business_id,
  product_id,
  fulfillment_date
)

preorders(business_id, status, created_at)

preorder_items(preorder_id)

campaigns(preorder_id, status)

campaign_blueprints(campaign_id, version)

campaign_tasks(blueprint_id, task_key)

campaign_contents(blueprint_id, content_key)

campaign_ai_messages(session_id, sequence)

ai_generations(
  business_id,
  generation_type,
  request_key
)

orders(business_id, idempotency_key)
orders(public_order_number)
orders(private_token_hash)

capacity_reservations(order_item_id)

payments(provider_order_id)
payments(order_id, attempt_number)

payment_events(payment_id, provider_event_key)

campaign_memories(
  business_id,
  source_evaluation_id,
  source_version
)

job_runs(job_type, dedupe_key)
```

Tambahkan partial unique index untuk:

- Maksimal satu approved blueprint per campaign.
- Maksimal satu published campaign per preorder.
- Maksimal satu published preorder per bisnis/fulfillment date.
- Maksimal satu active payment attempt per order.
- Maksimal satu applied payment per order.

Perhatikan bahwa constraint satu published preorder per bisnis/tanggal harus mempertimbangkan status dan transisi legal.

---

# 22. Migration Strategy

Schema ini adalah target design berdasarkan PRD v2.1.

Migration lama tidak boleh diedit secara langsung jika sudah diterapkan.

## 22.1 Legacy Tables

Rancangan awal sebelumnya menggunakan:

```text
campaigns
  ├── product_id
  ├── quota_units
  ├── price
  └── fulfillment_date
```

Dalam target baru, preorder dan campaign dipisahkan:

```text
preorders
    ↓
preorder_items
    ↓
products

preorders
    ↓
campaigns
    ↓
campaign_blueprints
```

## 22.2 Migration Changes

Perubahan konseptual yang diperlukan:

| Legacy | Target |
|---|---|
| Campaign merangkap event preorder | Preorder terpisah dari campaign |
| Capacity per business/date | Capacity per product/date |
| Reservation per order | Reservation per order item |
| Campaign-first orders | Orders memiliki preorder dan attribution/pricing links |
| Knowledge documents + chunks | Private campaign_memories |
| Payment basic flow | Payment attempts, applied point, durable email job |
| Campaign cost only | Campaign cost + incurred production cost ledger |

## 22.3 Required Migration Process

1. Audit migration yang benar-benar ada.
2. Bandingkan schema aktual dengan target.
3. Tandai tabel KEEP, ALTER, CREATE, BACKFILL, DEPRECATE atau DROP.
4. Review breaking changes.
5. Buat migration baru yang menjaga data.
6. Tambahkan foreign key, RLS, indexes dan RPC.
7. Generate ulang TypeScript database types.
8. Jalankan local integration tests.
9. Review hasil bersama tim.
10. Deploy hanya setelah mendapat izin.

Jangan menjalankan destructive reset, truncate, cascade delete, atau mengubah migration lama tanpa persetujuan eksplisit.

---

# 23. Implementation Priority

## G0 — Audit & Contracts

Owners: All members.

- Audit migration.
- Finalisasi kontrak database.
- Verifikasi Midtrans Sandbox.
- Verifikasi email provider.
- Verifikasi embedding 768.
- Tetapkan shared TypeScript DTO.

## G1 — Preorder Foundation

Owner: Member 1.

- Supabase Auth.
- Business onboarding.
- Product management.
- Production capacity.
- Preorder creation and publishing.
- Guest/manual order.
- Capacity reservation.
- Order tracking.

## G2 — Payment & Email

Owners: Member 3 + Member 1.

- Midtrans Sandbox integration.
- Payment attempts.
- Verified webhook.
- Payment reconciliation.
- Email confirmation.
- Fulfillment status integration.

## G3 — AI Campaign

Owners: Member 2 + Member 3.

- Business context builder.
- Gemini strategy generation.
- Persistent AI discussion.
- Campaign Simulator.
- Campaign proposal.
- Full blueprint.
- Calendar preview.
- Revision and approval.
- Campaign publishing and execution.

## G4 — Analytics & Memory

Owners: Member 3 + Member 2.

- Preorder Analytics.
- Campaign Analytics.
- Actual campaign costs.
- AI Evaluation.
- Campaign Memory.
- Embedding generation.
- Private semantic retrieval.

## G5 — Testing & Release

Owners: All members.

- RLS tests.
- Cross-tenant authorization tests.
- Atomic transaction tests.
- Payment webhook replay tests.
- Overbooking/concurrency tests.
- Email duplicate prevention tests.
- Golden financial calculation tests.
- Business Memory isolation tests.
- End-to-end user journey.
- Deployment verification.

---

# 24. Open Technical Review Items

Bagian ini harus diperiksa sebelum membuat migration SQL.

## 24.1 Capacity Unique Constraint

Kapasitas adalah per produk/tanggal, tetapi hanya satu preorder published per bisnis/tanggal pada MVP.

Rekomendasi kontrak:

```text
production_capacity:
  UNIQUE(business_id, product_id, fulfillment_date)

preorders:
  max one published per business/fulfillment_date
```

Jangan otomatis menggunakan UNIQUE `(business_id, fulfillment_date)` pada `production_capacity` karena akan mencegah pencatatan kapasitas beberapa produk pada tanggal sama meskipun preorder-nya belum dipublikasikan.

## 24.2 Public Order Single Item

Public order hanya satu item.

PostgreSQL tidak bisa membuat partial index di `order_items` yang langsung membaca `orders.source` dari tabel lain.

Aturan ini harus dijaga melalui service/RPC atau desain constraint yang valid.

## 24.3 Campaign Content & Tasks

Migration lama mungkin mempunyai `campaign_contents.campaign_task_id`.

PRD v2.1 tidak menetapkan field itu sebagai minimum wajib.

Tentukan apakah kolom tersebut dipertahankan untuk menghubungkan caption ke tugas kalender setelah audit consumer dan migration.

## 24.4 Embedding Profile

Dimensi 768 sudah disepakati.

Namun model, parameter output dimensionality, extension schema, serta operator pgvector harus diverifikasi.

Jika extension dipasang pada schema `extensions`, gunakan tipe dan operator yang ter-qualify secara benar.

## 24.5 Email Private Tracking Token

Email konfirmasi wajib MVP.

Namun, jangan membuat private tracking link menggunakan hash token atau mengekspos raw bearer token.

Email tanpa link privat tetap dapat memenuhi kebutuhan konfirmasi minimal. Link pemulihan privat membutuhkan desain terpisah yang aman.

---

# 25. Definition of Done

Schema dan implementasinya dinyatakan siap setelah:

- [ ] Migration aktual sudah diaudit.
- [ ] Target database dan PRD konsisten.
- [ ] Semua foreign key dan unique constraints valid.
- [ ] Tenant isolation ditegakkan.
- [ ] Preorder dapat berjalan tanpa AI campaign.
- [ ] Kapasitas tidak dapat oversold.
- [ ] Checkout dan pembayaran memakai idempotency.
- [ ] Webhook terverifikasi dan aman terhadap replay.
- [ ] Email konfirmasi terkirim setelah verified Sandbox payment.
- [ ] Simulator dan checkout memakai rumus sama.
- [ ] Approval blueprint atomik.
- [ ] Calendar tasks tidak terduplikasi.
- [ ] Diskon aktif berlaku bagi pembeli organik dan campaign-link buyer.
- [ ] Preorder Analytics dan Campaign Analytics terpisah.
- [ ] AI Evaluation menggunakan KPI backend.
- [ ] Business Memory menggunakan vector(768).
- [ ] Retrieval memory hanya untuk bisnis terkait.
- [ ] Cold-start tanpa memory ditangani dengan benar.
- [ ] Unit, integration, concurrency, dan E2E tests lulus.
- [ ] Tidak ada klaim integrasi berhasil tanpa bukti.
- [ ] Tidak ada commit/push/deploy/reset tanpa izin.

---

# 26. References

Dokumen acuan:

1. [PRD v2.1](requirements/PRD.md)
2. [Aturan database](requirements/database-rules.md)
3. `supabase/migrations/20261110120000_initial_schema.sql` — satu-satunya migration aktif; menyatukan seluruh migration sebelumnya

PRD merupakan acuan target produk.

Migration merupakan sumber kebenaran kondisi database. Perubahan schema berikutnya ditambahkan sebagai migration baru setelah file init, bukan dengan mengubah file init.

Jika terdapat ketidaksesuaian, lakukan schema diff dan review sebelum implementasi.

**Dokumen ini adalah kontrak database untuk dibaca; SQL yang dijalankan ada di migration init.**

---

# 27. Addendum Slice 7B — Evaluation CAS dan completion

Kontrak RPC evaluasi berikut termasuk dalam migration init. Bagian ini tidak menambah tabel/kolom/enum/index/RLS/grant tabel.

- `record_campaign_evaluation_cas` menerima expected latest evaluation UUID (nullable untuk awal), memeriksa revision sumber dalam transaksi dan menyimpan generation/review sebagai snapshot append-only. Review mengacu parent terbaru, dengan actor/waktu dan sumber tetap tersimpan.
- `finalize_campaign_evaluation` memeriksa business/preorder/campaign, expected campaign version/hash, latest owner-reviewed evaluation, approved published blueprint, kelengkapan biaya/KPI dan revision sumber; lalu menyimpan final evaluation dan `closed → completed` atomik. Final evaluation UUID adalah request UUID yang durable; audit/referensi final berada dalam `metrics_json.finalization`, bukan kolom campaign baru.
- Kedua RPC hanya dapat dieksekusi service_role melalui boundary server yang mengautentikasi owner. `SECURITY DEFINER`, owner migration `postgres`, `search_path=''`; PUBLIC/anon/authenticated tidak mendapat EXECUTE.
- Guard biaya, task, konten, blueprint dan insert evaluasi ikut lock campaign. Perubahan biaya tetap membatalkan konfirmasi completeness. ID/versi seluruh source set diperiksa; insert phantom tidak melewati CAS. Setelah completed, ordinary campaign/source writes ditolak, termasuk no-op UPDATE. Koreksi setelah completed belum mempunyai lifecycle yang disetujui.
- Mode completion yang didukung baru `development_synthetic`: KPI tetap `development_fixture`, `isProvisional=true`, analysis sintetis dan cohort preorder nyata harus kosong. Server hanya development/test dengan opt-in sintetis. Audit JSON menyimpan mode, actor, timestamp, reviewed evaluation, request, expected/completed campaign version dan source hash. Ini bukan finalisasi performa terverifikasi.
- Finalisasi produksi ditolak sampai otoritas revision C6 terverifikasi tersedia. `evaluation_kind=final` pada completion simulasi tidak menghapus provenance sintetis. SQL menolak status memory approved untuk sumber completion ini; tidak ada memory yang otomatis dibuat.
- `created_at` evaluasi baru diurutkan monoton di bawah lock campaign (termasuk writer lama), agar token latest tidak bergantung pada waktu mulai transaksi yang menunggu. Default kolom tetap sama.

---

# 28. Addendum Slice 8B — transaksi Business Memory

Kontrak RPC Business Memory berikut termasuk dalam migration init. Bagian ini tidak menambah tabel, kolom, enum, index, RLS, atau grant tabel.

- `approve_campaign_memory(uuid,uuid,text,text,text,uuid) → uuid` mempertahankan signature, kini service-only setelah auth owner di server. Lock campaign context → memory, pemeriksaan source/latest/review/hash/version/provenance, kemudian approval + `domain_events` audit + enqueue unik dalam satu transaksi. EXECUTE authenticated yang lama dicabut. Sumber `development_synthetic` tetap ditolak; otoritas verified C6/C7 belum tersedia dan tidak digantikan flag JSON.
- `claim_memory_jobs(p_business_id uuid,p_model text,p_profile text,p_embedding_version integer,p_limit integer=5,p_lease_seconds integer=60,p_max_attempts integer=5) → SETOF job_runs` membatasi bisnis/jenis memory/profil/versi/durable key, memakai SKIP LOCKED, lease, monotonic attempt dan terminal exhaustion. Tidak mengambil job email/payment. Klaim kompatibilitas queue tidak menggantikan validasi kelayakan source oleh worker/writeback.
- `complete_memory_index_job(p_business_id uuid,p_job_id uuid,p_attempt_count integer,p_memory_id uuid,p_content_hash text,p_embedding_version integer,p_model text,p_profile text,p_embedding vector=NULL,p_error_code text=NULL,p_max_attempts integer=5) → void` memvalidasi live attempt/lease, binding/key/source/profil dan vector tepat 768 finite/nonzero. Sukses menyimpan vector/ready serta succeeded/ack atomik; kode error aman menyimpan failed/retryable/dead atomik. Ready-vector recovery dan acknowledgement identik idempotent. Provider tetap dipanggil di luar SQL.
- Ketiga public RPC SECURITY DEFINER, `search_path=''`, owner postgres, EXECUTE hanya service_role. Private transition helpers tidak dapat dieksekusi role aplikasi. Guard memory/job menutup jalur direct service indexing. RPC vector-only lama tidak lagi memiliki service EXECUTE; `finish_job` tetap melayani jenis lain dan menolak `embed_memory`.
- `match_campaign_memories` tetap SECURITY INVOKER owner-scoped dengan filter tenant/approved/ready/model/profile/version sebelum ranking. Aplikasi tetap memerlukan source attestation tepercaya; belum ada approved production RAG dari completion sintetis.

---

# 29. Kontrak pascamerge — A1/A2/A3 dan sinkronisasi A5

`supabase/migrations/` berisi satu migration aktif (init), berbeda dari snapshot historis `database/v2.1/supabase/migrations/` dan `database/legacy/migrations/` yang tidak dijalankan. Tidak ada tabel bernama `reservations` atau `payment_attempts`: entitas aktual ialah `capacity_reservations` dan `payments` (satu row per payment attempt).

| Area | Kontrak aktual |
|---|---|
| Publikasi preorder, A3 | `publish_preorder(uuid,integer) → void` tetap authenticated-only dan derive business dari sesi. `publish_preorder(uuid,uuid,integer,uuid DEFAULT NULL) → preorders` tetap mendukung owner dan service dengan explicit owner actor. Keduanya memanggil private canonical primitive dengan version/draft/product/schedule/remaining-capacity guards. Pickup snapshot wajib berisi `pickup_instructions: string`, `public_contact: string atau null`, `intake_cutoff_at: string`, `fulfillment_window_end_at: string`. Harga/nama/SKU dibekukan pada preorder_items, tanggal/window pada preorders. Row lama tidak dibackfill otomatis. |
| Generic job claim, A2 | `claim_jobs(text[],integer,integer) → jsonb` service-only, menerima hanya expire/reconcile/send_paid_email, limit 1–100, lease 1–3600 detik, maksimum 5 attempt; validation sebelum mutation, scoped exhaustion dan SKIP LOCKED. Legacy `claim_jobs(integer DEFAULT 10,integer DEFAULT 60,integer DEFAULT 5) → SETOF job_runs` mempertahankan signature tetapi selalu menolak dengan TYPED_JOB_CLAIM_REQUIRED untuk service call. |
| Generic ACK, A1 | `complete_job(uuid,integer,text DEFAULT NULL) → boolean`, `fail_job(uuid,integer,text,text DEFAULT NULL) → text` service-only; menolak embed_memory dan memerlukan running/current attempt/live lease sesudah lock. Stale/missing menghasilkan false/NULL; failure memakai retry 1/5/15/60 menit dan dead pada attempt kelima. |
| Memory | embed_memory memakai dedicated claim dan atomic indexing §28. Public synthetic approval tetap dilarang; vector-only legacy completion tidak mempunyai service EXECUTE. Private helpers bukan application RPC meskipun ada di catalog. |
| Payment persistence | Canonical core `apply_verified_payment(text,text,text,text,text,bigint,timestamptz) → jsonb` memakai parameter provider_order_id/event_key/payload_hash/status/transaction_id/amount_idr/paid_at dengan prefix `p_`. Legacy overload tetap ada; caller tidak boleh menyamakan signature/return. `payments` menyimpan attempt/provider facts, `payment_events` dedupe event, dan verified apply mengalokasikan hold serta enqueue email atomik. Keberadaan RPC bukan bukti callback/provider autentik telah terintegrasi. |
| AI claims/admission | `admit_ai_generation` service-only menggabungkan durable identity dan tiga allowance secara atomik. Generation replay tidak mengulang inference/charge; nullable context/session/generation fields bergantung generation_type. Evaluation/Memory source authority C6/C7 tetap terbatas seperti §27–28. CHECK bukan enum PostgreSQL; generated field string tidak menggantikan runtime validation. |

Type contract di `src/lib/supabase/database.types.ts` harus dihasilkan/diverifikasi dari final public schema dengan seluruh overload, defaults, FK dan nullability. Metadata generation tidak memberi izin EXECUTE; RLS/grants tetap sumber otorisasi. Layer 1 dan parser/type tests tidak membuktikan PostgREST overload resolution atau Supabase Auth/Storage HTTP.

Postgres-meta menghasilkan SQL void sebagai TypeScript `undefined`, JSON/JSONB sebagai `Json`, vector sebagai string dan CHECK-based status sebagai string. Ia tidak dapat menyimpulkan argumen/return NULL kondisional dari function body. Typed transport mempertahankan alias type-only untuk nullable initial Evaluation CAS token dan enam nullable context fields AI admission, sesuai SQL. Return stale `fail_job=NULL` tetap diperiksa parser runtime; generated metadata saja tidak menggantikan guard/validation tersebut.

---

# 30. A6-F1 — Financial bounds dan owner CAS (8 November 2026)

Aturan berikut termasuk dalam migration init. Tidak menambah tabel/kolom/RPC publik atau mengubah ACL/RLS. Metadata publik: 26 tabel, 353 kolom, 50 signature fungsi.

- Seluruh pembuatan order manual preorder, standalone manual, dan public memakai `private.insert_order`. Harga dasar/unit wajib1..1.000.000.000 IDR, quantity1..10.000, diskon0..9999bps, dan **subtotal sebelum diskon** maksimal1.000.000.000. Nilai di atas batas ditolak dengan `VALIDATION_ERROR` (P0001), tidak dipotong. Perkalian pemeriksaan memakai numeric sebelum arithmetic bigint atau insert. Unit variable-cost snapshot yang diketahui tetap0..1.000.000.000; NULL tetap berarti unknown.
- `private.discount_per_unit` mempertahankan floor per unit lalu dikalikan quantity. Bound subtotal juga membatasi discount total/final total. Diskon valid tidak membuat subtotal di atas batas menjadi sah walaupun final totalnya lebih rendah. Harga unit expected dari client tetap advisory; SQL yang menghitung harga. Penolakan membatalkan seluruh transaksi, termasuk reservation/version/event; tidak ada backfill atau validasi ulang seluruh historical rows.
- `private.lock_owned_preorder` mewajibkan expected version nonNULL, positif dan sama dengan versi row milik owner, dengan `PREORDER_VERSION_CONFLICT`. Ini berlaku untuk update draft, cancellation, close/complete yang memakai helper; create draft baru boleh memakai NULL karena belum ada row/version. Publikasi A3 tetap memakai guard kanonisnya sendiri.
- `private.lock_order` mewajibkan versi valid/matching untuk jalur owner: fulfillment, late accept/decline, cancellation, cost resolution dan owner expiry. Rejection memakai `VERSION_CONFLICT`; scope ownership diperiksa sebelum konflik versi. Tidak ada perubahan signature/default/return/owner/security/search_path/grant publik.
- Pengecualian NULL hanya bagi expiry internal tanpa business scope, `auth.uid()` NULL, JWT role service_role **dan database request role aktual service_role**. Helper private tetap tidak executable langsung oleh application roles. Mengirim business/user/role palsu tidak menyediakan jalur owner tanpa CAS. Service cancellation tetap ditolak oleh boundary cancellation existing; service tidak mendapat hak RPC owner-only.
- F1 membatasi harga/transaksi order baru, bukan mengubah seluruh financial ledger aplikasi. Tidak menyelesaikan deadline settlement A6-09, lock-order U01, historical pickup snapshots atau integrasi C1/C8/C6/C7.
