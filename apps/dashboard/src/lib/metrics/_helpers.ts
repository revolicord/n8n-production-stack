export function safeDivide(num: number, denom: number): number | null {
  if (!denom || denom === 0) return null;
  return num / denom;
}

export function getPeriodRange(year: number, month?: number): { start: Date; end: Date } {
  if (month != null) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return { start, end };
  }
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}
