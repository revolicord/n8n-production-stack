# 05 — Especificación de queries (Drizzle + SQL)

> Este doc contiene **cada query que el panel necesita**, en Drizzle TypeScript. Copy-paste directo a `src/lib/metrics/`. Si una query no está aquí, abrir issue antes de improvisar.

## Convenciones

- Cada función vive en `apps/dashboard/src/lib/metrics/<area>.ts`.
- Cada función recibe `{ tenantId, periodStart, periodEnd }` como mínimo.
- Cada función devuelve un tipo explícito (no `any`).
- División por cero → `null`. **NUNCA** `0` falso. La UI pinta `null` como `—`.
- Todas las fechas son `Date` JavaScript convertidas a `timestamptz` Postgres.

## Helper compartido

```ts
// apps/dashboard/src/lib/metrics/_helpers.ts
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
```

---

## 1. Conteos de etapa (los 5 KPIs principales)

```ts
// apps/dashboard/src/lib/metrics/funnel.ts
import { db, subscribers, stageTransitions, leadContentSent } from '@/lib/db';
import { and, eq, gte, lt, sql, countDistinct } from 'drizzle-orm';

export type FunnelCounts = {
  a: number;
  ms: number;
  b: number;
  c: number;
  d: number;
};

export async function getFunnelCounts(args: {
  tenantId: string;
  start: Date;
  end: Date;
}): Promise<FunnelCounts> {
  const { tenantId, start, end } = args;

  // A — Initiated (subscribers created in period)
  const [aRow] = await db
    .select({ value: sql<number>`COUNT(*)::int` })
    .from(subscribers)
    .where(
      and(
        eq(subscribers.tenantId, tenantId),
        gte(subscribers.firstSeenAt, start),
        lt(subscribers.firstSeenAt, end),
      ),
    );

  // MS — Media Seen (content sent in period)
  const [msRow] = await db
    .select({ value: sql<number>`COUNT(DISTINCT subscriber_id)::int` })
    .from(leadContentSent)
    .where(
      and(
        eq(leadContentSent.tenantId, tenantId),
        gte(leadContentSent.sentAt, start),
        lt(leadContentSent.sentAt, end),
      ),
    );

  // B, C, D — via stage_transitions
  async function transitionsTo(toStage: 'B' | 'C' | 'D') {
    const [row] = await db
      .select({ value: sql<number>`COUNT(DISTINCT subscriber_id)::int` })
      .from(stageTransitions)
      .where(
        and(
          eq(stageTransitions.tenantId, tenantId),
          eq(stageTransitions.toStage, toStage),
          gte(stageTransitions.createdAt, start),
          lt(stageTransitions.createdAt, end),
        ),
      );
    return row?.value ?? 0;
  }

  const [b, c, d] = await Promise.all([
    transitionsTo('B'),
    transitionsTo('C'),
    transitionsTo('D'),
  ]);

  return {
    a: aRow?.value ?? 0,
    ms: msRow?.value ?? 0,
    b, c, d,
  };
}
```

## 2. Ratios derivados

```ts
// apps/dashboard/src/lib/metrics/funnel.ts (continúa)
import { safeDivide } from './_helpers';

export type FunnelRatios = {
  msr: number | null;     // MS/A
  prr: number | null;     // B/A
  csr: number | null;     // C/A
  abr: number | null;     // D/A
  aToMs: number | null;   // MS/A (= MSR)
  msToB: number | null;   // B/MS
  bToC: number | null;    // C/B
  cToD: number | null;    // D/C
};

export function ratiosFromCounts(c: FunnelCounts): FunnelRatios {
  return {
    msr:   safeDivide(c.ms, c.a),
    prr:   safeDivide(c.b,  c.a),
    csr:   safeDivide(c.c,  c.a),
    abr:   safeDivide(c.d,  c.a),
    aToMs: safeDivide(c.ms, c.a),
    msToB: safeDivide(c.b,  c.ms),
    bToC:  safeDivide(c.c,  c.b),
    cToD:  safeDivide(c.d,  c.c),
  };
}
```

