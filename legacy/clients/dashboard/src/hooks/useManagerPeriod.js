import { useManagerPeriodContext } from "../context/ManagerPeriodContext.jsx";

/**
 * Shared manager period (rolling minutes or calendar day).
 * State lives in ManagerPeriodProvider + URL ?minutes= / ?date=.
 */
export function useManagerPeriod() {
  const ctx = useManagerPeriodContext();
  if (!ctx) {
    throw new Error("useManagerPeriod must be used within ManagerPeriodProvider");
  }
  return ctx;
}
