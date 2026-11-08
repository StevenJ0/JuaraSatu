# Batch A6-F1 — Financial Bounds & Owner CAS Result

Tanggal: **8 November 2026, Asia/Jakarta**. Branch merge/ai-campaign; HEAD 5065bc5ed3d7bd1b5d26bd6ebe4a0b05ae121762. Scope: implementasi A6-07/A6-08 pada source dan PostgreSQL disposable, tanpa deployment.

## A. Executive Summary

**Overall: PASS dalam scope source dan PostgreSQL disposable.** Focused F1 PASS:19 kelompok SQL,170 pernyataan ditolak dengan snapshot sebelum/sesudah identik pada13 tabel terkait. Ketiga writer order kini berbagi guard nominal yang sama; owner RPC wajib memakai versi valid, sedangkan expiry service-role yang sah tetap dapat memakai NULL. Tidak ada public signature/grant atau workflow AI/payment yang diganti.

Satu migration baru: supabase/migrations/20261108090000_financial_bounds_owner_cas.sql. Active root chain menjadi14. Tepat4 fungsi private diganti: discount_per_unit, insert_order, lock_order, lock_owned_preorder. Tidak ada tabel/kolom/constraint baru, backfill atau helper baru; metadata public/type generation tetap kompatibel.

App regression: unit **1.103/67 file PASS**; selected AI mock **69/7 PASS**; next typegen + strict TypeScript, ESLint, production build PASS. Harness lengkap **14 migration PASS**, A1/A2/A3/Memory/A4/F05/F06 PASS, strict schema **352 MATCH/zero drift**. Seluruh3 container run F1 sudah dibersihkan; SQL tidak menyentuh database normal/remote.

**Bukan production readiness.** Target lokal persisten9-chain dan dua published legacy snapshots dari F0 tidak diakses SQL atau dimutasi dalam F1. A6-09/U01, C1/C8/C6/C7, Layer2 dan rollout tetap terpisah. Tidak memulai F2/F3/B/C/Final E2E.

## B. Initial State

Branch/HEAD diverifikasi, tidak berubah. Baseline684 berkas tracked/untracked termasuk inclusion eksplisit .env.local diambil dengan SHA256. Dirty A1–A5 sebelumnya dipertahankan: concurrency/schema-contract harness, schema docs, main DB runner, jobs repository, generated types/typed transport, admission test; seluruh untracked contract modules,13 root migrations, QA/plans dan type/parser tests tersedia.

Dokumen acuan dibaca pada bagian relevan: AGENTS, schema, PRD, AI handoff, audit awal/A6, F0 dan Stage0/A1–A5. Schema tetap sumber kontrak; pengecualian perubahan migration/function/addendum dibatasi oleh izin eksplisit F1. Tidak ada izin deploy atau mengubah database normal.

Source awal13 root migrations sampai20261107110000. Filename20261108090000 belum ada dan urutannya sesudah A3; ditambahkan satu sehingga actual14, bukan mengganti file lama. Tiga hardening A1/A2/A3 dan core/baseline lama tidak diedit.

F0 adalah bukti historis target:9 migration,351 kolom,27 public signatures dan dua published camelCase snapshots. F1 tidak mencoba menjalankan current integration suite pada target itu. Semua SQL mutasi memakai harness baru, bukan container supabase_db_campaign-lab.

## C. Root Cause A6-07 — complete write-path matrix

PRD §9.1 baris321 dan §648 membatasi nominal/total/intermediate IDR hingga1.000.000.000 dan quantity1..10.000. TS pricing/contracts.ts memakai MAX_MONEY_IDR; calculateOrderPrice menghitung BigInt dan menolak subtotal di atas batas. SQL awal hanya memeriksa konsistensi header/item dan angka positif, tanpa upper bound.

Pencarian INSERT orders/order_items pada seluruh root SQL menemukan tepat satu lokasi masing-masing: private.insert_order pada core migration:181/193. **Standalone juga memakai helper ini**, dengan synthetic composite preorder/item yang hanya diisi field yang dibaca helper (core:1009–1022); tidak ada writer terpisah yang perlu diduplikasi.

