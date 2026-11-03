/** Working product identity; no domain or trademark availability claim. */
export const site = {
  name: "Campaign Lab",
  title: "Campaign Lab — Buka preorder. Rencanakan promosi. Pahami hasilnya.",
  description:
    "Pratinjau platform preorder untuk UMKM dari berbagai bidang, mulai makanan, fashion, hingga kerajinan. Kelola kuota dan pesanan, rencanakan promosi sesuai biaya, lalu pahami hasil preorder dan kampanye secara terpisah.",
};

export const authLinks = {
  signIn: { href: "/login", label: "Masuk" },
  signUp: { href: "/register", label: "Daftar" },
} as const;

export const landingNavigation = [
  { href: "#cara-kerja", label: "Cara kerja" },
  { href: "#contoh-penggunaan", label: "Contoh penggunaan" },
  { href: "#contoh-hasil", label: "Dua laporan" },
] as const;
