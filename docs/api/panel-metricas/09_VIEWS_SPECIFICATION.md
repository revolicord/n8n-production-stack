# 09 — Especificación de vistas

> Para cada vista: ruta, datos que consulta, layout exacto, navegación, criterios de aceptación visual.

## Vista 1 — Anual (home del panel)

### Ruta
- `/year/[year]` — `[year]` es un número de 4 dígitos.
- Default: si entras a `/`, el root redirige a `/year/<año en curso UTC>`.

### Es Server Component que llama a:
- `getActiveTenant()` → para el tenantId
- `getMonthlySeries({ tenantId, year })` → la serie completa de 12 meses
- (`getFunnelView` para mostrar el funnel del año entero: pasarle `start = jan 1 año, end = jan 1 año+1`)

### Datos en pantalla
1. **5 KPI cards** (Initiated, MS, B, C, D) con:
   - Valor total del año (de `series.totals`)
   - Delta vs año anterior (calculado con un `getFunnelCounts` extra del año anterior)
   - Sparkline de 12 puntos (de `series.months[].counts[metric]`)
2. **Matriz mensual** (componente `MonthlyMatrix`) con las 5 filas de conteos + 4 filas de ratios + columna total.
3. **Funnel del año** (componente `FunnelBars`) con las 5 etapas y los 4 drops.
4. **3 insights del año** (lista de `InsightCard`): solo los más importantes, no la lista completa.

### Layout
```
┌─────────────────────────────────────────────────────────────────┐
│ TopBar: "DM Sorcery Tracker · 2026"  [en vivo]  [period switch] │
├─────────────────────────────────────────────────────────────────┤
│ KPI A  │ KPI MS │ KPI B │ KPI C │ KPI D                          │
├─────────────────────────────────────────────────────────────────┤
│ Section: "Matriz mensual · click en un mes para detalle"        │
│ ╔═════════════════════════════════════════════════════════════╗ │
│ ║  Ene Feb Mar ... Dic  TOTAL                                  ║ │
│ ║ A 238 312 ...                                                ║ │
│ ║ ... (5 conteos + 4 ratios + total col + total rows)         ║ │
│ ╚═════════════════════════════════════════════════════════════╝ │
├─────────────────────────────────────────────────────────────────┤
│ Section: "Funnel del año"                                       │
│ ╔═════════════════════════════════════════════════════════════╗ │
│ ║ Funnel bars (1.4fr)         │ Insights del año (1fr)        ║ │
│ ╚═════════════════════════════════════════════════════════════╝ │
└─────────────────────────────────────────────────────────────────┘
```

### Skeleton de `page.tsx`

```tsx
// src/app/(dashboard)/year/[year]/page.tsx
import { redirect } from 'next/navigation';
import { getActiveTenant } from '@/lib/tenant';
import { getMonthlySeries } from '@/lib/metrics/timeseries';
import { getFunnelView } from '@/lib/metrics/funnel';
import { buildInsights } from '@/lib/metrics/insights';
import { getVelocity } from '@/lib/metrics/velocity';
import { getActiveByStage } from '@/lib/metrics/funnel';
import { KpiCard } from '@/components/kpi/KpiCard';
import { MonthlyMatrix } from '@/components/matrix/MonthlyMatrix';
import { FunnelBars } from '@/components/funnel/FunnelBars';
import { InsightList } from '@/components/insights/InsightList';
import { TopBar } from '@/components/shell/TopBar';
import { PeriodSwitcher } from '@/components/shell/PeriodSwitcher';
import { getPeriodRange } from '@/lib/metrics/_helpers';
import { getFunnelCounts } from '@/lib/metrics/funnel';

export const revalidate = 30;

export default async function YearPage({ params }: { params: { year: string } }) {
  const year = parseInt(params.year, 10);
  if (Number.isNaN(year) || year < 2020 || year > 2099) redirect(`/year/${new Date().getUTCFullYear()}`);

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
    return { value: Math.round(((curr - prev) / prev) * 100), suffix: `vs ${year - 1}` };
  }

  const insights = buildInsights({
    current: funnel,
    yearSeries: series,
    velocity,
    active,
  });

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
              { label: String(year),     href: `/year/${year}`, active: true },
            ]}
          />
        }
      />

      <div className="grid grid-cols-5 gap-2.5 mb-5">
        <KpiCard label="Initiated"   letter="A"  value={series.totals.a}  delta={delta(series.totals.a,  prevYear.a)}  sparkline={series.months.map(m => m.counts.a)} />
        <KpiCard label="Media seen"  letter="MS" value={series.totals.ms} delta={delta(series.totals.ms, prevYear.ms)} sparkline={series.months.map(m => m.counts.ms)} />
        <KpiCard label="Engaged"     letter="B"  value={series.totals.b}  delta={delta(series.totals.b,  prevYear.b)}  sparkline={series.months.map(m => m.counts.b)} />
        <KpiCard label="Calendly"    letter="C"  value={series.totals.c}  delta={delta(series.totals.c,  prevYear.c)}  sparkline={series.months.map(m => m.counts.c)} />
        <KpiCard label="Booked"      letter="D"  value={series.totals.d}  delta={delta(series.totals.d,  prevYear.d)}  sparkline={series.months.map(m => m.counts.d)} />
      </div>

      <h3 className="text-[13px] font-medium text-qc-textBody mb-2.5 flex items-center gap-2">
        Matriz mensual · click en un mes para ver el detalle
      </h3>
      <div className="mb-5">
        <MonthlyMatrix series={series} />
      </div>

      <h3 className="text-[13px] font-medium text-qc-textBody mb-2.5 flex items-center gap-2">
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
```

