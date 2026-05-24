# HÆ°á»›ng dáº«n tÃ­ch há»£p Tracking SDK â€” Laptop 2

> TÃ i liá»‡u nÃ y dÃ nh cho web React trÃªn **Laptop 2** Ä‘á»ƒ gá»­i behavior event vá» backend trÃªn **Laptop 1** qua tailnet.

## ThÃ´ng tin káº¿t ná»‘i

| | GiÃ¡ trá»‹ |
|--|--|
| Tracking API | `http://lap1:3100` |
| Dashboard | `http://lap1:8090` |
| Máº¡ng | Tailscale (Headscale: `https://vpn.simplething.id.vn`) |

---

## BÆ°á»›c 1 â€” CÃ i Tailscale trÃªn Windows (náº¿u chÆ°a)

1. Táº£i: https://tailscale.com/download/windows â†’ cÃ i Ä‘áº·t
2. Má»Ÿ PowerShell vá»›i quyá»n Admin:

```powershell
tailscale up --login-server=https://vpn.simplething.id.vn --auth-key=<AUTH_KEY> --hostname=Lap2
```

3. Verify káº¿t ná»‘i Ä‘Æ°á»£c Laptop 1:

```powershell
tailscale status
# â†’ pháº£i tháº¥y Lap1 (lap1)

# Test ping
ping lap1
```

---

## BÆ°á»›c 2 â€” Test Tracking API tá»« Laptop 2

Má»Ÿ PowerShell, cháº¡y:

```powershell
curl -Method POST http://lap1:3100/track `
  -ContentType "application/json" `
  -Body '{"event_type":"page_view","anonymous_id":"test_anon","session_id":"test_sess","page_url":"/"}'
```

**Káº¿t quáº£ mong Ä‘á»£i:**
```json
{"accepted": true, "event_id": "evt_..."}
```

Náº¿u ra `{"accepted": true, ...}` â†’ API káº¿t ná»‘i thÃ nh cÃ´ng, sang BÆ°á»›c 3.

---

## BÆ°á»›c 3 â€” ThÃªm SDK vÃ o project web React

### 3.1. Copy file SDK

Táº¡o file `src/lib/behavior-sdk.js` trong project web, dÃ¡n toÃ n bá»™ ná»™i dung sau:

```javascript
const ANON_KEY = "pipeline_anonymous_id";
const SESS_KEY = "pipeline_session_id";

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

export function createBehaviorSdk(options = {}) {
  const endpoint = (options.endpoint || "http://lap1:3100").replace(/\/$/, "");
  const debug = Boolean(options.debug);
  let userId = options.userId ?? null;

  function getAnonymousId() {
    let id = storageGet(ANON_KEY);
    if (!id) { id = randomId("anon"); storageSet(ANON_KEY, id); }
    return id;
  }

  function getSessionId() {
    let id = storageGet(SESS_KEY);
    if (!id) { id = randomId("sess"); storageSet(SESS_KEY, id); }
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
    if (!res.ok) throw new Error(`track failed ${res.status}`);
    return res.json();
  }

  return {
    setUserId: (id) => { userId = id; },
    newSession: () => { storageSet(SESS_KEY, randomId("sess")); },
    trackPageView: (pageUrl) => send(basePayload("page_view", { page_url: pageUrl })),
    trackProductView: (productId, pageUrl) =>
      send(basePayload("product_view", { product_id: productId, page_url: pageUrl })),
    trackProductClick: (productId, pageUrl) =>
      send(basePayload("product_click", { product_id: productId, page_url: pageUrl })),
    trackSearch: (query) => send(basePayload("search", { metadata: { query } })),
    trackFilterApply: (filters) => send(basePayload("filter_apply", { metadata: { filters } })),
    trackScrollDepth: (percent, pageUrl) =>
      send(basePayload("scroll_depth", { page_url: pageUrl, metadata: { scroll_percent: percent } })),
    trackBannerImpression: (banner) =>
      send(basePayload("banner_impression", { metadata: { ...banner } })),
    trackBannerClick: (banner) =>
      send(basePayload("banner_click", { metadata: { ...banner } })),
    trackCustom: (eventType, fields = {}) =>
      send({ ...basePayload(eventType), ...fields }),
    initAutoPageView() {
      if (typeof window === "undefined") return;
      this.trackPageView(window.location.pathname).catch(() => {});
      let maxScroll = 0;
      window.addEventListener("scroll", () => {
        const doc = document.documentElement;
        const pct = Math.round(((window.scrollY + window.innerHeight) / Math.max(doc.scrollHeight, 1)) * 100);
        if (pct > maxScroll && pct >= 25 && pct % 25 === 0) {
          maxScroll = pct;
          this.trackScrollDepth(pct, window.location.pathname).catch(() => {});
        }
      }, { passive: true });
    },
  };
}
```

