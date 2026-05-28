/**
 * One SSE connection shared across the whole app.
 *
 * - Opens /api/events/stream when the user is authenticated.
 * - Provides useOnLiveEvent(cb) and useOnKpiUpdate(cb) hooks.
 *   Components register callbacks; they are cleaned up automatically on unmount.
 */
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from "react";
import { getToken, getStoredUser } from "../lib/auth.js";
import { isAnalystRole } from "../lib/routes.js";

const LiveStreamContext = createContext(null);

const STREAM_URL = "/api/events/stream";

export function LiveStreamProvider({ children }) {
  const eventHandlers = useRef(new Set());
  const kpiHandlers = useRef(new Set());
  const esRef = useRef(null);
  const [token, setToken] = useState(() => getToken());
  const [streamStatus, setStreamStatus] = useState("offline");

  useEffect(() => {
    const role = getStoredUser()?.role;
    if (!token || !isAnalystRole(role)) {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      setStreamStatus("offline");
      return;
    }

    const url = `${STREAM_URL}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;
    setStreamStatus("reconnecting");

    es.onopen = () => setStreamStatus("live");
    es.onerror = () => setStreamStatus("reconnecting");

    es.addEventListener("events", (e) => {
      try {
        const rows = JSON.parse(e.data);
        if (Array.isArray(rows) && rows.length > 0) {
          eventHandlers.current.forEach((fn) => fn(rows));
        }
      } catch { /* malformed */ }
    });

    es.addEventListener("kpi", () => {
      kpiHandlers.current.forEach((fn) => fn());
    });

    return () => {
      es.close();
      if (esRef.current === es) {
        esRef.current = null;
      }
      setStreamStatus("offline");
    };
  }, [token]); // reconnect whenever auth token changes

  useEffect(() => {
    const syncToken = () => setToken(getToken());
    window.addEventListener("dashboard-auth-changed", syncToken);
    window.addEventListener("storage", syncToken);

    return () => {
      window.removeEventListener("dashboard-auth-changed", syncToken);
      window.removeEventListener("storage", syncToken);
    };
  }, []);

  const onLiveEvent = useCallback((fn) => {
    eventHandlers.current.add(fn);
    return () => eventHandlers.current.delete(fn);
  }, []);

  const onKpiUpdate = useCallback((fn) => {
    kpiHandlers.current.add(fn);
    return () => kpiHandlers.current.delete(fn);
  }, []);

  return (
    <LiveStreamContext.Provider value={{ onLiveEvent, onKpiUpdate, streamStatus }}>
      {children}
    </LiveStreamContext.Provider>
  );
}

/** Subscribe to new raw event rows from the SSE stream. */
export function useOnLiveEvent(handler) {
  const ctx = useContext(LiveStreamContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!ctx) return;
    const stable = (rows) => handlerRef.current(rows);
    return ctx.onLiveEvent(stable);
  }, [ctx]);
}

/**
 * Trigger a callback whenever the server signals that KPI tables
 * have been updated (streaming-processor flushed a new window).
 * Use inside a component to call `refresh()` on your data fetcher.
 */
export function useOnKpiUpdate(handler) {
  const ctx = useContext(LiveStreamContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!ctx) return;
    const stable = () => handlerRef.current();
    return ctx.onKpiUpdate(stable);
  }, [ctx]);
}

export function useLiveStreamStatus() {
  const ctx = useContext(LiveStreamContext);
  return ctx?.streamStatus || "offline";
}
