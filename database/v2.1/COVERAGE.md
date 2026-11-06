# Coverage database v2.1

> Matriks legacy-versus-target dari audit baseline. Hasil verifikasi database Supabase lokal yang kini aktif, klasifikasi kontrak yang belum selesai, dan runbook terbaru tersedia di [LOCAL_VERIFICATION.md](./LOCAL_VERIFICATION.md). SQL aktif ada di root; legacy berada di `database/legacy/migrations/`.

Katalog diambil dari PostgreSQL 17.11 disposable, 3 November 2026. Kedua chain diterapkan pada database kosong yang berbeda dalam container pengujian yang sama; bukan inspeksi database pengguna atau remote. Kontrak target: docs/schema.md v2.1.

Legacy: 19 tabel / 211 kolom. Target: 26 tabel / 351 kolom, tanpa tabel aplikasi tambahan. Seluruh nama kolom, tipe, panjang varchar dan nullable eksplisit dibandingkan otomatis dengan tabel Markdown kontrak. Nullable draft slug dijelaskan di README.

Angka di bawah adalah hasil katalog, bukan klaim bahwa semua jalur bisnis sudah memiliki aplikasi atau telah diuji. Lihat README untuk batas integrasi dan kontrak lintas tim.

## Matriks seluruh tabel

PK/FK/UQ/CK menghitung constraint PostgreSQL; index termasuk index pendukung PK/UQ. Semua tabel memakai RLS. Owner mendapat SELECT melalui policy tenant; rate_limit_buckets hanya service.

| Tabel | Kolom lama -> baru | Status | PK/FK/UQ/CK | Index | Policy | Trigger |
|---|---:|---|---|---:|---:|---:|
| `ai_generations` | 10 -> 15 | Reshape | 1/4/3/8 | 5 | 1 | 0 |
| `business_members` | 5 -> 5 | Reshape | 1/2/3/1 | 4 | 1 | 0 |
| `businesses` | 10 -> 11 | Reshape | 1/0/1/1 | 2 | 1 | 1 |
| `campaign_ai_messages` | 0 -> 10 | Baru | 1/3/2/6 | 4 | 1 | 1 |
| `campaign_ai_sessions` | 0 -> 10 | Baru | 1/3/2/4 | 4 | 1 | 1 |
| `campaign_blueprints` | 10 -> 11 | Reshape | 1/4/3/5 | 5 | 1 | 1 |
| `campaign_contents` | 10 -> 11 | Reshape | 1/3/2/4 | 3 | 1 | 1 |
| `campaign_costs` | 8 -> 12 | Reshape | 1/2/1/3 | 2 | 1 | 2 |
| `campaign_evaluations` | 8 -> 13 | Reshape | 1/4/2/5 | 4 | 1 | 1 |
| `campaign_memories` | 0 -> 20 | Baru | 1/4/2/8 | 4 | 1 | 2 |
| `campaign_tasks` | 11 -> 13 | Reshape | 1/3/2/3 | 3 | 1 | 1 |
| `campaigns` | 20 -> 26 | Reshape | 1/4/3/14 | 6 | 1 | 2 |
| `capacity_reservations` | 12 -> 13 | Reshape | 1/4/2/4 | 5 | 1 | 3 |
| `domain_events` | 0 -> 10 | Baru | 1/2/0/1 | 2 | 1 | 1 |
| `job_runs` | 0 -> 13 | Baru | 1/1/1/3 | 3 | 1 | 0 |
| `order_events` | 10 -> 11 | Reshape | 1/3/1/2 | 4 | 1 | 1 |
| `order_items` | 12 -> 17 | Reshape | 1/5/2/14 | 3 | 1 | 2 |
| `order_production_costs` | 0 -> 12 | Baru | 1/3/2/8 | 3 | 1 | 1 |
| `orders` | 20 -> 33 | Reshape | 1/4/4/14 | 6 | 1 | 2 |
| `payment_events` | 10 -> 11 | Reshape | 1/2/2/1 | 3 | 1 | 1 |
| `payments` | 14 -> 19 | Reshape | 1/2/4/7 | 8 | 1 | 3 |
| `preorder_items` | 0 -> 13 | Baru | 1/4/3/5 | 4 | 1 | 2 |
| `preorders` | 0 -> 15 | Baru | 1/1/1/5 | 4 | 1 | 2 |
| `production_capacity` | 7 -> 10 | Reshape | 1/2/3/3 | 4 | 1 | 2 |
| `products` | 11 -> 13 | Reshape | 1/1/2/6 | 4 | 1 | 1 |
| `rate_limit_buckets` | 0 -> 4 | Baru | 1/0/0/2 | 1 | 0 | 0 |