| Path/runtime caller | SQL entry point | Helper/inputs/calculation | Guard/transaction |
|---|---|---|---|
| Owner manual preorder: ManualOrderForm → orders/actions.ts:64 → service.createManualOrder:67 → repository.createManualOrderRecord:330 | create_manual_order(uuid,int,text,text,text,bool,text,text), authenticated | frozen preorder-item base, quantity, bps0 → private.insert_order | owner/availability/idempotency lebih dahulu; helper menolak nominal sebelum INSERT; allocated reservation/event dalam transaksi sama |
| Standalone manual: action87 → service79 → repository345 | create_standalone_manual_order(uuid,int,text,text,text,bool,text,text), authenticated | catalog product base di composite item, capacity/date di composite preorder → helper yang sama | scope owner/date/product/capacity/idempotency tetap; bps0; allocated reservation |
| Public contract: service.placePublicOrder:95 → repository.createPublicOrderRecord:374; app HTTP consumer belum ada | create_preorder_order(text,int,text,text,text,text,text,text,bigint,int,text), service_role | frozen base + server offer, expected unit price advisory, quantity → helper | server schedule/quote/quota/hold/idempotency tetap; held reservation; tidak menambahkan checkout HTTP |
| Private primitive | private.insert_order, tidak executable app roles | unit discount + final unit; base×qty, discount/unit×qty, final/unit×qty; unit cost snapshot | guard baru mencakup semua writer; direct helper SQL test bukan public pricing integration |
| Existing DB invariants | order/items constraints + deferred check_order_totals; guard_order_items/reservation | header/item sums, frozen snapshot dan allocation | tidak dilemahkan/diganti; exception membatalkan statement/transaksi dan seluruh side effect |

Rumus valid dipertahankan:
- discountPerUnit=floor(base×bps/10000).
- finalUnit=base−discountPerUnit.
- subtotal=base×quantity; discountTotal=discountPerUnit×quantity; total=finalUnit×quantity.
- base1..1e9, bps0..9999, quantity1..10000, subtotal≤1e9. Karena discount≤base dan final positif, discountTotal/finalTotal juga bounded.
- Numerator base×bps adalah bilangan berskala bps, bukan monetary subtotal yang harus dipotong ke1e9. Perkalian numeric dan floor mempertahankan transaksi tepat batas, termasuk diskon9999bps.

Awal private.insert_order menghitung discount di DECLARE sebelum guard; helper discount SQL memakai perkalian bigint. Guard baru dijalankan sebelum kalkulasi/insert; private.discount_per_unit juga memvalidasi input dan memakai numeric agar jalur public quote sebelum insert tidak overflow pada base/bps yang tidak sah.

## D. Root Cause A6-08 — owner/versionless matrix

Sebelumnya private.lock_order:254 hanya memeriksa versi jika nonNULL; lock_owned_preorder:278 memakai <> sehingga NULL tidak menjadi true. Owner sah dapat memanggil RPC langsung denganNULL. Form memang mewajibkan versi positif; itu tidak cukup untuk caller RPC langsung. Ini masalah same-owner concurrency, bukan bukti cross-tenant bypass.

