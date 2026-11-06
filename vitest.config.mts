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
    // Uji yang butuh Supabase lokal ada di tests/supabase dan dijalankan lewat `npm run test:integration`.
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.ts"],
  },
});
