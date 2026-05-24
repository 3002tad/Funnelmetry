import { createBehaviorSdk } from "@sdk";

const endpoint = import.meta.env.VITE_TRACKING_API_URL || "http://localhost:3100";

export const tracking = createBehaviorSdk({
  endpoint,
  debug: import.meta.env.DEV,
});

tracking.initAutoPageView();