| RPC | Role/caller nyata | Version sebelum F1 | Kontrak sesudah F1 |
|---|---|---|---|
| advance_fulfillment | authenticated, actions123/repository392 | lock_order; NULL melewati CAS | nonNULL/positif/exact; state/payment guards tetap |
| accept_late_payment | authenticated, actions163/repository397 | lock_order; NULL lolos jika state lain valid | strict owner CAS; capacity/payment recheck tetap |
| decline_late_payment | authenticated, actions174/repository402 | lock_order; NULL lolos | strict CAS dan review/note rules tetap |
| expire_or_cancel_order action cancel | authenticated, actions133/repository407 | shared helper NULL lolos | strict owner CAS; reason/refund/state rules tetap |
| expire_or_cancel_order owner expire | authenticated, actions187/repository407 | NULL lolos | strict owner CAS, current version tetap sukses |
| expire_or_cancel_order trusted expiry | service worker runExpireJobs→expireOrder(client,id,NULL) | sengaja versionless dengan owner scopeNULL | NULL hanya jika business scopeNULL, auth.uid NULL, JWTrole service_role **dan actual database request role service_role** |
| resolve_production_cost | authenticated, actions148/repository314 | lock_order; NULL lolos | strict CAS; zero/unknown cost resolution tetap |
| save_preorder_draft update | authenticated, preorder actions65/repository337 | lock_owned_preorder; NULL lolos | strict CAS; product/capacity/state rules tetap |
| save_preorder_draft create | authenticated, preorder actions42 | idNULL/versionNULL sah | tetap sah: row/version belum ada |
| cancel_preorder_draft | authenticated, actions139 | lock_owned_preorder NULL lolos | strict CAS |
| cancel_published_preorder | authenticated, actions143 | helper NULL lolos | strict CAS, existing orders prohibition tetap |
| close_preorder | authenticated, actions111 | helper NULL lolos | strict CAS, reason/event tetap |
| complete_preorder | authenticated, actions135 | helper NULL lolos | strict CAS dan unresolved orders guard tetap |
| publish_preorder owner2args | authenticated; A3 wrapper | kanonis sudah menolakNULL/invalid/mismatch | tidak diubah; diuji lagi |
| publish_preorder legacy4args | authenticated/service dengan explicit owner actor | A3 sudah strict | tidak diubah; owner/actor/service behavior diuji lagi |

Semua caller dua helper ditelusuri di root migration; helper private tidak diberi EXECUTE kepada app roles. Tidak ada exception umum berdasarkan fabricated businessId/userId/claim string. actual current_setting('role') diperlukan karena current_user di SECURITY DEFINER menjadi postgres; claimrole saja tidak membuktikan request database role service_role. Pemeriksaan menggunakan IS NOT TRUE agar nilai NULL pada kondisi trust tidak membuka pengecualian.

Owner scope/row existence diperiksa sebelum version error. Foreign owner tetap menerima NOT_FOUND atau legacy FORBIDDEN, bukan nilai versi usaha lain. Service cancellation tetap ditolak boundary existing; role service tidak memperoleh EXECUTE atas owner-only RPC lain. Admin/test fixture yang memerlukan expiry versionless memakai SET ROLE service_role dan JWT role/sub yang benar, bukan shortcut postgres dengan forged claim saja.

## E. Implementation Decisions

Perbaikan nominal berada di primitive shared yang sudah ada, sehingga tiga writer terlindungi tanpa menyalin kalkulasi pada UI/service. Tidak menambah constraint table-wide yang dapat gagal saat scan historical rows, tidak memotong total, dan tidak mengganti financial snapshots.

private.discount_per_unit diganti dari SQL ke PL/pgSQL agar input tidak valid menghasilkan VALIDATION_ERROR yang stabil, bukan integer overflow. Return bigint, parameter, IMMUTABLE, invoker, owner, path dan ACL dipertahankan. Valid rounding/final unit tidak berubah. private.insert_order menunda kalkulasi sampai guard numeric selesai dan memvalidasi unit variable cost diketahui0..1e9; NULL tetap unknown.

Perbaikan CAS pada dua helper dipilih karena seluruh caller owner terkait terinventaris, sedangkan satu exception service expiry dapat dibuktikan dari trusted boundary. Tidak menyalin wrapper publik atau membuka new owner privilege. Tidak mengubah locking order atau penggunaan now() pada payment: itu F2.

Application change hanya publicOrderSchema.expectedUnitPriceIdr.max(MAX_MONEY_IDR), dengan dua focused unit cases: quote boundary dan mapping penolakan SQL ke domain. VALIDATION_ERROR sudah terdaftar dalam ORDER_VIOLATIONS dan mapped ke pesan “Isian pesanan tidak valid”; P0001 tetap domain rejection melalui service.toOutcome. Tidak menambah arbitrary SQL error string, any, cast/suppression, dependency atau public interface.

