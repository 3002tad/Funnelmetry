import { formatMoneyParts } from "../lib/format.js";

/** Parse formatted money string from formatMoney() (incl. NBSP before ₫). */
export function parseMoneyDisplay(value) {
  if (value == null) return null;
  if (typeof value === "number" && !Number.isNaN(value)) {
    return formatMoneyParts(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/[₫đ]/u.test(trimmed)) return null;
  const currency = trimmed.match(/[₫đ]/u)?.[0] || "₫";
  const amount = trimmed.replace(/[\s\u00A0]*[₫đ]\s*$/u, "").trim();
  if (!amount) return null;
  return { amount, currency };
}

/** Amount + currency on one line; currency never wraps alone. */
export function MoneyText({ value, className = "" }) {
  const parts = parseMoneyDisplay(value);
  if (!parts) return className ? <span className={className}>{value}</span> : value;

  return (
    <span className={`money-value${className ? ` ${className}` : ""}`} title={typeof value === "string" ? value : undefined}>
      <span className="money-value__amount">{parts.amount}</span>
      <span className="money-value__currency">{parts.currency}</span>
    </span>
  );
}

export function renderStatValue(value, valueClassName = "") {
  const parts = parseMoneyDisplay(value);
  if (!parts) {
    return <span className={valueClassName || undefined}>{value}</span>;
  }
  return <MoneyText value={value} className={valueClassName} />;
}

export function ActionCardValue({ value }) {
  return (
    <strong className="action-card__value">
      {parseMoneyDisplay(value) ? <MoneyText value={value} /> : value}
    </strong>
  );
}
