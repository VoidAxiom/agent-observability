import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import {
  assertConfigValid,
  buildEndpointUrl,
  ClickHouseError,
  loadConfigFromEnv,
} from "./src/lib/clickhouse";

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
  // Reuse the SAME loader + validator the SPA uses, so the dev-proxy
  // target and the browser loader agree on what's a legal host/port.
  // Without this, vite.config.ts would silently accept (e.g.) port 81234
  // or bare-IPv6 `::1` that loadConfigFromEnv / buildEndpointUrl reject —
  // dev would 502 on every /ch and the failure would look like a CH
  // outage instead of an env typo. Bracket IPv6 + integer/range port +
  // hostname grammar all flow from the same one source of truth.
  const chConfig = loadConfigFromEnv(env as ImportMetaEnv);
  let proxyTarget: string;
  try {
    // assertConfigValid throws on bad host/port — keeps the loader and
    // the dev-proxy in lockstep on what's a legal config. We separately
    // build the URL (with query) and strip to the origin, since the
    // proxy target must NOT include `?database=…` (the /ch rewrite
    // produces /?database=… at ClickHouse).
    assertConfigValid(chConfig);
    const validated = new URL(buildEndpointUrl(chConfig));
    proxyTarget = `${validated.protocol}//${validated.host}`;
  } catch (err) {
    if (err instanceof ClickHouseError) {
      throw new Error(
        `[vite.config] Invalid CH_* env for dev-proxy target: ${err.message}. ` +
          `Fix CH_HOST/CH_HTTP_PORT in the repo-root .env (loader and dev-proxy share the same validator).`,
        { cause: err },
      );
    }
    throw err;
  }

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
      // /ch?... (same-origin from its perspective), Vite forwards to
      // http://<chHost>:<chPort>/?... — no CORS preflight, since the
      // browser never sees a cross-origin request. The Tauri runtime
      // will bypass this entirely (HTTP plugin, filed as VOI-347).
      //
      // Key is a regex so the match is segment-anchored — a path of
      // /ch, /ch/<anything>, or /ch?<query> proxies; /changelog,
      // /cherry.png, or any other "happens to start with /ch" path
      // falls through to Vite's normal handling. Vite's default string
      // key is startsWith-style, which would silently route those.
      proxy: {
        "^/ch(?:[/?]|$)": {
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