## F. Forward-Only Migration

File: supabase/migrations/20261108090000_financial_bounds_owner_cas.sql,137baris, SHA256 **dcc51c3743d702f670c92d3e4ccb42574625941f3e6609df19a9a3a91b0b5bfe**.

| Replaced existing private function | Signature/return preserved | Perubahan |
|---|---|---|
| discount_per_unit |(p_base_price_idr bigint,p_discount_bps integer)→bigint | validasi unit/bps; numeric/floor; IMMUTABLE/invoker tetap |
| insert_order |existing18parameters/composites/text/int/timestamptz/uuid→orders | quantity/base/subtotal guard sebelum operasi bigint/INSERT; unit cost known bound |
| lock_order |(p_order_id uuid,p_expected_version integer,p_business_id uuid)→orders | strict owner CAS dengan exception trusted service expiry |
| lock_owned_preorder |(p_preorder_id uuid,p_expected_version integer)→preorders | NULL/zero/negative/mismatch ditolak |

Metadata sebelum/sesudah pada PostgreSQL dibandingkan untuk **semua fungsi public/private**: OID, parameter names/defaults, returns, owner, SECURITY DEFINER, search_path, ACL, volatility identik. Hanya empat definition fingerprints berubah, seluruh fungsi lain identik. Public bodies/signatures/defaults/grants tidak berubah; private helpers tetap non-executable app roles. Tidak ada helper baru, ALTER OWNER/GRANT/REVOKE/RLS/table/trigger changes. New migration BEGIN/COMMIT hanya CREATE OR REPLACE empat fungsi tersebut.

Dokumentasi docs/schema.md hanya mendapat §30 kontrak F1; definitions tabel/kolom tidak diubah. Generated database.types.ts tidak diregenerasi atau diedit karena metadata public tidak berubah.

## G. Financial Bound Verification

Focused SQL memakai actual writer/RPC dan persisted rows, bukan repository mock.

| Kasus | Path yang diuji | Actual expected/result |
|---|---|---|
| Minimal base1×qty1 |manual/standalone/public |PASS, total1 |
| Normal12345×3 |ketiganya |PASS, subtotal/lineTotal37035 |
| Base100000×qty10000 |ketiganya |PASS tepat1e9; unit cost0 preserved |
| Base1e9×qty1 |ketiganya |PASS tepat1e9, unknown costNULL preserved |
| Base1e9+1 |ketiganya |P0001 VALIDATION_ERROR, rollback |
| Valid base142857143×qty7 |ketiganya |subtotal tepat1e9+1 ditolak, bukan sekadar invalid unit |
| Base600m×qty2 |ketiganya |1.2b ditolak |
| BaseBIGINT_MAX×qty10000 |ketiganya |VALIDATION_ERROR sebelum bigint overflow, bukan22003 |
| Quantity0/negative/10001/NULL |ketiganya +private primitive |ditolak; direct helper juga diuji INT_MAX |
| Unit cost1e9+1 |manual through shared helper |ditolak; unknownNULL dan known0 tetap valid |
| Bps3333,base10003,qty3 |actual private shared insertion |subtotal30009, discount9999, final20010; discount/unit3333 |
| Base1e9,bps9999,qty1 |private insertion |subtotal1e9, discount999900000, final100000; tepat boundary sah |
| Subtotal1.2b,bps9000 |private insertion |ditolak meski hypothetical final120m<1e9 |
| Bps−1/10000/INT_MAX/NULL |private insertion |VALIDATION_ERROR |
| Public expected price salah |public RPC |OFFER_CHANGED, no allocation |
| Expected priceNULL/malformed bigint |public RPC |VALIDATION_ERROR /22P02 parameter parsing; tidak ada side effect |
| Same key/hash/token |semua writer |replay same order; no extra reservation |
| Same key, conflicting hash |semua writer |IDEMPOTENCY_CONFLICT +full snapshot unchanged |

