import { useCallback, useMemo, useState } from "react";
import { formatCalendarDayLabel, formatPeriodLabel } from "../lib/period.js";

/**
 * Manager dashboard period: rolling minutes OR a single calendar day (YYYY-MM-DD).
 */
export function useManagerPeriod(initialMinutes = 60) {
  const [minutes, setMinutes] = useState(initialMinutes);
  const [date, setDate] = useState("");

  const selectMinutes = useCallback((m) => {
    setDate("");
    setMinutes(m);
  }, []);

  const selectDate = useCallback((d) => {
    setDate(d || "");
  }, []);

  const periodLabel = useMemo(
    () => (date ? formatCalendarDayLabel(date) : formatPeriodLabel(minutes)),
    [date, minutes]
  );

  const periodKey = date || `m${minutes}`;

  const periodParams = useMemo(
    () => (date ? { date } : { minutes }),
    [date, minutes]
  );

  return {
    minutes,
    date,
    periodLabel,
    periodKey,
    periodParams,
    selectMinutes,
    selectDate,
  };
}
