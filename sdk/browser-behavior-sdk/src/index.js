import { createBannerTracking } from "./banner-tracking.js";

const ANON_KEY = "pipeline_anonymous_id";
const SESS_KEY = "pipeline_session_id";

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function createBehaviorSdk(options = {}) {
  // Set endpoint via VITE_TRACKING_API_URL — k3s: http://<WSL_IP>:31000
  const endpoint = (options.endpoint || "http://localhost:31000").replace(/\/$/, "");
  const debug = Boolean(options.debug);
  let userId = options.userId ?? null;

  function getAnonymousId() {
    let id = storageGet(ANON_KEY);
    if (!id) {
      id = randomId("anon");
      storageSet(ANON_KEY, id);
    }
    return id;
  }

  function getSessionId() {
    let id = storageGet(SESS_KEY);
    if (!id) {
      id = randomId("sess");
      storageSet(SESS_KEY, id);
    }
    return id;
  }

  function basePayload(eventType, extra = {}) {
    return {
      event_source: "browser_sdk",
      event_category: "behavior",
      event_type: eventType,
      anonymous_id: getAnonymousId(),
      session_id: getSessionId(),
      user_id: userId,
      page_url: typeof window !== "undefined" ? window.location.pathname : extra.page_url || "/",
      timestamp: new Date().toISOString(),
      metadata: {
        device: /Mobi/i.test(navigator.userAgent) ? "mobile" : "desktop",
        browser: navigator.userAgent?.split(" ").pop() || "unknown",
        ...extra.metadata,
      },
      ...extra,
    };
  }

  async function send(event) {
    if (debug) console.debug("[behavior-sdk]", event);
    const res = await fetch(`${endpoint}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      keepalive: true,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`track failed ${res.status}: ${text}`);
    }
    return res.json();
  }

  return {
    setUserId(id) {
      userId = id;
    },
    newSession() {
      storageSet(SESS_KEY, randomId("sess"));
    },
    trackPageView(pageUrl) {
      return send(basePayload("page_view", { page_url: pageUrl }));
    },
    trackProductView(productId, pageUrl) {
      return send(
        basePayload("product_view", {
          product_id: productId,
          page_url: pageUrl,
        })
      );
    },
    trackProductClick(productId, pageUrl) {
      return send(
        basePayload("product_click", {
          product_id: productId,
          page_url: pageUrl,
        })
      );
    },
    trackSearch(query) {
      return send(
        basePayload("search", {
          metadata: { query },
        })
      );
    },
    trackFilterApply(filters) {
      return send(
        basePayload("filter_apply", {
          metadata: { filters },
        })
      );
    },
    trackScrollDepth(percent, pageUrl) {
      return send(
        basePayload("scroll_depth", {
          page_url: pageUrl,
          metadata: { scroll_percent: percent },
        })
      );
    },
    trackBannerImpression(banner) {
      return send(
        basePayload("banner_impression", {
          metadata: {
            banner_id: banner.banner_id,
            banner_name: banner.banner_name,
            position: banner.position,
            campaign_id: banner.campaign_id,
            viewport_visible_percent: banner.viewport_visible_percent ?? 100,
          },
        })
      );
    },
    trackBannerClick(banner) {
      return send(
        basePayload("banner_click", {
          metadata: {
            banner_id: banner.banner_id,
            target_url: banner.target_url,
            target_product_id: banner.target_product_id,
            campaign_id: banner.campaign_id,
          },
        })
      );
    },
    trackCustom(eventType, fields = {}) {
      return send({ ...basePayload(eventType), ...fields });
    },
    initAutoPageView() {
      if (typeof window === "undefined") return;
      this.trackPageView(window.location.pathname).catch(() => {});
      let maxScroll = 0;
      const onScroll = () => {
        const doc = document.documentElement;
        const pct = Math.round(
          ((window.scrollY + window.innerHeight) / Math.max(doc.scrollHeight, 1)) * 100
        );
        if (pct > maxScroll && (pct >= 25 || pct === 100) && pct % 25 === 0) {
          maxScroll = pct;
          this.trackScrollDepth(pct, window.location.pathname).catch(() => {});
        }
      };
      window.addEventListener("scroll", onScroll, { passive: true });
    },
    /** Wire [data-banner-id] elements → banner_impression (50% visible ≥1s) + banner_click. */
    initBannerTracking(options) {
      return createBannerTracking(this, options).start();
    },
  };
}
