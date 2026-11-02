# Peta dokumentasi Campaign Lab

Baseline B00, 2 November 2026. Peta ini menyatukan **lokasi**, bukan menghapus konflik desain atau menyatakan target telah berjalan.

| Acuan | Lokasi kanonik | Makna/status |
|---|---|---|
| Instruksi agent | [AGENTS.md](../AGENTS.md) | Batas operasi, scope, keamanan dan commit pengguna |
| Produk | [requirements/PRD.md](requirements/PRD.md) | PRD v2.1 pengguna; target, bukan bukti implementasi |
| Data | [schema.md](schema.md) | Schema v2.1 pengguna disalin utuh; target 26 tabel, belum migration applied |
| Aturan DB | [requirements/database-rules.md](requirements/database-rules.md) | Local-first, review dan izin; setup aktual wajib diperiksa |
| Keputusan/gap | [DECISIONS.md](DECISIONS.md) | Baseline yang sudah tercantum vs usulan yang belum disetujui |
| Integrasi tim | [architecture/integration-contracts.md](architecture/integration-contracts.md) | C1–C8, PIC, consumer/reviewer, acceptance, blockers |

`docs/Campaign_Lab_PRD_v2_1.md` dan root `schema.md` hanya pointer, bukan salinan penuh lain. PRD/schema lama dari `main` dapat ditelusuri melalui histori Git; jangan dijadikan requirement berjalan.

Pembagian kerja dan milestone tim ada di PRD §21–22; kontrak antarmodul pada dokumen integrasi. Open technical review schema berada di **§24**. Aturan database kanonik berada di `docs/requirements/database-rules.md`.

## Kesiapan yang terverifikasi pada baseline dokumentasi

- PRD/schema adalah target; kontrak C1–C8 masih memerlukan review producer/consumer.
- Base branch dokumentasi berasal dari starter `main`; kode landing berada pada branch terpisah dan tidak otomatis ikut terintegrasi.
- Pemeriksaan remote 2 November 2026 hanya mencantumkan `main` dan `landing-page`. Commit foundation `b7917eb` tersedia sebagai referensi lokal, belum masuk main; basis foundation harus dikonfirmasi sebelum dipakai.
- Tidak ada migration chain atau provider yang diuji melalui tugas penyelarasan dokumen. Konflik kapasitas dan kesiapan integrasi tetap dicatat di decision log.

## Urutan dan otoritas

Instruksi eksplisit pengguna + AGENTS mengendalikan izin. PRD menyatakan perilaku produk target; schema menyatakan rancangan data target. **Migration yang ada dan metadata database yang diperiksa** menunjukkan implementasi, bukan nama file yang disebut dokumen. Catat drift; jangan menyimpulkan database remote sama dengan dokumen atau membuat workaround sendiri.

Baca peta → AGENTS → PRD/schema + keputusan terbuka → aturan DB → kontrak dan pembagian kerja tim → implementasi dan test area terkait. Jika target bertentangan, lanjutkan pekerjaan independen dan blok bagian dependent sampai ada keputusan.

## Catatan historis

PRD v2.1 §0.1 merekam snapshot historis landing pada 1 November. Struktur folder di §10 adalah usulan target; frasa `docs/schema.md` sebagai kontrak hasil migration belum berlaku pada B00. Catatan sinkronisasi di awal PRD dan status aktual menjelaskan batas ini. Isi requirement PRD dipertahankan; path lokal dan rujukan catatan individu telah disanitasi; B00 tidak menyelesaikan konflik kapasitas dengan mengubah requirement diam-diam.

Aturan database lama memuat baseline 17/19 tabel, tambahan global knowledge, serta klaim CLI/config sudah tersedia. Itu bukan bukti checkout B00 atau target v2.1; aturan kanonik sekarang tidak mengulang klaim kesiapan tersebut.
