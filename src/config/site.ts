/** Working product identity; no domain or trademark availability claim. */
export const site = {
  name: "Juara Satu",
  title: "Juara Satu | Preorder sesuai kapasitas usahamu",
  description:
    "Kenali Juara Satu, platform preorder untuk usaha produk standar. Lihat kapasitas tersedia, tinjau penawaran berdasarkan biaya, dan pisahkan hasil preorder dari hasil promosi. Pratinjau dengan data contoh.",
};

export const authLinks = {
  signIn: { href: "/login", label: "Masuk" },
  signUp: { href: "/register", label: "Daftar" },
} as const;

export const landingNavigation = [
  { href: "#contoh-penggunaan", label: "Preorder" },
  { href: "#cara-kerja", label: "Penawaran" },
  { href: "#contoh-hasil", label: "Hasil" },
] as const;
