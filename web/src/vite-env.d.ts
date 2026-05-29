/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Repo-standard names (preferred): match clickhouse/migrate.sh,
  // docker-compose.yml, and the Swift app's environment lookup.
  readonly CH_HOST?: string;
  readonly CH_HTTP_PORT?: string;
  readonly CH_DATABASE?: string;
  readonly CH_USERNAME?: string;
  readonly CH_PASSWORD?: string;
  // Vite-prefixed fallbacks (deprecated; web-only overrides).
  readonly VITE_CH_HOST?: string;
  readonly VITE_CH_HTTP_PORT?: string;
  readonly VITE_CH_DATABASE?: string;
  readonly VITE_CH_USERNAME?: string;
  readonly VITE_CH_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
