export function PeriodSelect({ value, onChange, options = [30, 60, 180, 720, 1440], className = "period-select" }) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((m) => (
        <option key={m} value={m}>{m < 60 ? `${m}m` : `${m / 60}h`}</option>
      ))}
    </select>
  );
}
