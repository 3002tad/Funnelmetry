import { query } from "../../db.js";
import { kpiPeriodFilter, parseCalendarDate } from "../period.js";

function asPeriod(minutes, calendarDate) {
  const date = parseCalendarDate(calendarDate);
  if (date) return { type: "day", date };
  return { type: "rolling", minutes };
}

function escapeLike(value) {
  return String(value).replace(/[%_\\]/g, "\\$&");
}

/** Resolve product_id from catalog by id or partial name match. */
export async function resolveProductRef(ref) {
  if (!ref) return null;
  const trimmed = String(ref).trim();
  const idMatch = trimmed.match(/\b(P\d{3,}|SKU[-\w]+)\b/i);
  if (idMatch) {
    const productId = idMatch[1].toUpperCase();
    const [row] = await query(
      `SELECT product_id, name, price, category FROM products_catalog WHERE product_id = $1`,
      [productId]
    );
    return row || { product_id: productId, name: trimmed, price: 0, category: null };
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  const [exact] = await query(
    `SELECT product_id, name, price, category FROM products_catalog WHERE name ILIKE $1 LIMIT 1`,
    [normalized]
  );
  if (exact) return exact;

  const tokens = normalized.split(" ").filter((t) => t.length >= 2);
  const tail = tokens.slice(-3).join(" ");
  const [partial] = await query(
    `SELECT product_id, name, price, category FROM products_catalog
     WHERE name ILIKE $1 OR ($2 <> '' AND name ILIKE $3)
     ORDER BY CASE WHEN name ILIKE $1 THEN 0 ELSE 1 END, length(name) ASC
     LIMIT 1`,
    [`%${escapeLike(normalized)}%`, tail, `%${escapeLike(tail)}%`]
  );
  return partial || null;
}

export async function fetchProductDetail(minutes, productRef, calendarDate = null) {
  const catalog = await resolveProductRef(productRef);
  if (!catalog) {
    return { found: false, query: productRef, product: null, stats: null };
  }

  const tf = kpiPeriodFilter("k.window_start", asPeriod(minutes, calendarDate), 2);
  const [stats] = await query(
    `SELECT
       k.product_id,
       COALESCE(c.name, k.product_id) AS product_name,
       SUM(k.views) AS views,
       SUM(k.clicks) AS clicks,
       SUM(k.purchases) AS purchases,
       SUM(k.revenue) AS revenue,
       CASE WHEN SUM(k.views) > 0
         THEN ROUND(SUM(k.purchases)::numeric / SUM(k.views), 4) ELSE 0 END AS conversion_rate
     FROM product_revenue_kpi_1m k
     LEFT JOIN products_catalog c USING (product_id)
     WHERE k.product_id = $1${tf.clause}
     GROUP BY k.product_id, c.name`,
    [catalog.product_id, ...tf.params]
  );

  return {
    found: true,
    query: productRef,
    product: catalog,
    stats: stats || {
      product_id: catalog.product_id,
      product_name: catalog.name,
      views: 0,
      clicks: 0,
      purchases: 0,
      revenue: 0,
      conversion_rate: 0,
    },
  };
}

export async function fetchOverview(minutes, calendarDate = null) {
  const tf = kpiPeriodFilter("t.window_start", asPeriod(minutes, calendarDate), 1);
  const [kpi] = await query(
    `SELECT
       COALESCE(SUM(t.total_events), 0)   AS total_events,
       COALESCE(SUM(t.page_views), 0)     AS page_views,
       COALESCE(SUM(t.product_views), 0)  AS product_views,
       COALESCE(SUM(t.add_to_cart), 0)    AS add_to_cart,
       COALESCE(SUM(t.checkout_start), 0) AS checkout_start,
       COALESCE(SUM(t.purchases), 0)      AS purchases,
       COALESCE(SUM(t.unique_sessions), 0) AS unique_sessions,
       CASE WHEN SUM(t.unique_sessions) > 0
         THEN ROUND(SUM(t.purchases)::numeric / SUM(t.unique_sessions), 4)
         ELSE 0 END AS conversion_rate,
       COALESCE(SUM(t.revenue), 0) AS total_revenue
     FROM tracking_kpi_1m t
     WHERE 1=1${tf.clause}`,
    tf.params
  );
  return kpi;
}

export async function fetchTopProducts(minutes, limit = 5, sortBy = "views", calendarDate = null) {
  const orderCol =
    sortBy === "purchases" ? "purchases" : sortBy === "revenue" ? "revenue" : "views";
  const tf = kpiPeriodFilter("k.window_start", asPeriod(minutes, calendarDate), 1);
  const limitIdx = tf.params.length + 1;
  return query(
    `SELECT
       k.product_id,
       COALESCE(c.name, k.product_id) AS product_name,
       SUM(k.views) AS views,
       SUM(k.purchases) AS purchases,
       SUM(k.revenue) AS revenue
     FROM product_revenue_kpi_1m k
     LEFT JOIN products_catalog c USING (product_id)
     WHERE 1=1${tf.clause}
     GROUP BY k.product_id, c.name
     ORDER BY ${orderCol} DESC
     LIMIT $${limitIdx}`,
    [...tf.params, limit]
  );
}

export async function fetchProductAnomalies(minutes, limit = 5, calendarDate = null) {
  const tf = kpiPeriodFilter("k.window_start", asPeriod(minutes, calendarDate), 1);
  const limitIdx = tf.params.length + 1;
  const rows = await query(
    `SELECT
       k.product_id,
       COALESCE(c.name, k.product_id) AS product_name,
       SUM(k.views) AS views,
       SUM(k.clicks) AS clicks,
       SUM(k.purchases) AS purchases
     FROM product_revenue_kpi_1m k
     LEFT JOIN products_catalog c USING (product_id)
     WHERE 1=1${tf.clause}
     GROUP BY k.product_id, c.name
     HAVING SUM(k.views) >= 5 AND SUM(k.purchases) = 0
     ORDER BY views DESC
     LIMIT $${limitIdx}`,
    [...tf.params, limit]
  );
  return rows.map((r) => ({
    ...r,
    severity_score: Number(r.views) + Number(r.clicks) * 0.3,
  }));
}

export async function fetchKpiComparison(minutes) {
  const span = minutes || 1440;
  const [current] = await query(
    `SELECT
       COALESCE(SUM(unique_sessions), 0) AS unique_sessions,
       COALESCE(SUM(purchases), 0) AS purchases,
       COALESCE(SUM(revenue), 0) AS total_revenue,
       CASE WHEN SUM(unique_sessions) > 0
         THEN ROUND(SUM(purchases)::numeric / SUM(unique_sessions), 4) ELSE 0 END AS conversion_rate
     FROM tracking_kpi_1m
     WHERE window_start >= NOW() - ($1::int || ' minutes')::interval`,
    [span]
  );
  const [previous] = await query(
    `SELECT
       COALESCE(SUM(unique_sessions), 0) AS unique_sessions,
       COALESCE(SUM(purchases), 0) AS purchases,
       COALESCE(SUM(revenue), 0) AS total_revenue,
       CASE WHEN SUM(unique_sessions) > 0
         THEN ROUND(SUM(purchases)::numeric / SUM(unique_sessions), 4) ELSE 0 END AS conversion_rate
     FROM tracking_kpi_1m
     WHERE window_start >= NOW() - ($1::int * 2 || ' minutes')::interval
       AND window_start < NOW() - ($1 || ' minutes')::interval`,
    [span]
  );
  return {
    current,
    previous,
    delta: {
      sessions_pct: pctDelta(previous.unique_sessions, current.unique_sessions),
      purchases_pct: pctDelta(previous.purchases, current.purchases),
      revenue_pct: pctDelta(previous.total_revenue, current.total_revenue),
      conversion_delta: Number(current.conversion_rate) - Number(previous.conversion_rate),
    },
  };
}

function pctDelta(prev, cur) {
  const p = Number(prev) || 0;
  const c = Number(cur) || 0;
  if (p === 0) return c > 0 ? 1 : 0;
  return Number(((c - p) / p).toFixed(4));
}

export async function fetchRevenueTrend(minutes, bucketMinutes = 15, calendarDate = null) {
  const tf = kpiPeriodFilter("window_start", asPeriod(minutes, calendarDate), 1);
  return query(
    `SELECT
       window_start,
       COALESCE(SUM(revenue), 0) AS revenue,
       COALESCE(SUM(purchases), 0) AS purchases,
       COALESCE(SUM(unique_sessions), 0) AS sessions
     FROM tracking_kpi_1m
     WHERE 1=1${tf.clause}
     GROUP BY window_start
     ORDER BY window_start ASC`,
    tf.params
  );
}

export async function fetchProductConversion(minutes, limit = 10, calendarDate = null) {
  const tf = kpiPeriodFilter("k.window_start", asPeriod(minutes, calendarDate), 1);
  const limitIdx = tf.params.length + 1;
  return query(
    `SELECT
       k.product_id,
       COALESCE(c.name, k.product_id) AS product_name,
       SUM(k.views) AS views,
       SUM(k.purchases) AS purchases,
       CASE WHEN SUM(k.views) > 0
         THEN ROUND(SUM(k.purchases)::numeric / SUM(k.views), 4) ELSE 0 END AS conversion_rate,
       SUM(k.revenue) AS revenue
     FROM product_revenue_kpi_1m k
     LEFT JOIN products_catalog c USING (product_id)
     WHERE 1=1${tf.clause}
     GROUP BY k.product_id, c.name
     HAVING SUM(k.views) >= 3
     ORDER BY conversion_rate DESC, views DESC
     LIMIT $${limitIdx}`,
    [...tf.params, limit]
  );
}

export async function fetchFunnel(minutes, calendarDate = null) {
  const tf = kpiPeriodFilter("window_start", asPeriod(minutes, calendarDate), 1);
  const [row] = await query(
    `SELECT
       COALESCE(SUM(page_views), 0)     AS page_view,
       COALESCE(SUM(product_views), 0)  AS product_view,
       COALESCE(SUM(add_to_cart), 0)    AS add_to_cart,
       COALESCE(SUM(checkout_start), 0) AS checkout_start,
       COALESCE(SUM(purchases), 0)      AS purchase
     FROM tracking_kpi_1m
     WHERE 1=1${tf.clause}`,
    tf.params
  );
  const steps = [
    { step: "page_view", label: "Xem trang", count: Number(row.page_view) },
    { step: "product_view", label: "Xem SP", count: Number(row.product_view) },
    { step: "add_to_cart", label: "Thêm giỏ", count: Number(row.add_to_cart) },
    { step: "checkout_start", label: "Checkout", count: Number(row.checkout_start) },
    { step: "purchase", label: "Mua hàng", count: Number(row.purchase) },
  ];
  let worst = steps[0];
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1].count;
    const drop = prev > 0 ? 1 - steps[i].count / prev : 0;
    steps[i].drop_off_rate = Number(drop.toFixed(4));
    if (prev > 0 && drop > (worst.drop_off_rate || 0)) {
      worst = { ...steps[i], from: steps[i - 1].label };
    }
  }
  return { steps, worst_drop: worst };
}

