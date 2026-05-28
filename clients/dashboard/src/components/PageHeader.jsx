import { PeriodPills } from "./PeriodPills.jsx";
import { IconRefresh } from "./icons.jsx";
import { useLiveStreamStatus } from "../context/LiveStreamContext.jsx";

const PERIOD_OPTS = [
  { value: 15, label: "15p" },
  { value: 30, label: "30p" },
  { value: 60, label: "1h" },
  { value: 180, label: "3h" },
  { value: 720, label: "12h" },
  { value: 1440, label: "24h" },
];

export function PageHeader({
  title,
  subtitle,
  minutes,
  onMinutesChange,
  onRefresh,
  periodOptions = PERIOD_OPTS,
  variant = "mgr",
  live = true,
  lastUpdated,
}) {
  const streamStatus = useLiveStreamStatus();
  const statusClass = streamStatus === "live"
    ? "live"
    : streamStatus === "reconnecting"
      ? "reconnecting"
      : "offline";
  const statusLabel = streamStatus === "live"
    ? "Live"
    : streamStatus === "reconnecting"
      ? "Đang kết nối lại"
      : "Offline";

  if (variant === "admin") {
    return (
      <div className="admin-topbar">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted" style={{ marginTop: "0.2rem" }}>{subtitle}</p>}
        </div>
        <div className="admin-topbar-actions">
          {onMinutesChange && (
            <PeriodPills value={minutes} onChange={onMinutesChange} options={periodOptions} />
          )}
          {onRefresh && (
            <button type="button" className="btn btn-ghost" onClick={onRefresh} aria-label="Làm mới">
              <IconRefresh />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <header className="page-header">
      <div className="page-header__main">
        <div className="page-header__titles">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {live && (
          <span className={`live-badge live-badge--${statusClass}`}>
            <span className="live-badge__dot" />
            {statusLabel}
          </span>
        )}
      </div>
      <div className="page-header__toolbar">
        {lastUpdated && (
          <span className="header-last-updated">
            Cập nhật: {new Date(lastUpdated).toLocaleTimeString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
        {onMinutesChange && (
          <PeriodPills value={minutes} onChange={onMinutesChange} options={periodOptions} />
        )}
        {onRefresh && (
          <button type="button" className="btn btn-ghost btn-icon" onClick={onRefresh}>
            <IconRefresh />
            <span>Làm mới</span>
          </button>
        )}
      </div>
    </header>
  );
}
