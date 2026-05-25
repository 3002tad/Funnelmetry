const DEFAULT = [
  { value: 30, label: "30p" },
  { value: 60, label: "1h" },
  { value: 180, label: "3h" },
  { value: 720, label: "12h" },
  { value: 1440, label: "24h" },
];

export function PeriodPills({ value, onChange, options = DEFAULT }) {
  return (
    <div className="period-pills" role="group" aria-label="Khoảng thời gian">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`period-pill${value === opt.value ? " active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
