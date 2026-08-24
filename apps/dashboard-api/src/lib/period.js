/** Rolling analytics window. 0 = all rows in KPI/event tables (since first ingest). */
export const PERIOD_ALL = 0;
export const MAX_ANALYTICS_MINUTES = 43_200; // 30 days

const MINUTES_7D = 10_080;
const MINUTES_30D = 43_200;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string|number|undefined} raw query ?minutes=
 * @param {number} defaultMinutes when missing/invalid
 * @returns {number} 0 = all time, else 1..MAX
 */
export function parseAnalyticsMinutes(raw, defaultMinutes = 60) {
  if (raw === "all" || raw === "0") return PERIOD_ALL;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultMinutes;
  if (n <= 0) return PERIOD_ALL;
  return Math.min(n, MAX_ANALYTICS_MINUTES);
}

/** @returns {string|null} YYYY-MM-DD */
export function parseCalendarDate(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!DAY_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return s;
}

/**
 * @typedef {{ type: 'day', date: string, label: string } | { type: 'rolling', minutes: number, label: string }} AnalyticsPeriod
 */

/** `date` wins over `minutes` when both present. */
export function resolveAnalyticsPeriod(query = {}, defaultMinutes = 60) {
  const date = parseCalendarDate(query.date);
  if (date) {
    return { type: "day", date, label: formatCalendarDayLabel(date) };
  }
  const minutes = parseAnalyticsMinutes(query.minutes, defaultMinutes);
  return { type: "rolling", minutes, label: formatPeriodLabel(minutes) };
}

/** Filter KPI / event timestamp column for rolling window or one calendar day (UTC date boundary). */
export function kpiPeriodFilter(column, period, paramIndex = 1) {
  if (period.type === "day") {
    return {
      clause: ` AND ${column} >= $${paramIndex}::date AND ${column} < ($${paramIndex}::date + INTERVAL '1 day')`,
      params: [period.date],
    };
  }
  return kpiTimeAnd(column, period.minutes, paramIndex);
}

/** `AND col >= NOW() - ($idx || ' minutes')::interval` or empty when all-time. */
export function kpiTimeAnd(column, minutes, paramIndex = 1) {
  if (!minutes) return { clause: "", params: [] };
  return {
    clause: ` AND ${column} >= NOW() - ($${paramIndex}::int || ' minutes')::interval`,
    params: [minutes],
  };
}

export const eventTimeAnd = kpiPeriodFilter;

export function formatPeriodLabel(minutes) {
  if (!minutes) return "toàn bộ dữ liệu";
  if (minutes >= MINUTES_30D) return "30 ngày gần nhất";
  if (minutes >= MINUTES_7D) return "7 ngày gần nhất";
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} ngày gần nhất`;
  if (minutes >= 1440) return "24 giờ gần nhất";
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} giờ gần nhất`;
  return `${minutes} phút gần nhất`;
}

export function formatCalendarDayLabel(date) {
  const [y, m, d] = date.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("vi-VN", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `ngày ${label}`;
}

export function periodJson(minutes) {
  return {
    period_minutes: minutes || PERIOD_ALL,
    period_label: formatPeriodLabel(minutes),
    period_all_time: !minutes,
    period_date: null,
  };
}

export function periodToJson(period) {
  if (period.type === "day") {
    return {
      period_date: period.date,
      period_minutes: null,
      period_label: period.label,
      period_all_time: false,
    };
  }
  return periodJson(period.minutes);
}
