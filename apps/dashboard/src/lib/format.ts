export function fmtNumber(n: number): string {
  return new Intl.NumberFormat('es-ES').format(n);
}

export function fmtPct(p: number | null, decimals = 0): string {
  if (p == null) return '—';
  return `${(p * 100).toFixed(decimals)}%`;
}

export function fmtDays(d: number | null): string {
  if (d == null) return '—';
  return `${d.toFixed(1)} días`;
}

export function fmtDelta(d: number): string {
  const sign = d > 0 ? '+' : '';
  return `${sign}${d}%`;
}

export const MONTH_LABELS_ES = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

export const MONTH_LABELS_LONG_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
