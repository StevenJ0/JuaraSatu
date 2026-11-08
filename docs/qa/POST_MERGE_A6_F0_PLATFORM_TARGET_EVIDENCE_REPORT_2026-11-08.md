# Batch A6-F0 — Platform Evidence Result

Tanggal: **8 November 2026, Asia/Jakarta**. Mode: pengumpulan bukti dan perencanaan, tanpa implementasi/deployment. Branch merge/ai-campaign; HEAD 5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762.

## A. Executive Summary

**Overall: PARTIAL.** Bukti utama target lokal berhasil diperoleh dengan aman dan cukup untuk menyusun rencana upgrade. Status database adalah **OLDER_MIGRATION_CHAIN**, bukan sesuai kontrak repository saat ini. Sisa ketidakpastian meliputi consumer eksternal, effective environment proses aplikasi, kesetaraan seluruh isi migration ledger, precondition data untuk upgrade, dan preflight operasional Layer2 yang memang belum dijalankan. Ini bukan FAIL karena perbedaan target ditemukan dan dilaporkan, bukan diubah atau disembunyikan.

Hasil baru A6-F0:

- Target terverifikasi: Docker lokal named pipe, label project campaign-lab dan workdir D:\Project\campaign-lab, container penuh ef13ca94ef3871398de107c4eddaee131649dc1ae73b378f3b0d82771b10ae24, database/user postgres melalui Unix socket container. Transaksi melaporkan transaction_read_only=on.
- Source **13 migration**, target ledger **9**. Target belum menerapkan 20261106160000_core_preorder_on_v21 maupun ketiga hardening A1/A2/A3. Tidak ditemukan versi ekstra atau13 versi core yang dihapus dari Git pada ledger ini.
- Target **26 tabel/351 kolom/54 fungsi public+private/27 signature public**, sedangkan catalog disposable A5 **26/352/99/50**. Ada45 signature hilang dan2 definisi fungsi bersama yang berbeda terhadap kontrak13-chain.
- A1: complete_job dan fail_job **tidak ada**. A2: typed claim **tidak ada**, legacy claim masih catch-all. A3: helper kanonis dan overload owner **tidak ada**, legacy publish masih menulis pickupInstructions.
- Snapshot published: **2 row**, **0 kanonis**, **2 camelCase-only**, tanpa raw pickup/kontak/identitas dikembalikan. A6-17 kini terbukti pada cohort published lokal yang diperiksa.
- Seluruh26 tabel public memiliki RLS sesuai catalog pembanding;25 policy yang ada cocok, tetapi5 policy tulis owner belum ada. Hak INSERT/UPDATE owner yang diharapkan pada business/products/capacity juga belum ada. Bucket product-photos serta3 object policies-nya tidak ada.
- Desain Layer2 dengan project/temp directory/volume/network/port terpisah disiapkan menggunakan kemampuan CLI2.122.0 yang dibaca langsung dari --help. Stack baru **tidak diluncurkan**. Origin AI yang tetap127.0.0.1:54321 adalah blocker integrasi app AI pada port stack sementara.
- .env.local identik dengan hash akhir A6, tetapi berbeda dari hash awal A6. Penyebab perubahan historis tetap tidak diketahui; tidak ada atribusi proses/insiden keamanan. HMAC masih tidak dideklarasikan di file/shell yang diperiksa.

**A6-F1 dapat direncanakan dan, melalui tugas berizin tersendiri, dikerjakan pada source dan PostgreSQL disposable. Deployment persisten belum diizinkan dan belum layak dilakukan.** Tidak ada perbaikan bisnis, backfill, migrasi atau provider call pada F0.

## B. Scope and Safety

Permintaan A6-F0 secara eksplisit mengizinkan metadata Docker lokal, catalog/ledger PostgreSQL READ ONLY dan aggregate snapshot terbatas pada target Campaign Lab yang telah diidentifikasi. Target lain tidak diakses SQL. Tidak ada RPC aplikasi dipanggil, termasuk claim/publish/payment/Memory; membaca prosrc/pg_get_functiondef tidak mengeksekusi fungsi tersebut.

Dokumen yang dibaca ulang pada bagian relevan: AGENTS.md, AI_MODULE_HANDOFF.md, docs/schema.md, PRD, audit integrasi awal, A6 beserta temuan13/15/16/17/18 dan rencana N, serta Stage0/A1–A5. Source yang dibandingkan mencakup13 root migrations, catalog.sql/A4 contract checks, SDK factories/transport, repository jobs/payments/preorders, worker Memory, config dan script platform yang berisiko. Handoff6November tetap konteks historis9 migration, bukan kontrak current13.

Pengamanan setiap sesi SQL:

1. ID container penuh dan --host Docker named pipe eksplisit; koneksi psql ke /var/run/postgresql:5432, bukan port host/URL env.
2. User container postgres; psql -X --no-password --username=postgres --dbname=postgres; routing PGSERVICE/PGSERVICEFILE/PGHOSTADDR dan password diwariskan dibuang pada proses anak.
3. PGOPTIONS=-cdefault_transaction_read_only=on, kemudian BEGIN TRANSACTION READ ONLY, statement_timeout5s, lock_timeout1s. Catalog comparison memakai SET LOCAL search_path=public. Tidak ada SET ROLE atau invokasi mutasi.
4. Hanya SELECT catalog, identitas, ledger metadata dan aggregate JSON shape. Cohort published dibatasi10001; data8KiB dan hasil2row membuat jumlah lengkap untuk statement tersebut, bukan sampel yang mencapai cap.
5. Hasil transaksi sukses diakhiri COMMIT; tidak ada percobaan write untuk menguji proteksi.

Contoh pembungkus yang benar-benar dipakai, tanpa kredensial:

~~~sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SELECT current_database(), current_user,
       current_setting('transaction_read_only');
-- SELECT catalog atau aggregate yang sudah ditinjau.
COMMIT;
~~~

F0 tidak menjalankan unit/lint/typecheck/build/harness SQL ulang karena source hanya dibaca. Tidak menjalankan real platform HTTP, browser, Gemini/embedding, Midtrans/email, lifecycle Supabase, migration/reset/push/repair, atau Git mutation. A1–A5 PASS adalah **HISTORICAL**. Ini review metadata dan persiapan platform, bukan pen-test/security certification atau deployment sign-off.

## C. Git / Working Tree Baseline

Branch/HEAD sesuai ekspektasi dan tidak berubah. Baseline **683 berkas** tracked/untracked ditambah inclusion eksplisit .env.local melalui daftar hash yang sama; file di-ignore tersebut sudah termasuk hitungan683, bukan dihitung lagi. Source A1–A5 belum seluruhnya committed; revision Git saja tidak merepresentasikan candidate runtime.

Modified awal8 berkas: database/v2.1/tests/concurrency.mjs; database/v2.1/tests/schema-contract.mjs; docs/schema.md; scripts/test-database-v21.mjs; src/features/jobs/repository.ts; src/lib/supabase/database.types.ts; src/lib/supabase/transport.server.ts; tests/integration/atomic-generation-admission-postgres.test.ts.

Untracked awal dipertahankan: modul contract tests current-contracts/database-types-contract/job-acknowledgement/job-claim-isolation/migration-contract/preorder-publication/platform-storage; script generate-database-types-v21; repository.test jobs; migration A1/A2/A3; parser integration test; tests/types/database-contracts; laporan audit awal, Stage0/A1–A5 dan A6. Tidak staging/stash/reset/commit.

### Fingerprint berkas terlindungi saat mulai

SHA256 adalah fingerprint isi file, bukan secret value atau bukti deployment.

| Berkas | SHA256 awal F0 |
|---|---|
| docs/schema.md | 1fa054f1750e96ba6f1cf06f8bc018e5b69c3dd71d18139271bd58860c54a400 |
| src/lib/supabase/database.types.ts | bdc759c96628b985fa5f96da33a5c9eda29a1617f578c5a3610981911e8d1e6a |
| src/lib/supabase/transport.server.ts | a5af6ced290dbe53badc49c9de4e95dd80c11cb1e0e1e7ba9053866450355add |
| supabase/config.toml | f9e62b6780f033f8b2b6fe983afa4ef35f4d9d6842ff427385a13f9fdc651f6e |
| AGENTS.md | ea413018acb5b7cdcf2262600b6b02a2d08c728373d7d2fa19065c3875d90b7e |
| package.json | 3af29f811ba3db81c40d81ec47849daae31c997061e6720a5652a973ce6711bb |
| package-lock.json | 9ed125a3fb5438301cbccdd92fabc2155cc47fecd3b6733a316306666ff99e3a |
| .env.local | 3e325c50f96b274b34ea4d4aadf2ca4360b024e617ae57df0e62a6c3c1bf0f9b |

Ketigabelas migration mempunyai fingerprint lengkap di E. Pembandingan akhir seluruh baseline ada di O. Perubahan pengguna bersamaan tidak akan dikembalikan otomatis.

### Observasi .env.local dari A6

