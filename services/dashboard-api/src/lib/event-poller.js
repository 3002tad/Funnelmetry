/**
 * Background poller: queries Postgres every POLL_MS for:
 *   - New events in tracking_events_clean  → emits "events"
 *   - Updated KPI windows in tracking_kpi_1m → emits "kpi"
 *
 * SSE clients subscribe to eventBus and get pushed immediately.
 * Starts tracking from "now" — no replay of historical data on boot.
 */
import { query } from "../db.js";
import { eventBus } from "./event-bus.js";

const POLL_MS = 2000;

let _eventCursor = new Date();
let _kpiCursor = new Date();
let _timer = null;

async function pollEvents() {
  const rows = await query(
    `SELECT event_id, event_time, event_type, event_category,
            anonymous_id, session_id, page_url, product_id, metadata
     FROM tracking_events_clean
     WHERE event_time > $1
     ORDER BY event_time ASC
     LIMIT 100`,
    [_eventCursor]
  );
  if (rows.length > 0) {
    _eventCursor = new Date(rows[rows.length - 1].event_time);
    eventBus.emit("events", rows);
  }
}

async function pollKpi() {
  const [row] = await query(
    `SELECT MAX(processed_at) AS latest FROM tracking_kpi_1m`
  );
  if (!row?.latest) return;
  const latest = new Date(row.latest);
  if (latest > _kpiCursor) {
    _kpiCursor = latest;
    eventBus.emit("kpi");
  }
}

async function poll() {
  try {
    await Promise.all([pollEvents(), pollKpi()]);
  } catch {
    // DB not ready yet — retry silently next tick
  }
}

export function startEventPoller() {
  if (_timer) return;
  _timer = setInterval(poll, POLL_MS);
  _timer.unref?.();
}

export function stopEventPoller() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