Tabel legacy `knowledge_documents` dan `knowledge_chunks` tidak dibuat dalam baseline baru. Tidak ada DROP terhadap database lama.

## Perbedaan lengkap kolom

Kolom yang tidak disebut dalam tabel lama yang sama mempertahankan tipe dan nullability. Perubahan default, check, FK, indeks, dan perilaku tidak boleh disimpulkan dari kesamaan kolom; lihat matriks dan SQL.

### ai_generations

- Tambah: `preorder_id uuid NULL`, `session_id uuid NULL`, `request_key text NOT NULL`, `model_id text NOT NULL`, `started_at timestamptz NULL`, `finished_at timestamptz NULL`, `created_at timestamptz NOT NULL`.
- Tidak dibawa dari legacy: `model_name varchar(100) NULL`, `generated_at timestamptz NOT NULL`.
- Ubah tipe/nullability: `generation_type`: `varchar(30) NOT NULL` -> `text NOT NULL`; `input_hash`: `char(64) NOT NULL` -> `text NOT NULL`; `status`: `varchar(16) NOT NULL` -> `text NOT NULL`; `error_code`: `varchar(60) NULL` -> `text NULL`.

### business_members

- Tambah: tidak ada.
- Tidak dibawa dari legacy: tidak ada.
- Ubah tipe/nullability: `role`: `varchar(20) NOT NULL` -> `text NOT NULL`.

### businesses

- Tambah: `is_demo boolean NOT NULL`.
- Tidak dibawa dari legacy: tidak ada.
- Ubah tipe/nullability: `pickup_instructions`: `text NULL` -> `text NOT NULL`.

### campaign_ai_messages

Baru: `id uuid NOT NULL`, `business_id uuid NOT NULL`, `session_id uuid NOT NULL`, `sequence integer NOT NULL`, `role text NOT NULL`, `body_text text NOT NULL`, `proposal_json jsonb NULL`, `context_hash text NULL`, `ai_generation_id uuid NULL`, `created_at timestamptz NOT NULL`.

### campaign_ai_sessions

Baru: `id uuid NOT NULL`, `business_id uuid NOT NULL`, `preorder_id uuid NOT NULL`, `campaign_id uuid NULL`, `status text NOT NULL`, `summary_text text NULL`, `context_version_hash text NOT NULL`, `version integer NOT NULL`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`.

### campaign_blueprints

- Tambah: `context_hash text NOT NULL`.
- Tidak dibawa dari legacy: tidak ada.
- Ubah tipe/nullability: `approval_status`: `varchar(16) NOT NULL` -> `text NOT NULL`.

### campaign_contents

- Tambah: `blueprint_id uuid NOT NULL`, `content_key text NOT NULL`, `version integer NOT NULL`.
- Tidak dibawa dari legacy: `source_ai_generation_id uuid NULL`, `campaign_task_id uuid NULL`.
- Ubah tipe/nullability: `channel`: `varchar(30) NOT NULL` -> `text NOT NULL`; `content_type`: `varchar(20) NOT NULL` -> `text NOT NULL`.

### campaign_costs

- Tambah: `voided_at timestamptz NULL`, `void_reason text NULL`, `version integer NOT NULL`, `updated_at timestamptz NOT NULL`.
- Tidak dibawa dari legacy: tidak ada.
- Ubah tipe/nullability: `category`: `varchar(40) NOT NULL` -> `text NOT NULL`.

### campaign_evaluations

- Tambah: `blueprint_id uuid NOT NULL`, `metrics_schema_version integer NOT NULL`, `analysis_json jsonb NULL`, `evaluation_kind text NOT NULL`, `calculated_at timestamptz NOT NULL`, `created_at timestamptz NOT NULL`.
- Tidak dibawa dari legacy: `analysis_text text NULL`.
- Ubah tipe/nullability: tidak ada.

### campaign_memories

Baru: `id uuid NOT NULL`, `business_id uuid NOT NULL`, `campaign_id uuid NOT NULL`, `source_evaluation_id uuid NOT NULL`, `source_blueprint_id uuid NULL`, `source_version integer NOT NULL`, `summary_text text NOT NULL`, `lessons_json jsonb NOT NULL`, `limitations_json jsonb NOT NULL`, `content_hash text NOT NULL`, `review_status text NOT NULL`, `embedding_status text NOT NULL`, `embedding extensions.vector(768) NULL`, `embedding_model text NULL`, `embedding_profile text NULL`, `embedding_version integer NOT NULL`, `approved_at timestamptz NULL`, `indexed_at timestamptz NULL`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`.