- Awal A6: ebf42210ef101a00250052461645872d080683be372eb73c2b15d514f6326f70.
- Akhir A6 dan awal F0: 3e325c50f96b274b34ea4d4aadf2ca4360b024e617ae57df0e62a6c3c1bf0f9b.
- Ukuran1219bytes; LastWriteTime teramati2026-11-07T21:22:40.043268+07:00. File di-ignore oleh Git; git status kosong untuk path ini tidak membuktikan isinya tidak berubah.
- Discrepancy historis tetap ada, tetapi **tidak ada perubahan baru antara akhir A6 dan awal F0**. Penyebab tidak diketahui. Tidak membaca full diff, mengungkap nilai, menulis atau mengembalikan env. Keadaan proses Next yang sudah berjalan tidak disimpulkan dari file.

## D. Local Environment Identity

| Bukti | Hasil teramati |
|---|---|
| Docker context | default |
| Endpoint eksplisit | npipe:////./pipe/docker_engine; local Windows named pipe |
| Routing override shell | DOCKER_HOST/CONTEXT/TLS_VERIFY/CERT_PATH dan PGHOST/PORT/DATABASE/USER/PASSWORD/SERVICE/SERVICEFILE/DATABASE_URL/SUPABASE_DB_URL tidak terpasang |
| Config repository | supabase/config.toml project_id=campaign-lab; API54321, DB54322, PostgreSQL17 |
| Label container | com.docker.compose.project=campaign-lab; com.supabase.cli.project=campaign-lab; com.supabase.cli.workdir=D:\Project\campaign-lab |
| Target ID/name | ef13ca94ef3871398de107c4eddaee131649dc1ae73b378f3b0d82771b10ae24 / supabase_db_campaign-lab |
| Image | public.ecr.aws/supabase/postgres:17.11.0.006 |
| Database identity | postgres; current_user=postgres; server_version17.11; inet_server_addr=NULL karena socket |
| Storage persisten | volume supabase_db_campaign-lab → /var/lib/postgresql/data |
| Network | supabase_network_campaign-lab; ID500d55a94f68d912ae848aaf9ee46960e84b445bc0682eb444e7e1cb432c44c8 |
| DB published port teramati | 54322→5432 pada IPv4/IPv6 wildcard; **tidak digunakan untuk inspeksi** |
| State DB awal | running=true, healthy; StartedAt2026-11-07T18:10:44.291127266Z =8November01:10:44WIB; RestartCount0 |
| Read-only evidence | transaction_read_only=on pada sesi identitas/ledger/metadata/cohort |
| Target lain | proyek Supabase lain tampak pada ps; tidak diinspeksi catalog/data dan tidak disentuh lifecycle |

Stack Campaign Lab saat ps juga memuat GoTrue2.197.0, PostgREST16.5, Storage1.84.19, Kong2.8.1, Mailpit1.31.3, postgres-meta0.100.0, Studio dan layanan tambahan. Running container bukan bukti HTTP/API correctness. Container vector sudah terlihat Restarting pada observasi awal; tidak direstart/diperbaiki oleh agent dan tidak dipakai untuk menyimpulkan health seluruh platform.

Sandbox awal menolak akses daemon/config Docker; request eskalasi read-only sesuai otorisasi F0 berhasil. Tidak ada automatic approval rejection. Satu koneksi psql awal gagal sebelum SQL karena PGSERVICEFILE kosong; diperbaiki dengan menghapus variabel pada proses anak, bukan mengubah file/layanan. PGPASSFILE=/dev/null menimbulkan warning non-plain file, kemudian digunakan path nonexistent yang tidak dibaca/ditulis. Tidak ada password ditampilkan.

## E. Active Migration Chain

Actual inventory **13 root SQL**, sesuai expected list; snapshot database/v2.1 dan database/legacy bukan active root. Hash sama dengan manifest run A5 yang dipakai sebagai pembanding. Setiap row menunjukkan status ledger lokal sekarang, bukan instruksi apply.

| Migration root | SHA256 source | Ada di ledger target |
|---|---|---|
| 20261103000000_initial_v21.sql | 1b3612e0da1fb181c9abbdd70d13b7a6bb35c4a21d93195f479e86e1b1c8617a | YES |
| 20261103090000_atomic_campaign_blueprint_creation.sql | 89935a0868f89407795bf00041ec7e315ed38b6269281c6f1a95344360858580 | YES |
| 20261104090000_evaluation_cas_and_finalization.sql | 290b7250bfc646ac84c090c86602af96ed67be831ed0e7a857675f263a0d58a9 | YES |
| 20261104091000_seal_completed_campaign_updates.sql | 8a224c07be742908da5795d13bbd62a3c0afec412069cfe63ebe268922cdebf8 | YES |
| 20261104092000_reject_synthetic_finalization_memory_approval.sql | 56207626de52522d3d2e8806ca2006e6dc4dfdbb0f51975ea49c8bfdc724e6ba | YES |
| 20261104093000_memory_approval_and_indexing_transactions.sql | 5455cba67b76af28582d1738535943d589772821551d17f0d8adb87dfc46278c | YES |
| 20261104094000_memory_index_recovery.sql | 2e84d3e269e053b860ba807959fb1b188845cf6c25a9ee00b842c03344e295f5 | YES |
| 20261106090000_memory_generation_type.sql | 0c863cac72b323582100062d8ee20ef4c81aa2a964e60e327324025f3467eb87 | YES |
| 20261106100000_atomic_ai_generation_admission.sql | b4e0a4f37f792de92901b433aa08a6a0b94237fa836c72c52174ff2def8f59b9 | YES |
| 20261106160000_core_preorder_on_v21.sql | e9b56fed5718c0e1d906ca2186527adaa9822d14c796d092015ba6d88d828b43 | NO |
| 20261107090000_generic_job_acknowledgement_guards.sql | 150a5b25547f5232225ad385d1323b5cd76df4e1ceab05fdc0c532457ae20c48 | NO |
| 20261107100000_job_claim_isolation.sql | 348c57a84b52b48c7d616e1ee1fdf3e7e7299d55bfd4791293637782d35f0f40 | NO |
| 20261107110000_canonical_preorder_publication.sql | 187e5ab76eef1ea91723f00514d61a4abc9de67034b5fb688ef1b42fac0429ab | NO |

### Dependency dan surface perubahan

| Versi | Prasyarat dan kontrak relevan |
|---|---|
|03000000 | baseline public/private,26tabel, RLS/grant/function/triggers/constraints dan vector; memerlukan platform Auth/extensions |
|03090000 | baseline; atomic campaign + initial Blueprint/proposal source persistence |
|04090000 | baseline/Blueprint; Evaluation CAS, source locking, finalization + campaign completion |
|04091000 | finalization; seal completed campaign updates |
|04092000 | finalization; synthetic finalization/Memory approval guards |
|04093000 | source guards; atomic Memory approval+enqueue dan dedicated claim/complete |
|04094000 | Memory transactions; indexing recovery/fencing |
|06090000 | AI/Memory; generation_type contract dan Memory generation binding |
|06100000 | AI claims; atomic admission/quota, generation request identity |
|06160000 | seluruh9 baseline; port core owner/business categories, order/payment/reservation/publication/jobs, policies/column grants, bucket Storage, FK/index/default |
|07090000 A1 | core complete/fail + private.job_backoff; ACK fencing/Memory exclusion tanpa signature/ACL change |
|07100000 A2 | kedua claim overload/core queue; legacy fail-closed, generic type isolation |
|07110000 A3 | core owner/lock/snapshot dependencies; kedua publish overload ke helper kanonis |

Prefix versi dipersingkat pada tabel dependency, bukan nama migration baru. Ordering tepat tetap filenames lengkap di atas. A1/A2/A3 tidak dapat dipasang sendirian pada target9-chain; dependency core belum ada.

Git429f603 mengganti13 migration core lama dengan06160000: core_preorder(20261102091442), product_photos(20261102154714), business_categories(20261103090000), preorder_lifecycle(20261104093641), order_lifecycle(20261104120000), cancel_preorder_draft(20261105090000), order_offer_seam(20261106090000), payments(20261106100000), payment_contract_alignment(20261106110000), order_attribution_seam(20261106120000), owner_order_review(20261106130000), job_queue(20261106140000), domain_events(20261106150000). Tidak ada file lama yang dihapus dari database lewat F0. Beberapa **nomor versi** beririsan dengan baseline AI tetapi nama/source berbeda; dalam target ini ledger name mengidentifikasi baseline AI, bukan migration core lama bernomor sama. Version-only matching tidak cukup.

9c36b61 menambahkan grant per kolom dalam06160000 setelah versi awal port. Target tidak mencatat06160000 sama sekali, sehingga kasus “versi06160000 sudah applied tetapi grant masih sebelum9c36b61” **tidak ditemukan pada target ini**. Untuk target rekan/hosted tetap UNKNOWN.

## F. Existing Target Applied History — U02

Relation supabase_migrations.schema_migrations diverifikasi ada sebelum SELECT. Kolom actual: version text, statements text[], name text. Total9; seluruh row dibaca sebagai version/name/jumlah statement/fingerprint, tanpa mengeluarkan isi statements.

