import { ActiveByStageGrid } from '@/components/funnel/ActiveByStageGrid';
import { FunnelBars } from '@/components/funnel/FunnelBars';
import { RatioRibbon } from '@/components/funnel/RatioRibbon';
import { InsightList } from '@/components/insights/InsightList';
import { Card } from '@/components/primitives/Card';
import { SectionTitle } from '@/components/primitives/SectionTitle';
import { PeriodSwitcher } from '@/components/shell/PeriodSwitcher';
import { TopBar } from '@/components/shell/TopBar';
import { VelocityCard } from '@/components/velocity/VelocityCard';
import { getPeriodRange } from '@/lib/metrics/_helpers';
import { getActiveByStage, getFunnelView } from '@/lib/metrics/funnel';
import { buildInsights, getBestDayOfWeek } from '@/lib/metrics/insights';
import { getMonthlySeries } from '@/lib/metrics/timeseries';
import { getVelocity } from '@/lib/metrics/velocity';
import { getActiveTenant } from '@/lib/tenant';
import { IconChartBar } from '@tabler/icons-react';

export const revalidate = 30;

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  let year = currentYear;
  let month: number | null = null;

  if (period === 'month') {
    year = currentYear;
    month = currentMonth;
  } else if (period?.match(/^\d{4}-\d{2}$/)) {
    const [y, m] = period.split('-').map(Number);
    year = y ?? currentYear;
    month = m ?? currentMonth;
  }

  const range = month != null ? getPeriodRange(year, month) : getPeriodRange(year);

  const tenant = await getActiveTenant();

  const [funnel, active, velocity, series] = await Promise.all([
    getFunnelView({ tenantId: tenant.id, start: range.start, end: range.end }),
    getActiveByStage({ tenantId: tenant.id }),
    getVelocity({ tenantId: tenant.id, start: range.start, end: range.end }),
    getMonthlySeries({ tenantId: tenant.id, year }),
  ]);

  const startOfYear = getPeriodRange(year).start;
  const bestDay = await getBestDayOfWeek({
    tenantId: tenant.id,
    startOfYear,
    now,
  });

  const insights = buildInsights({ current: funnel, yearSeries: series, velocity, active });

  const DOW_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  const periodLabel = month != null ? `${String(month).padStart(2, '0')}/${year}` : String(year);

  const switcherOptions = [
    { label: String(year), href: '/funnel', active: period == null },
    { label: 'Mes actual', href: '/funnel?period=month', active: period === 'month' },
  ];

  return (
    <div className="px-6 py-5">
      <TopBar
        title={`Funnel · ${periodLabel}`}
        badge={{ label: 'en vivo' }}
        right={<PeriodSwitcher options={switcherOptions} />}
      />

      {/* Active by stage */}
      <div className="mb-5">
        <ActiveByStageGrid data={active} />
      </div>

      {/* Ratio ribbon */}
      <div className="mb-5">
        <h3 className="text-[13px] font-medium text-qc-textBody mb-2.5">Ratios del período</h3>
        <RatioRibbon ratios={funnel.ratios} />
      </div>

      {/* Funnel + side */}
      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <div>
          <h3 className="text-[13px] font-medium text-qc-textBody mb-2.5">
            Funnel completo · {periodLabel}
          </h3>
          <div className="bg-qc-surface border border-qc-border rounded-lg p-4">
            <FunnelBars view={funnel} />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <VelocityCard velocity={velocity} />
          {bestDay && (
            <Card>
              <SectionTitle icon={IconChartBar}>Mejor día de la semana</SectionTitle>
              <div className="text-center py-3">
                <div className="text-[28px] font-medium text-qc-teal500 leading-none">
                  {DOW_NAMES[bestDay.dow]}
                </div>
                <div className="text-[11px] text-qc-textMuted mt-1.5">
                  {(bestDay.multiplier * 100 - 100).toFixed(0)}% más conversiones que el promedio
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Insights */}
      <InsightList insights={insights} />
    </div>
  );
}
