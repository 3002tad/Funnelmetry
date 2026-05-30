/** Shared with PageHeader period pills — values match dashboard-api parseAnalyticsMinutes. */
export const MANAGER_PERIOD_OPTIONS = [
  { value: 15, label: "15p" },
  { value: 30, label: "30p" },
  { value: 60, label: "1h" },
  { value: 180, label: "3h" },
  { value: 720, label: "12h" },
  { value: 1440, label: "24h" },
  { value: 10080, label: "7 ngày" },
  { value: 43200, label: "30 ngày" },
  { value: 0, label: "Tất cả" },
];

export function formatPeriodLabel(minutes) {
  if (!minutes) return "toàn bộ dữ liệu";
  if (minutes >= 43200) return "30 ngày gần nhất";
  if (minutes >= 10080) return "7 ngày gần nhất";
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} ngày gần nhất`;
  if (minutes >= 1440) return "24 giờ gần nhất";
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} giờ gần nhất`;
  return `${minutes} phút gần nhất`;
}

export function formatCalendarDayLabel(date) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("vi-VN", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `ngày ${label}`;
}

/** Build query string for analytics APIs. */
export function periodQueryString({ minutes, date }) {
  if (date) return `date=${encodeURIComponent(date)}`;
  return `minutes=${minutes ?? 60}`;
}