| Versi/nama | Statements | Applied | Perbandingan current contract | Klasifikasi |
|---|---:|---|---|---|
|20261103000000 initial_v21 |307|YES|column baseline ada; legacy claim/publish sama body awal, berbeda expected akhir; full-file equivalenceUNKNOWN|baseline lama, kemudian perlu override |
|20261103090000 atomic_campaign_blueprint_creation |5|YES|fungsi bersama cocok catalog A5|kontrak fungsi teramati MATCH |
|20261104090000 evaluation_cas_and_finalization |15|YES|CAS/finalize/source guard bersama cocok|MATCH pada surface teramati |
|20261104091000 seal_completed_campaign_updates |1|YES|trigger/function bersama cocok|MATCH pada surface teramati |
|20261104092000 reject_synthetic_finalization_memory_approval |3|YES|guard bersama cocok|MATCH pada surface teramati |
|20261104093000 memory_approval_and_indexing_transactions |17|YES|Memory claim/complete/approval/source guard cocok|MATCH pada surface teramati |
|20261104094000 memory_index_recovery |4|YES|fungsi bersama cocok|MATCH pada surface teramati |
|20261106090000 memory_generation_type |4|YES|column/function bersama cocok|MATCH pada surface teramati |
|20261106100000 atomic_ai_generation_admission |5|YES|admit_ai_generation definition/ACL cocok|MATCH pada surface teramati |
|20261106160000 core_preorder_on_v21 |—|NO|categories/core functions/grants/bucket tidak ada|MISSING |
|20261107090000 generic_job_acknowledgement_guards |—|NO|ACK functions tidak ada|MISSING |
|20261107100000 job_claim_isolation |—|NO|typed claim tidak ada; legacy body lama|MISSING |
|20261107110000 canonical_preorder_publication |—|NO|canonical helper/owner overload tidak ada|MISSING |

Tidak ada extra version; urutan ledger adalah prefix9 current source. Tidak ada gap di dalam prefix tersebut. Tidak ada ledger checksum formal. Hash md5 dari statements yang digabung newline hanya fingerprint representasi ledger saat dibaca, **bukan checksum sumber SQL otoritatif** dan tidak dibandingkan langsung dengan SHA256 file atau pg_get_functiondef. Full-content equivalence per migration tetapUNKNOWN; perubahan di luar ledger juga tidak dikesampingkan hanya dari versi.

**Klasifikasi: OLDER_MIGRATION_CHAIN.** Bukan CURRENT_VERSIONS_BUT_CONTRACT_DRIFT, bukan target unavailable, dan tidak ditemukan mixed/extra ledger pada database ini. U02 berubah dari “target belum diinspeksi” menjadi “target9-chain diketahui; forward upgrade masih perlu keputusan dan pengujian”. Tidak ada repair/reset/upaya menyamakan ledger.

## G. Schema/RPC/Grant Compatibility

### Metode pembandingan

Reference adalah artefak historis A5 run5605882a-c4fa-42ca-9956-40e93e767353, catalog SHA256 **05ffc10e46b1a62dda77b6bb1562349db2fce7d92dbc7a956a47366e0c1e0992**. Summary mencatat Layer1PASS, Layer2NOT EXECUTED, docsMATCH/comparatorPASS. Seluruh13 migration hash di summary dicocokkan ulang dengan file current dan semuanya sama. Cache dipastikan berada dalam node_modules/.cache/database-v21. Ini bukti historis pembanding yang ditelusuri, **bukan fresh reference DB yang dijalankan F0**.

SQL database/v2.1/tests/catalog.sql dibaca lengkap, SHA256 dicocokkan baseline sebelum dipakai, session SET diubah menjadi SET LOCAL dalam input proses tanpa mengedit file, lalu SELECT catalog dieksekusi dalam pembungkus READ ONLY. Representation columns/constraints/policies/trigger/function sama dengan A5; pencocokan per object key, bukan order JSON atau whole-file hash.

pg_get_functiondef actual dan cache dibandingkan pada teks definisi yang sama, bukan migration-file bytes. Untuk2 body lama, prosrc target dibandingkan lagi dengan body $$ source initial_v21 setelah newline text LF; kedua MD5 cocok. MD5 di sini fingerprint kesetaraan teks, bukan jaminan kriptografis provenance. Whole target JSON fingerprint berbeda memang diharapkan; tidak dijadikan bukti detail drift.

### Inventory/delta actual

| Area | Current expected A5 | Local target | Delta teramati |
|---|---:|---:|---|
| Public tables/RLS |26/26enabled|26/26enabled|nama, RLS dan effective table privileges role anon/authenticated/service_role semuanya cocok |
| Columns |352|351|businesses.categories hilang;6 default berbeda |
| Public constraints |290|288|2hilang;288 lainnya identik |
| Public indexes |107|100|7hilang;100 lainnya identik |
| Public policies |30|25|5hilang;25 lainnya identik termasuk role/qual/with_check |
| Public triggers noninternal |45|43|2hilang;43 lainnya identik |
| Public+private functions |99|54|45hilang;2dari54 definisi berbeda;52 definisi cocok |
| Public RPC signatures |50|27|23hilang; tidak ada extra signature |
| Private functions |49|27|22hilang |
| Effective execute privileges shared54 |source roles|target roles|MATCH untuk seluruh54 pada anon/authenticated/service_role; missing45 tidak dianggap MATCH |
| Owner/config fungsi54 |kontrak restricted|postgres seluruh54; search_path='' seluruh54|28SECURITY DEFINER,26invoker; metadata dibaca, bukan disimpulkan dari file |
| Extensions |3 pada L1|7 pada platform|4tambahan platform; bukan app schema regression |
| Storage product-photos |bucket +3policies|bucket tidak ada; storage policies0|surface photo belum deployed |

Enam default yang tidak ada pada target: preorders.status=draft; payments.provider=midtrans_sandbox; job_runs.status=queued; job_runs.attempt_count=0; job_runs.next_run_at=now(); domain_events.occurred_at=now().

Constraints hilang: businesses_categories_valid; capacity_reservations_order_id_business_id_fkey. Indexes hilang: capacity_reservations_order_idx; domain_events_entity_idx; order_items_order_idx; orders_business_status_created_idx; orders_preorder_idx; preorder_items_capacity_idx; preorders_slug_key. Triggers hilang: business_category_sync dan capacity_commitment_guard.

Policies hilang: businesses_owner_update; products_owner_insert; products_owner_update; production_capacity_owner_insert; production_capacity_owner_update. **Tidak ada table-wide atau column-specific authenticated INSERT/UPDATE efektif pada ketiga tabel yang diperiksa.** Ini kekurangan grant, bukan temuan owner memiliki hak tulis terlalu luas. Kode core yang memerlukan categories dan write grants tidak kompatibel dengan catalog target; gejala HTTP/UI belum dieksekusi.

Grant current06160000: business UPDATE(name,categories,description,public_contact,pickup_instructions); product INSERT9kolom/UPDATE8kolom; capacity INSERT6kolom/UPDATE3kolom. Exact allowlists ada pada source06160000:1516–1526 dan current-contracts.mjs:37–48. Tidak menerapkan GRANT apa pun.

Extension tambahan target: pg_stat_statements, pgcrypto, supabase_vault, uuid-ossp. plpgsql/pgtap/vector ada dengan versi/schema yang cocok reference. Tidak menyamakan seluruh platform extensions dengan minimal Layer1 scaffold.

Storage schema/buckets columns diverifikasi terlebih dahulu. Query id product-photos menghasilkan0row; pg_policies schema storage menghasilkan0policy. Source06160000:1466–1474 menghendaki public bucket, limit5,242,880bytes, MIME JPEG/PNG/WebP, owner select/insert/delete path policies. Tidak membaca objects atau menguji HTTP. Limit input foto aplikasi10MiB sebelum optimisasi berbeda tahap dari limit output bucket5MiB; belum membuktikan output oversized bug.

### Signature yang hilang dari target

Public23 signature berikut ada pada current catalog A5 dan tidak ada pada target:

accept_late_payment(p_order_id uuid, p_expected_version integer, p_payment_id uuid); advance_fulfillment(p_order_id uuid, p_expected_version integer, p_action text); apply_verified_payment(p_provider_order_id text, p_provider_event_key text, p_payload_hash text, p_provider_status text, p_provider_transaction_id text, p_amount_idr bigint, p_provider_paid_at timestamp with time zone); cancel_preorder_draft(p_preorder_id uuid, p_expected_version integer); cancel_published_preorder(p_preorder_id uuid, p_expected_version integer); claim_jobs(p_job_types text[], p_limit integer, p_lease_seconds integer); claim_payment_attempt(p_token_hash text); close_preorder(p_preorder_id uuid, p_expected_version integer, p_reason text); complete_job(p_job_id uuid, p_attempt integer, p_provider_reference text); complete_preorder(p_preorder_id uuid, p_expected_version integer); create_business_with_owner(p_name text, p_slug text, p_categories text[], p_description text, p_public_contact text, p_pickup_instructions text); create_manual_order(p_preorder_id uuid, p_quantity integer, p_customer_name text, p_customer_email text, p_customer_contact text, p_is_paid boolean, p_idempotency_key text, p_request_hash text); create_preorder_order(p_slug text, p_quantity integer, p_customer_name text, p_customer_email text, p_customer_contact text, p_token_hash text, p_idempotency_key text, p_request_hash text, p_expected_unit_price_idr bigint, p_hold_ttl_seconds integer, p_attribution_ref text); create_standalone_manual_order(p_capacity_id uuid, p_quantity integer, p_customer_name text, p_customer_email text, p_customer_contact text, p_is_paid boolean, p_idempotency_key text, p_request_hash text); decline_late_payment(p_order_id uuid, p_expected_version integer, p_note text); enqueue_expire_jobs(p_limit integer); expire_or_cancel_order(p_order_id uuid, p_expected_version integer, p_action text, p_reason text, p_refund_note text); fail_job(p_job_id uuid, p_attempt integer, p_error_code text, p_provider_reference text); publish_preorder(p_preorder_id uuid, p_expected_version integer); read_preorder_offer(p_preorder_id uuid); record_payment_charge(p_payment_id uuid, p_provider_transaction_id text, p_qr_content text, p_qr_expires_at timestamp with time zone); resolve_production_cost(p_order_id uuid, p_expected_version integer, p_cost_per_unit_idr bigint, p_quality text, p_note text); save_preorder_draft(p_preorder_id uuid, p_expected_version integer, p_slug text, p_name text, p_capacity_id uuid, p_target_units integer, p_quota_units integer, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone).

