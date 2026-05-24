import { useCallback, useState } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

export function SearchPage() {
  const [minutes, setMinutes] = useState(60);
  const topFetcher = useCallback(() => api.searchTop(minutes), [minutes]);
  const filterFetcher = useCallback(() => api.searchFilters(minutes), [minutes]);
  const top = useAutoRefresh(topFetcher);
  const filters = useAutoRefresh(filterFetcher);

  return (
    <>
      <PageHeader title="Search & Filters" minutes={minutes} onMinutesChange={setMinutes} />
      <div className="admin-panel">
        <h3>Top từ khóa</h3>
        {top.loading ? <p className="empty">…</p> : (
          <table className="data-table">
            <thead><tr><th>Query</th><th>Số lần</th></tr></thead>
            <tbody>
              {(top.data?.searches || []).map((r) => (
                <tr key={r.query}><td>{r.query}</td><td>{r.searches}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="admin-panel">
        <h3>Filter phổ biến</h3>
        {filters.loading ? <p className="empty">…</p> : (
          <table className="data-table">
            <thead><tr><th>Category</th><th>Sort</th><th>Lượt</th></tr></thead>
            <tbody>
              {(filters.data?.filters || []).map((r, i) => (
                <tr key={i}><td>{r.category}</td><td>{r.sort_mode || "—"}</td><td>{r.filter_events}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
