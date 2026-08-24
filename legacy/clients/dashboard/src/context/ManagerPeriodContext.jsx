import { createContext, useCallback, useContext, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { formatCalendarDayLabel, formatPeriodLabel } from "../lib/period.js";
import {
  buildPeriodSearch,
  DEFAULT_MANAGER_MINUTES,
  parseDateSearchParam,
  parseMinutesSearchParam,
} from "../lib/periodSearch.js";

const ManagerPeriodContext = createContext(null);

export function ManagerPeriodProvider({ children }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const date = parseDateSearchParam(searchParams.get("date")) || "";
  const minutesFromUrl = parseMinutesSearchParam(searchParams.get("minutes"));
  const minutes = minutesFromUrl ?? DEFAULT_MANAGER_MINUTES;

  const applySearch = useCallback(
    (nextMinutes, nextDate) => {
      const search = buildPeriodSearch({ minutes: nextMinutes, date: nextDate });
      setSearchParams(search ? new URLSearchParams(search) : new URLSearchParams(), { replace: true });
    },
    [setSearchParams]
  );

  const selectMinutes = useCallback(
    (m) => {
      applySearch(m, "");
    },
    [applySearch]
  );

  const selectDate = useCallback(
    (d) => {
      if (d) {
        applySearch(DEFAULT_MANAGER_MINUTES, d);
      } else {
        applySearch(DEFAULT_MANAGER_MINUTES, "");
      }
    },
    [applySearch]
  );

  const periodLabel = useMemo(
    () => (date ? formatCalendarDayLabel(date) : formatPeriodLabel(minutes)),
    [date, minutes]
  );

  const periodKey = date || `m${minutes}`;

  const periodParams = useMemo(
    () => (date ? { date } : { minutes }),
    [date, minutes]
  );

  const value = useMemo(
    () => ({
      minutes,
      date,
      periodLabel,
      periodKey,
      periodParams,
      selectMinutes,
      selectDate,
    }),
    [minutes, date, periodLabel, periodKey, periodParams, selectMinutes, selectDate]
  );

  return (
    <ManagerPeriodContext.Provider value={value}>{children}</ManagerPeriodContext.Provider>
  );
}

export function useManagerPeriodContext() {
  return useContext(ManagerPeriodContext);
}
