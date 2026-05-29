import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Expose both Vite's standard VITE_* prefix and the repo's CH_* env-var
  // convention used by clickhouse/migrate.sh, docker-compose.yml, and the
  // Swift app. Without this, a CH_HOST set in the repo-root .env would be
  // silently ignored by the web app while every other tool honored it.
  envPrefix: ["VITE_", "CH_"],
  server: {
    port: 5174,
    strictPort: true,
    host: "127.0.0.1",
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
