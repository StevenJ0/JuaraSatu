/** Working product identity; no domain or trademark availability claim. */
export const site = {
  name: "juarasatu",
  title: "juarasatu | Teman usaha di setiap langkah",
  description:
    "juarasatu membantu UMKM makanan menjalankan preorder: atur kapasitas produksi, bagikan halaman pesanan, terima pembayaran QRIS (simulasi Midtrans Sandbox), dan minta strategi promosi dari AI saat target belum tercapai.",
};

export const authLinks = {
  signIn: { href: "/login", label: "Masuk" },
  signUp: { href: "/register", label: "Daftar" },
} as const;

export const landingNavigation = [
  { href: "#tentang", label: "Tentang" },
  { href: "#fitur", label: "Fitur" },
  { href: "#cara-pakai", label: "Cara pakai" },
] as const;