### Criterios de aceptación visual

- [ ] El header muestra "DM Sorcery Tracker · <year>" con la pill "en vivo" verde.
- [ ] Los 5 KPI tienen su letter pill (A/MS/B/C/D), valor numerado formateado en es-ES, delta con color (verde +, rojo −), y sparkline funcional.
- [ ] La matriz tiene 9 filas (5 counts + 4 ratios). Las celdas son clickables y navegan a `/month/<year>/<month>`.
- [ ] Los meses sin datos muestran `—`, NO `0`.
- [ ] El funnel tiene las 5 etapas con widths proporcionales correctos y los 4 drop lines.
- [ ] Hay máximo 3 insights visibles en la columna derecha.

---

## Vista 2 — Mensual

### Ruta
- `/month/[year]/[month]` — `[month]` es 1–12 (sin padding) o 01–12 (con padding cero). Aceptar ambos.

### Datos
- `getFunnelView({ tenantId, start: <month start>, end: <next month start> })`
- `getVelocity({ tenantId, start, end })`
- `getMonthlyHeatmap({ tenantId, start, end })`
- `getFollowupGrid({ tenantId, start, end })`
- `getMonthPrediction({ tenantId, year, month, now: new Date() })`

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Breadcrumb: <a>2026</a> · vista mensual                          │
│ Title: "Mayo 2026"          [< Abr | Mayo | Jun >]              │
├─────────────────────────────────────────────────────────────────┤
│ 5 KPI cards (A, MS, B, C, D) con valores del mes y "X por día" │
├─────────────────────────────────────────────────────────────────┤
│ Ratio ribbon: 8 ratios en una banda (MSR/PRR/CSR/ABR + A→MS/MS→B/B→C/C→D) │
├─────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────┬───────────────────────────────┐  │
│ │ Funnel del mes (1fr)      │ Velocidad del funnel (1fr)    │  │
│ └───────────────────────────┴───────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────┬─────────────────────────────┐  │
│ │ Heatmap del mes (1.3fr)     │ Follow-ups del mes (1fr)    │  │
│ └─────────────────────────────┴─────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│ Predicción del mes (PredictionCard, ancho completo o 1.4fr)    │
└─────────────────────────────────────────────────────────────────┘
```

### Skeleton

```tsx
// src/app/(dashboard)/month/[year]/[month]/page.tsx
import { redirect } from 'next/navigation';
import { getActiveTenant } from '@/lib/tenant';
import { getFunnelView, getFunnelCounts } from '@/lib/metrics/funnel';
import { getVelocity } from '@/lib/metrics/velocity';
import { getMonthlyHeatmap } from '@/lib/metrics/heatmap';
import { getFollowupGrid } from '@/lib/metrics/followups';
import { getMonthPrediction } from '@/lib/metrics/prediction';
import { getPeriodRange } from '@/lib/metrics/_helpers';
import { KpiCard } from '@/components/kpi/KpiCard';
import { FunnelBars } from '@/components/funnel/FunnelBars';
import { VelocityCard } from '@/components/velocity/VelocityCard';
import { MonthHeatmap } from '@/components/heatmap/MonthHeatmap';
import { FollowupGrid } from '@/components/followups/FollowupGrid';
import { PredictionCard } from '@/components/prediction/PredictionCard';
import { PeriodSwitcher } from '@/components/shell/PeriodSwitcher';
import { MONTH_LABELS_LONG_ES, fmtPct } from '@/lib/format';

