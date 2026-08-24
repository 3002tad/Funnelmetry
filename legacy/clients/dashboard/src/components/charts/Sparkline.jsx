/**
 * Mini trend line for KPI cards — no axes, BI-style.
 */
export function Sparkline({ values = [], width = 120, height = 36, stroke = "#53389e", fill = "rgba(83, 56, 158, 0.12)" }) {
  const nums = values.map(Number).filter((n) => !Number.isNaN(n));
  if (nums.length < 2) return null;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = nums.map((v, i) => {
    const x = pad + (i / (nums.length - 1)) * innerW;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(" L ")}`;
  const areaPath = `${linePath} L ${pad + innerW},${pad + innerH} L ${pad},${pad + innerH} Z`;

  const last = nums[nums.length - 1];
  const prev = nums[nums.length - 2];
  const up = last >= prev;

  return (
    <svg
      className={`sparkline${up ? " sparkline--up" : " sparkline--down"}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <path d={areaPath} fill={fill} stroke="none" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={pad + innerW}
        cy={pad + innerH - ((last - min) / range) * innerH}
        r="3"
        fill={stroke}
        stroke="#fff"
        strokeWidth="1.5"
      />
    </svg>
  );
}