### campaign_tasks

- Tambah: `blueprint_id uuid NOT NULL`, `task_key text NOT NULL`, `version integer NOT NULL`.
- Tidak dibawa dari legacy: `sort_order integer NOT NULL`.
- Ubah tipe/nullability: `title`: `varchar(160) NOT NULL` -> `text NOT NULL`; `channel`: `varchar(30) NULL` -> `text NULL`; `due_at`: `timestamptz NULL` -> `timestamptz NOT NULL`.

### campaigns

- Tambah: `preorder_id uuid NOT NULL`, `offer_type text NOT NULL`, `marketing_approach text NOT NULL`, `discount_bps integer NOT NULL`, `primary_kpi text NOT NULL`, `target_additional_units integer NOT NULL`, `closed_at timestamptz NULL`, `completed_at timestamptz NULL`, `active_blueprint_id uuid NULL`, `published_blueprint_id uuid NULL`, `baseline_json jsonb NULL`, `baseline_calculated_at timestamptz NULL`, `metrics_schema_version integer NULL`, `costs_completeness text NOT NULL`, `version integer NOT NULL`.
- Tidak dibawa dari legacy: `product_id uuid NOT NULL`, `strategy_type varchar(30) NOT NULL`, `discount_type varchar(12) NOT NULL`, `discount_value bigint NOT NULL`, `base_price_snapshot_idr bigint NOT NULL`, `offer_price_idr bigint NOT NULL`, `fulfillment_date date NOT NULL`, `quota_units integer NOT NULL`, `target_units integer NOT NULL`.
- Ubah tipe/nullability: `slug`: `varchar(160) NOT NULL` -> `varchar(160) NULL`; `status`: `varchar(20) NOT NULL` -> `text NOT NULL`.

### capacity_reservations

- Tambah: `order_item_id uuid NOT NULL`, `preorder_item_id uuid NULL`.
- Tidak dibawa dari legacy: `campaign_id uuid NULL`.
- Ubah tipe/nullability: `state`: `varchar(12) NOT NULL` -> `text NOT NULL`; `release_reason`: `varchar(40) NULL` -> `text NULL`.

### domain_events

Baru: `id uuid NOT NULL`, `business_id uuid NULL`, `entity_type text NOT NULL`, `entity_id uuid NOT NULL`, `command_key text NULL`, `event_type text NOT NULL`, `actor_type text NOT NULL`, `actor_user_id uuid NULL`, `safe_details_json jsonb NULL`, `occurred_at timestamptz NOT NULL`.

### job_runs

Baru: `id uuid NOT NULL`, `job_type text NOT NULL`, `entity_id uuid NULL`, `business_id uuid NULL`, `dedupe_key text NOT NULL`, `status text NOT NULL`, `attempt_count integer NOT NULL`, `next_run_at timestamptz NOT NULL`, `locked_until timestamptz NULL`, `last_error_code text NULL`, `provider_reference text NULL`, `created_at timestamptz NOT NULL`, `finished_at timestamptz NULL`.

### order_events

- Tambah: `command_key text NULL`, `from_state text NULL`, `to_state text NULL`, `occurred_at timestamptz NOT NULL`.
- Tidak dibawa dari legacy: `from_status varchar(32) NULL`, `to_status varchar(32) NULL`, `created_at timestamptz NOT NULL`.
- Ubah tipe/nullability: `event_type`: `varchar(40) NOT NULL` -> `text NOT NULL`; `actor_type`: `varchar(20) NOT NULL` -> `text NOT NULL`; `details_json`: `jsonb NOT NULL` -> `jsonb NULL`.

### order_items

