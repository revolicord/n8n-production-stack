import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import type { ActiveByStage, FunnelView } from './funnel';
import type { MonthlySeries } from './timeseries';
import type { Velocity } from './velocity';

export type InsightType = 'warning' | 'ok' | 'info' | 'ai';

export type Insight = {
  type: InsightType;
  iconName: string;
  title: string;
  body: string;
  actionHref?: string;
  actionLabel?: string;
};

export function buildInsights(input: {
  current: FunnelView;
  yearSeries: MonthlySeries | null;
  velocity: Velocity;
  active: ActiveByStage;
  staleBCount?: number;
}): Insight[] {
  const insights: Insight[] = [];

  // Rule 1: cuello de botella B → C
  const histBToC = input.yearSeries?.avgRatios.bToC ?? null;
  const curBToC = input.current.ratios.bToC;
  if (histBToC != null && curBToC != null && curBToC < histBToC * 0.9) {
    const delta = Math.round((histBToC - curBToC) * 100);
    insights.push({
      type: 'warning',
      iconName: 'IconAlertTriangle',
      title: 'Cuello de botella en B→C',
      body: `Tu conversión a Calendly cayó ${delta}% vs el promedio anual`,
      actionHref: '/admin',
      actionLabel: 'Ver follow-ups de Fase B →',
    });
  }

  // Rule 2: MSR alto
  const histMsr = input.yearSeries?.avgRatios.msr ?? null;
  const curMsr = input.current.ratios.msr;
  if (histMsr != null && curMsr != null && curMsr > histMsr * 1.05) {
    const delta = Math.round((curMsr - histMsr) * 100);
    insights.push({
      type: 'ok',
      iconName: 'IconTrendingUp',
      title: 'MSR está alto',
      body: `${Math.round(curMsr * 100)}% de Initiated están viendo tu contenido, ${delta}% sobre tu media`,
    });
  }

  // Rule 3: prospectos B estancados
  if ((input.staleBCount ?? 0) >= 10) {
    insights.push({
      type: 'ai',
      iconName: 'IconTarget',
      title: `${input.active.b} prospectos en B esperando respuesta`,
      body: `${input.staleBCount} llevan más de 48h sin avanzar, podrían enfriarse`,
      actionHref: '/prospects?stage=B&stale=true',
      actionLabel: 'Ver lista →',
    });
  }

  // Rule 4: velocidad mejorando
  if (input.velocity.aToD != null && input.velocity.aToD < 7.0) {
    insights.push({
      type: 'info',
      iconName: 'IconClockHour4',
      title: 'Velocidad mejorando',
      body: `A → D promedio: ${input.velocity.aToD.toFixed(1)} días, mejor que tu media de 7.8 días`,
    });
  }

  return insights;
}

export async function getBestDayOfWeek(args: {
  tenantId: string;
  startOfYear: Date;
  now: Date;
}): Promise<{ dow: number; multiplier: number } | null> {
  const r = await db.execute(sql`
    WITH per_dow AS (
      SELECT
        EXTRACT(DOW FROM s.first_seen_at)::int AS dow,
        COUNT(*) FILTER (WHERE st.to_stage = 'B')::float / NULLIF(COUNT(*), 0) AS conv_rate
      FROM api.subscribers s
      LEFT JOIN api.stage_transitions st
        ON st.subscriber_id = s.id AND st.to_stage = 'B' AND st.tenant_id = s.tenant_id
      WHERE s.tenant_id = ${args.tenantId}
        AND s.first_seen_at >= ${args.startOfYear.toISOString()}::timestamptz
        AND s.first_seen_at < ${args.now.toISOString()}::timestamptz
      GROUP BY dow
    ),
    avg_rate AS (SELECT AVG(conv_rate) AS r FROM per_dow)
    SELECT dow, conv_rate / NULLIF((SELECT r FROM avg_rate), 0) AS multiplier
    FROM per_dow
    ORDER BY multiplier DESC NULLS LAST
    LIMIT 1
  `);
  type Row = { dow: number; multiplier: number };
  const top = r[0] as Row | undefined;
  if (!top || top.multiplier < 1.2) return null;
  return top;
}
