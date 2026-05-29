/** Non-breaking space keeps amount + currency on one line in narrow stat cards. */
const NBSP = "\u00A0";
const CURRENCY = "₫";

export function formatMoneyParts(v) {
  return {
    amount: Number(v || 0).toLocaleString("vi-VN"),
    currency: CURRENCY,
  };
}

export function formatMoney(v) {
  const { amount, currency } = formatMoneyParts(v);
  return `${amount}${NBSP}${currency}`;
}

export function formatMoneyShort(v) {
  const n = Number(v ?? 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M${NBSP}${CURRENCY}`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k${NBSP}${CURRENCY}`;
  return formatMoney(n);
}