## 3. Serie mensual del año (para la matriz y sparklines)

```ts
// apps/dashboard/src/lib/metrics/timeseries.ts
import { getFunnelCounts, ratiosFromCounts, type FunnelCounts, type FunnelRatios } from './funnel';

export type MonthlySeries = {
  year: number;
  months: Array<{
    month: number; // 1..12
    counts: FunnelCounts;
    ratios: FunnelRatios;
  }>;
  totals: FunnelCounts;
  avgRatios: FunnelRatios; // promedio de ratios mes-a-mes, no recomputado
};

export async function getMonthlySeries(args: {
  tenantId: string;
  year: number;
}): Promise<MonthlySeries> {
  const { tenantId, year } = args;

  const months = await Promise.all(
    Array.from({ length: 12 }, async (_, i) => {
      const month = i + 1;
      const start = new Date(Date.UTC(year, i, 1));
      const end = new Date(Date.UTC(year, i + 1, 1));
      const counts = await getFunnelCounts({ tenantId, start, end });
      const ratios = ratiosFromCounts(counts);
      return { month, counts, ratios };
    }),
  );

  const totals: FunnelCounts = months.reduce(
    (acc, m) => ({
      a:  acc.a  + m.counts.a,
      ms: acc.ms + m.counts.ms,
      b:  acc.b  + m.counts.b,
      c:  acc.c  + m.counts.c,
      d:  acc.d  + m.counts.d,
    }),
    { a: 0, ms: 0, b: 0, c: 0, d: 0 },
  );

  // Avg de ratios = promedio simple ignorando nulls
  function avgOf(getter: (r: FunnelRatios) => number | null): number | null {
    const valid = months.map((m) => getter(m.ratios)).filter((v): v is number => v != null);
    if (valid.length === 0) return null;
    return valid.reduce((s, v) => s + v, 0) / valid.length;
  }

  const avgRatios: FunnelRatios = {
    msr:   avgOf((r) => r.msr),
    prr:   avgOf((r) => r.prr),
    csr:   avgOf((r) => r.csr),
    abr:   avgOf((r) => r.abr),
    aToMs: avgOf((r) => r.aToMs),
    msToB: avgOf((r) => r.msToB),
    bToC:  avgOf((r) => r.bToC),
    cToD:  avgOf((r) => r.cToD),
  };

  return { year, months, totals, avgRatios };
}
```

> **Optimización**: la versión naive ejecuta 12 × 4 queries = 48 round-trips. Si la latencia molesta, reemplazar por 1 query agregada con `GROUP BY DATE_TRUNC('month', ...)`. Versión optimizada queda para el sprint si hace falta; **prioridad es claridad**.

## 4. Funnel del período (para la vista Funnel)

```ts
// apps/dashboard/src/lib/metrics/funnel.ts (continúa)
export type FunnelView = {
  counts: FunnelCounts;
  ratios: FunnelRatios;
  // drops por etapa (cantidad perdida y % perdido)
  drops: {
    aToMs: { lost: number; pct: number | null };
    msToB: { lost: number; pct: number | null };
    bToC:  { lost: number; pct: number | null };
    cToD:  { lost: number; pct: number | null };
  };
};

export async function getFunnelView(args: {
  tenantId: string;
  start: Date;
  end: Date;
}): Promise<FunnelView> {
  const counts = await getFunnelCounts(args);
  const ratios = ratiosFromCounts(counts);

  const drops = {
    aToMs: { lost: counts.a  - counts.ms, pct: ratios.aToMs == null ? null : 1 - ratios.aToMs },
    msToB: { lost: counts.ms - counts.b,  pct: ratios.msToB == null ? null : 1 - ratios.msToB },
    bToC:  { lost: counts.b  - counts.c,  pct: ratios.bToC  == null ? null : 1 - ratios.bToC  },
    cToD:  { lost: counts.c  - counts.d,  pct: ratios.cToD  == null ? null : 1 - ratios.cToD  },
  };

  return { counts, ratios, drops };
}
```

