import { Sparkline } from "./charts/Sparkline.jsx";

export function StatCard({ label, value, hint, icon: Icon, accent, variant = "default", sparkline, sparkColor }) {
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
      {sparkline?.length >= 2 && (
        <Sparkline values={sparkline} stroke={sparkColor} width={88} height={32} />
      )}
    </div>
  );
}

const SPARK_COLORS = {
  primary: "#f54e00",
  purple: "#53389e",
  success: "#15803d",
};

export function StatHero({ label, value, sub, icon: Icon, tone = "primary", sparkline, trendPct }) {
  const sparkStroke = SPARK_COLORS[tone] || SPARK_COLORS.primary;

  return (
    <div className={`stat-hero stat-hero--${tone}`}>
      {Icon && (
        <div className="stat-hero__icon"><Icon size={22} /></div>
      )}
      <div className="stat-hero__main">
        <span className="stat-hero__label">{label}</span>
        <div className="stat-hero__value-row">
          <div className="stat-hero__value">{value}</div>
          {trendPct != null && (
            <span className={`stat-hero__trend${trendPct >= 0 ? " up" : " down"}`}>
              {trendPct >= 0 ? "+" : ""}{trendPct.toFixed(1)}%
            </span>
          )}
        </div>
        {sub && <span className="stat-hero__sub">{sub}</span>}
      </div>
      {sparkline?.length >= 2 && (
        <div className="stat-hero__spark">
          <Sparkline values={sparkline} stroke={sparkStroke} width={100} height={40} />
        </div>
      )}
    </div>
  );
}
