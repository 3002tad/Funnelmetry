import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const infraEnvDir = path.resolve(__dirname, "../../infra");

/** k3s NodePort listens on WSL — Windows localhost:32000 often refuses (ECONNREFUSED). */
function resolveProxyTargets(localEnv, infraEnv) {
  const wslIp = (infraEnv.WSL_IP || localEnv.WSL_IP || "").trim();
  const host = wslIp ? `http://${wslIp}` : "http://127.0.0.1";

  return {
    dashboard:
      localEnv.VITE_PROXY_DASHBOARD
      || infraEnv.VITE_DASHBOARD_API_URL
      || `${host}:32000`,
    tracking:
      localEnv.VITE_PROXY_TRACKING
      || infraEnv.VITE_TRACKING_API_URL
      || `${host}:31000`,
    commerce:
      localEnv.VITE_PROXY_COMMERCE
      || (infraEnv.COMMERCE_BACKEND_URL || "").replace(/\/$/, "")
      || `${host}:30330`,
  };
}

/** Proxy API calls through Vite so Swagger (localhost:5190) avoids browser CORS. */
function apiProxy(targets) {
  const { dashboard, tracking, commerce } = targets;

  return {
    "/proxy/dashboard": {
      target: dashboard,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/proxy\/dashboard/, ""),
    },
    "/proxy/tracking": {
      target: tracking,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/proxy\/tracking/, ""),
    },
    "/proxy/commerce": {
      target: commerce,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/proxy\/commerce/, ""),
    },
  };
}

export default defineConfig(({ mode }) => {
  const localEnv = loadEnv(mode, process.cwd(), "");
  const infraEnv = loadEnv(mode, infraEnvDir, "");
  const targets = resolveProxyTargets(localEnv, infraEnv);

  // eslint-disable-next-line no-console
  console.log(
    "[api-docs] proxy →",
    targets.dashboard,
    "|",
    targets.tracking,
    "|",
    targets.commerce
  );

  return {
    root: ".",
    publicDir: "public",
    server: {
      port: 5190,
      strictPort: true,
      open: "/",
      proxy: apiProxy(targets),
    },
    preview: {
      port: 5190,
      strictPort: true,
      proxy: apiProxy(targets),
    },
  };
});
