import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, TimeRange } from "@/lib/api";

export interface DrillFilter {
  key: string;
  label: string;
  value: string;
}

export interface DrillDetail {
  title: string;
  type: "eventType" | "status" | "user" | "time";
  value: string;
}

export function useDrillDown(timeRange: TimeRange) {
  const [drillFilters, setDrillFilters] = useState<DrillFilter[]>([]);
  const [drillDetail, setDrillDetail] = useState<DrillDetail | null>(null);

  const addDrill = useCallback((key: string, label: string, value: string) => {
    setDrillFilters((prev) => {
      const filtered = prev.filter((f) => f.key !== key);
      return [...filtered, { key, label, value }];
    });
  }, []);

  const removeDrill = useCallback(
    (key: string) => {
      setDrillFilters((prev) => prev.filter((f) => f.key !== key));
      if (drillDetail?.type === key) setDrillDetail(null);
    },
    [drillDetail],
  );

  const clearDrills = useCallback(() => {
    setDrillFilters([]);
    setDrillDetail(null);
  }, []);

  const drillEventType = useCallback(
    (eventType: string) => {
      const label = eventType.replace(/_/g, " ");
      addDrill("eventType", label, eventType);
      setDrillDetail({ title: `Event Type: ${label}`, type: "eventType", value: eventType });
    },
    [addDrill],
  );

  const drillStatus = useCallback(
    (status: string) => {
      addDrill("status", status, status);
      setDrillDetail({ title: `Status: ${status}`, type: "status", value: status });
    },
    [addDrill],
  );

  const drillUser = useCallback(
    (userId: string) => {
      addDrill("user", userId, userId);
      setDrillDetail({ title: `User: ${userId}`, type: "user", value: userId });
    },
    [addDrill],
  );

  const activeEventType = drillFilters.find((f) => f.key === "eventType")?.value;
  const activeStatus = drillFilters.find((f) => f.key === "status")?.value;

  const { data: drillEvents } = useQuery({
    queryKey: ["drillEvents", drillDetail?.type, drillDetail?.value, timeRange],
    queryFn: () =>
      api.getEvents({
        pageSize: 50,
        ...(drillDetail?.type === "eventType" && { eventType: drillDetail.value as any }),
        ...(drillDetail?.type === "status" && { status: drillDetail.value as any }),
        ...(drillDetail?.type === "user" && { search: drillDetail.value }),
      }),
    enabled: !!drillDetail,
  });

  return {
    drillFilters,
    drillDetail,
    setDrillDetail,
    activeEventType,
    activeStatus,
    removeDrill,
    clearDrills,
    drillEventType,
    drillStatus,
    drillUser,
    drillEvents,
  };
}
