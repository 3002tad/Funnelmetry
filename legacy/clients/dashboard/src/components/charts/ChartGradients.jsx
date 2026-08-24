/** SVG linearGradient defs for area / bar fills */
export function ChartGradients({ items }) {
  return (
    <defs>
      {items.map(({ id, color, topOpacity = 0.38, bottomOpacity = 0.02, horizontal = false }) => (
        <linearGradient
          key={id}
          id={id}
          x1="0"
          y1="0"
          x2={horizontal ? "1" : "0"}
          y2={horizontal ? "0" : "1"}
        >
          <stop offset="0%" stopColor={color} stopOpacity={topOpacity} />
          <stop offset="92%" stopColor={color} stopOpacity={bottomOpacity} />
        </linearGradient>
      ))}
      {items.map(({ id, color, horizontal = false }) => (
        <linearGradient
          key={`${id}-bar`}
          id={`${id}Bar`}
          x1="0"
          y1="0"
          x2={horizontal ? "1" : "0"}
          y2={horizontal ? "0" : "1"}
        >
          <stop offset="0%" stopColor={color} stopOpacity={0.95} />
          <stop offset="100%" stopColor={color} stopOpacity={0.72} />
        </linearGradient>
      ))}
    </defs>
  );
}
