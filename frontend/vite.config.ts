import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": import.meta.dirname + "/src",
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: false,
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "text-summary", "html", "lcov"],
      // Measure the whole source tree honestly. e2e coverage is complementary,
      // never a substitute — untested units show up here as gaps to close with
      // unit tests, not something to hide behind the Playwright suite.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
      ],
    },
  },
});