export async function fetchBanners(minutes, limit = 5, calendarDate = null) {
  const tf = kpiPeriodFilter("window_start", asPeriod(minutes, calendarDate), 1);
  const limitIdx = tf.params.length + 1;
  return query(
    `SELECT banner_id,
            SUM(impressions) AS impressions,
            SUM(clicks) AS clicks,
            CASE WHEN SUM(impressions) > 0
              THEN ROUND(SUM(clicks)::numeric / SUM(impressions), 4)
              ELSE 0 END AS ctr
     FROM banner_kpi_1m
     WHERE 1=1${tf.clause}
     GROUP BY banner_id
     ORDER BY impressions DESC
     LIMIT $${limitIdx}`,
    [...tf.params, limit]
  );
}

export async function fetchBannerDetail(minutes, bannerRef, calendarDate = null) {
  if (!bannerRef) return { found: false, query: null, banner: null };
  const ref = String(bannerRef).trim().toLowerCase();
  const rows = await fetchBanners(minutes, 30, calendarDate);
  const banner =
    rows.find((b) => String(b.banner_id).toLowerCase() === ref) ||
    rows.find((b) => String(b.banner_id).toLowerCase().includes(ref));
  return {
    found: Boolean(banner),
    query: bannerRef,
    banner: banner || null,
  };
}

