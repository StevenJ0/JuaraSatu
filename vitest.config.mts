import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Test berjalan di Node biasa, bukan environment React Server; pakai entry kosong milik paket itu sendiri.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Uji Supabase lokal Rafi ada di tests/supabase (`npm run test:integration`). tests/integration milik Steven
    // butuh fixture lokalnya sendiri (node_modules/.cache, container campaign-lab), jadi tidak ikut di sini.
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.{ts,tsx}"],
  },
});
