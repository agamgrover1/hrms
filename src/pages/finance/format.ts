export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function money(n: number, currency = '₹') {
  return currency + Math.round(n || 0).toLocaleString('en-IN');
}

export function moneyShort(n: number, currency = '₹') {
  const abs = Math.abs(n || 0);
  if (abs >= 1e7) return currency + (n / 1e7).toFixed(2) + 'Cr';
  if (abs >= 1e5) return currency + (n / 1e5).toFixed(2) + 'L';
  return money(n, currency);
}

export function pct(n: number | null | undefined, digits = 1) {
  if (n == null || !isFinite(n)) return '—';
  return (n * 100).toFixed(digits) + '%';
}

export function hrs(n: number) {
  return (Math.round((n || 0) * 10) / 10) + 'h';
}

export function marginTone(v: number): string {
  if (v < 0) return 'text-danger';
  if (v >= 0.4) return 'text-success';
  if (v >= 0.15) return 'text-warning';
  return 'text-on-surface';
}
