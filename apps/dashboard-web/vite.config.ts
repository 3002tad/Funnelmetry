import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

declare const process: { env: Record<string, string | undefined> }

export default defineConfig({
  plugins: [react()],
  server: process.env.DASHBOARD_DEV_API_TARGET ? {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: process.env.DASHBOARD_DEV_API_TARGET,
        changeOrigin: true,
        secure: process.env.DASHBOARD_DEV_ALLOW_SELF_SIGNED_TLS !== "1",
      },
    },
  } : undefined,
})