- Tambah: `preorder_item_id uuid NULL`, `sku_snapshot text NOT NULL`, `discount_bps_snapshot integer NOT NULL`, `cost_quality_snapshot text NOT NULL`, `pricing_campaign_id uuid NULL`.
- Tidak dibawa dari legacy: tidak ada.
- Ubah tipe/nullability: `product_name_snapshot`: `varchar(160) NOT NULL` -> `text NOT NULL`.

### order_production_costs

Baru: `id uuid NOT NULL`, `business_id uuid NOT NULL`, `order_item_id uuid NOT NULL`, `cost_kind text NOT NULL`, `quantity integer NOT NULL`, `cost_per_unit_idr bigint NULL`, `amount_idr bigint NULL`, `quality text NOT NULL`, `incurred_at timestamptz NOT NULL`, `resolved_by_user_id uuid NULL`, `resolution_note text NULL`, `created_at timestamptz NOT NULL`.

### orders

- Tambah: `preorder_id uuid NULL`, `attribution_campaign_id uuid NULL`, `pricing_campaign_id uuid NULL`, `request_hash text NULL`, `customer_email text NULL`, `external_payment_status text NULL`, `external_payment_confirmed_at timestamptz NULL`, `confirmed_at timestamptz NULL`, `production_started_at timestamptz NULL`, `ready_at timestamptz NULL`, `fulfilled_at timestamptz NULL`, `cancelled_at timestamptz NULL`, `review_reason text NULL`, `version integer NOT NULL`.
- Tidak dibawa dari legacy: `campaign_id uuid NULL`.
- Ubah tipe/nullability: `public_order_number`: `varchar(32) NOT NULL` -> `text NOT NULL`; `private_token_hash`: `char(64) NULL` -> `text NULL`; `idempotency_key`: `varchar(128) NULL` -> `text NULL`; `source`: `varchar(12) NOT NULL` -> `text NOT NULL`; `customer_name`: `varchar(120) NOT NULL` -> `text NOT NULL`; `customer_contact`: `varchar(120) NOT NULL` -> `text NULL`; `payment_mode`: `varchar(24) NOT NULL` -> `text NOT NULL`; `order_status`: `varchar(24) NOT NULL` -> `text NOT NULL`; `fulfillment_status`: `varchar(24) NOT NULL` -> `text NOT NULL`.

### payment_events

- Tambah: `verified_at timestamptz NOT NULL`, `outcome text NOT NULL`.
- Tidak dibawa dari legacy: `processing_outcome varchar(24) NOT NULL`.
- Ubah tipe/nullability: `provider_event_key`: `varchar(160) NOT NULL` -> `text NOT NULL`; `payload_hash`: `char(64) NOT NULL` -> `text NOT NULL`; `provider_status`: `varchar(40) NOT NULL` -> `text NOT NULL`.

### payments

- Tambah: `is_active_attempt boolean NOT NULL`, `provider_paid_at timestamptz NULL`, `verified_at timestamptz NULL`, `applied_at timestamptz NULL`, `review_reason text NULL`, `version integer NOT NULL`.
- Tidak dibawa dari legacy: `paid_at timestamptz NULL`.
- Ubah tipe/nullability: `provider`: `varchar(32) NOT NULL` -> `text NOT NULL`; `provider_order_id`: `varchar(128) NOT NULL` -> `text NOT NULL`; `provider_transaction_id`: `varchar(128) NULL` -> `text NULL`; `status`: `varchar(24) NOT NULL` -> `text NOT NULL`.

### preorder_items

Baru: `id uuid NOT NULL`, `business_id uuid NOT NULL`, `preorder_id uuid NOT NULL`, `product_id uuid NOT NULL`, `capacity_id uuid NOT NULL`, `target_units integer NOT NULL`, `quota_units integer NOT NULL`, `base_price_snapshot_idr bigint NOT NULL`, `product_name_snapshot varchar(160) NOT NULL`, `sku_snapshot varchar(80) NOT NULL`, `version integer NOT NULL`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`.

### preorders

Baru: `id uuid NOT NULL`, `business_id uuid NOT NULL`, `name varchar(160) NOT NULL`, `slug varchar(160) NULL`, `status text NOT NULL`, `fulfillment_date date NOT NULL`, `starts_at timestamptz NOT NULL`, `ends_at timestamptz NOT NULL`, `published_at timestamptz NULL`, `closed_at timestamptz NULL`, `completed_at timestamptz NULL`, `pickup_terms_snapshot jsonb NULL`, `version integer NOT NULL`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`.