export const revalidate = 30;

export default async function MonthPage({ params }: { params: { year: string; month: string } }) {
  const year = parseInt(params.year, 10);
  const month = parseInt(params.month, 10);
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) redirect('/');

  const tenant = await getActiveTenant();
  const range = getPeriodRange(year, month);

  const [funnel, velocity, heatmap, followups, prediction] = await Promise.all([
    getFunnelView({ tenantId: tenant.id, ...range }),
    getVelocity({ tenantId: tenant.id, ...range }),
    getMonthlyHeatmap({ tenantId: tenant.id, ...range }),
    getFollowupGrid({ tenantId: tenant.id, ...range }),
    getMonthPrediction({ tenantId: tenant.id, year, month, now: new Date() }),
  ]);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const perDay = (n: number) => `${(n / daysInMonth).toFixed(1)} por día`;
  const monthLabelLong = MONTH_LABELS_LONG_ES[month - 1];

  function prevMonth(): { year: number; month: number } {
    return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  }
  function nextMonth(): { year: number; month: number } {
    return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  }

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[11.5px] text-qc-textSubtle">
            <a href={`/year/${year}`} className="text-qc-teal500 hover:underline">{year}</a> · vista mensual
          </div>
          <h1 className="text-lg font-medium text-white">{monthLabelLong} {year}</h1>
        </div>
        <PeriodSwitcher
          options={[
            { label: `< ${MONTH_LABELS_LONG_ES[prevMonth().month - 1].slice(0, 3)}`, href: `/month/${prevMonth().year}/${String(prevMonth().month).padStart(2, '0')}` },
            { label: monthLabelLong.slice(0, 3), href: `/month/${year}/${String(month).padStart(2, '0')}`, active: true },
            { label: `${MONTH_LABELS_LONG_ES[nextMonth().month - 1].slice(0, 3)} >`, href: `/month/${nextMonth().year}/${String(nextMonth().month).padStart(2, '0')}` },
          ]}
        />
      </div>

      <div className="grid grid-cols-5 gap-2 mb-3.5">
        <KpiCard label="Initiated"  letter="A"  value={funnel.counts.a}  hint={perDay(funnel.counts.a)} />
        <KpiCard label="Media seen" letter="MS" value={funnel.counts.ms} hint={perDay(funnel.counts.ms)} />
        <KpiCard label="Engaged"    letter="B"  value={funnel.counts.b}  hint={perDay(funnel.counts.b)} />
        <KpiCard label="Calendly"   letter="C"  value={funnel.counts.c}  hint={perDay(funnel.counts.c)} />
        <KpiCard label="Booked"     letter="D"  value={funnel.counts.d}  hint={perDay(funnel.counts.d)} />
      </div>

      <div className="grid grid-cols-4 gap-2 mb-5 px-3.5 py-2.5 bg-qc-surface2 border border-qc-border rounded-lg">
        <RatioPill name="MSR"   value={funnel.ratios.msr} />
        <RatioPill name="PRR"   value={funnel.ratios.prr} />
        <RatioPill name="CSR"   value={funnel.ratios.csr} />
        <RatioPill name="ABR"   value={funnel.ratios.abr} />
        <RatioPill name="A→MS"  value={funnel.ratios.aToMs} />
        <RatioPill name="MS→B"  value={funnel.ratios.msToB} />
        <RatioPill name="B→C"   value={funnel.ratios.bToC} />
        <RatioPill name="C→D"   value={funnel.ratios.cToD} />
      </div>

      <div className="grid grid-cols-2 gap-3.5 mb-3.5">
        <div className="bg-qc-surface border border-qc-border rounded-lg p-4">
          <FunnelBars view={funnel} />
        </div>
        <VelocityCard velocity={velocity} />
      </div>

      <div className="grid gap-3.5 mb-3.5" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <MonthHeatmap days={heatmap} year={year} month={month} />
        <FollowupGrid cells={followups} />
      </div>

      <PredictionCard prediction={prediction} monthLabel={monthLabelLong.toLowerCase()} />
    </div>
  );
}

