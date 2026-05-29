import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Read .env files from the repo root, not web/. The repo-standard
  // .env / .env.example live one level up alongside clickhouse/, sdk/,
  // and the Swift app — Vite's default envDir is the project root (web/),
  // which would miss them entirely. Pair with the envPrefix below so the
  // CH_* convention used by migrate.sh, docker-compose, and the Swift app
  // is actually exposed to the browser.
  const envDir = "..";
  // loadEnv honors envPrefix, so request both prefixes here too. Used to
  // derive the dev-proxy target below.
  const env = loadEnv(mode, envDir, ["VITE_", "CH_"]);
  const chHost = env.CH_HOST ?? env.VITE_CH_HOST ?? "localhost";
  const chPortRaw = env.CH_HTTP_PORT ?? env.VITE_CH_HTTP_PORT ?? "8123";
  const chPort = Number(chPortRaw);
  const proxyTarget = `http://${chHost}:${Number.isFinite(chPort) && chPort > 0 ? chPort : 8123}`;

  return {
    plugins: [react()],
    clearScreen: false,
    envDir,
    // Expose both Vite's standard VITE_* prefix and the repo's CH_* env-var
    // convention used by clickhouse/migrate.sh, docker-compose.yml, and the
    // Swift app. Without this, a CH_HOST set in the repo-root .env would be
    // silently ignored by the web app while every other tool honored it.
    envPrefix: ["VITE_", "CH_"],
    server: {
      port: 5174,
      strictPort: true,
      host: "127.0.0.1",
      // Same-origin dev proxy for ClickHouse. The browser POSTs to
      // /ch?database=... (same-origin from its perspective), Vite forwards
      // to http://<chHost>:<chPort>/?database=... — no CORS preflight,
      // since the browser never sees a cross-origin request. The Tauri
      // runtime will bypass this entirely (HTTP plugin, filed as VOI-347).
      proxy: {
        "/ch": {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/ch/, ""),
        },
      },
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
  };
});