### production_capacity

- Tambah: `product_id uuid NOT NULL`, `intake_cutoff_at timestamptz NOT NULL`, `fulfillment_window_end_at timestamptz NOT NULL`, `version integer NOT NULL`.
- Tidak dibawa dari legacy: `order_deadline_at timestamptz NOT NULL`.
- Ubah tipe/nullability: tidak ada.

### products

- Tambah: `sku varchar(80) NOT NULL`, `version integer NOT NULL`.
- Tidak dibawa dari legacy: tidak ada.
- Ubah tipe/nullability: `cost_quality`: `varchar(16) NOT NULL` -> `text NOT NULL`.

### rate_limit_buckets

Baru: `bucket_key_hash text NOT NULL`, `window_start timestamptz NOT NULL`, `count integer NOT NULL`, `expires_at timestamptz NOT NULL`.

## Constraint, index, policy, trigger, grant, extension

| Objek katalog | Legacy | v2.1 |
|---|---:|---:|
| constraints | 159 | 288 |
| indexes | 73 | 100 |
| policies | 19 | 25 |
| triggers | 10 | 34 |
| functions | 3 | 38 |

- PK: UUID setiap entitas; rate_limit_buckets memakai composite PK hash/window.
- FK: tenant-composite dan binding preorder/campaign/blueprint/session/order mencegah referensi silang tenant; auth.users tetap dikelola Supabase. ON DELETE RESTRICT menjaga history.
- UQ/check: capacity per business/product/date; satu item per preorder; target -> quota -> capacity; basis poin 0..9999, perhitungan harga integer, cost_quality konsisten dengan null, total order deferred, hash64 dan status allowlist.
- Partial unique: satu published preorder per business/date; satu published campaign per preorder; satu approved blueprint; satu running generation/session; satu message/role/generation; satu active payment attempt; satu applied payment; command dedupe audit.
- Semua 25 policy hanya owner SELECT. Tidak ada policy guest/private table. rate_limit_buckets tidak diberikan kepada owner. authenticated tidak memiliki INSERT/UPDATE/DELETE langsung. service_role mendapat SELECT/INSERT/UPDATE, tidak DELETE. Keputusan bisnis sensitif wajib melalui RPC/server tepercaya.
- SECURITY DEFINER: search_path kosong, helper private tidak dapat dieksekusi langsung oleh client. service_role tetap role tepercaya yang bisa menulis langsung dan melewati RLS; jangan berikan key kepada browser.
- Trigger: timestamp/version CAS; frozen preorder/order/approved blueprint/memory; total order deferred; capacity/quota guard; campaign bounds; audit/evaluation/message append-only; cost change mengembalikan completeness ke unreviewed.
- Extension aplikasi: vector 0.8.2 di extensions, dimensi 768. pgTAP 1.3.3 dipasang hanya oleh test, tidak oleh migration aplikasi. Tidak menambahkan vector ANN index: corpus P0 kecil, retrieval mengutamakan tenant filter sebelum ranking.

### Partial indexes aktual

- `CREATE UNIQUE INDEX ai_one_running_session ON public.ai_generations USING btree (session_id) WHERE ((status = 'running'::text) AND (session_id IS NOT NULL))`.
- `CREATE UNIQUE INDEX messages_generation_role ON public.campaign_ai_messages USING btree (ai_generation_id, role) WHERE (ai_generation_id IS NOT NULL)`.
- `CREATE UNIQUE INDEX blueprints_one_approved ON public.campaign_blueprints USING btree (campaign_id) WHERE (approval_status = 'approved'::text)`.
- `CREATE UNIQUE INDEX campaigns_one_published ON public.campaigns USING btree (preorder_id) WHERE (status = 'published'::text)`.
- `CREATE UNIQUE INDEX domain_events_command ON public.domain_events USING btree (business_id, entity_type, entity_id, event_type, command_key) WHERE (command_key IS NOT NULL)`.
- `CREATE UNIQUE INDEX order_events_command ON public.order_events USING btree (business_id, command_key) WHERE (command_key IS NOT NULL)`.
- `CREATE UNIQUE INDEX payments_one_active ON public.payments USING btree (order_id) WHERE is_active_attempt`.
- `CREATE UNIQUE INDEX payments_one_applied ON public.payments USING btree (order_id) WHERE (applied_at IS NOT NULL)`.
- `CREATE UNIQUE INDEX preorders_one_published ON public.preorders USING btree (business_id, fulfillment_date) WHERE (status = 'published'::text)`.

