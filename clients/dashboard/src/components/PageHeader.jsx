import { PeriodPills } from "./PeriodPills.jsx";
import { IconRefresh } from "./icons.jsx";
import { useLiveStreamStatus } from "../context/LiveStreamContext.jsx";
import { MANAGER_PERIOD_OPTIONS } from "../lib/period.js";

const PERIOD_OPTS = MANAGER_PERIOD_OPTIONS;

export function PageHeader({
  title,
  subtitle,
  minutes,
  onMinutesChange,
  date,
  onDateChange,
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

  const periodToolbar = (onMinutesChange || onDateChange) && (
    <div className="page-header__period">
      {onMinutesChange && (
        <PeriodPills
          value={date ? null : minutes}
          onChange={onMinutesChange}
          options={periodOptions}
        />
      )}
      {onDateChange && (
        <label className="period-date-picker">
          <span className="period-date-picker__label">Ngày</span>
          <input
            type="date"
            value={date || ""}
            onChange={(e) => onDateChange(e.target.value)}
            title="Xem KPI đúng một ngày (00:00–24:00 UTC)"
          />
        </label>
      )}
    </div>
  );

  if (variant === "admin") {
    return (
      <div className="admin-topbar">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted" style={{ marginTop: "0.2rem" }}>{subtitle}</p>}
        </div>
        <div className="admin-topbar-actions">
          {periodToolbar}
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
        {periodToolbar}
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
