import { getPeriodRange } from './_helpers';
import { safeDivide } from './_helpers';
import { getFunnelCounts } from './funnel';

export type Prediction = {
  projected: number;
  current: number;
  rate: number;
  daysElapsed: number;
  daysInMonth: number;
  comparison: { vsLastMonth: number; pct: number | null };
};

export async function getMonthPrediction(args: {
  tenantId: string;
  year: number;
  month: number;
  now: Date;
}): Promise<Prediction> {
  const { start, end } = getPeriodRange(args.year, args.month);
  const current = (await getFunnelCounts({ tenantId: args.tenantId, start, end })).d;

  const daysInMonth = new Date(Date.UTC(args.year, args.month, 0)).getUTCDate();
  const daysElapsed = Math.min(args.now.getUTCDate(), daysInMonth);
  const rate = daysElapsed > 0 ? current / daysElapsed : 0;
  const projected = Math.round(rate * daysInMonth);

  const prevMonth = args.month === 1 ? 12 : args.month - 1;
  const prevYear = args.month === 1 ? args.year - 1 : args.year;
  const prev = (
    await getFunnelCounts({
      tenantId: args.tenantId,
      ...getPeriodRange(prevYear, prevMonth),
    })
  ).d;

  return {
    projected,
    current,
    rate,
    daysElapsed,
    daysInMonth,
    comparison: {
      vsLastMonth: projected - prev,
      pct: safeDivide(projected - prev, prev),
    },
  };
}
