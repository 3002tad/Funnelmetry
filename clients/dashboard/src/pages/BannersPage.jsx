import { useCallback, useState } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

export function BannersPage() {
  const [minutes, setMinutes] = useState(60);
  const fetcher = useCallback(() => api.banners(minutes), [minutes]);
  const { data, loading, error } = useAutoRefresh(fetcher);

  if (loading) return <p className="empty">Đang tải…</p>;
  if (error) return <p className="empty">Lỗi: {error}</p>;

  return (
    <>
      <PageHeader title="Banners" minutes={minutes} onMinutesChange={setMinutes} />
      <div className="admin-panel">
        {(data?.banners || []).length === 0 ? (
          <p className="empty">Chưa có dữ liệu banner.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Banner</th><th>Impressions</th><th>Clicks</th><th>CTR</th></tr>
            </thead>
            <tbody>
              {data.banners.map((b) => (
                <tr key={b.banner_id}>
                  <td>{b.banner_id}</td>
                  <td>{b.impressions}</td>
                  <td>{b.clicks}</td>
                  <td>{(Number(b.ctr) * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