Active C8 source masih resolver bps0. Karena itu discounted cases diuji melalui **private primitive yang nyata**, bukan mengarang active campaign atau mengganti resolver. Tidak mengklaim campaign→public checkout discount integration sudah lulus. Base/quantity invalid dapat ditolak public wrapper sebelum helper; helper juga diuji langsung oleh privileged fixture untuk guard independen.

Final amount di atas1e9 pada formula valid selalu mempunyai subtotal di atas1e9; tidak ada fixture final>subtotal atau diskon negatif palsu. Malformed typed SQL argument dapat gagal sebelum body dijalankan; app input sudah runtime-validated, tidak diperlakukan sebagai keberhasilan.

## H. Owner CAS Verification

Focused groups6–18 mencakup enam order cases (fulfillment, cancel, owner expire, late accept, late decline, cost resolution), lima preorder update/transition cases dan dua A3 publish overloads.

Pada setiap case:
- NULL,0,−1 dan positive stale expected version ditolak dengan VERSION_CONFLICT atau PREORDER_VERSION_CONFLICT.
- Exact current version dan state valid berhasil; tersimpan lewat RPC dengan role authenticated sebenarnya.
- Foreign owner ditolak NOT_FOUND, kecuali legacy publish memakai42501 FORBIDDEN dari private.require_owner. Missing membership dan anon ditolak42501.
- Service-only role tidak dapat menjalankan owner-only functions. Legacy publish service dengan explicit actor tetap diuji A3; tidak diberikan blanket owner permission.
- Pengulangan memakai versi lama ditolak atau lifecycle existing menolak; cost resolution mengikuti existing state semantics, tidak mengubah increment version/event contract.

Trusted expiry:
- Owner NULL expiry ditolak.
- authenticated dengan fabricated JWT role service_role dan UID kosong tetap ditolak karena actual DB role salah.
- service dengan supplied owner UID atau claim role kosong ditolakNULL.
- service role aktual +JWT role benar +UID/business scopeNULL dapat expire pending overdue order tanpa versi; status expired dan repeated invocation tidak menambah event/mutasi.
- Service cancellation tidak mendapat bypass; direct private.lock_order service EXECUTE ditolak.
- New draft create idNULL/versionNULL tetap berhasil. Invalid fulfillment transition ditolak tanpa perubahan data.

Tidak melakukan refactor keseluruhan state machine. Role assertions adalah SQL Layer1 memakai auth stand-ins, bukan bukti JWT verification/GoTrue/PostgREST HTTP nyata.

## I. Atomicity and Rollback

Setiap rejected statement menangkap snapshot JSONB sebelum/sesudah yang diurutkan ID dan dibandingkan deep equality untuk seluruh row fixture business pada13 tabel: orders, order_items, capacity_reservations, payments, payment_events, domain_events, job_runs, order_events, order_production_costs, preorders, preorder_items, production_capacity dan products.

**170 rejected statements**, semuanya mempertahankan snapshot identik. Cakupan termasuk capacity version/counters/commitments, price/status/version snapshots dan event/job rows, bukan hanya menghitung orders. Duplicate/replay valid juga dipastikan tidak membuat order/reservation tambahan.

Sebelum F1 pada disposable:
- Transaksi base600m×2 diterima1.2b, lalu ROLLBACK.
- Owner confirm dengan versionNULL diterima, lalu ROLLBACK.
- Satu synthetic historical1.2b order sengaja disimpan untuk menguji compatibility migration. Seluruh snapshot sebelum/sesudah migration identik dan same-key replay order lama tidak menulis ulang/memotongnya.

Ini fixture disposable sintetis, **bukan bukti ada order over-limit pada database persisten**. Guard hanya new writes/helper pricing inputs; tidak scan/rewrite historical orders. Failed statement rollback PostgreSQL mempertahankan seluruh dependent rows; bukan klaim side effect eksternal transactional, karena provider tidak dipanggil.

## J. Authorization and RLS

Owner/business tetap diturunkan dari auth/membership dan scoped row lookup. Helper tidak menerima user-controlled role string sebagai bukti tunggal. Actual request DB role service_role dibandingkan dengan claim role/UID, sementara current_user definer tetappostgres. NULL-trust condition memakai IS NOT TRUE untuk menolak unknown.

