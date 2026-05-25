export function StatCard({ label, value, hint, icon: Icon, accent, variant = "default" }) {
  return (
    <div className={`stat-card stat-card--${variant}${accent ? " stat-card--accent" : ""}`}>
      {Icon && (
        <div className="stat-card__icon">
          <Icon size={20} />
        </div>
      )}
      <div className="stat-card__body">
        <span className="stat-card__label">{label}</span>
        <span className="stat-card__value">{value}</span>
        {hint && <span className="stat-card__hint">{hint}</span>}
      </div>
    </div>
  );
}

export function StatHero({ label, value, sub, icon: Icon, tone = "primary" }) {
  return (
    <div className={`stat-hero stat-hero--${tone}`}>
      {Icon && (
        <div className="stat-hero__icon"><Icon size={22} /></div>
      )}
      <div>
        <span className="stat-hero__label">{label}</span>
        <div className="stat-hero__value">{value}</div>
        {sub && <span className="stat-hero__sub">{sub}</span>}
      </div>
    </div>
  );
}
