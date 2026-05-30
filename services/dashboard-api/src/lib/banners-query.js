import { query } from "../db.js";
import { kpiPeriodFilter } from "./period.js";

/** Resolve banner id — web-shop often sends metadata.name without banner_id. */
const BANNER_ID_SQL = `COALESCE(
  NULLIF(TRIM(metadata->>'banner_id'), ''),
  NULLIF(TRIM(metadata->>'bannerId'), ''),
  NULLIF(TRIM(metadata->>'banner_name'), ''),
  NULLIF(TRIM(metadata->>'name'), '')
)`;

function buildKpiSql(period) {
  const tf = kpiPeriodFilter("window_start", period, 1);
  return {
    sql: `
  SELECT
    banner_id,
    SUM(impressions)::int AS impressions,
    SUM(clicks)::int AS clicks,
    CASE WHEN SUM(impressions) > 0
      THEN ROUND(SUM(clicks)::numeric / SUM(impressions), 4)
      ELSE 0 END AS ctr,
    MAX(target_product_id) AS target_product_id
  FROM banner_kpi_1m
  WHERE COALESCE(banner_id, '') <> ''${tf.clause}
  GROUP BY banner_id
  ORDER BY impressions DESC`,
    params: tf.params,
  };
}

function buildCleanSql(period) {
  const tf = kpiPeriodFilter("event_time", period, 1);
  return {
    sql: `
  SELECT
    bid AS banner_id,
    COUNT(*) FILTER (WHERE event_type = 'banner_impression')::int AS impressions,
    COUNT(*) FILTER (WHERE event_type = 'banner_click')::int AS clicks,
    CASE WHEN COUNT(*) FILTER (WHERE event_type = 'banner_impression') > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE event_type = 'banner_click')::numeric
        / COUNT(*) FILTER (WHERE event_type = 'banner_impression'),
        4
      )
      ELSE 0 END AS ctr,
    MAX(metadata->>'target_product_id') AS target_product_id
  FROM (
    SELECT event_type, metadata, ${BANNER_ID_SQL} AS bid
    FROM tracking_events_clean
    WHERE event_type IN ('banner_impression', 'banner_click')${tf.clause}
  ) t
  WHERE COALESCE(bid, '') <> ''
  GROUP BY bid
  ORDER BY impressions DESC`,
    params: tf.params,
  };
}

async function countRawBannerEvents(period) {
  const tf = kpiPeriodFilter("event_time", period, 1);
  const [row] = await query(
    `SELECT COUNT(*)::int AS n
     FROM tracking_events_clean
     WHERE event_type IN ('banner_impression', 'banner_click')${tf.clause}`,
    tf.params
  );
  return row?.n ?? 0;
}

async function countMissingBannerId(period) {
  const tf = kpiPeriodFilter("event_time", period, 1);
  const [row] = await query(
    `SELECT COUNT(*)::int AS n
     FROM tracking_events_clean
     WHERE event_type IN ('banner_impression', 'banner_click')
       AND (${BANNER_ID_SQL}) IS NULL${tf.clause}`,
    tf.params
  );
  return row?.n ?? 0;
}

export async function fetchBannersForPeriod(period) {
  const raw_banner_events = await countRawBannerEvents(period);
  const missing_banner_id = await countMissingBannerId(period);
  const diagnostics = { raw_banner_events, missing_banner_id };

  const clean = buildCleanSql(period);
  const eventRows = await query(clean.sql, clean.params);
  if (eventRows.length > 0) {
    const kpi = buildKpiSql(period);
    const kpiRows = await query(kpi.sql, kpi.params);
    return {
      banners: eventRows,
      source: "events",
      diagnostics: { ...diagnostics, kpi_rows: kpiRows.length },
    };
  }

  const kpi = buildKpiSql(period);
  const kpiRows = await query(kpi.sql, kpi.params);
  if (kpiRows.length > 0) {
    return {
      banners: kpiRows,
      source: "kpi",
      diagnostics: { ...diagnostics, kpi_rows: kpiRows.length },
    };
  }

  return {
    banners: [],
    source: "none",
    diagnostics: { ...diagnostics, kpi_rows: 0 },
  };
}