Metadata equality dan A4 current-contract suite memeriksa table RLS/column grants, owner/foreign access, private ACL dan four overload pairs. Tidak ada widening RLS atau table-wide write grants. Default private helper EXECUTE tetap revoked untuk anon/authenticated/service_role. SQL fixtures memakai SET ROLE, bukan hanya mengaku role pada parameter input.

C5 payment verification persistence tidak diubah; test late-review/accept memakai synthetic provider facts dan unique synthetic transaction IDs. Tidak ada webhook/Midtrans call/QR charge/email delivery. Tidak menyatakan cross-tenant exploit baru atau menyatakan seluruh platform security verified.

## K. Database Regression

Command canonical: node scripts/test-database-v21.mjs --strict-docs. Runner yang sama dipakai; tidak membuat Docker orchestration kedua atau menerima existing target/DB URL.

Integrasi harness:
1. Reviewed ACTIVE_MIGRATIONS ditambah tepat satu nama F1.
2. Checkpoint100pgTAP dan7legacy Memory groups tetap pada checkpoint historis sebelum hardening.
3. A1/A2/A3 tetap memverifikasi delta migration masing-masing sebelum F1.
4. Hook setelah metadata A3 menjalankan F1 setelahA3, sebelum positive A3 contracts; A2 remaining behavior, A1 behavior dan Memory8B berikutnya berjalan pada **final14-chain**.
5. A4 final catalog/docs/current concurrency tetap sesudah semua migrations; applied inventory harus identik actual root list.
6. Tidak mengurangi assertion lama, memindah checkpoint lama ke final schema, atau melemahkan exact catalog expectations.

Hasil final run9a0776fb-d201-44ff-8102-3a77ae9ab142, exit0,321878ms:

| Suite | Bukti |
|---|---|
| F1 focused |**19groups PASS /170 rejected statements**, termasuk before/after catalog dan13table rollback |
| Full14 migration/current contracts |**PASS**, urutan/hash seluruh14 root migrations terekam pada summary |
| Historical pgTAP |100assertions PASS pada checkpoint asal; #65PASS |
| Historical Memory |7groups PASS; bukan current verified approval |
| A1 |**15groups PASS**,5observed ACK lock races; Memory exclusion, stale attempt/lease, retry/exhaustion |
| A2 |**18groups PASS**,4overlapping claim scenarios +admission lock contention; typed/legacy/Memory isolation |
| A3 |**14SQLgroups PASS**,4lock races +1MVCC editor overlap;5actual-reader Vitest cases PASS |
| Memory8B |**10groups PASS**,5observed PostgreSQL races; synthetic guard/atomicity/recovery/tenant tetap |
| F05/F06 SQL |**PASS** durable generation/replay dan atomic quota denial rollback; tanpa provider |
| CurrentA4 |**8groups PASS**, termasuk3current concurrency scenarios; RLS/column grants/Storage SQL subset/payment persistence |
| Strictdocs |**PASS**,352MATCH/0EXTRA/0MISSING/0MISMATCH; comparator negative controls tetap |
| Supabase Layer2 |NOT EXECUTED |

Dua run awal berhenti pada fixture/assertion, bukan ditandai PASS:
- a40d17b7-6f94-412b-9614-5d030768d7fd: unique provider_transaction_id fixture F1-SYNTHETIC dipakai dua kali; diganti UUID per notification fixture.
- 631eccd6-fc82-47a7-b817-fa8e1a5be0b8: foreign legacy publish benar menolak42501FORBIDDEN, tetapi test mengharapkan NOT_FOUND; assertion dibuat **spesifik legacy** sesuai source, bukan diubah untuk menerima success.
- Keduanya cleanup otomatis. Tidak ada perubahan fungsi runtime untuk melewati kegagalan tersebut. Run akhir9a0776fb-d201-44ff-8102-3a77ae9ab142 memakai fixture/assertions yang dikoreksi.

