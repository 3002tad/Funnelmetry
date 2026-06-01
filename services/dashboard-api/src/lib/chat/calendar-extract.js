import { parseCalendarDate } from "../period.js";

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function shiftUtcDay(isoDate, deltaDays) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

/** @returns {string|null} YYYY-MM-DD for single-day questions (hôm qua, 2 ngày trước, d/m/y). */
export function extractCalendarDate(message) {
  const text = (message || "").toLowerCase().trim();
  if (!text) return null;

  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return parseCalendarDate(iso[1]);

  const dmy = text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (dmy) {
    const day = String(dmy[1]).padStart(2, "0");
    const month = String(dmy[2]).padStart(2, "0");
    return parseCalendarDate(`${dmy[3]}-${month}-${day}`);
  }

  const today = utcToday();
  if (/hôm nay\b|today\b/.test(text)) return today;
  if (/hôm qua\b|yesterday\b/.test(text)) return shiftUtcDay(today, -1);
  if (/hôm kia\b/.test(text)) return shiftUtcDay(today, -2);

  const daysAgo = text.match(/(\d+)\s*ngày\s*trước/);
  if (daysAgo) {
    const n = Math.min(parseInt(daysAgo[1], 10), 30);
    return shiftUtcDay(today, -n);
  }

  return null;
}