Private22 signature berikut juga tidak ada:

are_valid_business_categories(p_categories text[]); assert_orderable(p_capacity production_capacity, p_item preorder_items, p_quantity integer); close_active_payment_attempts(p_order orders, p_status text); committed_units(p_capacity_id uuid, p_preorder_item_id uuid); current_order_offer(p_preorder_id uuid); current_owner_business(); discount_per_unit(p_base_price_idr bigint, p_discount_bps integer); enqueue_paid_email(p_order orders); guard_capacity_update(); insert_order(p_preorder preorders, p_item preorder_items, p_source text, p_payment_mode text, p_external_payment_status text, p_order_status text, p_customer_name text, p_customer_email text, p_customer_contact text, p_quantity integer, p_token_hash text, p_idempotency_key text, p_request_hash text, p_reservation_state text, p_payment_due_at timestamp with time zone, p_discount_bps integer, p_pricing_campaign_id uuid, p_attribution_campaign_id uuid); is_business_owner(p_business_id uuid); job_backoff(p_attempt integer); lock_order(p_order_id uuid, p_expected_version integer, p_business_id uuid); lock_owned_preorder(p_preorder_id uuid, p_expected_version integer); new_order_number(); order_result(p_order orders, p_replayed boolean); owns_product_photo(p_object_name text); payment_attempt_result(p_payment payments, p_action text); publish_preorder_canonical(p_business_id uuid, p_preorder_id uuid, p_expected_version integer); record_order_event(p_business_id uuid, p_order_id uuid, p_event_type text, p_from_state text, p_to_state text, p_details jsonb); resolve_attribution(p_preorder_id uuid, p_attribution_ref text); sync_business_category().

Tidak memanggil fungsi-fungsi tersebut untuk membuktikan ketidakhadiran. Parameter name ikut key pembanding agar perubahan overload/named args tidak tersembunyi.

## H. A1/A2/A3 Deployment Evidence

| Kontrak | Target actual | Expected current / grants | Kesimpulan |
|---|---|---|---|
| complete_job(uuid,integer,text DEFAULT NULL)→boolean |ABSENT|A1: definer, empty path, EXECUTE service_role only; Memory reject23514, attempt/live lease setelah lock, stale false|**A1 NO**; bukan “unsafe ACK function masih ada”, karena fungsi belum ada sama sekali |
| fail_job(uuid,integer,text,text DEFAULT NULL)→text nullable stale |ABSENT|A1: sama; Memory reject, staleNULL, bounded retry/dead|**A1 NO** |
| claim_jobs(integer DEFAULT10,integer DEFAULT60,integer DEFAULT5)→SETOF job_runs |PRESENT legacy catch-all; ownerpostgres/definer/empty path; ACL postgres+service_role|A2 harus0A000 TYPED_JOB_CLAIM_REQUIRED, bukan claim/update|**A2 NO**; body berbeda |
| claim_jobs(text[],integer,integer)→jsonb |ABSENT|generic allowlist expire/reconcile/send_paid_email; EXECUTE service_role|**A2 NO**; current TS worker belum dapat memakai target |
| claim_memory_jobs(uuid,text,text,integer,integer,integer,integer)→SETOF job_runs |PRESENT, definition+privilegesMATCH|dedicated scoped Memory claim tetap tersedia|Memory lower-layer deployed, bukan bukti positive verified source |
| publish_preorder(uuid,uuid,integer,uuid DEFAULT NULL)→preorders |PRESENT legacy; ownerpostgres/definer/empty path; ACL postgres+authenticated+service_role; pickupInstructions|A3 wrapper ke canonical helper dengan actor/owner check|**A3 NO**; legacy body berbeda |
| publish_preorder(uuid,integer)→void |ABSENT|owner derived auth; EXECUTE authenticated only|**A3 NO** |
| private.publish_preorder_canonical(uuid,uuid,integer)→preorders |ABSENT|invoker, empty path, tidak executable app roles|**A3 NO** |

### Definition fingerprint sebanding

| Fungsi | MD5 pg_get_functiondef target | MD5 expected13-chain A5 |
|---|---|---|
| legacy claim_jobs |bcba683c2438e4b5c00aeb3d0b9ee7c3|a6e9341437e9d74b90d8ca0ac884f7e9|
| legacy publish_preorder |def9ccb2d99f50a578c6b637f05c1db0|5f2cfef8448b6d3b3d7fdf0e9593cab4|
| claim_memory_jobs |ff78f4d027c67aaef70abf41a5ebd0fd|sama |
| complete_memory_index_job |835667ec9d5e817c0832dcc35b0ee26f|sama |
| admit_ai_generation |386eaa6b4e81ac716e02eca27a2698c0|sama |
| record_campaign_evaluation_cas |401ed745c453c6ecf7a2f637c4540117|sama |
| finalize_campaign_evaluation |2ae465f0bf1c3fbbaf00d9f98ba40899|sama |

prosrc legacy claim MD5 07356bc8336d952a05bad20b59e475b0 dan legacy publish87a328fb59dea5ffaa95bd5363ee03d1 cocok body current initial_v21, membuktikan varian lama secara independen dari ledger version.

Legacy claim actual meng-update exhaustion tanpa filter job_type dan memilih ready rows lintas tipe. Ini risiko service-worker mengambil/menandai Memory; **tidak ada job aktual yang diklaim atau bukti job corruption dibaca**. Existing finish_job tetap menolak jalur Memory sesuai source guard; tidak menjadikan catch-all claim aman. Legacy publish actual memakai advisory lock+capacity/order context dan snapshot camelCase. Tidak ada publikasi nyata dilakukan.

Shared payment: hanya overload legacy apply_verified_payment(uuid,text,text,text,bigint,text,timestamptz)→text, definer/empty path/service-only, definition3f18cd3183a6cbf44ac1f5639f63845d MATCH reference legacy. Canonical tujuh-field core overload belum ada; accept_late_payment/read_preorder_offer/create_preorder_order/save_preorder_draft/private.current_order_offer belum ada. Jangan mengubah caller ke legacy semata agar target menerima request; semantiknya berbeda.

Memory private.approve_memory_and_enqueue adalah invoker dengan ACL postgres saja. Public approve_campaign_memory, dedicated claim/complete, source check dan recovery memiliki definisi shared yang cocok catalog A5. Public source guard synthetic/VERIFIED_C6_UNAVAILABLE tetap berlaku. A1/A2/A3 hardening tidak boleh ditandai deployed berdasarkan keberadaan Memory RPC tersebut.

## I. Historical Preorder Snapshot Cohorts

Schema public.preorders.status text dan pickup_terms_snapshot jsonb sudah diverifikasi sebelum aggregate. pg_class estimate=-1 belum analyzed; pg_relation_size8192bytes. Query tidak bergantung pada estimate tersebut: SELECT status='published' LIMIT10001 lalu aggregate, statement_timeout5s. Hasil2, jauh di bawah cap, sehingga hitungan lengkap **pada snapshot statement itu**, bukan batas bawah sampel.

| Pengukuran | Jumlah | Arti |
|---|---:|---|
| Published rows diperiksa |2|tidak mengembalikan ID, nama, pickup/contact |
| Empat key kanonis dengan tipe reader-compatible |0|pickup_instructions string, public_contact string/JSONnull, kedua window string |
| Legacy camelCase-only |2|ada pickupInstructions; tidak ada satu pun dari4key kanonis |
| Legacy instruction bertipe string |2|pemeriksaan aggregate tambahan; tidak mengembalikan nilainya |
| Legacy instruction salah tipe |0|bukan bukti field kanonis sudah tersedia |
| Object missing required canonical keys |2|diagnostic overlap dengan legacy2, bukan tambahan2row |
| Object dengan semua key tetapi tipe salah |0|tidak berarti2legacy kompatibel |
| Field kanonis yang hadir tetapi salah tipe |0|missing keys tetap dihitung terpisah |
| JSON non-object |0|termasuk JSONnull, array/scalar |
| SQLNULL snapshot |0|berbeda dari JSONnull |
| Other object incompatible |0|di luar kelompok canonical/legacy |
| Cap tercapai/full countUNKNOWN |NO|hasil2<10001 |
| Backfill/republish/snapshot update |**NO**|tidak ada mutation |

