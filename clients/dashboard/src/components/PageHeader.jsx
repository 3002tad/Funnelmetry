import { PeriodSelect } from "./PeriodSelect.jsx";

export function PageHeader({
  title,
  subtitle,
  minutes,
  onMinutesChange,
  onRefresh,
  periodOptions,
  variant = "admin",
}) {
  const prefix = variant === "shop" ? "shop" : "admin";

  if (variant === "shop") {
    return (
      <div className="shop-hero">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem" }}>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {onMinutesChange && (
              <PeriodSelect value={minutes} onChange={onMinutesChange} options={periodOptions} className="period-select" />
            )}
            {onRefresh && (
              <button type="button" className="btn btn-ghost" onClick={onRefresh}>Làm mới</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-topbar">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="muted" style={{ marginTop: "0.25rem" }}>{subtitle}</p>}
      </div>
      <div className="admin-topbar-actions">
        {onMinutesChange && (
          <PeriodSelect value={minutes} onChange={onMinutesChange} options={periodOptions} className="period-select" />
        )}
        {onRefresh && (
          <button type="button" className="btn btn-ghost" onClick={onRefresh}>↻ Làm mới</button>
        )}
      </div>
    </div>
  );
}
