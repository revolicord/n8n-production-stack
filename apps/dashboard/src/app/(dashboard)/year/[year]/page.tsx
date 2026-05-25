import { FunnelBars } from '@/components/funnel/FunnelBars';
import { InsightList } from '@/components/insights/InsightList';
import { KpiCard } from '@/components/kpi/KpiCard';
import { MonthlyMatrix } from '@/components/matrix/MonthlyMatrix';
import { PeriodSwitcher } from '@/components/shell/PeriodSwitcher';
import { TopBar } from '@/components/shell/TopBar';
import { getPeriodRange } from '@/lib/metrics/_helpers';
import { getActiveByStage, getFunnelCounts, getFunnelView } from '@/lib/metrics/funnel';
import { buildInsights } from '@/lib/metrics/insights';
import { getMonthlySeries } from '@/lib/metrics/timeseries';
import { getVelocity } from '@/lib/metrics/velocity';
import { getActiveTenant } from '@/lib/tenant';
import { redirect } from 'next/navigation';

export const revalidate = 30;

export default async function YearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: yearStr } = await params;
  const year = Number.parseInt(yearStr, 10);
  if (Number.isNaN(year) || year < 2020 || year > 2099) {
    redirect(`/year/${new Date().getUTCFullYear()}`);
  }

  const tenant = await getActiveTenant();
  const range = getPeriodRange(year);

  const [series, funnel, prevYear, velocity, active] = await Promise.all([
    getMonthlySeries({ tenantId: tenant.id, year }),
    getFunnelView({ tenantId: tenant.id, start: range.start, end: range.end }),
    getFunnelCounts({ tenantId: tenant.id, ...getPeriodRange(year - 1) }),
    getVelocity({ tenantId: tenant.id, start: range.start, end: range.end }),
    getActiveByStage({ tenantId: tenant.id }),
  ]);

  function delta(curr: number, prev: number): { value: number; suffix: string } {
    if (prev === 0) return { value: 0, suffix: `vs ${year - 1}` };
    return {
      value: Math.round(((curr - prev) / prev) * 100),
      suffix: `vs ${year - 1}`,
    };
  }

  const insights = buildInsights({ current: funnel, yearSeries: series, velocity, active });

  return (
    <div className="px-6 py-5">
      <TopBar
        title={`DM Sorcery Tracker · ${year}`}
        badge={{ label: 'en vivo' }}
        right={
          <PeriodSwitcher
            options={[
              { label: String(year - 2), href: `/year/${year - 2}` },
              { label: String(year - 1), href: `/year/${year - 1}` },
              { label: String(year), href: `/year/${year}`, active: true },
            ]}
          />
        }
      />

      <div className="grid grid-cols-5 gap-2.5 mb-5">
        <KpiCard
          label="Initiated"
          letter="A"
          value={series.totals.a}
          delta={delta(series.totals.a, prevYear.a)}
          sparkline={series.months.map((m) => m.counts.a)}
        />
        <KpiCard
          label="Media seen"
          letter="MS"
          value={series.totals.ms}
          delta={delta(series.totals.ms, prevYear.ms)}
          sparkline={series.months.map((m) => m.counts.ms)}
        />
        <KpiCard
          label="Engaged"
          letter="B"
          value={series.totals.b}
          delta={delta(series.totals.b, prevYear.b)}
          sparkline={series.months.map((m) => m.counts.b)}
        />
        <KpiCard
          label="Calendly"
          letter="C"
          value={series.totals.c}
          delta={delta(series.totals.c, prevYear.c)}
          sparkline={series.months.map((m) => m.counts.c)}
        />
        <KpiCard
          label="Booked"
          letter="D"
          value={series.totals.d}
          delta={delta(series.totals.d, prevYear.d)}
          sparkline={series.months.map((m) => m.counts.d)}
        />
      </div>

      <h3 className="text-[13px] font-medium text-qc-textBody mb-2.5">
        Matriz mensual · click en un mes para ver el detalle
      </h3>
      <div className="mb-5">
        <MonthlyMatrix series={series} />
      </div>

      <h3 className="text-[13px] font-medium text-qc-textBody mb-2.5">
        Funnel del año · todas las etapas
      </h3>
      <div className="grid gap-4" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <div className="bg-qc-surface border border-qc-border rounded-lg p-4">
          <FunnelBars view={funnel} />
        </div>
        <InsightList insights={insights.slice(0, 3)} />
      </div>
    </div>
  );
}