Klasifikasi **Legacy-format rows found**. A6-17 sekarang CONFIRMED untuk cohort published lokal. Tidak menyimpulkan seluruh usaha/pelanggan affected, tidak mengklasifikasikan row sebagai demo/production dari ID, dan tidak memeriksa closed/completed historical cohorts. Bentuk key/type diperiksa, bukan nilai kontak atau validitas timestamp/string secara semantik.

Reader src/features/preorders/repository.ts:66–71 meminta empat key snake_case tanpa fallback; source mismatch ini nyata. Memasang A3 hanya memperbaiki publication berikutnya, tidak memperbaiki2row ini. Owner/public reads yang melewati parser tersebut berisiko gagal; tidak ada request HTTP untuk mereproduksi gejala pada F0.

Keputusan pemulihan untuk tugas terpisah:

1. Pertahankan frozen pickupInstructions yang sudah tersimpan. Bila historical backup/event snapshot otoritatif menyediakan contact/window pada saat publikasi, evaluasi pemulihan dari sumber itu dengan provenance, bukan profil usaha/capacity sekarang.
2. Bila field tidak dapat dipulihkan, sepakati kompatibilitas pembacaan historical bentuk lama dengan keterbatasan eksplisit, atau penanganan arsip yang disetujui produk. Jangan mengarang nilai agar parser lulus.
3. Perubahan data/reader/trigger memerlukan tugas dan izin terpisah; lakukan dry-run pada salinan terotorisasi serta regression kedua future writers dan existing rows.
4. Jangan republish, menonaktifkan frozen-data trigger, atau mengganti terms historis memakai data hari ini.

## J. Worker and External Consumer Compatibility

Pencarian mencakup src, scripts, tests, database, root deployment/config names, docs dan route inventory. .github, compose/cron/Edge Function deployment entry tidak ditemukan pada inventory repository ini; tidak mengasumsikan sistem eksternal tidak ada. Komentar “dipanggil scheduler” bukan bukti scheduler yang berjalan.

| Consumer / klasifikasi | RPC/type/parameters | ACK/lease/attempt | Kompatibilitas |
|---|---|---|---|
| src/features/jobs/service.ts:32 runExpireJobs — fungsi runtime in-repo, **entry scheduler tidak ditemukan** | enqueue_expire_jobs, claimJobs(['expire'],limit default50,lease60); job_types aktual repository.ts:19 | complete_job(id,attempt,reference) / fail_job(id,attempt,code,reference), max attempt5 dalamSQL; helper summary mengabaikan stale ACKboolean | target tidak mempunyai typed claim/enqueue/ACK. Sesudah core+A1/A2 tersedia, signature consumer cocok; A2 tidak mematahkannya karena sudah typed |
| src/features/jobs/repository.ts:39 — adapter runtime | claim_jobs p_job_types/p_limit/p_lease_seconds | output JSON5fields diparse Zod lalu attempt_count dibawa balik | target hanya legacy signature, tidak compatible current args |
| Memory API src/features/business-memory/api.server.ts:32 — **known active dev entry** | action run_worker → runMemoryWorker; claim_memory_jobs dengan business/model/profile/version,limit1,lease60,max5 | complete_memory_index_job dengan jobId/attempt/contentHash/profile/vector/error; source/lease recheck sebelum/akhir; ambiguous ACK reconciliation | dedicated RPC targetMATCH; A2 tidak mematahkannya. Sumber verified masih guarded, bukan bukti indexing produksi aktif |
| scripts/run-memory-indexing.mjs:1 — explicit fixture runner | owner-A fixture token → development API, bukan generic claim | server menyimpan service key; output idle/processed dan max1claim | bergantung cache/normal app URL; **tidak dieksekusi F0**, tidak scheduler |
| reconcile dan send_paid_email | enum/queue SQL ada pada current source; actual worker/provider consumer tidak ditemukan | harus claim typed dan ACK fencing; referensi provider durable | deployment eksternalUNKNOWN; email enqueued bukan email delivered |
| database/v2.1/tests/invariants.sql:219 — **historical checkpoint test** | legacy claim_jobs(1,60,5) sebelumA2 | finish_job stale/current/replay checks | sengaja historical-only; bukan runtime consumer yang harus dipertahankan pada final chain |
| tests/supabase/jobs.test.ts, focused A1/A2 modules, tests/types — **test-only** | typed/negative legacy claims/ACK; beberapa test melakukan mutasi fixture | bounded attempts/races pada disposable suite | jangan dijalankan pada persistent target9chain |
| database/v2.1/tests/concurrency.mjs:45 — current test | typed expire claim | legacy finish_job untuk non-Memory historical compatible contract | bukan scheduler, tidak dijalankan |
| external worker/platform/cron — **potential/UNKNOWN** | mungkin legacy positional/default/noargs claim | tidak diketahui | A2 sengaja mematahkan legacy catch-all dengan0A000; perlu inventaris operator sebelum rollout |

**Nama job type aktual adalah reconcile, bukan reconcile_payment.** Ini dikonfirmasi src/features/jobs/repository.ts:19 dan migrationA2:18. Penyebutan reconcile_payment pada narasi A6-18 adalah ketidaktepatan dokumentasi historis; laporan A6 tidak diedit. Jangan menambahkan enum/alias baru berdasarkan narasi tersebut.

Checklist koordinasi rollout:

- Identifikasi semua deployment, command cron/worker, binary version dan target DB-nya; minta pemilik sistem eksternal memberi parameter RPC/ACK yang sebenarnya dipakai.
- Kelompokkan typed core, untyped legacy, dedicated Memory dan historical test; larang mixed Memory di generic claim.
- Tetapkan upgrade/pause/drain/resume per consumer; tangani request in-flight/lease yang berakhir tanpa melepas fencing.
- Pastikan retry0A000 adalah compatibility error yang teramati, bukan loop retry tanpa batas atau fallback ke catch-all.
- Verifikasi worker memakai PostgreSQL attempt/live lease dan menafsirkan complete=false/fail=NULL sebagai stale.
- Idempotency provider/email/reconcile harus terikat durable reference; ulang ACK tidak mengulang side effect.
- Tidak deployA2 ke target sampai consumer legacy diketahui/ditangani. Consumer eksternal belum dapat dinyatakan aman atau tidak ada dari repo saja.

## K. Supabase Layer 2 Environment Design — NOT EXECUTED

### K1. Tooling yang benar-benar diperiksa

Installed npm package dan native Windows CLI **2.122.0** cocok; runtime --version exit0. Native binary terpilih melalui node_modules/supabase/dist/supabase.js; SUPABASE_CLI_BINARY_OVERRIDE shell tidak terpasang. Tidak install/update dependency.

Awal bantuan CLI gagal karena inisialisasi telemetry mencoba menulis profil pengguna dan ditolak sandbox. Setelah flag process-local SUPABASE_TELEMETRY_DISABLED=true dan DO_NOT_TRACK=1, --version serta --help, start --help, stop --help, init --help, db reset --help, status --help berhasil. Tidak ada init/start/stop/reset/status operasional yang dijalankan. Native binary juga menyebut SUPABASE_HOME dan SUPABASE_NO_UPDATE_NOTIFIER; variabel ini baru **source-inspected**, bukan diuji membuat home/menonaktifkan update check pada F0.

| Capability | Bukti installed help | Pemakaian rancangan |
|---|---|---|
| --workdir string | global flag, folder yang memuat supabase/, dipakai persis tanpa ancestor search | wajib absolute temp root pada setiap command |
| init | initialize project; --force overwrite tersedia | gunakan hanya temp kosong; **tanpa --force** |
| start | start local containers; --exclude list; --ignore-health-check | start hanya temp project; **tidak pakai ignore-health-check** |
| stop --project-id string | membatasi local project ID | cleanup exact temporary ID setelah label/path check |
| stop --no-backup | menghapus data volumes project yang dihentikan | hanya disposable ownership yang sudah dibuktikan |
| stop --all | semua local instances | **dilarang digunakan** |
| status -o json | output platform vars | hanya capture private RAM pada eksekusi berikutnya; jangan log keys |
| db reset --local --no-seed | tersedia pada help | kemampuan dicatat; bukan instruksi reset stack normal, tidak dijalankan |
| start --project-id | **bukan flag start di help** | project identity di temp config, jangan mengarang flag |
| --network-id | global flag tersedia | tidak menunjuk network normal; default unique project network lebih sederhana |

### K2. Arsitektur dan batas target

Rancangan: Windows host Docker Desktop yang sama → bridge/network **khusus temporary project** → PostgreSQL17 aktual + GoTrue + PostgREST + Kong + Storage API dan storage volume baru, test mail sink lokal, metadata service bila diperlukan. Auth/storage schema datang dari platform nyata, **bukan scaffold A4**. Migrations app adalah salinan13 source current yang hash-nya diverifikasi. Auth ownerA/ownerB dan fixture data dibuat hanya di instance baru pada task eksekusi yang diizinkan.

Project ID: cl-a6f0-{unique12hex}, berbeda dari campaign-lab dan semua project teramati. Workspace: absolute temp directory di bawah system TEMP/campaign-lab-l2/{UUID}, di luar D:\Project\campaign-lab. Tidak membuat project Supabase kedua di dalam repository/current supabase directory. CLI working directory dan home/cache temporary dipisah; tidak menyalin .env.local, supabase/.temp, linked-project metadata, normal volumes atau token profile.

