const LAYER_COLORS = [
  "linear-gradient(135deg, #53389e 0%, #6d5cae 100%)",
  "linear-gradient(135deg, #6d5cae 0%, #8b7cc8 100%)",
  "linear-gradient(135deg, #f54e00 0%, #ff7a33 100%)",
  "linear-gradient(135deg, #ff7a33 0%, #ffb380 100%)",
  "linear-gradient(135deg, #15803d 0%, #22c55e 100%)",
];

/**
 * Classic funnel diagram — width shrinks per step for intuitive conversion view.
 */
export function FunnelShape({ steps, labels = {}, maxWidth = 100 }) {
  if (!steps?.length) return null;

  const max = steps[0]?.count || 1;

  return (
    <div className="funnel-shape">
      {steps.map((s, i) => {
        const pct = Math.max((s.count / max) * maxWidth, 42);
        const drop =
          i > 0 && s.drop_off_rate > 0
            ? `↓ ${(s.drop_off_rate * 100).toFixed(1)}%`
            : null;
        return (
          <div key={s.step} className="funnel-shape__row">
            <div
              className="funnel-shape__layer"
              style={{
                width: `${pct}%`,
                background: LAYER_COLORS[i % LAYER_COLORS.length],
              }}
            >
              <span className="funnel-shape__label">{labels[s.step] || s.step}</span>
              <span className="funnel-shape__value">{Number(s.count).toLocaleString()}</span>
            </div>
            {drop && <span className="funnel-shape__drop">{drop}</span>}
          </div>
        );
      })}
    </div>
  );
}
