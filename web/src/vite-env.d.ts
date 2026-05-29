/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CH_HOST?: string;
  readonly VITE_CH_HTTP_PORT?: string;
  readonly VITE_CH_DATABASE?: string;
  readonly VITE_CH_USERNAME?: string;
  readonly VITE_CH_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