Kandidat port, **belum direservasi**:

| Service | Temp candidate | Normal Campaign Lab |
|---|---:|---:|
| Shadow DB |56320|54320 |
| API/Kong |56321|54321 |
| DB |56322|54322 |
| Studio bila diaktifkan |56323|54323 |
| Mail sink |56324|54324 |
| Analytics bila diperlukan |56327|54327 |
| Pooler bila diperlukan |56329|54329 |
| Optional Next |3301|3001 |

Pembacaan listener tidak menemukan kandidat tersebut pada saat query; ini bukan jaminan tersedia saat start. Preflight eksekusi wajib mengulang pengecekan dan gagal bila collision. Postgres volume dan Storage bytes volume harus baru, berlabel unique project ID; catat exactID/name/mount sebelum fixture. Jangan mount source-data directory atau volume stack normal.

**Batas listener:** CLI tidak memperlihatkan flag bind-address pada start --help. Stack normal terbukti publish DB pada wildcard. Jangan mengklaim temp port otomatis loopback-only; task eksekusi harus memeriksa HostIp binding dan memastikan pembatasan akses host/firewall yang disetujui. Bila prasyarat eksposur lokal tidak dapat dipenuhi, abort startup/fixture sesuai cleanup scoped; jangan mengubah firewall atau stack normal otomatis.

### K3. Prosedur setup pada tugas terpisah

1. Dapatkan otorisasi eksekusi Layer2 disposable, pastikan candidate source/revision+hash manifest final dan ruang/disk/image runtime tersedia. Versi CLI/paket dipin dan diperiksa ulang; tidak mengikuti update notice otomatis.
2. Pilih unique temp root/projectID dan validasi resolved path berada di bawah root sementara yang dituju, tidak sama/ancestor current repository atau profil normal. Tidak membuat Git worktree/reset/copy DB volume. Semua path yang akan dibersihkan dicatat sebelum lifecycle dimulai.
3. Buat child environment allowlist: tool/system paths yang dibutuhkan, Docker local endpoint eksplisit; kosongkan inherited Supabase access token, linked refs, remote DB URL, provider/payment/SMTP/cloud credentials dan CLI binary/workdir override. Jangan repurpose HOME/USERPROFILE. Gunakan SUPABASE_HOME terpisah hanya setelah perilakunya diverifikasi ulang; telemetry/update notifier dimatikan. Jika CLI tetap membaca/menulis home normal, STOP dan tinjau isolasi, bukan memperluas izin diam-diam.
4. Gunakan absolute binary CLI yang telah diverifikasi. Template command **belum dieksekusi**:
   - & $cli --workdir $temporaryRoot init
   - edit hanya config hasil init dalam temporaryRoot: unique project_id, seluruh active ports, db.major_version17, local Auth site/redirects3301, Mailpit lokal; seed disabled/sql_paths kosong; external SMTP/OAuth/hooks yang memanggil jaringan eksternal dimatikan; analytics/realtime/edge optional dimatikan jika tidak diuji. Keys/config fields harus cocok hasil init CLI2.122.0, bukan copy buta semua config normal.
   - salin13 file migration yang diizinkan beserta template auth yang benar-benar dirujuk, dengan hash check. Jangan salin normal seed, fixture cache, .env atau credentials. Candidate source mencakup dirty/untrackedA1–A5; git archive HEAD saja akan menghilangkan patch tersebut.
   - & $cli --workdir $temporaryRoot start
5. Setelah startup, periksa labels exactID/workdir/project, semua mounts/volumes/networks/ports, DB version dan ledger. Verifikasi tidak ada resource milik normal/other project terpakai. Semua layanan wajib sehat; jangan --ignore-health-check. Jika current CLI tidak menghasilkan isolasi sesuai rencana, task gagal/cleanup, bukan lanjut fixture.
6. Periksa root migrations yang benar-benar applied, catalog current352/50RPC, grant/RLS/Storage dan PostgREST schema-cache visibility. Start behavior terhadap migration harus dibuktikan pada instance baru; bila chain tidak lengkap, STOP dan tinjau perintah local migration pada task itu. Jangan melakukan reset/repair sebagai fallback tanpa guard/otorisasi baru.
7. Capture status/temporary keys ke memori proses dengan output tertutup. Jangan cetak service key/JWT/password, jangan tulis Git atau env normal. Fresh local keys berbeda dari normal/hosted. Tidak memakai kredensial atau auth user milik stack normal.
8. Buat dua owner test dan fixture bisnis melalui API/transaction khusus instance baru. Gunakan fake text/embedding adapter untuk tes deterministik, tanpa menyalin test data persisten. Synthetic Memory tetap tidak boleh diloloskan ke verified approval.
9. Optional Next memakai salinan candidate source terpisah dengan environment explicit temporaryURL/keys dan output build di salinan, bukan .next/env repository normal. Jangan langsung menjalankan existing script yang hardcode54321/normal container/cache. Skema/cache target diverifikasi sebelum Server Action pertama.

**Blocker app AI:** src/lib/supabase/transport.server.ts:24–27 menolak origin selain http://127.0.0.1:54321; normal stack sudah memakai port itu. Core SSR dapat memakai temporary envURL56321, tetapi current AI transport tidak. L2 awal dapat menguji Auth/PostgREST/Storage langsung dan core app optional. Pengujian core→AI HTTP di optional app baru boleh dilanjutkan setelah tugas terpisah menyediakan boundary konfigurasi/origin yang benar dan diuji, atau isolasi network namespace yang dibuktikan tanpa menyentuh port normal. F0 tidak mengubah transport, tidak mengarahkan56321 ke54321, dan tidak mengklaim test AI terisolasi sudah siap dieksekusi tanpa blocker.

### K4. Cleanup yang sempit dan failure-safe

Template cleanup **belum dijalankan**: & $cli --workdir $temporaryRoot stop --project-id $temporaryProjectId --no-backup.

Sebelumnya cocokkan configID, absolute workdir, label container/network/volume dan manifest ownership; seluruh ID harus dari instance temporary yang baru dicatat. Jangan hanya menyeleksi nama prefix yang bisa bertabrakan. Bila guard gagal, hentikan cleanup dan laporkan exact resource yang perlu ditinjau; jangan stop normal stack.

Setelah stop, inspect ulang bahwa hanya resource temporary hilang dan ID/StartedAt/volumes normal tetap. Bila ada sisa partial-start, cleanup manual hanya by exact IDs yang telah diverifikasi ownership-nya, dengan tool native satu shell; tanpa --all, system prune, global volume deletion atau recursive delete computed path yang belum diverifikasi. Hapus directory temporary hanya setelah resolved target tetap berada di intended temporary root dan tidak memuat resource normal. Tangani partial startup dengan finally/failure path; jangan diam-diam meninggalkan credentials fixture/cache.

### K5. Test matrix Layer2 yang harus dieksekusi kemudian

| Area | Tes nyata | Assertion utama / dependency |
|---|---|---|
| GoTrue | login/logout/refresh/invalid token, owner membership; optional SSR cookie through Next | Auth identity nyata, satu owner hanya data sendiri; token tidak bocor ke log; upstream behavior tidak diganti auth stand-in |
| PostgREST overload | named args owner publish2-args versus legacy4-args explicit owner actor; service cannot use owner-only overload | expected return void versus composite; denial role/actor; helper private tidak exposed |
| A1 | service ACK/fail normal, stale attempt/lease, Memory exclusion | false/NULL stale dan23514; transaksi tidak memisahkan Memory vector/job |
| A2 | typed expire/reconcile/email; NULL/unknown/mixed type; legacy positional/default | typed dispatch JSON benar; legacy0A000; tidak cross-type exhaustion; dedicated Memory tetap terpisah |
| A3 | publish both overloads dengan valid/stale/null version dan capacity berubah | snapshot4keys, frozen data dan rollback sama; no unexpected overload |
| Owner CAS | NULL/stale/current direct RPC dan service expiryNULL | current08 harus direproduksi/ditandai known defect; rejection menjadi required PASS **setelah F1 diimplementasikan**, jangan mengubah expected agar menutupi bug |
| Schema grants/RLS | dua owner dan anon; insert/update forbidden columns; service privilege separation | column allowlists tepat, tidak table-wide write; foreign business tidak termutasi |
| Storage | public image read, owner upload/select/delete path sendiri; foreign denial; MIME/size invalid | actual bytes + API/JWT + policy, output WebP, over5MiB ditolak; input10MiB berada di tahap optimizer berbeda |
| App core | owner login/onboarding/product/capacity/preorder actions dan reload | real cookies, actual DTO parsers, constraints/CAS errors tampil; tidak memakai persisted old normal fixtures |
| App AI | single owner identity→owned context/discussion after boundary configuration ready | **BLOCKED sekarang** oleh fixed-origin dan context C1; tidak memakai normal54321 untuk pura-pura isolated |
| Memory | negative synthetic/stale/profile/lease cases | guards tetap; public positive verified source baru diuji setelah C6/C7, bukan private helper override |

Layer2 platform prerequisite: Docker/image health, validated temp config/ports/mounts, private status capture, schema-cache visibility dan scoped cleanup. Sebagian besar dapat diverifikasi pada task disposable berikutnya tanpa persistent rollout, tetapi belum ada actual startup preflight PASS. Tidak memakai scripts/test-supabase-v21.mjs --setup-fixtures karena menarget normal container/cache dan dapat menulis .env.local/types.

