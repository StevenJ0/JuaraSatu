import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Uji ke Supabase lokal sungguhan: `npx supabase start`, lalu `npm run test:integration`. Tidak ikut `npm test`, karena butuh Docker.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 90000,
    hookTimeout: 180000,
    // Uji harga mengganti fungsi penawaran sementara, jadi berkas tidak boleh berjalan bersamaan.
    fileParallelism: false,
  },
});
