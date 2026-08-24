import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests for the pure logic in src/lib — no DOM, no React, no Supabase.
// Anything needing a rendered component or a live DB is out of scope here and
// is verified in the browser instead.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // ⚠️ PINNED, because the DST regression tests in report-snapshot.test.ts are
    // inert without it: under TZ=UTC there is no clocks-back transition to cross,
    // so the walk that froze the client-reports tab passes every assertion. The
    // studio runs on Israel time and every date in the app is local to it.
    env: { TZ: "Asia/Jerusalem" },
  },
});