## L. SDK and Configuration Readiness

### L1. SDK/type inventory terbatas

| Area | Actual source | Batas dan tes HTTP berikutnya |
|---|---|---|
| Core browser/server/proxy/service factories | createBrowserClient/createServerClient/createClient tanpa Database generic; src/lib/supabase/{client,server,proxy,service-role}.ts | types hasil factory tidak otomatis memvalidasi semua query. Tidak ada refactor F0 |
| Core repositories | banyak SupabaseClient tanpa parameter, termasuk jobs/payments/preorders | Zod runtime parsing mempertahankan shape, error dan null. Missing targetRPC/column tetap runtime mismatch meski build PASS |
| AI transport | Database-derived Table/Rpc/Insert/Update; response Promise<unknown> lalu domain parsing | source typed, bukan bukti PostgREST resolver/network current |
| AiAdmissionArgs | enam conditional SQLNULL inputs pada transport type-only alias | generator tidak menginfer body; test actual named args/NULL |
| record_campaign_evaluation_cas | nullable expected_evaluation_id override | actual HTTP null versus omitted dibuktikan |
| fail_job | generated Returns text/string, SQL staleNULL; repository failedJobStatusSchema nullable | setelahRPC tersedia, HTTPNULL harus tetap diterima, bukan coercion ke string |
| claim_jobs/publish/payment/business overloads | A5 official50signature, compile-only SDK tests | target hanya27signature; compile compatibility tidak berarti deployment. Test resolution dan role deny diL2 |
| Generated metadata | A5 public26tables/352cols/66publicFK/50signatures | DB target351cols berbeda; database.types.ts tidak diubah/regenerate F0 |

SDK generation limitations tetap berlaku: CHECK status dipetakan string, bigint number, vector string, public-only Relationships tidak mencakup5FK auth; runtime schemas/bounds dibutuhkan. Tidak menemukan bug query baru hanya karena client unparameterized; A6-16 adalah gap type propagation/verification yang belum diperbaiki.

### L2. Presence-only konfigurasi

Pemeriksaan literal .env.local dan parent shell tanpa menampilkan nilai. Tidak menjalankan app atau membaca effective env proses Next/container services. Parsing presence tidak membuktikan validitas secret/keberhasilan provider; interpolation .env lain juga tidak dievaluasi.

| Requirement | .env.local | Shell override diperiksa | Status |
|---|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL |declared/nonempty; origin sesuai local54321|absent|declared local; target bukan otomatis schema-compatible |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY + fallback NEXT_PUBLIC_PUBLISHABLE_KEY |keduanya declared/nonempty|absent|belum divalidasi Auth HTTP |
| SUPABASE_SERVICE_ROLE_KEY |declared/nonempty|absent|server-only; tidak diuji atau dicetak |
| RATE_LIMIT_HMAC_KEY |**tidak declared**|absent|A6-13 tetap local dependency; effective running processUNKNOWN |
| AI_DAILY_GENERATION_LIMIT |tidak declared|absent|source default100; bukan otomatis config error |
| CAMPAIGN_DISCUSSION_PROVIDER/CONTEXT |declared/nonempty|absent|nilai mode tidak dicetak; validation/runtimeUNKNOWN |
| CAMPAIGN_BLUEPRINT_PROVIDER/APPROVAL |declared/nonempty|absent|deployment gate tetap source |
| CAMPAIGN_EXECUTION_MODE/EVALUATION_MODE/EVALUATION_PROVIDER |declared/nonempty|absent|tidak membuktikan producer nyata |
| CAMPAIGN_MEMORY_PROVIDER/RETRIEVAL |declared/nonempty|absent|tidak membuktikan verified eligible source |
| GEMINI_API_KEY/MODEL/TIMEOUT_MS/EMBEDDING_MODEL |declared/nonempty|absent|provider tidak dipanggil |
| MIDTRANS_SERVER_KEY/CLIENT_KEY/IS_PRODUCTION |tidak declared|absent|adapter belum diintegrasikan; bukan current runtime global missing diagnosis |
| Worker/cron/email/scheduler named keys |tidak ditemukan pada key-name inventory|effective envUNKNOWN|consumer/config terpisah belum terlihat |
| Photo storage |bukan secret env baru; source product-photos public bucket + path rules|N/A|bucket/policies target **ABSENT** |
| CLI binary/workdir/password/access token overrides |tidak declared pada nama yang diperiksa|absent|explicit local socket/--workdir tetap diperlukan |

HMAC validator src/lib/ai/generation-quota-policy.server.ts:5–14 meminta panjang32..4096 dan trimmed≥32; literal tidak ada, sehingga belum memenuhi validator bila effective env sama. Gagal tertutup AI_QUOTA_CONFIGURATION_REQUIRED, bukan bypass rate limit. Tidak membuat, menyisipkan atau merotasi key. Provider credentials yang terdeklarasi tidak memberi izin memanggil provider pada F0.

## M. Upgrade/Rollout Plan — proposal, tidak dieksekusi

### M1. Readiness matrix

| Area | Repository source | Existing local target | Disposable SQL | Real platform HTTP | Status |
|---|---|---|---|---|---|
| Migration history |13current/hash lengkap|9prefix, missing4, no extra|13chainPASS historicalA5|N/A|OLDER_MIGRATION_CHAIN terverifikasi |
| A1 |patched|functionsABSENT|PASS historical|NOT TESTED|NOT DEPLOYED |
| A2 |patched typed/fail-closed|legacycatch-all; typedABSENT|PASS historical|NOT TESTED|NOT DEPLOYED |
| A3 |canonical future writers|legacywriter only|PASS historical|NOT TESTED|NOT DEPLOYED |
| Published snapshots |four required keys|2legacy/0canonical|future writersPASS historical|NOT TESTED|historical compatibility decision REQUIRED |
| RPC/grants/RLS |99functions/30policies +column grants|54/25; shared52defsMATCH,2DIFF,45missing; owner write grants absent|PASS current subset historical|NOT TESTED|NOT CURRENT CONTRACT |
| Types |A5official publicmetadata|not itself DB deployment; target older|catalogverified historical|NOT TESTED|current types preserved, runtime availability mismatch |
| Workers |typed core helper/devMemory entry|dedicatedMemoryRPC MATCH; coreRPCmissing; externalUNKNOWN|queuecontracts historical|NOT TESTED|consumer coordination REQUIRED |
| Layer2 |concrete temp strategy|normalstack not reused|L1 historical only|NOT EXECUTED|design ready with preflight/appAI blockers |
| HMAC |guardrequired|effective appprocessUNKNOWN|mockquota historical|NOT TESTED|missing file/shell declaration |
| Core money/CAS |07/08open current code|affected coreRPC not yet present|newfix tests not run|NOT TESTED|F1 separate source/disposable task |

### M2. Pisahkan tiga target

1. **Fresh disposable:** actual platform schemas,13 migrations + future approved F1/F2 additive migrations, local fixture only, actual HTTP verification and cleanup. Ini tempat membuktikan upgrade candidate dan aplikasi sebelum normal deployment.
2. **Development local persistent:** target9-chain yang diinspeksi F0. Dapat direncanakan forward upgrade, tetapi perlu backup/recovery, historical cohort decision, data prerequisites dan persetujuan deploy terpisah. Tidak melakukan reset demi menyamai source.
3. **Shared/production/hosted:** tidak diakses. Semua identity/history/catalog/consumer/backup checks harus diulang dengan otorisasi tersendiri; hasil local tidak diwariskan sebagai deployment evidence.

### M3. Rencana forward-only yang bisa ditinjau

| Tahap | Aksi berikutnya yang perlu diizinkan | Gate/hasil wajib |
|---|---|---|
|1 Freeze candidate |identifikasi branch+dirty source hashes+SQL candidate; sepakati ownership dan consumer eksternal |manifest artifact jelas; tidak hanya HEAD |
|2 Backup/recovery |backup terotorisasi localDB +Storage dan uji restore pada instance lain; dokumentasikan operator/recovery threshold |restore terbukti; F0 tidak membuat backup |
|3 Precondition data |pada export/salinan berizin, periksa duplicate slug untuk unique index, FK orphan/composite tenant, categories derivation, row constraints; perluas historical cohort jika scope butuh closed/completed |tidak menganggap missingindex/FK aman diterapkan hanya karena catalog tersedia |
|4 Migration sequence |untuk target yang terbukti9prefix:06160000 current approved hash, lalu07090000A1→07100000A2→07110000A3, kemudian future additive remediation sesuai dependency |tidak mengubah first9/appliedhistory; perubahanF1 SQL melalui task terpisah |
|5 Body/grant reconciliation |review SQL/body/ACL current termasuk9c36b61 correction; apabila target lain mencatat version tetapi body salah, buat corrective forward migration baru |jangan edit/replay file applied, repairledger atau compare hash beda representation |
|6 Historical snapshot decision |pilih authorized reader compatibility/recovery dengan provenance; jangan isi terms dengan currentbusiness values |2legacy tidak hilang dari masalah hanya karena A3applied; frozen data dipertahankan |
|7 Worker coordination |inventory legacy consumers, pause/drain lease yang perlu, deploy typed/fenced consumers sebelum failclosed gate, resume scoped |0A000 tidak jadi retry storm; Memory dedicated tetap; provider references idempoten |
|8 Deploy compatibility |review app↔DB version matrix; selamaDB9 currentcore tidak compatible; rencanakan maintenance/feature gate agar request tidak masuk saat partial upgrade |transaksi per migration, urutan dan rollback threshold jelas |
|9 Post-apply metadata |baca ledger, categories/defaults/index/FK/RLS/columngrant/Storage, A1/A2/A3 bodies/ACL, expected signatures, read-only row-shape counts |exact current contract, bukan hanya migration version |
|10 PostgREST cache |refresh schema cache dengan mekanisme supported platform dalam tugas deploy; cek named args overload via realHTTP setelah reload |NOTIFY/restart **tidak dijalankan F0**; actual dispatcher melihat2overloads benar |
|11 Smoke/observe |owner+foreign-owner reads/writes, canonical future publication, known historical reader handling; worker error/lease/deadletter dan platform health |monitor safe codes, noPII; residualU01/F1defects resolved per scope sebelum acceptance |
|12 Recovery/forwardfix |jika invariant rusak, hentikan writes/worker yang relevan melalui operator berizin; forward corrective migration baru atau restorebackup yang disetujui |jangan drop data, disableguards, resetnormal atau pretendrollback receipt; provider sideeffects direconcile |