export async function fetchTopSearches(minutes, limit = 10, calendarDate = null) {
  const tf = kpiPeriodFilter("event_time", asPeriod(minutes, calendarDate), 1);
  const limitIdx = tf.params.length + 1;
  return query(
    `SELECT
       COALESCE(metadata->>'query', '') AS search_query,
       COUNT(*)::int AS searches
     FROM tracking_events_clean
     WHERE event_type = 'search'
       AND COALESCE(metadata->>'query', '') <> ''${tf.clause}
     GROUP BY metadata->>'query'
     ORDER BY searches DESC
     LIMIT $${limitIdx}`,
    [...tf.params, limit]
  );
}

export async function fetchSearchFilters(minutes, limit = 10, calendarDate = null) {
  const tf = kpiPeriodFilter("event_time", asPeriod(minutes, calendarDate), 1);
  const limitIdx = tf.params.length + 1;
  return query(
    `SELECT
       COUNT(*)::int AS filter_events,
       COALESCE(metadata->'filters'->>'category', metadata->>'category', 'all') AS category,
       COALESCE(metadata->'filters'->>'sortMode', metadata->>'sortMode', '') AS sort_mode
     FROM tracking_events_clean
     WHERE event_type = 'filter_apply'${tf.clause}
     GROUP BY 2, 3
     ORDER BY filter_events DESC
     LIMIT $${limitIdx}`,
    [...tf.params, limit]
  );
}