function RatioPill({ name, value }: { name: string; value: number | null }) {
  return (
    <div className="flex items-baseline gap-2 text-[11.5px]">
      <span className="text-qc-textSubtle font-medium min-w-[50px]">{name}</span>
      <span className="text-white text-[15px] font-medium tracking-tight">{fmtPct(value, value != null && value < 0.1 ? 1 : 0)}</span>
    </div>
  );
}
```

### Criterios de aceptación

- [ ] Breadcrumb funcional: click en el año vuelve a vista anual.
- [ ] Navegación entre meses (anterior/siguiente) funciona cruzando años.
- [ ] Si el mes está en curso, el heatmap muestra solo los días transcurridos; los futuros aparecen vacíos.
- [ ] Predicción muestra "~X bookings" y la comparación con el mes anterior.
- [ ] Followups grid muestra hasta 8 cells (1B-4B + 1C-4C) ordenados.

---

## Vista 3 — Funnel dedicado

### Ruta
- `/funnel` — soporta query param `?period=7d|30d|month|year`. Default: `month`.

### Datos
- `getActiveByStage({ tenantId })` → conteos actuales por etapa
- `getFunnelView({ tenantId, start, end })` para el periodo seleccionado
- `getVelocity` (para Sprint 2 si añadimos insight velocity)
- `buildInsights(...)` — los 5 insights del mockup
- `getBestDayOfWeek(...)` para Rule 5

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ TopBar: "Funnel"                  [7d | 30d | Mayo | 2026]     │
│         "Estado del pipeline · datos en tiempo real..."         │
├─────────────────────────────────────────────────────────────────┤
│ Section: "Prospectos activos ahora"                             │
│ [A:87 | MS:42 | B:23 | C:8 | D:3]                                │
├─────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────┬───────────────────────────────┐  │
│ │ Funnel grande (1.4fr)     │ Insights (1fr)                │  │
│ │ ╔═════════════════════╗   │ [warning B→C]                  │  │
│ │ ║ A 312    100%       ║   │ [ok MSR alto]                  │  │
│ │ ║ MS 134   43%        ║   │ [ai prospectos B estancados]   │  │
│ │ ║ B 58     19%        ║   │ [info velocidad mejorando]     │  │
│ │ ║ C 16     5.1%       ║   │ [info mejor día martes]        │  │
│ │ ║ D 5      1.6%       ║   │                                │  │
│ │ ╚═════════════════════╝   │                                │  │
│ │ Prediction card           │                                │  │
│ └───────────────────────────┴───────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Skeleton

```tsx
// src/app/(dashboard)/funnel/page.tsx
import { getActiveTenant } from '@/lib/tenant';
import { getFunnelView, getActiveByStage } from '@/lib/metrics/funnel';
import { getVelocity } from '@/lib/metrics/velocity';
import { getMonthlySeries } from '@/lib/metrics/timeseries';
import { getMonthPrediction } from '@/lib/metrics/prediction';
import { buildInsights, getBestDayOfWeek } from '@/lib/metrics/insights';
import { getPeriodRange } from '@/lib/metrics/_helpers';
import { ActiveByStageGrid } from '@/components/funnel/ActiveByStageGrid';
import { FunnelBars } from '@/components/funnel/FunnelBars';
import { InsightList } from '@/components/insights/InsightList';
import { PredictionCard } from '@/components/prediction/PredictionCard';
import { PeriodSwitcher } from '@/components/shell/PeriodSwitcher';
import { MONTH_LABELS_LONG_ES } from '@/lib/format';

export const revalidate = 30;

type Period = '7d' | '30d' | 'month' | 'year';

function resolvePeriod(p?: string): { period: Period; start: Date; end: Date; year: number; month: number } {
  const period = (['7d', '30d', 'month', 'year'].includes(p ?? '') ? p : 'month') as Period;
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  if (period === '7d') {
    const end = new Date(now);
    const start = new Date(now); start.setUTCDate(start.getUTCDate() - 7);
    return { period, start, end, year, month };
  }
  if (period === '30d') {
    const end = new Date(now);
    const start = new Date(now); start.setUTCDate(start.getUTCDate() - 30);
    return { period, start, end, year, month };
  }
  if (period === 'year') {
    const r = getPeriodRange(year);
    return { period, start: r.start, end: r.end, year, month };
  }
  // month default
  const r = getPeriodRange(year, month);
  return { period, start: r.start, end: r.end, year, month };
}

