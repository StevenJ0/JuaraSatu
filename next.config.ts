import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    // Foto produk maksimal 10MB (MAX_PHOTO_BYTES) ditambah field form lainnya.
    serverActions: { bodySizeLimit: "11mb" },
    // proxy.ts menyalin body request dengan batas bawaan 10MB. Tanpa ini, foto tepat 10MB terpotong dan Server Action gagal.
    proxyClientMaxBodySize: "11mb",
  },
};

export default nextConfig;