Artefak final pada node_modules/.cache/database-v21/9a0776fb-d201-44ff-8102-3a77ae9ab142/: summary.json, catalog.json, schema-comparison.json. Catalog SHA25613956c6e7e587491b81477978104bbdbc442be83b3edb84aff639b8db7ce6700;26tables/352columns/290constraints/107indexes/30publicpolicies/45triggers/99public+privatefunctions/3extensions,50public signatures. Summary.groups=8 adalah kelompok A4, bukan total semua test/F1. Jumlah kelompok/race/statement SQL tidak dijumlahkan dengan individual Vitest tests.

## L. Application Regression

| Check/command | Actual result |
|---|---|
| next.cmd typegen |PASS |
| tsc.cmd --noEmit --incremental false |PASS; diulang setelah test terakhir |
| npm.cmd run lint |PASS; diulang setelah test terakhir |
| npm.cmd run build |PASS; Next16.4.3 optimized build,29pages, actual existing fonts/config |
| npm.cmd test final |**1.103PASS/67files**, tidak ada skipped/failure |
| Focused schemas/service run awal |46PASS/2actual files pada saat itu; bukan jumlah tambahan yang dijumlah dengan default suite |
| Tujuh selected AI mock integration |**69PASS/7files**, no skipped/failure, programmatic Vitest allowlist |
| HTTP/browser/provider/live payments |NOT EXECUTED |

Mock allowlist: blueprint-manual-edit(16), blueprint-provider-provenance(3), duplicate-inference(11), evaluation-provider-validation(12), generation-quota-blocker(3), memory-generation-claims(21), remaining-ai-contracts(3). startVitest dipanggil dengan config:false dan include exact list, alias @/src serta server-only empty entry existing. Tidak menjalankan unrestricted tests/supabase atau tests/integration glob.

Dua unit tests baru: public quote1e9 accepted/>1e9 denied; SQL monetary VALIDATION_ERROR menjadi OrderOutcome rejected, bukan infrastructure failure/success. TS calculation formula dan order error enum/message tidak diubah. Tidak menambah dependency, any atau suppression.

Build berjalan pada source aplikasi final; koreksi sesudahnya hanya test SQL/assertion/docs. TypeScript/lint/unit diulang setelah penambahan unit test terakhir. Tidak melakukan build ulang tanpa perubahan runtime yang memerlukannya.

## M. Concurrency Limitations

F1 membuktikan sequential direct-RPC CAS rejection, valid current transitions, metadata preservation dan atomic rollback; existing concurrent A1/A2/A3/currentA4 suites tetap dijalankan pada final chain. Ini tidak membuktikan semua kombinasi payment/capacity writer bebas deadlock.

**A6-09 dan U01 tetap PENDING A6-F2.** Tidak mengubah lock acquisition order, cutoff/now() semantics, payment state machine, timeout/reconcile logic atau menambahkan payment concurrency fix terselubung. CASE late accept masih memegang locks sesuai source sebelumnya; SQL snapshots bukan two-session deadline-crossing proof. Tidak ada klaim HTTP/provider exactly-once atau production-level concurrency certification.

## N. Historical Data and Rollout

Database lokal normal menurut F0 tetap9-chain dengan dua legacy published snapshots; F1 tidak mengaksesnya SQL dan tidak deploy pending core+A1+A2+A3+F1. Tidak backfill/republish/update terms, menambah reader fallback atau mengubah ledger.

Sebelum rollout terpisah:
- Refresh authorized read-only history/catalog dan inventory consumer eksternal; jangan menganggap source14 sudah applied.
- Periksa cohort product/preorder base/unit cost dan historical order/item nominal di luar1e9 tanpa mengungkap customer data. Belum diketahui apakah ada pada target nyata.
- Tentukan handling historical invalid rows/quotes dan preserve frozen terms. Migration tidak scan/rewrite rows; helper price reads dapat menolak base di luar kontrak.
- Backup/recovery dan disposable representative upgrade validation diperlukan. Forward-only additive migrations, bukan rewrite applied files/reset/repair.
- Terapkan dependencies berurutan hanya setelah izin deploy; A2 perlu consumer coordination. PostgREST schema cache/actual HTTP overload dan role tests tetap Layer2 terpisah.

