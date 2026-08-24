export function DataPanel({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`data-panel ${className}`.trim()}>
      {(title || action) && (
        <header className="data-panel__head">
          <div>
            {title && <h3 className="data-panel__title">{title}</h3>}
            {subtitle && <p className="data-panel__sub">{subtitle}</p>}
          </div>
          {action && <div className="data-panel__action">{action}</div>}
        </header>
      )}
      <div className="data-panel__body">{children}</div>
    </section>
  );
}

export function PageLoading() {
  return (
    <div className="page-loading">
      <div className="skeleton-grid">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton skeleton--hero" />
        ))}
      </div>
      <div className="skeleton skeleton--chart" />
    </div>
  );
}

export function PageError({ message }) {
  return (
    <div className="page-error">
      <span className="page-error__icon">!</span>
      <p>{message || "Không tải được dữ liệu"}</p>
    </div>
  );
}

export function EmptyState({ message = "Chưa có dữ liệu trong khoảng thời gian này." }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">∅</span>
      <p>{message}</p>
    </div>
  );
}

export function RankBadge({ rank }) {
  if (rank === 1) return <span className="rank rank--1">1</span>;
  if (rank === 2) return <span className="rank rank--2">2</span>;
  if (rank === 3) return <span className="rank rank--3">3</span>;
  return <span className="rank">{rank}</span>;
}

export function BarCell({ value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="bar-cell">
      <span className="bar-cell__num">{Number(value).toLocaleString()}</span>
      <div className="bar-cell__track">
        <div className="bar-cell__fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
