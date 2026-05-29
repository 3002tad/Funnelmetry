import { query } from "../db.js";

/** Resolve banner id — web-shop often sends metadata.name without banner_id. */
const BANNER_ID_SQL = `COALESCE(
  NULLIF(TRIM(metadata->>'banner_id'), ''),
  NULLIF(TRIM(metadata->>'bannerId'), ''),
  NULLIF(TRIM(metadata->>'banner_name'), ''),
  NULLIF(TRIM(metadata->>'name'), '')
)`;

const KPI_SQL = `
  SELECT
    banner_id,
    SUM(impressions)::int AS impressions,
    SUM(clicks)::int AS clicks,
    CASE WHEN SUM(impressions) > 0
      THEN ROUND(SUM(clicks)::numeric / SUM(impressions), 4)
      ELSE 0 END AS ctr,
    MAX(target_product_id) AS target_product_id
  FROM banner_kpi_1m
  WHERE window_start >= NOW() - ($1 || ' minutes')::interval
    AND COALESCE(banner_id, '') <> ''
  GROUP BY banner_id
  ORDER BY impressions DESC`;

const CLEAN_SQL = `
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
    WHERE event_time >= NOW() - ($1 || ' minutes')::interval
      AND event_type IN ('banner_impression', 'banner_click')
  ) t
  WHERE COALESCE(bid, '') <> ''
  GROUP BY bid
  ORDER BY impressions DESC`;

async function countRawBannerEvents(minutes) {
  const [row] = await query(
    `SELECT COUNT(*)::int AS n
     FROM tracking_events_clean
     WHERE event_time >= NOW() - ($1 || ' minutes')::interval
       AND event_type IN ('banner_impression', 'banner_click')`,
    [minutes]
  );
  return row?.n ?? 0;
}

async function countMissingBannerId(minutes) {
  const [row] = await query(
    `SELECT COUNT(*)::int AS n
     FROM tracking_events_clean
     WHERE event_time >= NOW() - ($1 || ' minutes')::interval
       AND event_type IN ('banner_impression', 'banner_click')
       AND (${BANNER_ID_SQL}) IS NULL`,
    [minutes]
  );
  return row?.n ?? 0;
}

/**
 * Banner metrics: aggregate from clean events when present (matches Events stream),
 * else minute KPI table.
 */
export async function fetchBannersForPeriod(minutes) {
  const raw_banner_events = await countRawBannerEvents(minutes);
  const missing_banner_id = await countMissingBannerId(minutes);
  const diagnostics = { raw_banner_events, missing_banner_id };

  const eventRows = await query(CLEAN_SQL, [minutes]);
  if (eventRows.length > 0) {
    const kpiRows = await query(KPI_SQL, [minutes]);
    return {
      banners: eventRows,
      source: "events",
      diagnostics: { ...diagnostics, kpi_rows: kpiRows.length },
    };
  }

  const kpiRows = await query(KPI_SQL, [minutes]);
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
