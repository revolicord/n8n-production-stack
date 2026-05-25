import { FollowupGrid } from '@/components/followup/FollowupGrid';
import { FunnelBars } from '@/components/funnel/FunnelBars';
import { RatioRibbon } from '@/components/funnel/RatioRibbon';
import { MonthHeatmap } from '@/components/heatmap/MonthHeatmap';
import { InsightList } from '@/components/insights/InsightList';
import { KpiCard } from '@/components/kpi/KpiCard';
import { PredictionCard } from '@/components/prediction/PredictionCard';
import { PeriodSwitcher } from '@/components/shell/PeriodSwitcher';
import { TopBar } from '@/components/shell/TopBar';
import { VelocityCard } from '@/components/velocity/VelocityCard';
import { MONTH_LABELS_LONG_ES } from '@/lib/format';
import { getPeriodRange } from '@/lib/metrics/_helpers';
import { getFollowupGrid } from '@/lib/metrics/followups';
import { getActiveByStage, getFunnelCounts, getFunnelView } from '@/lib/metrics/funnel';
import { getMonthlyHeatmap } from '@/lib/metrics/heatmap';
import { buildInsights } from '@/lib/metrics/insights';
import { getMonthPrediction } from '@/lib/metrics/prediction';
import { getVelocity } from '@/lib/metrics/velocity';
import { getActiveTenant } from '@/lib/tenant';
import { redirect } from 'next/navigation';

export const revalidate = 30;

export default async function MonthPage({
  params,
}: {
  params: Promise<{ year: string; month: string }>;
}) {
  const { year: yearStr, month: monthStr } = await params;
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    redirect('/');
  }

  const tenant = await getActiveTenant();
  const range = getPeriodRange(year, month);

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const now = new Date();

  const [funnel, prevFunnel, velocity, heatmap, followups, prediction, active] = await Promise.all([
    getFunnelView({ tenantId: tenant.id, start: range.start, end: range.end }),
    getFunnelCounts({ tenantId: tenant.id, ...getPeriodRange(prevYear, prevMonth) }),
    getVelocity({ tenantId: tenant.id, start: range.start, end: range.end }),
    getMonthlyHeatmap({ tenantId: tenant.id, start: range.start, end: range.end }),
    getFollowupGrid({ tenantId: tenant.id, start: range.start, end: range.end }),
    getMonthPrediction({ tenantId: tenant.id, year, month, now }),
    getActiveByStage({ tenantId: tenant.id }),
  ]);

  const monthLabel = MONTH_LABELS_LONG_ES[month - 1] ?? String(month);

  function delta(curr: number, prev: number): { value: number; suffix: string } {
    if (prev === 0) return { value: 0, suffix: `vs ${monthLabel.slice(0, 3)} ant.` };
    return {
      value: Math.round(((curr - prev) / prev) * 100),
      suffix: `vs ${monthLabel.slice(0, 3)} ant.`,
    };
  }

  const insights = buildInsights({
    current: funnel,
    yearSeries: null,
    velocity,
    active,
  });

  const prevMLabel = (MONTH_LABELS_LONG_ES[prevMonth - 1] ?? String(prevMonth)).slice(0, 3);
  const switcherOptions = [
    { label: prevMLabel, href: `/month/${prevYear}/${String(prevMonth).padStart(2, '0')}` },
    {
      label: monthLabel.slice(0, 3),
      href: `/month/${year}/${String(month).padStart(2, '0')}`,
      active: true,
    },
  ];
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMLabel = (MONTH_LABELS_LONG_ES[nextMonth - 1] ?? String(nextMonth)).slice(0, 3);
  if (
    nextYear < now.getUTCFullYear() ||
    (nextYear === now.getUTCFullYear() && nextMonth <= now.getUTCMonth() + 1)
  ) {
    switcherOptions.push({
      label: nextMLabel,
      href: `/month/${nextYear}/${String(nextMonth).padStart(2, '0')}`,
    });
  }

  return (
    <div className="px-6 py-5">
      <TopBar
        title={`DM Sorcery Tracker · ${monthLabel} ${year}`}
        badge={{ label: 'en vivo' }}
        right={
          <div className="flex items-center gap-2">
            <a
              href={`/year/${year}`}
              className="text-[11px] text-qc-textMuted hover:text-white transition-colors"
            >
              ← Vista anual
            </a>
            <PeriodSwitcher options={switcherOptions} />
          </div>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-5 gap-2.5 mb-5">
        <KpiCard
          label="Initiated"
          letter="A"
          value={funnel.counts.a}
          delta={delta(funnel.counts.a, prevFunnel.a)}
        />
        <KpiCard
          label="Media seen"
          letter="MS"
          value={funnel.counts.ms}
          delta={delta(funnel.counts.ms, prevFunnel.ms)}
        />
        <KpiCard
          label="Engaged"
          letter="B"
          value={funnel.counts.b}
          delta={delta(funnel.counts.b, prevFunnel.b)}
        />
        <KpiCard
          label="Calendly"
          letter="C"
          value={funnel.counts.c}
          delta={delta(funnel.counts.c, prevFunnel.c)}
        />
        <KpiCard
          label="Booked"
          letter="D"
          value={funnel.counts.d}
          delta={delta(funnel.counts.d, prevFunnel.d)}
        />
      </div>

      {/* Ratio ribbon */}
      <div className="mb-5">
        <RatioRibbon ratios={funnel.ratios} />
      </div>

      {/* Funnel + right column */}
      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <div>
          <h3 className="text-[13px] font-medium text-qc-textBody mb-2.5">
            Funnel del mes · {monthLabel} {year}
          </h3>
          <div className="bg-qc-surface border border-qc-border rounded-lg p-4">
            <FunnelBars view={funnel} />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <VelocityCard velocity={velocity} />
          <PredictionCard prediction={prediction} monthLabel={monthLabel} />
          <InsightList insights={insights.slice(0, 2)} />
        </div>
      </div>

      {/* Heatmap + Followup row */}
      <div className="grid grid-cols-2 gap-4">
        <MonthHeatmap heatmap={heatmap} year={year} month={month} />
        <FollowupGrid followups={followups} />
      </div>
    </div>
  );
}
