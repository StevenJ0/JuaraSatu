import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    // Foto produk maksimal 5MB (MAX_PHOTO_BYTES) ditambah field form lainnya.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
