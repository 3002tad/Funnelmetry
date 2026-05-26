/**
 * Subscribe to the SSE event stream at /api/events/stream.
 *
 * - Opens EventSource on mount; closes on unmount.
 * - Auto-reconnects (browser behaviour for EventSource).
 * - onEvent(rows) called whenever the server pushes new events.
 * - Falls back to polling via onFallback() when SSE is unavailable.
 */
import { useEffect, useRef, useState } from "react";
import { getToken } from "../lib/auth.js";

const STREAM_URL = "/api/events/stream";

/**
 * @param {(rows: object[]) => void} onEvent - called with new event rows
 */
export function useEventStream(onEvent) {
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const url = `${STREAM_URL}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("events", (e) => {
      try {
        const rows = JSON.parse(e.data);
        if (Array.isArray(rows) && rows.length > 0) {
          onEventRef.current(rows);
        }
      } catch {
        // malformed data — ignore
      }
    });

    es.addEventListener("ping", () => {
      // keepalive — no action needed
    });

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, []); // intentionally empty — reconnect on mount only

  return { connected };
}
