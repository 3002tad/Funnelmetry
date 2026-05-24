import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sdk": path.resolve(__dirname, "../../sdk/browser-behavior-sdk/src/index.js"),
    },
  },
  server: {
    port: 5173,
  },
});
