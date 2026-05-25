import { PeriodSwitcher } from '@/components/shell/PeriodSwitcher';
import { TopBar } from '@/components/shell/TopBar';
import { fmtPct } from '@/lib/format';
import { getPeriodRange } from '@/lib/metrics/_helpers';
import { type CohortRow, getCohorts } from '@/lib/metrics/cohorts';
import { getActiveTenant } from '@/lib/tenant';

export const revalidate = 30;

function pct(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

function heatColor(ratio: number | null): string {
  if (ratio == null) return 'transparent';
  if (ratio === 0) return '#111';
  if (ratio < 0.1) return '#0d2d1f';
  if (ratio < 0.25) return '#14532d';
  if (ratio < 0.5) return '#166534';
  if (ratio < 0.75) return '#16a34a';
  return '#22c55e';
}

function CohortCell({ ratio }: { ratio: number | null }) {
  const bg = heatColor(ratio);
  const textColor = ratio != null && ratio >= 0.1 ? '#fff' : '#666';
  return (
    <td
      className="px-2 py-1.5 text-center text-[10.5px] font-medium tabular-nums"
      style={{ backgroundColor: bg, color: textColor }}
    >
      {ratio == null ? '—' : fmtPct(ratio)}
    </td>
  );
}

function CohortTable({ rows }: { rows: CohortRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-qc-border">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-qc-surface2 text-qc-textMuted">
            <th className="px-3 py-2 text-left font-medium">Semana</th>
            <th className="px-2 py-2 text-center font-medium">Total A</th>
            <th className="px-2 py-2 text-center font-medium">→ MS</th>
            <th className="px-2 py-2 text-center font-medium">→ B</th>
            <th className="px-2 py-2 text-center font-medium">→ C</th>
            <th className="px-2 py-2 text-center font-medium">→ D</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.cohortWeek}
              className="border-t border-qc-border hover:bg-qc-surface2/40 transition-colors"
            >
              <td className="px-3 py-1.5 text-qc-textBody whitespace-nowrap">{row.cohortWeek}</td>
              <td className="px-2 py-1.5 text-center text-white font-medium">{row.total}</td>
              <CohortCell ratio={pct(row.reachedMs, row.total)} />
              <CohortCell ratio={pct(row.reachedB, row.total)} />
              <CohortCell ratio={pct(row.reachedC, row.total)} />
              <CohortCell ratio={pct(row.reachedD, row.total)} />
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-qc-textMuted">
                Sin datos en este período
              </td>
            </tr>
          )}
        </tbody>
        {rows.length > 0 &&
          (() => {
            const totals = rows.reduce(
              (acc, r) => ({
                total: acc.total + r.total,
                ms: acc.ms + r.reachedMs,
                b: acc.b + r.reachedB,
                c: acc.c + r.reachedC,
                d: acc.d + r.reachedD,
              }),
              { total: 0, ms: 0, b: 0, c: 0, d: 0 },
            );
            return (
              <tfoot>
                <tr className="border-t-2 border-qc-border bg-qc-surface2">
                  <td className="px-3 py-2 text-qc-textMuted font-medium text-[10px] uppercase tracking-wide">
                    Total
                  </td>
                  <td className="px-2 py-2 text-center text-white font-medium">{totals.total}</td>
                  <CohortCell ratio={pct(totals.ms, totals.total)} />
                  <CohortCell ratio={pct(totals.b, totals.total)} />
                  <CohortCell ratio={pct(totals.c, totals.total)} />
                  <CohortCell ratio={pct(totals.d, totals.total)} />
                </tr>
              </tfoot>
            );
          })()}
      </table>
    </div>
  );
}

export default async function CohortsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearStr } = await searchParams;
  const now = new Date();
  const year = yearStr ? Number.parseInt(yearStr, 10) : now.getUTCFullYear();

  const tenant = await getActiveTenant();
  const range = getPeriodRange(year);
  const cohorts = await getCohorts({ tenantId: tenant.id, start: range.start, end: range.end });

  const switcherOptions = [
    { label: String(year - 1), href: `/cohorts?year=${year - 1}` },
    {
      label: String(year),
      href: `/cohorts?year=${year}`,
      active: !yearStr || yearStr === String(year),
    },
  ];

  return (
    <div className="px-6 py-5">
      <TopBar
        title={`Cohortes semanales · ${year}`}
        badge={{ label: 'en vivo' }}
        right={<PeriodSwitcher options={switcherOptions} />}
      />

      <div className="mb-3 flex items-center gap-4 text-[10.5px] text-qc-textMuted">
        <span>Color indica % conversión desde A:</span>
        {[
          { label: '0%', bg: '#111' },
          { label: '<10%', bg: '#0d2d1f' },
          { label: '<25%', bg: '#14532d' },
          { label: '<50%', bg: '#166534' },
          { label: '<75%', bg: '#16a34a' },
          { label: '≥75%', bg: '#22c55e' },
        ].map(({ label, bg }) => (
          <span key={label} className="flex items-center gap-1">
            <span
              className="w-3 h-3 rounded-sm inline-block border border-qc-border"
              style={{ backgroundColor: bg }}
            />
            {label}
          </span>
        ))}
      </div>

      <CohortTable rows={cohorts} />

      <div className="mt-3 text-[10px] text-qc-textMuted">
        Cada fila es una semana de entrada (primera vez que el subscriber apareció). Los % muestran
        qué porción de esa cohorte alcanzó cada etapa del funnel.
      </div>
    </div>
  );
}