## 5. Prospectos activos AHORA (no por período, estado actual)

```ts
// apps/dashboard/src/lib/metrics/funnel.ts (continúa)
import { leadStages, funnelStages } from '@/lib/db';

export type ActiveByStage = {
  a: number; ms: number; b: number; c: number; d: number;
};

export async function getActiveByStage(args: {
  tenantId: string;
}): Promise<ActiveByStage> {
  const rows = await db
    .select({
      stage: leadStages.currentStage,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(leadStages)
    .where(eq(leadStages.tenantId, args.tenantId))
    .groupBy(leadStages.currentStage);

  const counts: ActiveByStage = { a: 0, ms: 0, b: 0, c: 0, d: 0 };
  for (const r of rows) {
    const key = (r.stage as string).toLowerCase() as keyof ActiveByStage;
    if (key in counts) counts[key] = r.count;
  }
  return counts;
}
```

> **Confirmar slug case:** si `current_stage` se guarda como `'A'`, `'MS'`, etc. en mayúsculas, ajustar el map. Si se guarda como `'a'`, `'ms'`, etc., el `.toLowerCase()` lo cubre.

## 6. Velocidad del funnel

```ts
// apps/dashboard/src/lib/metrics/velocity.ts
import { db, subscribers, stageTransitions, leadContentSent } from '@/lib/db';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

export type Velocity = {
  aToMs: number | null;  // days avg
  msToB: number | null;
  bToC: number | null;
  cToD: number | null;
  aToD: number | null;
};

export async function getVelocity(args: {
  tenantId: string;
  start: Date;
  end: Date;
}): Promise<Velocity> {
  const { tenantId, start, end } = args;

  // A → MS: tiempo entre subscribers.first_seen_at y primer lead_content_sent.sent_at
  const aToMsRow = await db.execute(sql`
    SELECT AVG(EXTRACT(EPOCH FROM (lcs.first_sent - s.first_seen_at)) / 86400.0)::float AS avg
    FROM api.subscribers s
    JOIN (
      SELECT subscriber_id, MIN(sent_at) AS first_sent
      FROM api.lead_content_sent
      WHERE tenant_id = ${tenantId}
      GROUP BY subscriber_id
    ) lcs ON lcs.subscriber_id = s.id
    WHERE s.tenant_id = ${tenantId}
      AND s.first_seen_at >= ${start}
      AND s.first_seen_at <  ${end};
  `);
  const aToMs = (aToMsRow.rows[0] as any)?.avg ?? null;

  // MS → B, B → C, C → D: tiempo entre transitions consecutivas
  async function avgBetween(fromMeta: 'lcs' | 'st', fromStage: string | null, toStage: string) {
    if (fromMeta === 'lcs') {
      // MS → B: entre primer lead_content_sent y primera transition a B
      const r = await db.execute(sql`
        SELECT AVG(EXTRACT(EPOCH FROM (st.first_transition - lcs.first_sent)) / 86400.0)::float AS avg
        FROM (
          SELECT subscriber_id, MIN(sent_at) AS first_sent
          FROM api.lead_content_sent
          WHERE tenant_id = ${tenantId}
          GROUP BY subscriber_id
        ) lcs
        JOIN (
          SELECT subscriber_id, MIN(created_at) AS first_transition
          FROM api.stage_transitions
          WHERE tenant_id = ${tenantId} AND to_stage = ${toStage}
          GROUP BY subscriber_id
        ) st ON st.subscriber_id = lcs.subscriber_id
        JOIN api.subscribers s ON s.id = lcs.subscriber_id
        WHERE s.first_seen_at >= ${start} AND s.first_seen_at < ${end};
      `);
      return (r.rows[0] as any)?.avg ?? null;
    } else {
      // entre transitions: from -> to
      const r = await db.execute(sql`
        SELECT AVG(EXTRACT(EPOCH FROM (t2.created_at - t1.created_at)) / 86400.0)::float AS avg
        FROM api.stage_transitions t1
        JOIN api.stage_transitions t2
          ON t2.subscriber_id = t1.subscriber_id
         AND t2.to_stage = ${toStage}
         AND t2.created_at > t1.created_at
         AND t2.tenant_id = ${tenantId}
        JOIN api.subscribers s ON s.id = t1.subscriber_id
        WHERE t1.tenant_id = ${tenantId}
          AND t1.to_stage = ${fromStage!}
          AND s.first_seen_at >= ${start} AND s.first_seen_at < ${end};
      `);
      return (r.rows[0] as any)?.avg ?? null;
    }
  }

  const [msToB, bToC, cToD] = await Promise.all([
    avgBetween('lcs', null, 'B'),
    avgBetween('st',  'B',  'C'),
    avgBetween('st',  'C',  'D'),
  ]);

  // A → D total: suma de los 4 si todos non-null, si no null
  const parts = [aToMs, msToB, bToC, cToD];
  const aToD = parts.every((p) => p != null) ? parts.reduce((s, p) => s + (p as number), 0) : null;

  return { aToMs, msToB, bToC, cToD, aToD };
}
```