Synthetic historical1.2b replay compatibility dalam test bukan izin melanjutkan menerima order baru melampaui bound atau klaim normal data sudah bersih.

## O. Safety

Pemeriksaan SHA256: **677 dari684 berkas baseline identik**,7 berkas existing berubah sesuai scope,3 baru ditambahkan; total687, tidak ada penghapusan/perubahan lain. Seluruh13 migration lama, generated types, auth/payment/AI source, .env.local, supabase/config.toml dan user work lainnya tetap identik. Branch/HEAD tetap sama.

Existing yang berubah: database/v2.1/tests/job-acknowledgement.mjs; database/v2.1/tests/migration-contract.mjs; database/v2.1/tests/preorder-publication.mjs; docs/schema.md (header14 dan §30); src/features/orders/schemas.ts; src/features/orders/schemas.test.ts; src/features/orders/service.test.ts. Baru: database/v2.1/tests/financial-cas.mjs; migration F1; laporan QA ini. Tidak ada edit historical migration atau database.types.ts.

Harness menggunakan local named pipe Docker yang dipin, image17.11.0.006 existing, container baru --rm berlabel campaign_lab.disposable, networknone, zero mounts/volumes/port bindings, empty initdb /tmp/campaign-a1 dan Unix socket /tmp. Preflight memeriksa data_directory/address dan zero application/auth/storage tables. Cleanup memverifikasi exactID/label/network sebelum stop container milik run.

Endpoint yang digunakan run: npipe:////./pipe/dockerDesktopLinuxEngine, bukan remote Docker host. Exact-label docker ps -a setelah selesai menghasilkan nol container untuk ketiga run a40d17b7/631eccd6/9a0776fb. Tidak menghapus volume normal atau menjalankan global cleanup.

Tidak ada SQL read/write ke persistent/local normal atau remote DB dalam F1. Tidak Supabase start/stop/reset/push/repair, cloud config/deploy, global Docker cleanup, token generation/rotation, provider/embedding/Midtrans/email/worker real. Tidak git stage/commit/push/merge/rebase/reset/stash. Existing env tidak dicetak/ditulis. Test SQL data/customer/payment sepenuhnya sintetis dalam networkless disposable.

## P. Remaining Findings

| Finding | Status F1 |
|---|---|
| A6-07 |RESOLVED pada source/disposable scope; full regression PASS, belum deployed |
| A6-08 |RESOLVED pada source/disposable scope; trusted expiry preserved dan full regression PASS, belum deployed |
| A6-09 |OPEN untuk F2, tidak diubah |
| U01 |OPEN source inversion/cycle hypothesis, tidak direproduksi/diselesaikan F1 |
| U02 |F0 identified target9-chain; authorized upgrade/compatibility/rollout masih terbuka |
| A6-17 |dua legacy published rows menurut F0; tidak disentuh |
| C1/C8/C6/C7 |tetapOPEN, tidak diimplementasikan |
| A6-F3 UI/prompt/browser |tidak dimulai |
| Actual Supabase Layer2 |NOT EXECUTED, desain F0 tetap acuan |
| Persistent rollout/production |NOT DEPLOYED / NOT READY |
| Final E2E |tidak dimulai |

## Q. Final Verdict

**PASS.** Bound nominal sekarang ditegakkan konsisten pada seluruh tiga authoritative order paths yang ditemukan, dan mutasi owner memerlukan versi optimistic concurrency yang valid tanpa memutus trusted service expiry. Bukti:19focused SQL groups/170atomic rejections,14migration fresh-chain, seluruh regresi A1–A5 terkait,1.103unit tests,69selected AI mocks, strict TypeScript/lint/build PASS. Signature/grant/security publik tetap, no historical rewrite, semua test-owned container sudah dibersihkan.

Scope tetap current source+new disposable PostgreSQL, bukan deployment normal/remote atau production readiness. Berhenti sesudah F1; tidak mulai F2 otomatis.
