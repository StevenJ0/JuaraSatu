# Archived campaign-first migrations

Dipindahkan dari `supabase/migrations/` pada cutover lokal v2.1, 3 November 2026. File SQL dipertahankan byte-for-byte karena belum tersedia arsip Git yang dapat diandalkan saat audit.

| File | SHA256 |
|---|---|
| `20261030210000_initial_schema.sql` | `0024416c8296b70eb9b1024b9f13df9a048ce35fe5d8c32a46e0185b25ee9f65` |
| `20261030225000_add_campaign_memory_and_calendar_contents.sql` | `09dc752f763f5610fc33f0dd8a956bad1945249ed6444970bc18b7c0e20c8088` |

Arsip ini tidak dijalankan oleh Supabase CLI root. Harness disposable masih mengompilasinya pada database terpisah sebagai pembanding legacy. Jangan menggabungkannya dengan initial v2.1.

Cutover ini hanya untuk database lokal `campaign-lab` yang telah melewati safety gate. Database developer lain atau remote yang telah memakai chain ini membutuhkan rekonsiliasi/upgrade tersendiri, bukan reset otomatis. Lihat [laporan cutover](../v2.1/LOCAL_VERIFICATION.md).