export default async function FunnelPage({ searchParams }: { searchParams: { period?: string } }) {
  const tenant = await getActiveTenant();
  const { period, start, end, year, month } = resolvePeriod(searchParams.period);

  const [funnel, active, velocity, series, prediction, bestDow] = await Promise.all([
    getFunnelView({ tenantId: tenant.id, start, end }),
    getActiveByStage({ tenantId: tenant.id }),
    getVelocity({ tenantId: tenant.id, start, end }),
    getMonthlySeries({ tenantId: tenant.id, year }),
    period === 'month' ? getMonthPrediction({ tenantId: tenant.id, year, month, now: new Date() }) : null,
    getBestDayOfWeek({ tenantId: tenant.id, startOfYear: getPeriodRange(year).start, now: new Date() }),
  ]);

  const insights = buildInsights({
    current: funnel,
    yearSeries: series,
    velocity,
    active,
  });
  if (bestDow) {
    const DOW_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    insights.push({
      type: 'info',
      iconName: 'IconCalendarStats',
      title: `Mejor día para iniciar: ${DOW_ES[bestDow.dow]}`,
      body: `Los prospectos iniciados en ${DOW_ES[bestDow.dow]} convierten ${bestDow.multiplier.toFixed(1)}x más a B`,
    });
  }

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between mb-4.5">
        <div>
          <h1 className="text-lg font-medium text-white">Funnel</h1>
          <div className="text-[11.5px] text-qc-textSubtle">
            Estado del pipeline · datos en tiempo real desde Instagram
          </div>
        </div>
        <PeriodSwitcher
          options={[
            { label: '7 días',  href: '/funnel?period=7d',    active: period === '7d' },
            { label: '30 días', href: '/funnel?period=30d',   active: period === '30d' },
            { label: MONTH_LABELS_LONG_ES[month - 1].slice(0, 3), href: '/funnel?period=month', active: period === 'month' },
            { label: String(year), href: '/funnel?period=year', active: period === 'year' },
          ]}
        />
      </div>

      <ActiveByStageGrid data={active} />

      <div className="grid gap-3.5" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <div className="bg-qc-surface border border-qc-border rounded-lg p-4">
          <h3 className="text-[12px] font-medium text-qc-textBody mb-3.5 uppercase tracking-wider flex items-center gap-1.5">
            Conversión etapa por etapa
          </h3>
          <FunnelBars view={funnel} />
          {prediction && <PredictionCard prediction={prediction} monthLabel={MONTH_LABELS_LONG_ES[month - 1].toLowerCase()} />}
        </div>

        <InsightList insights={insights} />
      </div>
    </div>
  );
}
```

### Criterios de aceptación

- [ ] Selector de período cambia los datos sin recargar página entera.
- [ ] Los 5 conteos de "Prospectos activos ahora" reflejan el estado AHORA (no del período seleccionado).
- [ ] Drop lines del funnel muestran tanto el porcentaje como los perdidos.
- [ ] Insights renderizan en orden, máximo 5–6 cards.
- [ ] La prediction card solo aparece si `period === 'month'`.

---

## Vistas placeholder (Sprint 1)

### `/prospects`, `/velocity`, `/cohorts`

Cada uno con un Server Component simple que renderiza:

```tsx
export default function ProspectsPage() {
  return (
    <div className="px-6 py-5">
      <h1 className="text-lg font-medium text-white mb-2">Prospectos</h1>
      <div className="bg-qc-surface border border-qc-border rounded-lg p-8 text-center">
        <div className="text-qc-textMuted text-sm">
          Próximamente: Kanban de prospectos con drag & drop entre etapas.
        </div>
        <div className="text-qc-textSubtle text-[11.5px] mt-2">
          Sprint 3 estimado.
        </div>
      </div>
    </div>
  );
}
```

Mismo patrón para `/velocity` (Sprint 2 lo expande con vista dedicada de tendencias de tiempos) y `/cohorts` (Sprint 3).

## Comportamiento de navegación entre vistas

| Acción | Resultado |
|---|---|
| Click en celda de matriz anual (counts) | `/month/<year>/<month>` |
| Click en celda de matriz anual (ratios) | `/month/<year>/<month>` (mismo destino) |
| Click en breadcrumb `2026` de mes | `/year/2026` |
| Click en `< Abr` / `Jun >` en mes | `/month/<year>/<month>` previo/siguiente |
| Click en nav item "Funnel" | `/funnel?period=month` |
| Click en KPI card | (Sprint 1: no-op. Sprint 3: drawer con detalle del subscriber set) |
| Click en card de "Active by stage" | Sprint 3: `/prospects?stage=<X>` |
| Click en action link de insight | URL especificada en el insight (puede ser interna o externa) |

Fin del documento 09.