Urutan ini merupakan **rencana**, bukan persetujuan menerapkan pending migrations. Keberadaan13file dan current function hashes belum membuktikan kelayakan upgrade data. Index7/FK2/check/default/grant changes harus diuji pada copy representatif sebelum local persistent rollout.

A6-F1 fokus money upper bound dan owner NULL-version CAS di source/current disposable chain. Tugas itu dapat berlangsung tanpa menulis target9-chain, tetapi tetap memerlukan izin eksplisit perubahan function/migration sesuai AGENTS. F0 tidak otomatis memberi izin tersebut, dan tidak memulai F1/F2/F3/B/C.

## N. Remaining Risks

| Item | Keadaan sesudah F0 | Konsekuensi / bukti lanjutan |
|---|---|---|
| U02/A6-15 |Identitas/history/catalog lokal diketahui; OLDER_MIGRATION_CHAIN | Upgrade data, consumer dan recovery belum diuji; target lain UNKNOWN; belum deploy |
| A6-17 |**CONFIRMED pada2 published legacy rows lokal** | Keputusan kompatibilitas/pemulihan terpisah; tanpa backfill |
| A6-16 |Typed transport, core client tanpa generic Database, batas generator NULL tetap | Uji overload/nullable melalui L2; tanpa refactor F0 |
| A6-18 |Core helper dan dev Memory entry diketahui; worker eksternal UNKNOWN | Inventaris operator sebelum rollout A2; nama job type aktual reconcile |
| A6-13 |HMAC tidak ada di file/shell; effective process env UNKNOWN | Konfigurasi server berizin sebelum admission AI; tanpa membuat key |
| U01 |Inversi source/hipotesis siklus A6 belum direproduksi | Jalur core accept/apply belum deployed; ketidakhadiran di target bukan penyelesaian risiko source |
| A6-07/A6-08 |Defect nominal/CAS source tetap ada | RPC core yang belum deployed bukan perbaikan; perlu tugas F1 source/disposable |
| C1 |Business facts nyata belum terhubung ke AI | Fixture40unit/tanpa order bukan fakta usaha nyata |
| C8 |Resolver current core masih stub; resolver core target belum ada | Publikasi→checkout tetap terputus; deployment SQL saja tidak mengintegrasikannya |
| C6 |Analytics otoritatif belum ada | Metrik sintetis bukan verified outcome |
| C7 |Verified source/attestor belum ada; public guard deployed | Jangan membuka synthetic approval demi positive test |
| Layer2 |Strategi konkret dan flag CLI diverifikasi; tanpa startup | Port, mount/binding, health, HTTP dan cleanup belum terbukti; fixed origin AI masih blocker |
| Effective app/runtime |SQL state teramati; proses Next tidak diinspeksi | Kehadiran env/container bukan keberhasilan request nyata |
| Final E2E |NOT READY | Memerlukan integrasi/perbaikan serta17langkah dan negative journeys A6 |
| Concurrent changes |Aggregate dan catalog adalah snapshot waktu baca | Refresh bukti sebelum rollout bila aplikasi/proses lain dapat menulis bersamaan |
| Host exposure/health |DB normal publish wildcard; vector sudah Restarting | Observasi metadata saja; tanpa perbaikan firewall/lifecycle; isolated setup harus membatasi eksposur |

## O. Safety Verification

Agent hanya menambahkan laporan F0 ini. **Seluruh683 berkas baseline identik SHA256; hanya laporan baru ini ditambahkan, menjadi684 berkas; tidak ada perubahan/penghapusan berkas lama.** Ketigabelas migration, docs/schema.md, database.types.ts, transport, supabase/config.toml, seluruh laporan lama dan .env.local tetap sama. Branch/HEAD tidak berubah. Hash env akhir tetap3e325c50f96b274b34ea4d4aadf2ca4360b024e617ae57df0e62a6c3c1bf0f9b.

Semua akses database sukses memakai ID container eksplisit, Unix socket lokal dan transaksi READ ONLY dengan timeout. Sesi identitas/ledger/metadata/cohort melaporkan readonly=on. Catalog helper hanya SELECT yang ditinjau dan tidak menjalankan RPC aplikasi. Tidak ada INSERT/UPDATE/DELETE/DDL/GRANT/TRUNCATE/backfill/reset/seed/provider/webhook/email. COMMIT hanya menutup transaksi read-only, bukan menerapkan migration. Tidak mencoba write untuk membuktikan penolakan.

Tidak ada container/network/volume dibuat/dihapus/di-stop/start/restart oleh agent. docker exec hanya membuat proses inspeksi, bukan mengubah lifecycle container. Pemeriksaan akhir: ID DB penuh sama, running=true, StartedAt tetap2026-11-07T18:10:44.291127266Z, RestartCount tetap0, volume/mount sama. Daftar12 container Campaign Lab tetap ber-ID sama. Vector autorestart terlihat sejak awal; F0 tidak menyebabkan atau memperbaikinya. Ini tidak mengklaim daemon/proses lain berhenti bekerja. Stack proyek lain tidak disentuh.

Tidak ada akses hosted/remote DB. CLI hanya --version/--help; percobaan telemetry write awal ditolak sandbox, lalu telemetry dimatikan untuk proses anak. Update notice CLI tidak ditindaklanjuti. Nilai secret/PII tidak dicetak/disalin. .env.local tidak ditulis/diff/revert dan hash akhirnya dibandingkan. Tidak staging/commit/push/merge/rebase/reset/stash/deploy.

Validasi baru F0: inventaris hash source, identitas target, ledger/schema/function/ACL/RLS comparison, aggregate cohort JSON, bantuan CLI terpasang dan pemeriksaan laporan. Unit/lint/typecheck/build/harness SQL/HTTP/browser/Layer2 tetap **NOT EXECUTED**; PASS A1–A5 ditandai HISTORICAL. Sesi metadata terakhir kembali menunjukkan ledger9 dan readonly=on. Hasil ini membuktikan operasi agent tidak memutasi data; bukan klaim tidak ada aplikasi/proses lain yang mungkin menulis secara bersamaan.

Validasi artefak laporan:16bagian A–P tersedia; tidak ada trailing whitespace/karakter pengganti encoding. git diff --check exit0; peringatan LF/CRLF pada dirty files lama tidak ditindaklanjuti dan hash source tidak berubah. Referensi migration/function/reader dan jumlah object diperiksa terhadap hasil SELECT/source di atas. Tidak dibuat file SQL/script/JSON baru untuk audit; metadata disimpan pada hasil tool dan laporan ini saja.

## P. Final Verdict

**Overall PARTIAL; target OLDER_MIGRATION_CHAIN.** Keadaan lokal cukup diketahui untuk menulis rencana forward-only yang spesifik:9applied/4pending, column/default/function/policy/grant/bucket core belum tersedia,2body fungsi legacy berbeda dan2snapshot published legacy terbukti. Tidak perlu mengakses DB lain atau melakukan reset/repair. Bukti dan izin untuk deployment yang menjaga kompatibilitas data belum lengkap.

Desain real Supabase Layer2 disposable sudah konkret untuk CLI2.122.0: project/workdir/home sementara, port/volume/network unik, tanpa kredensial hosted yang diwariskan, capture key privat dan cleanup berdasarkan ownership tepat. **Belum dieksekusi**, preflight isolasi operasional belum PASS, dan optional app AI masih terblokir fixed origin54321. Auth/PostgREST/Storage langsung serta optional core app dapat menjadi scope tugas berikutnya setelah isolasi diverifikasi.

**A6-F1 dapat dilanjutkan pada source repository dan PostgreSQL disposable melalui tugas berizin terpisah**, walaupun deployment persisten tetap tertahan. Jangan menjalankan core fix pada target9-chain atau memasang A1/A2/A3 tanpa dependency core. F0 berhenti pada bukti dan rencana ini; tidak memulai F1/F2/F3/B/C, rollout atau Final E2E.