### 3.2. Táº¡o file `src/lib/tracking.js`

```javascript
import { createBehaviorSdk } from "./behavior-sdk.js";

export const tracking = createBehaviorSdk({
  endpoint: import.meta.env.VITE_TRACKING_API_URL || "http://lap1:3100",
  debug: import.meta.env.DEV,
});

// Tá»± track page_view + scroll depth
tracking.initAutoPageView();
```

### 3.3. ThÃªm vÃ o `.env` cá»§a web

```env
VITE_TRACKING_API_URL=http://lap1:3100
```

---

## BÆ°á»›c 4 â€” Gáº¯n tracking vÃ o cÃ¡c trang

### Import á»Ÿ Ä‘áº§u má»—i file cáº§n track

```javascript
import { tracking } from "../lib/tracking";
```

### CÃ¡c sá»± kiá»‡n phá»• biáº¿n

**Xem sáº£n pháº©m** (trong `useEffect`):
```javascript
useEffect(() => {
  tracking.trackProductView(productId, location.pathname).catch(() => {});
}, [productId]);
```

**Click vÃ o sáº£n pháº©m:**
```javascript
<div onClick={() => tracking.trackProductClick(product.id, `/products/${product.id}`).catch(() => {})}>
```

**TÃ¬m kiáº¿m:**
```javascript
tracking.trackSearch(searchQuery).catch(() => {});
```

**ThÃªm vÃ o giá»:**
```javascript
tracking.trackCustom("add_to_cart", {
  event_category: "behavior",
  product_id: product.id,
  metadata: { price: product.price, qty: 1 },
}).catch(() => {});
```

**Báº¯t Ä‘áº§u checkout:**
```javascript
tracking.trackCustom("checkout_start", {
  event_category: "behavior",
  metadata: { item_count: cart.length, total: cartTotal },
}).catch(() => {});
```

**Mua hÃ ng thÃ nh cÃ´ng:**
```javascript
tracking.setUserId(userEmail); // náº¿u Ä‘Ã£ login
tracking.trackCustom("purchase_succeeded", {
  event_category: "behavior",
  metadata: { order_id: orderId, amount: total },
}).catch(() => {});
```

**Banner impression** (khi banner hiá»‡n trong mÃ n hÃ¬nh):
```javascript
useEffect(() => {
  tracking.trackBannerImpression({
    banner_id: "B001",
    banner_name: "Summer Sale",
    position: "homepage_top",
    campaign_id: "CMP_SUMMER",
  }).catch(() => {});
}, []);
```

---

## BÆ°á»›c 5 â€” Verify data lÃªn dashboard

Má»Ÿ browser trÃªn Laptop 2: **http://lap1:8090**

Sau khi thao tÃ¡c trÃªn web:
- Trang **Events** â†’ tháº¥y event má»›i nháº¥t (refresh 5s)
- Trang **Overview** â†’ KPI tá»•ng há»£p
- Trang **Funnel** â†’ funnel page_view â†’ purchase

---

## Troubleshoot

| Lá»—i | NguyÃªn nhÃ¢n | CÃ¡ch sá»­a |
|-----|-------------|----------|
| `CORS error` trong DevTools | Origin web chÆ°a cÃ³ trong CORS_ORIGIN | Nháº¯n báº¡n kia thÃªm `http://lap2:<port>` vÃ o `infra/.env` rá»“i restart |
| `Failed to fetch` / `ERR_CONNECTION_REFUSED` | Tailscale chÆ°a connect hoáº·c tracking-api chÆ°a cháº¡y | Kiá»ƒm tra `tailscale status`, `ping lap1` |
| Response `400 validation_failed` | Thiáº¿u `anonymous_id` hoáº·c `session_id` | SDK tá»± sinh â€” khÃ´ng cáº§n truyá»n tay |
| Event khÃ´ng lÃªn Dashboard | Streaming processor chÆ°a flush | Chá» tá»‘i Ä‘a 30s sau khi gá»­i event |

---

> Náº¿u gáº·p lá»—i, chá»¥p mÃ n hÃ¬nh **DevTools â†’ Network â†’ request `/track`** (tab Headers + Response) gá»­i láº¡i Ä‘á»ƒ debug.

