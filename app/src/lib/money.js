// One way to show money, with the currency that belongs to the amount. Amounts in different
// currencies are never added together: totalsByCurrency keeps them apart.
const cache = {};
const locales = { INR: 'en-IN' };

export function formatMoney(amount, currency = 'INR') {
  if (amount == null || Number.isNaN(Number(amount))) return '';
  const code = String(currency || 'INR').toUpperCase();
  const n = Number(amount);
  const whole = Number.isInteger(n);
  const key = `${code}:${whole}`;
  try {
    cache[key] ||= new Intl.NumberFormat(locales[code] || 'en', { style: 'currency', currency: code, minimumFractionDigits: whole ? 0 : undefined });
    return cache[key].format(n);
  } catch (e) {
    return `${code} ${n.toLocaleString('en')}`;
  }
}

// [{ currency: 'INR', amount: 500 }, ...] -> { INR: 500, ... }
export function totalsByCurrency(parts) {
  return parts.reduce((acc, p) => { if (p.amount != null) acc[p.currency] = (acc[p.currency] || 0) + Number(p.amount); return acc; }, {});
}

export function formatTotals(totals) {
  return Object.entries(totals).map(([c, a]) => formatMoney(a, c)).join(' + ');
}