### Fungsi/RPC aktual

Schema private berisi helper dan trigger, tidak diekspos melalui API. Hak authenticated hanya fungsi owner yang diberi GRANT eksplisit pada akhir migration; seluruh fungsi public dapat dipanggil service_role.

| Schema | Fungsi dan argumen | Hasil | Definer |
|---|---|---|---|
| private | `append_only()` | `trigger` | Tidak |
| private | `check_context_versions(p_actual jsonb, p_expected jsonb)` | `void` | Tidak |
| private | `check_order_totals()` | `trigger` | Tidak |
| private | `cost_changed()` | `trigger` | Tidak |
| private | `guard_blueprint()` | `trigger` | Tidak |
| private | `guard_campaign()` | `trigger` | Tidak |
| private | `guard_capacity()` | `trigger` | Tidak |
| private | `guard_memory()` | `trigger` | Tidak |
| private | `guard_order_items()` | `trigger` | Tidak |
| private | `guard_payment()` | `trigger` | Tidak |
| private | `guard_preorder()` | `trigger` | Tidak |
| private | `guard_preorder_item()` | `trigger` | Tidak |
| private | `guard_reservation()` | `trigger` | Tidak |
| private | `lock_campaign_context(p_campaign_id uuid)` | `jsonb` | Tidak |
| private | `lock_order_context(p_order_id uuid)` | `void` | Tidak |
| private | `require_owner(p_business_id uuid, p_actor_user_id uuid)` | `uuid` | Ya |
| private | `touch_row()` | `trigger` | Tidak |
| public | `apply_verified_payment(p_payment_id uuid, p_provider_order_id text, p_event_key text, p_payload_hash text, p_amount_idr bigint, p_provider_status text, p_provider_paid_at timestamp with time zone)` | `text` | Ya |
| public | `approve_blueprint(p_business_id uuid, p_blueprint_id uuid, p_expected_versions jsonb, p_context_hash text, p_actor_user_id uuid)` | `campaign_blueprints` | Ya |
| public | `approve_campaign_memory(p_business_id uuid, p_memory_id uuid, p_content_hash text, p_model text, p_profile text, p_actor_user_id uuid)` | `uuid` | Ya |
| public | `claim_ai_generation(p_business_id uuid, p_session_id uuid, p_expected_version integer, p_context_hash text, p_request_key text, p_input_hash text, p_model_id text, p_message text, p_generation_type text, p_actor_user_id uuid)` | `jsonb` | Ya |
| public | `claim_jobs(p_limit integer, p_lease_seconds integer, p_max_attempts integer)` | `SETOF job_runs` | Ya |
| public | `close_campaign(p_business_id uuid, p_campaign_id uuid, p_expected_version integer, p_actor_user_id uuid)` | `campaigns` | Ya |
| public | `complete_memory_indexing(p_memory_id uuid, p_content_hash text, p_embedding_version integer, p_model text, p_profile text, p_embedding extensions.vector)` | `void` | Ya |
| public | `create_ai_session(p_business_id uuid, p_preorder_id uuid, p_session_id uuid, p_context_hash text, p_actor_user_id uuid)` | `campaign_ai_sessions` | Ya |
| public | `create_business_with_owner(p_name text, p_slug text, p_category text, p_pickup_instructions text, p_actor_user_id uuid)` | `uuid` | Ya |
| public | `fail_ai_generation(p_business_id uuid, p_session_id uuid, p_generation_id uuid, p_claim_version integer, p_error_code text, p_actor_user_id uuid)` | `jsonb` | Ya |
| public | `finalize_ai_generation(p_business_id uuid, p_session_id uuid, p_generation_id uuid, p_claim_version integer, p_output_json jsonb, p_actor_user_id uuid)` | `jsonb` | Ya |
| public | `finish_job(p_job_id uuid, p_attempt_count integer, p_success boolean, p_error_code text, p_provider_reference text)` | `void` | Ya |
| public | `is_business_owner(target_business_id uuid)` | `boolean` | Ya |
| public | `match_campaign_memories(p_business_id uuid, p_embedding extensions.vector, p_model text, p_profile text, p_embedding_version integer, p_limit integer, p_min_similarity double precision)` | `TABLE(memory_id uuid, campaign_id uuid, source_evaluation_id uuid, summary_text text, lessons_json jsonb, limitations_json jsonb, similarity double precision)` | Tidak |
| public | `publish_campaign(p_business_id uuid, p_campaign_id uuid, p_expected_versions jsonb, p_actor_user_id uuid)` | `campaigns` | Ya |
| public | `publish_preorder(p_business_id uuid, p_preorder_id uuid, p_expected_version integer, p_actor_user_id uuid)` | `preorders` | Ya |
| public | `record_campaign_evaluation(p_business_id uuid, p_campaign_id uuid, p_blueprint_id uuid, p_evaluation_id uuid, p_kind text, p_metrics jsonb, p_analysis jsonb, p_limitations jsonb, p_calculated_at timestamp with time zone, p_actor_user_id uuid)` | `uuid` | Ya |
| public | `refresh_ai_session_context(p_business_id uuid, p_session_id uuid, p_expected_version integer, p_context_hash text, p_actor_user_id uuid)` | `campaign_ai_sessions` | Ya |
| public | `save_blueprint_revision(p_business_id uuid, p_campaign_id uuid, p_expected_campaign_version integer, p_blueprint_id uuid, p_context_hash text, p_blueprint_json jsonb, p_source_generation_id uuid, p_actor_user_id uuid)` | `campaign_blueprints` | Ya |
| public | `save_campaign_draft(p_business_id uuid, p_campaign_id uuid, p_preorder_id uuid, p_expected_version integer, p_draft jsonb, p_actor_user_id uuid)` | `campaigns` | Ya |
| public | `take_rate_limit(p_key_hash text, p_window_start timestamp with time zone, p_expires_at timestamp with time zone, p_limit integer)` | `boolean` | Ya |

