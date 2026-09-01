/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DASHBOARD_API_URL?: string
  readonly VITE_ANALYTICS_SOURCE_ID?: string
  readonly VITE_ANALYTICS_WORKSPACE_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