> Esta query es la más cara del panel. Si tarda >500ms en producción, indexar `stage_transitions(tenant_id, subscriber_id, to_stage, created_at)` y `lead_content_sent(tenant_id, subscriber_id, sent_at)`. Esos índices probablemente ya existen — verificar en `packages/db/src/schema.ts`.

## 7. Heatmap mensual

```ts
// apps/dashboard/src/lib/metrics/heatmap.ts
import { db, subscribers } from '@/lib/db';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

export type HeatmapDay = { day: string; count: number };

export async function getMonthlyHeatmap(args: {
  tenantId: string;
  start: Date;
  end: Date;
}): Promise<HeatmapDay[]> {
  const rows = await db
    .select({
      day: sql<string>`TO_CHAR(first_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(subscribers)
    .where(
      and(
        eq(subscribers.tenantId, args.tenantId),
        gte(subscribers.firstSeenAt, args.start),
        lt(subscribers.firstSeenAt, args.end),
      ),
    )
    .groupBy(sql`day`)
    .orderBy(sql`day`);

  return rows;
}
```

UI mapea cada day a un nivel 0–4 según percentil:

```ts
export function levelFor(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  const ratio = count / max;
  if (ratio < 0.25) return 1;
  if (ratio < 0.50) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}
```

## 8. Follow-ups del período (grilla 1B/2B/.../1C/2C/...)

```ts
// apps/dashboard/src/lib/metrics/followups.ts
import { db, leadFollowupLog, followupTemplates, funnelStages } from '@/lib/db';
import { and, eq, gte, lt, sql, isNotNull } from 'drizzle-orm';

export type FollowupCell = {
  stageSlug: string;     // 'B' | 'C' | ...
  sequenceNumber: number; // 1..8
  sent: number;
  responded: number;
  responseRate: number | null;
};

