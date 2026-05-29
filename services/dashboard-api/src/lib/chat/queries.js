import { query } from "../../db.js";

export async function fetchOverview(minutes) {
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
     WHERE t.window_start >= NOW() - ($1 || ' minutes')::interval`,
    [minutes]
  );
  return kpi;
}

export async function fetchTopProducts(minutes, limit = 5) {
  return query(
    `SELECT
       k.product_id,
       COALESCE(c.name, k.product_id) AS product_name,
       SUM(k.views) AS views,
       SUM(k.purchases) AS purchases,
       SUM(k.revenue) AS revenue
     FROM product_revenue_kpi_1m k
     LEFT JOIN products_catalog c USING (product_id)
     WHERE k.window_start >= NOW() - ($1 || ' minutes')::interval
     GROUP BY k.product_id, c.name
     ORDER BY views DESC
     LIMIT $2`,
    [minutes, limit]
  );
}

export async function fetchProductAnomalies(minutes, limit = 5) {
  const rows = await query(
    `SELECT
       k.product_id,
       COALESCE(c.name, k.product_id) AS product_name,
       SUM(k.views) AS views,
       SUM(k.clicks) AS clicks,
       SUM(k.purchases) AS purchases
     FROM product_revenue_kpi_1m k
     LEFT JOIN products_catalog c USING (product_id)
     WHERE k.window_start >= NOW() - ($1 || ' minutes')::interval
     GROUP BY k.product_id, c.name
     HAVING SUM(k.views) >= 5 AND SUM(k.purchases) = 0
     ORDER BY views DESC
     LIMIT $2`,
    [minutes, limit]
  );
  return rows.map((r) => ({
    ...r,
    severity_score: Number(r.views) + Number(r.clicks) * 0.3,
  }));
}

export async function fetchKpiComparison(minutes) {
  const [current] = await query(
    `SELECT
       COALESCE(SUM(unique_sessions), 0) AS unique_sessions,
       COALESCE(SUM(purchases), 0) AS purchases,
       COALESCE(SUM(revenue), 0) AS total_revenue,
       CASE WHEN SUM(unique_sessions) > 0
         THEN ROUND(SUM(purchases)::numeric / SUM(unique_sessions), 4) ELSE 0 END AS conversion_rate
     FROM tracking_kpi_1m
     WHERE window_start >= NOW() - ($1 || ' minutes')::interval`,
    [minutes]
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
    [minutes]
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

export async function fetchRevenueTrend(minutes, bucketMinutes = 15) {
  const bucket = Math.max(5, Math.min(bucketMinutes, minutes));
  return query(
    `SELECT
       window_start,
       COALESCE(SUM(revenue), 0) AS revenue,
       COALESCE(SUM(purchases), 0) AS purchases,
       COALESCE(SUM(unique_sessions), 0) AS sessions
     FROM tracking_kpi_1m
     WHERE window_start >= NOW() - ($1 || ' minutes')::interval
     GROUP BY window_start
     ORDER BY window_start ASC`,
    [minutes]
  );
}

export async function fetchProductConversion(minutes, limit = 10) {
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
     WHERE k.window_start >= NOW() - ($1 || ' minutes')::interval
     GROUP BY k.product_id, c.name
     HAVING SUM(k.views) >= 3
     ORDER BY conversion_rate DESC, views DESC
     LIMIT $2`,
    [minutes, limit]
  );
}

export async function fetchFunnel(minutes) {
  const [row] = await query(
    `SELECT
       COALESCE(SUM(page_views), 0)     AS page_view,
       COALESCE(SUM(product_views), 0)  AS product_view,
       COALESCE(SUM(add_to_cart), 0)    AS add_to_cart,
       COALESCE(SUM(checkout_start), 0) AS checkout_start,
       COALESCE(SUM(purchases), 0)      AS purchase
     FROM tracking_kpi_1m
     WHERE window_start >= NOW() - ($1 || ' minutes')::interval`,
    [minutes]
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

export async function fetchBanners(minutes, limit = 5) {
  return query(
    `SELECT banner_id,
            SUM(impressions) AS impressions,
            SUM(clicks) AS clicks,
            CASE WHEN SUM(impressions) > 0
              THEN ROUND(SUM(clicks)::numeric / SUM(impressions), 4)
              ELSE 0 END AS ctr
     FROM banner_kpi_1m
     WHERE window_start >= NOW() - ($1 || ' minutes')::interval
     GROUP BY banner_id
     ORDER BY impressions DESC
     LIMIT $2`,
    [minutes, limit]
  );
}