export async function fetchCategoryPerformance(minutes, limit = 10, calendarDate = null) {
  const tf = kpiPeriodFilter("k.window_start", asPeriod(minutes, calendarDate), 1);
  const limitIdx = tf.params.length + 1;
  return query(
    `SELECT
       COALESCE(NULLIF(c.category, ''), 'unknown') AS category,
       SUM(k.views) AS views,
       SUM(k.purchases) AS purchases,
       SUM(k.revenue) AS revenue
     FROM product_revenue_kpi_1m k
     LEFT JOIN products_catalog c USING (product_id)
     WHERE 1=1${tf.clause}
     GROUP BY c.category
     ORDER BY revenue DESC
     LIMIT $${limitIdx}`,
    [...tf.params, limit]
  );
}

export async function fetchCatalogStats() {
  const [row] = await query(`SELECT COUNT(*)::int AS product_count FROM products_catalog`);
  return row || { product_count: 0 };
}

function normalizeLineItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((i) => i && typeof i === "object");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const PURCHASE_EVENT_PREDICATE = `(
  event_type = 'purchase_succeeded'
  OR metadata->>'business_event_type' = 'order.completed'
  OR (
    COALESCE(metadata->>'order_id', metadata->>'orderCode', '') <> ''
    AND COALESCE(NULLIF(metadata->>'amount', ''), NULLIF(metadata->>'total_amount', ''), '') <> ''
  )
)`;

/** Recent purchase events with line items from metadata (no separate orders table). */
export async function fetchRecentPurchases(
  minutes,
  calendarDate = null,
  limit = 8,
  focusOrderId = null,
  { sortByAmount = false } = {}
) {
  const tf = kpiPeriodFilter("event_time", asPeriod(minutes, calendarDate), 1);
  const limitIdx = tf.params.length + 1;
  const orderSql = sortByAmount
    ? "amount DESC NULLS LAST, event_time DESC"
    : "event_time DESC";
  const rows = await query(
    `SELECT
       event_id,
       event_time,
       session_id,
       anonymous_id,
       COALESCE(metadata->>'order_id', metadata->>'orderCode', '') AS order_id,
       metadata->'items' AS items,
       COALESCE(
         NULLIF(metadata->>'amount', '')::numeric,
         NULLIF(metadata->>'total_amount', '')::numeric,
         0
       ) AS amount
     FROM tracking_events_clean
     WHERE ${PURCHASE_EVENT_PREDICATE}${tf.clause}
     ORDER BY ${orderSql}
     LIMIT $${limitIdx}`,
    [...tf.params, limit]
  );

  let orders = rows.map((row) => ({
    event_id: row.event_id,
    event_time: row.event_time,
    session_id: row.session_id,
    anonymous_id: row.anonymous_id,
    order_id: row.order_id || null,
    amount: Number(row.amount || 0),
    items: normalizeLineItems(row.items),
  }));

  const focus = (focusOrderId || "").trim();
  if (focus) {
    const idx = orders.findIndex(
      (o) => o.order_id === focus || o.event_id === focus || String(o.order_id || "").includes(focus)
    );
    if (idx > 0) {
      const [match] = orders.splice(idx, 1);
      orders = [match, ...orders];
    }
  }
  return orders;
}