export async function getFollowupGrid(args: {
  tenantId: string;
  start: Date;
  end: Date;
}): Promise<FollowupCell[]> {
  const rows = await db
    .select({
      stageSlug: funnelStages.slug,
      sequenceNumber: followupTemplates.sequenceNumber,
      sent: sql<number>`COUNT(${leadFollowupLog.id})::int`,
      responded: sql<number>`COUNT(${leadFollowupLog.respondedAt})::int`,
    })
    .from(leadFollowupLog)
    .innerJoin(followupTemplates, eq(followupTemplates.id, leadFollowupLog.templateId))
    .innerJoin(funnelStages, eq(funnelStages.id, followupTemplates.stageId))
    .where(
      and(
        eq(leadFollowupLog.tenantId, args.tenantId),
        gte(leadFollowupLog.sentAt, args.start),
        lt(leadFollowupLog.sentAt, args.end),
      ),
    )
    .groupBy(funnelStages.slug, followupTemplates.sequenceNumber)
    .orderBy(funnelStages.slug, followupTemplates.sequenceNumber);

  return rows.map((r) => ({
    stageSlug: r.stageSlug,
    sequenceNumber: r.sequenceNumber,
    sent: r.sent,
    responded: r.responded,
    responseRate: r.sent > 0 ? r.responded / r.sent : null,
  }));
}
```

## 9. Predicción de cierre del mes

```ts
// apps/dashboard/src/lib/metrics/prediction.ts
export type Prediction = {
  projected: number;        // bookings estimados al cierre del mes
  current: number;          // bookings actuales del mes
  rate: number;             // bookings por día
  daysElapsed: number;
  daysInMonth: number;
  comparison: { vsLastMonth: number; pct: number | null }; // delta vs mes anterior
};

export async function getMonthPrediction(args: {
  tenantId: string;
  year: number;
  month: number; // 1..12
  now: Date;
}): Promise<Prediction> {
  // counts actuales del mes
  const { start, end } = getPeriodRange(args.year, args.month);
  const current = (await getFunnelCounts({ tenantId: args.tenantId, start, end })).d;

  const daysInMonth = new Date(Date.UTC(args.year, args.month, 0)).getUTCDate();
  const daysElapsed = Math.min(args.now.getUTCDate(), daysInMonth);
  const rate = current / daysElapsed;
  const projected = Math.round(rate * daysInMonth);

  // delta vs mes anterior (mes completo)
  const prevMonth = args.month === 1 ? 12 : args.month - 1;
  const prevYear  = args.month === 1 ? args.year - 1 : args.year;
  const prev = (await getFunnelCounts({
    tenantId: args.tenantId,
    ...getPeriodRange(prevYear, prevMonth),
  })).d;

  return {
    projected,
    current,
    rate,
    daysElapsed,
    daysInMonth,
    comparison: {
      vsLastMonth: projected - prev,
      pct: prev > 0 ? (projected - prev) / prev : null,
    },
  };
}
```

## 10. Insights (reglas hardcodeadas)

```ts
// apps/dashboard/src/lib/metrics/insights.ts
import type { FunnelView } from './funnel';
import type { MonthlySeries } from './timeseries';
import type { Velocity } from './velocity';
import type { ActiveByStage } from './funnel';

export type InsightType = 'warning' | 'ok' | 'info' | 'ai';
export type Insight = {
  type: InsightType;
  iconName: string;       // tabler icon, ej. 'IconAlertTriangle'
  title: string;
  body: string;
  actionHref?: string;
  actionLabel?: string;
};

