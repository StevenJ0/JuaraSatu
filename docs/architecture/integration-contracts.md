# Kontrak integrasi tim — C1–C8

Baseline kebutuhan B00, 2 November 2026. **Status semua C1–C8: NEEDS REVIEW / implementasi belum diverifikasi.** Ini kontrak perilaku dan ownership untuk B01, bukan tipe TypeScript final, endpoint/RPC yang sudah tersedia, atau persetujuan anggota tim.

Acuan: [PRD v2.1](../requirements/PRD.md), [schema target](../schema.md), [keputusan terbuka](../DECISIONS.md).

## Ownership dan dependency

| Area | Producer/PIC | Consumer/reviewer | Batas tanggung jawab |
|---|---|---|---|
| Auth/business/product/capacity/preorder, order/reservation/fulfillment/cost produksi | Rafi | Indro + Steven sesuai consumer | Atomic DB dan tenant boundary; Indro tidak insert reservasi sendiri |
| Shared calculator, AI discussion, blueprint/approval/tasks, evaluation/memory | Steven | Indro + Rafi sesuai consumer | Angka dari shared deterministic code, bukan Gemini |
| Public delivery/landing, offer/publish, payment adapter, paid email, KPI/cost pemasaran, history UI | Indro | Rafi + Steven | Verified provider → atomic service Rafi; history memakai hasil Steven |
| Shared jobs, migrations, DTO dan integrasi | PIC disepakati tim | Consumer terkait; Rafi wajib untuk payment apply | Satu writer per command, satu lease/scheduler contract; schema butuh tugas terpisah |

| Kontrak | Producer → consumer | Area consumer | Bukti tersedia saat B00 |
|---|---|---|---|
| C1 public projection | Rafi → Indro/Steven | Public preorder/order dan laporan | Requirement dokumen; export/service/test belum diverifikasi |
| C2 pricing calculator | Steven → Indro/Rafi | Penawaran, checkout dan publikasi | Requirement dokumen; parity test belum diverifikasi |
| C3 approved configuration | Steven → Indro | Publikasi kampanye | Requirement dokumen; persisted projection belum diverifikasi |
| C4 atomic order | Rafi → Indro | Pembuatan order, checkout, tracking | Requirement dokumen; RPC/DB tests belum tersedia pada baseline |
| C5 payment application | Rafi ↔ Indro | Payment apply, email, tracking | Requirement dokumen; atomic apply/outbox belum tersedia pada baseline |
| C6 SQL metrics | Indro → Steven | Laporan preorder dan kampanye | Target payload; coherent query/export belum diimplementasikan |
| C7 history/evaluation | Steven → Indro | Riwayat/evaluasi | Target payload; persisted read service belum diverifikasi |
| C8 offer + attribution | Indro → Rafi/Steven | Public offer, order, publikasi | Target resolver; implementasi belum tersedia pada baseline |

### C1 — Public-safe context

Input kebutuhan: public slug/reference dan waktu server untuk public event; owner context hanya dari identitas server. Output: bisnis/kontak publik yang diizinkan, preorder, produk/SKU/foto/harga yang boleh ditampilkan, tanggal/terms/status, availability dan versi/timestamp. Field final harus di-whitelist pada B01; jangan mengirim row DB utuh atau menganggap C1 boleh memuat seluruh biaya privat untuk AI.

Raw variable cost, customer data, private token, owner auth/internal notes dan secret tidak ke DTO guest. Pisahkan projection public dari owner/AI context. Not-found, draft/private, closed/not-started/full, tenant mismatch dan data unavailable punya perilaku jelas, tanpa existence leak.

Acceptance: preorder tanpa campaign tetap dapat dibaca/dipesan; public-safe negative checks dan cross-tenant tests. Rafi producer; Indro consumer reviewer. Bergantung pada fondasi dan schema actual O02.

### C2 — Satu calculator bersama

