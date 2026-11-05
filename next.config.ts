import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    // Foto produk maksimal 10MB (MAX_PHOTO_BYTES) ditambah field form lainnya.
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
