Biru tenang untuk platform preorder UMKM: dashboard pemilik, wizard AI Campaign Strategist, dan halaman pemesanan pelanggan. Pengguna utamanya pemilik usaha rumahan yang membuka aplikasi dari ponsel di sela produksi, jadi setiap layar harus terbaca dalam sekali lihat.

## Prinsip
- Biru untuk aksi, bukan dekorasi. `primary` hanya untuk satu tombol utama per layar, isi progress kapasitas, tautan, dan menu aktif. Sisanya `surface`, `canvas`, dan `ink`.
- Status pakai warna semantik, bukan biru. Setiap badge selalu memuat kata, tidak hanya warna.
- Bedakan sumber angka: Saran AI, hasil simulasi, data tercatat, dan biaya estimasi selalu diberi label berbeda.
- Ringkasan dulu, detail kemudian. Kartu KPI dan daftar tindakan di atas, tabel di bawah.

## Token warna (tema terang)
canvas #f8fafc · surface #ffffff · surface-sunken #f1f5f9 · border #e2e8f0 · ink #0f172a · ink-muted #5b6577 · primary #2563eb · on-primary #ffffff · primary-strong #1e3a8a · primary-soft #dbeafe · highlight #eff6ff · focus #1d4ed8
success-bg #dcfce7 / success-fg #166534 · warning-bg #fef3c7 / warning-fg #92400e · danger-bg #fee2e2 / danger-fg #991b1b
ai-bg #e0f2fe / ai-fg #075985 · sim-bg #f1f5f9 / sim-fg #334155 / sim-border #94a3b8 (garis putus-putus)

## Konten dan bahasa
- Bahasa Indonesia santai-baku, sentence case. Tombol diawali kata kerja, 1–3 kata: "Konfirmasi pesanan", "Salin caption".
- Istilah pengguna, bukan istilah sistem: "sisa kapasitas", "uang diterima", "menunggu bayar". Hindari "reservation", "settlement", "fulfillment" di UI.
- Uang: Rp45.000 (titik ribuan, tanpa desimal). Jumlah dengan satuan: "15 kotak". Tanggal: "Sabtu, 7 Nov"; detail: "7 Nov 2026, 14.30 WIB".
- Tanpa emoji, tanpa tanda seru di pesan sistem. Pesan galat menyebut apa yang terjadi dan apa yang bisa dilakukan.

## Badge status
Badge: latar *-bg, teks *-fg, 12px semibold, sudut pill, padding 4×8px.
- Bayar paid_sandbox → "Lunas (sandbox)" success · paid_manual → "Lunas (manual)" success · pending/unpaid → "Menunggu bayar" warning · expired/failed → "Kedaluwarsa"/"Gagal" danger
- Pesanan awaiting_confirmation → "Perlu dikonfirmasi" warning · confirmed/in_production/ready → "Dikonfirmasi"/"Diproduksi"/"Siap diambil" (surface-sunken + ink) · fulfilled → "Selesai" success · cancelled → "Dibatalkan" danger · requires_review → "Perlu ditinjau" danger · pending_payment → "Menunggu pembayaran" (surface-sunken + sim-fg)
- Kampanye published → "Aktif" success · draft → "Draf" (surface-sunken + ink-muted)
Status pesanan dan pembayaran tampil sebagai dua badge terpisah, pembayaran di kanan.

## Label wajib
- Saran AI: ai-bg/ai-fg + ikon kilau kecil, di setiap keluaran AI. Cadangan non-AI: "Template" (sim-bg/sim-fg).
- Simulasi: sim-bg/sim-fg + garis putus-putus sim-border, di angka simulator, halaman QRIS, dan angka pembayaran Midtrans.
- Biaya estimasi: warning, di samping kontribusi bila biaya produk belum diverifikasi.
- Data demo: strip tipis sim-bg di atas dashboard: "Data sintetis untuk demonstrasi."

## Tipografi
Plus Jakarta Sans 400/500/600/700; nomor pesanan JetBrains Mono 500.
h1 24/32 bold · h2 18/26 semibold · h3 15/22 semibold · body 15/24 · body-sm 13/20 · label 12/16 semibold huruf kapital spasi 0.04em · kpi 28/34 bold. Semua angka tabular-nums. Paragraf maksimal ~65 karakter.

## Ruang dan sudut
Jarak 4/8/12/16/24/32px. Kartu padding 24 (desktop) / 16 (ponsel), jarak antar kartu 24. Radius 6 input, 10 tombol, 14 kartu, pill untuk badge dan progress. Bayangan kartu tipis 0 1px 2px rgba(15,23,42,.06). Tanpa gradien.

## Pola layar
- Kartu KPI: label (ink-muted) di atas angka (kpi), keterangan di bawah. Tanpa garis aksen di sisi kartu.
- Kapasitas: "5 dari 40 kotak", progress 8px: terisi primary, ditahan primary 45%, sisa primary-soft. ≥90% → warna warning + badge "Hampir penuh".
- Tabel pesanan: header surface-sunken, nomor pesanan mono, status badge, aksi di kanan. Di ponsel jadi daftar kartu.
- Detail pesanan: panel samping 420px, layar penuh di ponsel.
- Wizard AI: Tujuan → Opsi AI → Simulasi → Setujui; kartu strategi berdampingan.
- Login dan Register: satu kolom di tengah, lebar maksimal 420px, nama produk di atas, tanpa ilustrasi atau gradien.
- Umpan balik: tombol "Menyimpan…" saat proses, toast berhasil, pesan galat di bawah field.

## Ikon
Ikon outline konsisten (Lucide, garis 1.5px, 16–20px), warna ink-muted atau primary. Tanpa emoji.
