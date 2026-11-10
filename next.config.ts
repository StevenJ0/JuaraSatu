import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    // Sampai 5 foto produk (MAX_PRODUCT_PHOTOS) masing-masing maksimal 10MB (MAX_PHOTO_BYTES), ditambah field form lainnya.
    serverActions: { bodySizeLimit: "52mb" },
    // proxy.ts menyalin body request dengan batas bawaan 10MB. Tanpa ini, kiriman foto di atas 10MB terpotong dan Server Action gagal.
    proxyClientMaxBodySize: "52mb",
  },
};

export default nextConfig;
