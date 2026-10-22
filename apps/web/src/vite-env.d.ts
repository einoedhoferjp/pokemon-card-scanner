/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Basis-URL der API, z. B. https://api.example.com (leer = automatisch). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