export function buildInsights(input: {
  current: FunnelView;
  yearSeries: MonthlySeries;
  velocity: Velocity;
  active: ActiveByStage;
  staleBCount?: number; // count de subscribers en stage B > 48h sin updated_at change
}): Insight[] {
  const insights: Insight[] = [];

  // Rule 1: cuello de botella B → C
  const histBToC = input.yearSeries.avgRatios.bToC;
  const curBToC  = input.current.ratios.bToC;
  if (histBToC != null && curBToC != null && curBToC < histBToC * 0.9) {
    const delta = Math.round((histBToC - curBToC) * 100);
    insights.push({
      type: 'warning',
      iconName: 'IconAlertTriangle',
      title: 'Cuello de botella en B→C',
      body: `Tu conversión a Calendly cayó ${delta}% vs el promedio anual`,
      actionHref: '/admin', // SPA admin para revisar follow-ups
      actionLabel: 'Ver follow-ups de Fase B →',
    });
  }

  // Rule 2: MSR alto
  const histMsr = input.yearSeries.avgRatios.msr;
  const curMsr  = input.current.ratios.msr;
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
  // (requiere histórico — para Sprint 1 dejamos hardcoded el avg histórico, en Sprint 2 calcularlo dinámico)
  if (input.velocity.aToD != null && input.velocity.aToD < 7.0) {
    insights.push({
      type: 'info',
      iconName: 'IconClockHour4',
      title: 'Velocidad mejorando',
      body: `A → D promedio: ${input.velocity.aToD.toFixed(1)} días, mejor que tu media de 7.8 días`,
    });
  }

  // Rule 5: mejor día de la semana (requiere query agregada, ver función siguiente)
  // Se inyecta desde la page si está disponible

  return insights;
}
```

Función auxiliar para Rule 5 (mejor día de la semana):

```ts
// apps/dashboard/src/lib/metrics/insights.ts (continúa)
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
        AND s.first_seen_at >= ${args.startOfYear}
        AND s.first_seen_at < ${args.now}
      GROUP BY dow
    ),
    avg_rate AS (SELECT AVG(conv_rate) AS r FROM per_dow)
    SELECT dow, conv_rate / (SELECT r FROM avg_rate) AS multiplier
    FROM per_dow
    ORDER BY multiplier DESC NULLS LAST
    LIMIT 1;
  `);
  const top = r.rows[0] as { dow: number; multiplier: number } | undefined;
  if (!top || top.multiplier < 1.2) return null; // solo si el mejor día convierte 20%+ más
  return top;
}
```

## 11. Resolver tenant activo

```ts
// apps/dashboard/src/lib/tenant.ts
import { db, tenants } from '@/lib/db';
import { and, eq } from 'drizzle-orm';

export async function getActiveTenant(): Promise<{ id: string; name: string; slug: string }> {
  // Por ahora: el primer tenant activo. Cuando haya selector multi-tenant,
  // leer de la cookie / sesión.
  const [row] = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.isActive, true))
    .limit(1);

  if (!row) throw new Error('No active tenant found');
  return row;
}
```

## 12. Lista de stages (sidebar)

```ts
// apps/dashboard/src/lib/stages.ts
import { db, funnelStages } from '@/lib/db';
import { and, asc, eq } from 'drizzle-orm';

export async function getStagesForTenant(tenantId: string) {
  return db
    .select({
      id: funnelStages.id,
      slug: funnelStages.slug,
      displayName: funnelStages.displayName,
      position: funnelStages.position,
    })
    .from(funnelStages)
    .where(and(eq(funnelStages.tenantId, tenantId), eq(funnelStages.isActive, true)))
    .orderBy(asc(funnelStages.position));
}
```

## 13. Sparkline 12 meses por métrica

Para alimentar las sparklines de KPI cards en vista anual, no se necesita query extra: el `MonthlySeries` ya tiene los 12 puntos por métrica. Cada KPI card extrae su columna:

```ts
function sparklineFor(series: MonthlySeries, metric: 'a' | 'ms' | 'b' | 'c' | 'd'): number[] {
  return series.months.map((m) => m.counts[metric]);
}
```

## Resumen: archivos a crear en `src/lib/metrics/`

```
_helpers.ts          — safeDivide, getPeriodRange
funnel.ts            — getFunnelCounts, ratiosFromCounts, getFunnelView, getActiveByStage
timeseries.ts        — getMonthlySeries
velocity.ts          — getVelocity
heatmap.ts           — getMonthlyHeatmap, levelFor
followups.ts         — getFollowupGrid
prediction.ts        — getMonthPrediction
insights.ts          — buildInsights, getBestDayOfWeek
```

Y de soporte:

```
src/lib/tenant.ts    — getActiveTenant
src/lib/stages.ts    — getStagesForTenant
src/lib/db.ts        — re-export de @revolicord/db con cliente propio
```

Fin del documento 05.
