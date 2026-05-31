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
  // Polling-query window + safety ceiling (VOI-382). Both positive
  // integers; defaults are 1h window / 50000-row ceiling (matches the
  // VOI-382 source brief). Window bounds how far back the
  // SessionSidebar's polling SELECT looks; ceiling caps the row count
  // so a silent table can never load the entire history. limitCeiling
  // is bounded above by clickhouse.ts MAX_LIMIT_CEILING so an obvious
  // typo (CH_QUERY_LIMIT_CEILING=1e21) throws a named error at boot
  // instead of a generic CH 500.
  // Both prefixes honored (CH_* repo-standard wins; VITE_CH_* fallback),
  // mirroring the connection-config loader's convention.
  readonly CH_QUERY_WINDOW_HOURS?: string;
  readonly CH_QUERY_LIMIT_CEILING?: string;
  readonly VITE_CH_QUERY_WINDOW_HOURS?: string;
  readonly VITE_CH_QUERY_LIMIT_CEILING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