Input kebutuhan: integer IDR snapshot harga/biaya, quantity, discount bps dan parameter simulasi yang valid. Output kebutuhan: harga/diskon per unit, total dan contribution sesuai scope, dengan validasi bounds dan rounding yang sama di simulator/quote/order. Arithmetic integer dan rounding per-unit memakai aturan PRD; jangan membuat calculator kedua pada frontend/payment adapter.

Acceptance: harga120.000, biaya75.000, diskon1.000bps → harga108.000, contribution/unit33.000; qty2 total216.000. B01 menyepakati runtime validation, overflow/bounds/error dan version. Steven producer; Indro + Rafi reviewers. Test fixture bukan bukti checkout DB berjalan.

### C3 — Approved blueprint/configuration

Input kebutuhan: owner identity/tenant, campaign reference, expected version/context. Output: persisted blueprint yang memang approved, stable campaign config/version dan approval reference sesuai tenant/preorder. Memilih proposal, approve blueprint dan publish adalah tindakan terpisah.

Stale version/context, missing approval, cross-tenant pointer, invalid window/config harus ditolak atau diminta review. Consumer tidak mengedit blueprint untuk mengizinkan publish. Steven owns approval; Indro owns publication. Acceptance: unapproved/stale configuration gagal publish, approved configuration valid dapat dikonsumsi; race final harus dijaga atomic service yang disepakati, bukan UI check saja.

### C4 — Atomic order/reservation

Operasi target `create_preorder_order`, bukan bukti RPC telah dibuat. Input kebutuhan: valid guest name/email, qty, preorder reference, expected offer version, stable idempotency key, request hash dan token/hash contract sesuai PRD; attribution link tervalidasi terpisah. Business, price, total, availability dan status tidak dipercaya dari client.

Output kebutuhan: referensi order aman, frozen quote dan payment/hold state; raw token tidak disimpan server atau diterbitkan ulang dari hash. Token browser dipertahankan untuk response-loss retry; duplicate caller tanpa authorization token tidak boleh mengambil order orang lain. Harga harus dihitung kembali server melalui C2/C8 dalam boundary transaksi.

Error families untuk dirinci B01: invalid input, unavailable/full/closed, stale quote (review ulang), same key different payload (conflict), token mismatch, dependency unavailable. Jangan menamai enum/error sebagai sudah ada sebelum producer menyepakati.

Acceptance DB: last-slot concurrent requests, duplicate same payload, response loss, rollback saat gagal, immutable snapshot dan tidak double-reserve. Rafi writer/reviewer; Indro hanya boundary UI/validation/consumer.

### C5 — Verified payment → apply + durable email

Indro memverifikasi fakta Midtrans Sandbox: signature dari string amount asli, reference, amount, environment dan status. Reference attempt harus tersimpan sebelum outbound charge; ambiguity ditangani reconcile, bukan blind new attempt. Data browser/redirect tidak menghasilkan paid.

Rafi menjaga satu atomic apply path: payment/order/reservation + audit + satu `job_runs(send_paid_email)` saat payment pertama applied. Indro mengorkestrasi provider/webhook/reconcile dan worker delivery, **bukan writer kedua**. Callback dapat tiba sebelum respons create charge; duplicate/reordered event tidak downgrade/double-allocate. Pending/invalid/late-unapplied tidak menghasilkan email paid.

Late owner acceptance perlu kapasitas baru diperiksa dan efek first-applied/email yang sama; detailnya masih OPEN O05. Failed email tidak rollback payment. Job entity/dedupe orderId:templateVersion, lease/retry/provider reference dan safe payload perlu review O04. Tidak ada raw private token dalam job/log/email; email P0 dapat tanpa private link. Provider accepted berbeda dari delivered/received.

Acceptance: real Sandbox applied once; replay/out-of-order/invalid amount-signature/late cases; atomic rollback; satu logical email job; retry email; satu email aktual diterima. **Review Rafi wajib**, Steven review shared job interface. SQL/migration tugas terpisah; B06/B07 mengonsumsi hasilnya.

### C6 — Coherent SQL analytics snapshot

