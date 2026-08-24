import { MANAGER_PERIOD_OPTIONS } from "./period.js";

export const DEFAULT_MANAGER_MINUTES = 60;

const VALID_MINUTES = new Set(MANAGER_PERIOD_OPTIONS.map((o) => o.value));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse ?minutes= from URL (0 = Tất cả). */
export function parseMinutesSearchParam(raw) {
  if (raw == null || raw === "") return null;
  if (raw === "all") return 0;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  if (!VALID_MINUTES.has(n)) return null;
  return n;
}

/** Parse ?date=YYYY-MM-DD from URL. */
export function parseDateSearchParam(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!DAY_RE.test(s)) return null;
  return s;
}

/** Build search string for NavLink / setSearchParams. */
export function buildPeriodSearch({ minutes, date }) {
  const params = new URLSearchParams();
  if (date) {
    params.set("date", date);
    return params.toString();
  }
  const m = minutes ?? DEFAULT_MANAGER_MINUTES;
  params.set("minutes", String(m));
  return params.toString();
}
