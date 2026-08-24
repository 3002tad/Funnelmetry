import { useCallback, useEffect, useState } from "react";

export function useAutoRefresh(fetcher, intervalMs = 15000) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const result = await fetcher();
      setData(result);
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    refresh();
    if (intervalMs <= 0) return undefined;
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { data, loading, error, refresh, lastUpdated };
}