Target payload: `PreorderAnalyticsV1` dan `CampaignAnalyticsV1`. Input kebutuhan: owner/tenant, scope event/campaign, window half-open, snapshot/version request bila relevan. Output: aggregate numerik dari SQL yang konsisten, calculated_at/schema version/window, cohort/source metadata, financial completeness dan limitations.

Preorder: paid/held/allocated/available/fulfilled, paid target gap/ratio, paid vs fulfilled revenue. Campaign: baseline/window increases, linked attribution, pricing campaign discounted cohort, actual marketing cost, task progress dan scoped contribution. Budget bukan spend, missing cost null/unknown bukan0; no join fan-out. Pembayaran valid berbeda dari produksi selesai; cancel setelah produksi mempertahankan incurred cost sesuai kontrak.

Acceptance: target40/paid30/held2 → gap10/available8. Setelah8 tambahan paid →38/40. Lima linked-attributed berbeda dari delapan window-paid/discounted units. Bila delapan fulfilled, biaya lengkap dan actual campaign50.000: 8×(108.000−75.000)−50.000=214.000 kontribusi cohort. Bukan bukti causal lift/net profit keseluruhan. Steven menerima snapshot versioned, tidak menghitung ulang lewat LLM.

Indro producer; Steven reviewer dan Rafi review order/cost semantics. Atomic query/RPC baru memerlukan tugas schema; jangan mengklaim beberapa query terpisah sebagai satu snapshot konsisten.

### C7 — Persisted history/evaluation

Input kebutuhan: authorized owner/tenant dan campaign/evaluation reference. Output: stored evaluation + metrics snapshot/version/calculated/evaluated timestamps, limitation dan safe memory/index status bila tersedia. Snapshot lama dibedakan dari live metrics.

GET/history tidak menghasilkan generation baru atau menjalankan embedding. Jika evaluation belum ada/AI unavailable, UI menampilkan fakta dan status jujur; tindakan evaluate eksplisit mengonsumsi service Steven. Acceptance: membuka dua kali tidak memanggil Gemini, cross-tenant read ditolak, old snapshot tidak berubah karena katalog. Steven producer; Indro consumer reviewer.

### C8 — Current offer berbeda dari attribution

Input kebutuhan: preorder, waktu server, optional valid campaign-link reference, expected configuration version. Output: current normal/percent-discount offer, eligibility/window/status, source pricing campaign dan attribution yang tervalidasi secara terpisah. Field/DTO final B01, aturan transaksi final bersama C4/C5.

Satu active offer per preorder; diskon berlaku pada semua checkout baru selama aktif. Organik dan link buyer mendapat harga sama; hanya valid link memberi attribution. Campaign close/expiry menghentikan harga baru; frozen order lama tidak diubah. Campaign tidak menambah kapasitas/preorder.

Acceptance: organic vs linked parity, invalid/cross-tenant link, window boundary, stale review, publish race dan immutable historical order. Indro owns resolver/publication; Rafi mereview atomic consumption; Steven mereview calculator/blueprint parity. Link lama/closed memiliki perilaku yang harus dirinci sesuai PRD pada B01; jangan menjadikan link voucher tersembunyi.

## Gate review B01 dan aturan readiness

Per kontrak, catat lokasi source/export dan versi producer yang actual, input/output/error runtime, whitelist privacy, idempotency/concurrency, test fixture vs real DB/provider, reviewer dan hasil review. Consumer tidak menulis ulang producer yang belum ada. Status dapat bergerak: needs review → contract reviewed → implemented → integration verified, hanya dengan bukti yang sesuai. Daftar ini tidak menandai semua kontrak approved secara otomatis.

Jobs memakai satu claim/lease/dedupe contract untuk expiry/reconcile/email/memory; satu PIC deployment/scheduler. Indro dan Steven boleh memiliki handler berbeda, tetapi tidak dua scheduler tanpa koordinasi. Kebutuhan B01 yang tidak memerlukan DB/provider boleh memakai typed fixtures berlabel; acceptance transaksi tetap menunggu implementasi actual.
