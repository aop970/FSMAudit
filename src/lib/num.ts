export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function withinCent(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.01;
}

export function withinHour(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.01;
}

export function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[$,%\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export function toStr(v: unknown): string {
  if (v == null) return '';
  return String(v)
    .trim()
    .replace(/[ ​]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toPct(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v > 1 ? v / 100 : v;
  const s = String(v).replace(/\s/g, '');
  if (s.endsWith('%')) return parseFloat(s.slice(0, -1)) / 100;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