## Coverage operasi atomik

| Operasi | Implementasi | Bukti / batas |
|---|---|---|
| business + owner | create_business_with_owner | Satu transaksi; belum integrasi signup |
| publish preorder | publish_preorder | Snapshot frozen; unique business/date |
| claim/finalize/fail discussion | RPC AI | CAS/version, dedupe, sequencing, RLS, replay dan failure diuji PostgreSQL; dua koneksi race claim |
| campaign draft / blueprint revision | save_campaign_draft / save_blueprint_revision | Mengunci sumber, menjaga versi/history; adapter aplikasi belum ada |
| approve blueprint | approve_blueprint | Validasi versi/kapasitas/harga; materialisasi; duplicate content membatalkan seluruh transaksi |
| publish / close campaign | publish_campaign / close_campaign | Approval terpisah; baseline actual DB; duplicate publish diuji |
| evaluation | record_campaign_evaluation | Append-only, final preconditions; belum C6 metrics calculation / consistent snapshot RPC |
| approve memory + enqueue | approve_campaign_memory | Approval+dedupe job dalam satu transaksi |
| indexing / retrieval | complete_memory_indexing / match_campaign_memories | CAS metadata, vector768, tenant/profile filter; provider/worker belum ada |
| reservation guard | trigger capacity_reservations | Dua transaksi berebut slot terakhir: hanya satu commit; bukan checkout endpoint |
| payment application | apply_verified_payment | Replay, duplicate paid review, hold -> allocated, satu email job; verifikasi provider harus sudah dilakukan server |
| worker claim/finish | claim_jobs / finish_job | SKIP LOCKED, lease/fence/retry; race dua worker diuji |
| rate limiter | take_rate_limit | Atomic upsert, hash-only; belum HTTP middleware |
| create_preorder_order / create_manual_order / claim_payment_attempt / expire_or_cancel_order / advance_fulfillment / accept_late_payment / read_metrics_snapshot | Kontrak handoff saja | Belum RPC; tidak boleh digantikan request REST terpisah dan diklaim atomik |

Katalog lengkap FK/check/index/policy/grant/trigger/signature kedua chain dapat direproduksi di node_modules/.cache/database-v21/coverage.json; DDL hasil pg_dump di schema.sql. File cache bukan source of truth dan tidak perlu di-commit.
