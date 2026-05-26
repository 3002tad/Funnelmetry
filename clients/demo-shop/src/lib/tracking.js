import { createBehaviorSdk } from "@sdk";

// infra/.env — VITE_TRACKING_API_URL=http://<WSL_IP>:31000
const endpoint = import.meta.env.VITE_TRACKING_API_URL || "http://localhost:31000";

export const tracking = createBehaviorSdk({
  endpoint,
  debug: import.meta.env.DEV,
});

tracking.initAutoPageView();
