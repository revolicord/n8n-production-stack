import { Card } from '@/components/primitives/Card';
import { SectionTitle } from '@/components/primitives/SectionTitle';
import { PeriodSwitcher } from '@/components/shell/PeriodSwitcher';
import { TopBar } from '@/components/shell/TopBar';
import { MONTH_LABELS_ES, fmtDays, fmtPct } from '@/lib/format';
import { getPeriodRange } from '@/lib/metrics/_helpers';
import { getMonthlySeries } from '@/lib/metrics/timeseries';
import { getTopFastest, getVelocity } from '@/lib/metrics/velocity';
import { getActiveTenant } from '@/lib/tenant';
import { IconChartBar, IconTrophy } from '@tabler/icons-react';

export const revalidate = 30;

const STAGE_COLORS: Record<string, string> = {
  A: '#6ee7f7',
  MS: '#38bdf8',
  B: '#22d3ee',
  C: '#2dd4bf',
  D: '#34d399',
};

function MonthlyConversionChart({
  series,
}: {
  series: Awaited<ReturnType<typeof getMonthlySeries>>;
}) {
  const W = 560;
  const H = 140;
  const PAD = { top: 12, right: 12, bottom: 28, left: 32 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const maxVal = Math.max(...series.months.map((m) => m.counts.a), 1);

  const barW = Math.floor(chartW / 12) - 2;

  const stageKeys: Array<{ key: keyof (typeof series.months)[0]['counts']; color: string }> = [
    { key: 'a', color: STAGE_COLORS.A ?? '#6ee7f7' },
    { key: 'ms', color: STAGE_COLORS.MS ?? '#38bdf8' },
    { key: 'b', color: STAGE_COLORS.B ?? '#22d3ee' },
    { key: 'c', color: STAGE_COLORS.C ?? '#2dd4bf' },
    { key: 'd', color: STAGE_COLORS.D ?? '#34d399' },
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      <title>Volumen mensual por etapa</title>
      {/* Y axis ticks */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const y = PAD.top + chartH * (1 - frac);
        const val = Math.round(frac * maxVal);
        return (
          <g key={frac}>
            <line
              x1={PAD.left}
              x2={PAD.left + chartW}
              y1={y}
              y2={y}
              stroke="#2a2a2a"
              strokeWidth={1}
            />
            <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize={8} fill="#555">
              {val}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {series.months.map((m, i) => {
        const slotX = PAD.left + i * (chartW / 12);
        const centerX = slotX + chartW / 12 / 2;

        return (
          <g key={m.month}>
            {stageKeys.map(({ key, color }, ki) => {
              const val = m.counts[key];
              const h = (val / maxVal) * chartH;
              const x = centerX - (barW * stageKeys.length) / 2 + ki * barW;
              return (
                <rect
                  key={key}
                  x={x}
                  y={PAD.top + chartH - h}
                  width={barW - 1}
                  height={h}
                  fill={color}
                  fillOpacity={0.85}
                  rx={1}
                />
              );
            })}
            <text x={centerX} y={H - 4} textAnchor="middle" fontSize={8} fill="#555">
              {MONTH_LABELS_ES[m.month - 1]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ConversionRatioLine({
  series,
}: {
  series: Awaited<ReturnType<typeof getMonthlySeries>>;
}) {
  const W = 560;
  const H = 100;
  const PAD = { top: 12, right: 12, bottom: 24, left: 32 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const points = series.months.map((m, i) => {
    const ratio = m.counts.a > 0 ? m.counts.d / m.counts.a : 0;
    const x = PAD.left + (i / 11) * chartW;
    const y = PAD.top + chartH * (1 - ratio);
    return { x, y, ratio, month: m.month };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      <title>Conversión A→D por mes</title>
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const y = PAD.top + chartH * (1 - frac);
        return (
          <g key={frac}>
            <line
              x1={PAD.left}
              x2={PAD.left + chartW}
              y1={y}
              y2={y}
              stroke="#1e1e1e"
              strokeWidth={1}
            />
            <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize={8} fill="#444">
              {(frac * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
      <path d={pathD} fill="none" stroke="#34d399" strokeWidth={1.5} />
      {points.map((p) => (
        <circle key={p.month} cx={p.x} cy={p.y} r={2.5} fill="#34d399" />
      ))}
      {points.map((p) => (
        <text key={`lbl-${p.month}`} x={p.x} y={H - 4} textAnchor="middle" fontSize={8} fill="#555">
          {MONTH_LABELS_ES[p.month - 1]}
        </text>
      ))}
    </svg>
  );
}

export default async function VelocityPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearStr } = await searchParams;
  const now = new Date();
  const year = yearStr ? Number.parseInt(yearStr, 10) : now.getUTCFullYear();

  const tenant = await getActiveTenant();
  const range = getPeriodRange(year);

  const [series, velocity, topFast] = await Promise.all([
    getMonthlySeries({ tenantId: tenant.id, year }),
    getVelocity({ tenantId: tenant.id, start: range.start, end: range.end }),
    getTopFastest({ tenantId: tenant.id, limit: 5 }),
  ]);

  const switcherOptions = [
    { label: String(year - 1), href: `/velocity?year=${year - 1}` },
    {
      label: String(year),
      href: `/velocity?year=${year}`,
      active: !yearStr || yearStr === String(year),
    },
  ];

  const ROWS: Array<{ label: string; key: keyof typeof velocity }> = [
    { label: 'A → MS', key: 'aToMs' },
    { label: 'MS → B', key: 'msToB' },
    { label: 'B → C', key: 'bToC' },
    { label: 'C → D', key: 'cToD' },
  ];

  const aToD_pct = series.totals.a > 0 ? series.totals.d / series.totals.a : null;

  return (
    <div className="px-6 py-5">
      <TopBar
        title={`Velocidad del funnel · ${year}`}
        badge={{ label: 'en vivo' }}
        right={<PeriodSwitcher options={switcherOptions} />}
      />

      {/* Velocity stats */}
      <div className="grid grid-cols-5 gap-2.5 mb-5">
        {ROWS.map((r) => (
          <div
            key={r.key}
            className="bg-qc-surface border border-qc-border rounded-lg p-3 text-center"
          >
            <div className="text-[10px] text-qc-textMuted mb-1">{r.label}</div>
            <div className="text-[22px] font-medium text-qc-teal500 leading-none">
              {fmtDays(velocity[r.key])}
            </div>
          </div>
        ))}
        <div className="bg-qc-surface border border-qc-border rounded-lg p-3 text-center">
          <div className="text-[10px] text-qc-textMuted mb-1">A → D total</div>
          <div className="text-[22px] font-medium text-white leading-none">
            {fmtDays(velocity.aToD)}
          </div>
        </div>
      </div>

      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        {/* Monthly volume chart */}
        <Card>
          <SectionTitle icon={IconChartBar}>Volumen mensual por etapa · {year}</SectionTitle>
          <div className="mt-3 flex gap-3 flex-wrap mb-2">
            {[
              { letter: 'A', color: STAGE_COLORS.A },
              { letter: 'MS', color: STAGE_COLORS.MS },
              { letter: 'B', color: STAGE_COLORS.B },
              { letter: 'C', color: STAGE_COLORS.C },
              { letter: 'D', color: STAGE_COLORS.D },
            ].map(({ letter, color }) => (
              <span key={letter} className="flex items-center gap-1 text-[10px] text-qc-textMuted">
                <span
                  className="w-2 h-2 rounded-sm inline-block"
                  style={{ backgroundColor: color }}
                />
                {letter}
              </span>
            ))}
          </div>
          <MonthlyConversionChart series={series} />
        </Card>

        {/* A→D ratio line */}
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle icon={IconChartBar}>Conversión A → D por mes</SectionTitle>
            <div className="text-[11px] text-qc-textMuted mb-1">
              Promedio anual:{' '}
              <span className="text-qc-teal500 font-medium">{fmtPct(aToD_pct)}</span>
            </div>
            <ConversionRatioLine series={series} />
          </Card>

          {/* Top fastest */}
          <Card>
            <SectionTitle icon={IconTrophy}>Top 5 conversiones más rápidas</SectionTitle>
            {topFast.length === 0 ? (
              <div className="text-[11px] text-qc-textMuted py-3 text-center">Sin datos aún</div>
            ) : (
              <div className="mt-2 space-y-1.5">
                {topFast.map((lead, i) => (
                  <div
                    key={`${lead.igUsername ?? 'anon'}-${i}`}
                    className="flex items-center justify-between text-[11.5px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-qc-textMuted w-4 text-right">{i + 1}.</span>
                      <span className="text-qc-textBody">{lead.igUsername ?? 'Anónimo'}</span>
                    </div>
                    <span className="text-qc-teal500 font-medium tabular-nums">
                      {fmtDays(lead.daysToD)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
