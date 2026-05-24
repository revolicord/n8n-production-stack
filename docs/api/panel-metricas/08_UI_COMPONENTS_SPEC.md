# 08 — Especificación de componentes UI

> Para cada componente: props, comportamiento, classes Tailwind clave, y referencia visual al mockup.

## Convenciones

- **Server Components por defecto.** Marcar `'use client'` solo donde sea necesario (hooks, eventos, navegación).
- Cada componente tiene un único default export.
- Props tipadas con `interface` o `type`. NO `any`.
- Class names: combinar con `clsx` o template strings; el repo no usa `cn` helper salvo que ya exista en `packages/shared`. Si no, usar `clsx` simple.
- Colores: SIEMPRE clases `bg-qc-*` / `text-qc-*` definidas en `tailwind.config.ts`. NO hardcodear hex en JSX.

## Componentes de shell

### `Sidebar.tsx` (client)

Sidebar fija con logo, tenant selector, nav items, footer logout.

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconChartBar, IconLayoutDashboard, IconCalendarMonth, IconFilter, IconUsers, IconClockHour4, IconChartArcs, IconSettings } from '@tabler/icons-react';
import { TenantSelect } from './TenantSelect';
import { SidebarItem } from './SidebarItem';

type Stage = { id: string; slug: string; displayName: string; position: number };
type Tenant = { id: string; name: string; slug: string };

interface SidebarProps {
  tenant: Tenant;
  stages: Stage[];
  allTenants?: Tenant[];
}

export function Sidebar({ tenant, stages, allTenants = [tenant] }: SidebarProps) {
  const pathname = usePathname();
  const year = new Date().getUTCFullYear();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <aside className="w-50 bg-qc-surface border-r border-qc-border flex flex-col flex-shrink-0" style={{ width: 200 }}>
      <div className="px-3.5 py-3.5 border-b border-qc-border flex items-center gap-2">
        <div className="w-5.5 h-5.5 bg-qc-teal700 rounded-md flex items-center justify-center" style={{ width: 22, height: 22 }}>
          <IconChartBar size={14} className="text-qc-teal50" />
        </div>
        <span className="text-[13px] font-medium text-white">Quantum</span>
      </div>

      <div className="px-3 pt-3 pb-2">
        <TenantSelect tenants={allTenants} activeId={tenant.id} />
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <SidebarItem href={`/year/${year}`} icon={IconLayoutDashboard} label="Vista anual" active={pathname.startsWith('/year')} />
        <SidebarItem href={`/month/${year}/${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`} icon={IconCalendarMonth} label="Vista mensual" active={pathname.startsWith('/month')} />
        <SidebarItem href="/funnel" icon={IconFilter} label="Funnel" active={pathname.startsWith('/funnel')} />
        <SidebarItem href="/prospects" icon={IconUsers} label="Prospectos" active={pathname.startsWith('/prospects')} />

        <div className="border-t border-qc-border mx-3 my-1.5" />
        <div className="px-4 pt-1.5 pb-0.5 text-[10px] uppercase tracking-[0.08em] text-qc-textFaint font-medium">Análisis</div>
        <SidebarItem href="/velocity" icon={IconClockHour4} label="Velocidad" active={pathname.startsWith('/velocity')} />
        <SidebarItem href="/cohorts" icon={IconChartArcs} label="Cohortes" active={pathname.startsWith('/cohorts')} />

        <div className="border-t border-qc-border mx-3 my-1.5" />
        <SidebarItem href="https://api.revolicord.com/dashboard" external icon={IconSettings} label="Settings" />
      </nav>

      <div className="px-4 py-3 border-t border-qc-border">
        <button onClick={handleLogout} className="text-[11px] text-qc-textSubtle hover:text-qc-textMuted transition-colors">
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
```

> El href de Settings apunta al SPA admin existente. La URL exacta depende de cómo esté servido. Verificar en doc 13 sección "Navegación entre paneles".

### `SidebarItem.tsx` (client)

```tsx
'use client';
import Link from 'next/link';
import type { Icon } from '@tabler/icons-react';

interface SidebarItemProps {
  href: string;
  icon: Icon;
  label: string;
  active?: boolean;
  external?: boolean;
}

export function SidebarItem({ href, icon: IconCmp, label, active, external }: SidebarItemProps) {
  const cls = [
    'flex items-center gap-2.5 px-4 py-2 text-[12.5px] transition-colors border-l-2',
    active
      ? 'text-qc-teal50 bg-qc-teal700/10 border-l-qc-teal500'
      : 'text-qc-textMuted hover:text-white hover:bg-white/[0.03] border-l-transparent',
  ].join(' ');

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        <IconCmp size={15} />
        <span>{label}</span>
      </a>
    );
  }

  return (
    <Link href={href} className={cls}>
      <IconCmp size={15} />
      <span>{label}</span>
    </Link>
  );
}
```

### `TenantSelect.tsx` (client)

```tsx
'use client';
import { useRouter } from 'next/navigation';

type Tenant = { id: string; name: string; slug: string };
interface TenantSelectProps {
  tenants: Tenant[];
  activeId: string;
}

export function TenantSelect({ tenants, activeId }: TenantSelectProps) {
  const router = useRouter();
  if (tenants.length <= 1) {
    // Mostrar como texto plano, no select
    const t = tenants[0];
    return (
      <div className="text-[11px] text-qc-textMuted bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5">
        {t.name}
      </div>
    );
  }
  return (
    <select
      value={activeId}
      onChange={(e) => {
        // El switch de tenant en multi-tenant real se hará en sprint posterior
        document.cookie = `tenant_id=${e.target.value}; path=/`;
        router.refresh();
      }}
      className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-[11px] text-qc-textBody focus:outline-none focus:border-qc-teal500"
    >
      {tenants.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  );
}
```

### `TopBar.tsx` (server)

No es estrictamente necesario como componente reutilizable; cada page renderiza su propio header. Si se extrae, contiene:

```tsx
interface TopBarProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  badge?: { label: string; tone?: 'teal' };
}

export function TopBar({ title, subtitle, right, badge }: TopBarProps) {
  return (
    <div className="flex items-center justify-between mb-4.5">
      <div>
        {subtitle && <div className="text-[11.5px] text-qc-textSubtle mb-0.5">{subtitle}</div>}
        <div className="text-lg font-medium text-white flex items-center gap-2.5">
          {title}
          {badge && (
            <span className="text-[10.5px] bg-qc-teal700/15 text-qc-teal50 px-2 py-0.5 rounded-full font-medium tracking-wider uppercase">
              {badge.label}
            </span>
          )}
        </div>
      </div>
      {right}
    </div>
  );
}
```

### `PeriodSwitcher.tsx` (client)

Para alternar entre años (vista anual) o meses (vista mensual).

```tsx
'use client';
import Link from 'next/link';

interface PeriodSwitcherProps {
  options: Array<{ label: string; href: string; active?: boolean }>;
}

export function PeriodSwitcher({ options }: PeriodSwitcherProps) {
  return (
    <div className="flex gap-1 bg-qc-surface border border-qc-border rounded-md p-0.5">
      {options.map((opt) => (
        <Link
          key={opt.label}
          href={opt.href}
          className={[
            'text-[11.5px] px-2.5 py-1 rounded',
            opt.active ? 'bg-qc-teal700 text-white' : 'text-qc-textMuted hover:text-white',
          ].join(' ')}
        >
          {opt.label}
        </Link>
      ))}
    </div>
  );
}
```

## Componentes KPI

### `KpiCard.tsx` (server)

```tsx
import { LetterBadge } from './LetterBadge';
import { DeltaPill } from './DeltaPill';
import { Sparkline } from './Sparkline';

interface KpiCardProps {
  label: string;
  letter: 'A' | 'MS' | 'B' | 'C' | 'D';
  value: number;
  delta?: { value: number; suffix: string }; // {value: 12, suffix: 'vs 2025'}
  sparkline?: number[]; // 12 puntos
  hint?: string;
}

export function KpiCard({ label, letter, value, delta, sparkline, hint }: KpiCardProps) {
  return (
    <div className="bg-qc-surface border border-qc-border rounded-lg px-3.5 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10.5px] uppercase tracking-wider text-qc-textSubtle font-medium">{label}</span>
        <LetterBadge letter={letter} />
      </div>
      <div className="text-[24px] font-medium text-white leading-none tracking-tight mb-1">
        {new Intl.NumberFormat('es-ES').format(value)}
      </div>
      {delta && <DeltaPill value={delta.value} suffix={delta.suffix} />}
      {hint && !delta && <div className="text-[10px] text-qc-textSubtle mt-1">{hint}</div>}
      {sparkline && sparkline.length > 0 && <Sparkline data={sparkline} />}
    </div>
  );
}
```

### `LetterBadge.tsx` (server)

```tsx
interface LetterBadgeProps { letter: 'A' | 'MS' | 'B' | 'C' | 'D'; }
export function LetterBadge({ letter }: LetterBadgeProps) {
  return (
    <span className="text-[9.5px] font-medium text-qc-teal500 bg-qc-teal700/15 px-1.5 py-0.5 rounded">
      {letter}
    </span>
  );
}
```

### `DeltaPill.tsx` (server)

```tsx
import { IconTrendingUp, IconTrendingDown, IconMinus } from '@tabler/icons-react';

interface DeltaPillProps { value: number; suffix?: string; }

export function DeltaPill({ value, suffix }: DeltaPillProps) {
  const isUp = value > 0;
  const isFlat = value === 0;
  const Icon = isFlat ? IconMinus : isUp ? IconTrendingUp : IconTrendingDown;
  const colorCls = isFlat ? 'text-qc-textSubtle' : isUp ? 'text-qc-success' : 'text-qc-danger';
  const sign = isUp ? '+' : '';
  return (
    <div className={`flex items-center gap-1 text-[10.5px] ${colorCls}`}>
      <Icon size={12} />
      <span>{sign}{value}%</span>
      {suffix && <span className="text-qc-textSubtle">{suffix}</span>}
    </div>
  );
}
```

### `Sparkline.tsx` (server)

SVG inline, 140×22 viewBox, `preserveAspectRatio="none"`.

```tsx
interface SparklineProps { data: number[]; }

export function Sparkline({ data }: SparklineProps) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 140;
  const height = 22;
  const step = width / Math.max(data.length - 1, 1);
  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="mt-1.5" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="#14b8a6" strokeWidth={1.5} />
    </svg>
  );
}
```

## Matriz mensual

### `MonthlyMatrix.tsx` (client — para cross-highlight)

```tsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { MONTH_LABELS_ES, fmtNumber, fmtPct } from '@/lib/format';
import type { MonthlySeries } from '@/types';

interface MonthlyMatrixProps {
  series: MonthlySeries;
}

export function MonthlyMatrix({ series }: MonthlyMatrixProps) {
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const rows = [
    { key: 'a',     label: 'A',   counts: series.months.map(m => m.counts.a),  total: series.totals.a },
    { key: 'ms',    label: 'MS',  counts: series.months.map(m => m.counts.ms), total: series.totals.ms },
    { key: 'b',     label: 'B',   counts: series.months.map(m => m.counts.b),  total: series.totals.b },
    { key: 'c',     label: 'C',   counts: series.months.map(m => m.counts.c),  total: series.totals.c },
    { key: 'd',     label: 'D',   counts: series.months.map(m => m.counts.d),  total: series.totals.d },
  ];
  const ratioRows = [
    { key: 'msr', label: 'MSR', values: series.months.map(m => m.ratios.msr), avg: series.avgRatios.msr },
    { key: 'prr', label: 'PRR', values: series.months.map(m => m.ratios.prr), avg: series.avgRatios.prr },
    { key: 'csr', label: 'CSR', values: series.months.map(m => m.ratios.csr), avg: series.avgRatios.csr },
    { key: 'abr', label: 'ABR', values: series.months.map(m => m.ratios.abr), avg: series.avgRatios.abr },
  ];

  function cellCls(col: number, row: string) {
    return [
      'px-1.5 py-1.5 text-right text-[11px] border-b border-qc-surface2 cursor-pointer transition-colors',
      hoveredCol === col || hoveredRow === row ? 'bg-qc-teal500/[0.05] text-white' : '',
    ].join(' ');
  }

  return (
    <div className="bg-qc-surface border border-qc-border rounded-lg px-3 py-2.5">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="text-left px-1.5 py-1.5 text-qc-textSubtle font-medium text-[10.5px] uppercase tracking-wider">&nbsp;</th>
            {MONTH_LABELS_ES.map((m, i) => (
              <th key={m} className="text-right px-1.5 py-1.5 text-qc-textSubtle font-medium text-[10.5px] uppercase tracking-wider">{m}</th>
            ))}
            <th className="text-right px-1.5 py-1.5 bg-qc-teal700/10 text-qc-teal50 font-medium text-[10.5px] uppercase tracking-wider">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} onMouseEnter={() => setHoveredRow(r.key)} onMouseLeave={() => setHoveredRow(null)}>
              <td className="text-left px-1.5 py-1.5 text-qc-textMuted font-medium">{r.label}</td>
              {r.counts.map((v, col) => (
                <td
                  key={col}
                  onMouseEnter={() => setHoveredCol(col)}
                  onMouseLeave={() => setHoveredCol(null)}
                  className={cellCls(col, r.key)}
                >
                  <Link href={`/month/${series.year}/${String(col + 1).padStart(2, '0')}`}>
                    {v > 0 ? fmtNumber(v) : '—'}
                  </Link>
                </td>
              ))}
              <td className="text-right px-1.5 py-1.5 bg-qc-teal700/10 text-qc-teal50 font-medium">{fmtNumber(r.total)}</td>
            </tr>
          ))}
          {ratioRows.map((r, idx) => (
            <tr key={r.key} className={idx === 0 ? 'border-t border-qc-border' : ''}>
              <td className="text-left px-1.5 py-1.5 text-qc-textMuted font-medium">{r.label}</td>
              {r.values.map((v, col) => (
                <td
                  key={col}
                  onMouseEnter={() => setHoveredCol(col)}
                  className={cellCls(col, r.key) + ' text-qc-textMuted'}
                >
                  {fmtPct(v, 0)}
                </td>
              ))}
              <td className="text-right px-1.5 py-1.5 bg-qc-teal700/10 text-qc-teal50 font-medium">{fmtPct(r.avg, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

## Funnel

### `FunnelBars.tsx` (server)

```tsx
import type { FunnelView } from '@/types';
import { FunnelStageRow } from './FunnelStageRow';
import { FunnelDropLine } from './FunnelDropLine';
import { fmtNumber } from '@/lib/format';

interface FunnelBarsProps { view: FunnelView; }

export function FunnelBars({ view }: FunnelBarsProps) {
  const { counts, drops } = view;
  const total = counts.a || 1; // evita div/0 en widths

  return (
    <div className="flex flex-col gap-1">
      <FunnelStageRow letter="A"  label="Initiated"  value={counts.a}  widthPct={100} />
      <FunnelDropLine pct={drops.aToMs.pct} lost={drops.aToMs.lost} />
      <FunnelStageRow letter="MS" label="Media seen" value={counts.ms} widthPct={(counts.ms / total) * 100} />
      <FunnelDropLine pct={drops.msToB.pct} lost={drops.msToB.lost} />
      <FunnelStageRow letter="B"  label="Engaged"    value={counts.b}  widthPct={(counts.b  / total) * 100} />
      <FunnelDropLine pct={drops.bToC.pct} lost={drops.bToC.lost} />
      <FunnelStageRow letter="C"  label="Calendly"   value={counts.c}  widthPct={(counts.c  / total) * 100} />
      <FunnelDropLine pct={drops.cToD.pct} lost={drops.cToD.lost} />
      <FunnelStageRow letter="D"  label="Booked"     value={counts.d}  widthPct={(counts.d  / total) * 100} />
    </div>
  );
}
```

### `FunnelStageRow.tsx` (server)

```tsx
import { fmtNumber } from '@/lib/format';

interface FunnelStageRowProps {
  letter: string;
  label: string;
  value: number;
  widthPct: number;
}

export function FunnelStageRow({ letter, label, value, widthPct }: FunnelStageRowProps) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-20 text-[11.5px] text-qc-textMuted">
        <span className="font-medium">{letter}</span> · {label}
      </div>
      <div className="flex-1 h-7 bg-qc-surface2 rounded relative overflow-hidden">
        <div
          className="h-full flex items-center px-2 text-[11.5px] text-white font-medium"
          style={{
            width: `${Math.max(widthPct, 0).toFixed(1)}%`,
            background: 'linear-gradient(90deg, #0f6e56 0%, #14b8a6 100%)',
            borderRadius: 4,
          }}
        >
          {fmtNumber(value)}
        </div>
      </div>
    </div>
  );
}
```

### `FunnelDropLine.tsx` (server)

```tsx
import { fmtPct, fmtNumber } from '@/lib/format';

interface FunnelDropLineProps {
  pct: number | null;
  lost: number;
}

export function FunnelDropLine({ pct, lost }: FunnelDropLineProps) {
  if (pct == null) {
    return <div className="text-[10.5px] text-qc-textSubtle pl-22 pb-0.5">↓ sin datos</div>;
  }
  return (
    <div className="text-[10.5px] text-qc-textSubtle pb-0.5" style={{ paddingLeft: 90 }}>
      ↓ <span className="text-qc-danger font-medium">−{Math.round(pct * 100)}%</span> drop · {fmtNumber(lost)} perdidos
    </div>
  );
}
```

### `ActiveByStageGrid.tsx` (server)

Grid de 5 columnas con los conteos actuales (no del período).

```tsx
import type { ActiveByStage } from '@/types';

interface ActiveByStageGridProps { data: ActiveByStage; }

const HINTS = {
  a:  'esperando MS',
  ms: 'esperando B',
  b:  'en conversación',
  c:  'link enviado',
  d:  'por confirmar',
};

export function ActiveByStageGrid({ data }: ActiveByStageGridProps) {
  const stages: Array<{ key: keyof ActiveByStage; letter: string }> = [
    { key: 'a',  letter: 'A' },
    { key: 'ms', letter: 'MS' },
    { key: 'b',  letter: 'B' },
    { key: 'c',  letter: 'C' },
    { key: 'd',  letter: 'D' },
  ];
  return (
    <div>
      <div className="text-[11px] text-qc-textSubtle uppercase tracking-wider mb-2 font-medium">
        Prospectos activos ahora
      </div>
      <div className="grid grid-cols-5 gap-2 mb-4">
        {stages.map(({ key, letter }) => (
          <div key={key} className="bg-qc-surface2 border border-qc-border rounded-md px-2.5 py-2.5 cursor-pointer hover:border-qc-teal500 transition-colors">
            <div className="text-[10px] text-qc-teal500 font-medium tracking-wider">{letter}</div>
            <div className="text-[19px] font-medium text-white leading-none my-1 tracking-tight">{data[key]}</div>
            <div className="text-[9.5px] text-qc-textSubtle">{HINTS[key]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Velocity card

```tsx
import type { Velocity } from '@/types';
import { fmtDays } from '@/lib/format';
import { Card } from '@/components/primitives/Card';
import { SectionTitle } from '@/components/primitives/SectionTitle';
import { IconClockHour4 } from '@tabler/icons-react';

interface VelocityCardProps { velocity: Velocity; }

export function VelocityCard({ velocity }: VelocityCardProps) {
  const rows = [
    { from: 'A',  to: 'MS', value: velocity.aToMs },
    { from: 'MS', to: 'B',  value: velocity.msToB },
    { from: 'B',  to: 'C',  value: velocity.bToC },
    { from: 'C',  to: 'D',  value: velocity.cToD },
  ];
  return (
    <Card>
      <SectionTitle icon={IconClockHour4}>Velocidad del funnel</SectionTitle>
      {rows.map((r) => (
        <div key={`${r.from}-${r.to}`} className="flex items-center justify-between py-1.5 border-b border-qc-surface2 last:border-0 text-[11.5px]">
          <span className="text-qc-textMuted">{r.from} <span className="text-qc-teal500 text-[10px] font-medium">→</span> {r.to}</span>
          <span className="text-white font-medium">{fmtDays(r.value)}</span>
        </div>
      ))}
      <div className="mt-2.5 pt-2.5 border-t border-qc-border flex justify-between text-[12px]">
        <span className="text-qc-textMuted">A → D promedio</span>
        <span className="text-qc-teal50 font-medium text-[16px]">{fmtDays(velocity.aToD)}</span>
      </div>
    </Card>
  );
}
```

## Heatmap

### `MonthHeatmap.tsx` (server)

Renderiza 5 semanas × 7 días. Cada día con su nivel 0–4.

```tsx
import type { HeatmapDay } from '@/types';
import { Card } from '@/components/primitives/Card';
import { SectionTitle } from '@/components/primitives/SectionTitle';
import { IconFlame } from '@tabler/icons-react';

interface MonthHeatmapProps {
  days: HeatmapDay[];     // YYYY-MM-DD strings
  year: number;
  month: number;          // 1..12
}

const DOW_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']; // lun a dom
const LEVEL_BG = ['#1a1a1a', 'rgba(13,148,136,0.20)', 'rgba(13,148,136,0.40)', 'rgba(13,148,136,0.65)', '#14b8a6'];

function levelFor(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  const r = count / Math.max(max, 1);
  if (r < 0.25) return 1;
  if (r < 0.50) return 2;
  if (r < 0.75) return 3;
  return 4;
}

export function MonthHeatmap({ days, year, month }: MonthHeatmapProps) {
  const byDay = new Map(days.map((d) => [d.day, d.count]));
  const max = days.reduce((m, d) => Math.max(m, d.count), 0);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  // 5 semanas × 7 días. Empezamos el primer lunes que cae en el mes o antes.
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const dowOfFirst = (firstOfMonth.getUTCDay() + 6) % 7; // L=0...D=6
  const cells: Array<{ date?: string; count: number; inMonth: boolean }> = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 7; c++) {
      const dayOfMonth = r * 7 + c - dowOfFirst + 1;
      if (dayOfMonth >= 1 && dayOfMonth <= daysInMonth) {
        const iso = `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
        cells.push({ date: iso, count: byDay.get(iso) ?? 0, inMonth: true });
      } else {
        cells.push({ count: 0, inMonth: false });
      }
    }
  }

  return (
    <Card>
      <SectionTitle icon={IconFlame}>Días con más actividad · este mes</SectionTitle>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: '14px repeat(5, 1fr)' }}>
        {/* No DOW labels on this layout — diagonal por semana se simplifica con 7 columnas */}
      </div>
      <div className="grid grid-cols-7 gap-[3px]">
        {DOW_LABELS.map((l) => (
          <div key={l} className="text-[9px] text-qc-textSubtle text-center">{l}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell.inMonth) return <div key={i} className="aspect-square rounded-sm bg-transparent" />;
          const lvl = levelFor(cell.count, max);
          return (
            <div
              key={i}
              title={`${cell.date}: ${cell.count} iniciados`}
              className="aspect-square rounded-sm transition-transform hover:scale-110 cursor-pointer"
              style={{ background: LEVEL_BG[lvl] }}
            />
          );
        })}
      </div>
      <div className="flex justify-end items-center gap-1 mt-2 text-[9.5px] text-qc-textSubtle">
        menos
        {LEVEL_BG.map((bg, i) => (
          <div key={i} className="w-2.5 h-2.5 rounded-sm" style={{ background: bg }} />
        ))}
        más
      </div>
    </Card>
  );
}
```

## Followup grid

```tsx
import type { FollowupCell } from '@/types';
import { Card } from '@/components/primitives/Card';
import { SectionTitle } from '@/components/primitives/SectionTitle';
import { IconMessage2 } from '@tabler/icons-react';
import { fmtNumber, fmtPct } from '@/lib/format';

interface FollowupGridProps { cells: FollowupCell[]; }

export function FollowupGrid({ cells }: FollowupGridProps) {
  const totalSent = cells.reduce((s, c) => s + c.sent, 0);
  const totalResp = cells.reduce((s, c) => s + c.responded, 0);
  const respRate = totalSent > 0 ? totalResp / totalSent : null;
  // Ordenar: primero todos los B en orden, luego todos los C
  const sorted = [...cells].sort((a, b) => a.stageSlug.localeCompare(b.stageSlug) || a.sequenceNumber - b.sequenceNumber);
  return (
    <Card>
      <SectionTitle icon={IconMessage2}>Follow-ups del mes</SectionTitle>
      <div className="flex justify-between mb-2.5 text-[11.5px]">
        <span className="text-qc-textMuted">Enviados</span>
        <span className="text-white font-medium">{fmtNumber(totalSent)}</span>
      </div>
      <div className="flex justify-between mb-3 text-[11.5px]">
        <span className="text-qc-textMuted">Respondidos</span>
        <span className="text-qc-success font-medium">{fmtNumber(totalResp)} · {fmtPct(respRate)}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {sorted.map((c) => (
          <div key={`${c.stageSlug}-${c.sequenceNumber}`} className="bg-qc-surface2 border border-qc-border rounded-md px-2.5 py-2">
            <div className="text-[10px] text-qc-teal500 font-medium tracking-wider">{c.sequenceNumber}{c.stageSlug}</div>
            <div className="text-[17px] font-medium text-white leading-none my-1">{fmtNumber(c.sent)}</div>
            <div className="text-[10px] text-qc-textSubtle">{fmtNumber(c.responded)} resp.</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
```

## Insights

### `InsightList.tsx` (server)

```tsx
import type { Insight } from '@/types';
import { Card } from '@/components/primitives/Card';
import { SectionTitle } from '@/components/primitives/SectionTitle';
import { IconBulb } from '@tabler/icons-react';
import { InsightCard } from './InsightCard';

interface InsightListProps { insights: Insight[]; }

export function InsightList({ insights }: InsightListProps) {
  return (
    <Card>
      <SectionTitle icon={IconBulb}>Insights del agente</SectionTitle>
      {insights.length === 0 && <p className="text-[11.5px] text-qc-textMuted">Sin alertas por ahora.</p>}
      <div className="flex flex-col gap-2">
        {insights.map((i, idx) => <InsightCard key={idx} insight={i} />)}
      </div>
    </Card>
  );
}
```

### `InsightCard.tsx` (server)

```tsx
import type { Insight } from '@/types';
import * as TablerIcons from '@tabler/icons-react';

interface InsightCardProps { insight: Insight; }

const TONE: Record<Insight['type'], { iconColor: string; iconBg: string }> = {
  warning: { iconColor: '#fbbf24', iconBg: 'rgba(251,191,36,0.12)' },
  ok:      { iconColor: '#5dcaa5', iconBg: 'rgba(93,202,165,0.12)' },
  info:    { iconColor: '#60a5fa', iconBg: 'rgba(96,165,250,0.12)' },
  ai:      { iconColor: '#c084fc', iconBg: 'rgba(192,132,252,0.12)' },
};

export function InsightCard({ insight }: InsightCardProps) {
  const Icon = (TablerIcons as any)[insight.iconName] ?? TablerIcons.IconBulb;
  const tone = TONE[insight.type];
  return (
    <div className="flex gap-2.5 p-3 bg-qc-surface2 border border-qc-border rounded-md text-[11.5px] leading-relaxed items-start">
      <div
        className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ background: tone.iconBg }}
      >
        <Icon size={14} color={tone.iconColor} />
      </div>
      <div className="flex-1">
        <div className="text-white font-medium mb-0.5">{insight.title}</div>
        <div className="text-qc-textMuted">{insight.body}</div>
        {insight.actionHref && insight.actionLabel && (
          <a href={insight.actionHref} className="text-[10.5px] text-qc-teal500 mt-1 inline-block hover:underline">
            {insight.actionLabel}
          </a>
        )}
      </div>
    </div>
  );
}
```

## Prediction card

```tsx
import type { Prediction } from '@/types';
import { IconSparkles } from '@tabler/icons-react';
import { fmtNumber, fmtPct } from '@/lib/format';

interface PredictionCardProps {
  prediction: Prediction;
  monthLabel: string; // "mayo", "junio"...
}

export function PredictionCard({ prediction, monthLabel }: PredictionCardProps) {
  const pctText = prediction.comparison.pct == null
    ? 'sin mes previo de referencia'
    : `${prediction.comparison.pct > 0 ? '+' : ''}${Math.round(prediction.comparison.pct * 100)}% sobre el mes anterior`;
  return (
    <div
      className="rounded-lg p-4 mt-3"
      style={{
        background: 'linear-gradient(135deg, rgba(13,148,136,0.15) 0%, rgba(13,148,136,0.05) 100%)',
        border: '1px solid rgba(20,184,166,0.3)',
      }}
    >
      <div className="text-[10.5px] text-qc-teal50 uppercase tracking-wider font-medium flex items-center gap-1.5">
        <IconSparkles size={12} /> Predicción de cierre
      </div>
      <div className="text-[28px] font-medium text-white leading-none mt-2 mb-1.5 tracking-tight">
        ~{prediction.projected} bookings
      </div>
      <div className="text-[11px] text-qc-textMuted">
        proyectado fin de {monthLabel} · al ritmo actual, {pctText}
      </div>
    </div>
  );
}
```

## Primitives

### `Card.tsx` (server)

```tsx
import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-qc-surface border border-qc-border rounded-lg p-4 ${className}`}>
      {children}
    </div>
  );
}
```

### `SectionTitle.tsx` (server)

```tsx
import type { Icon } from '@tabler/icons-react';
import type { ReactNode } from 'react';

interface SectionTitleProps { icon?: Icon; children: ReactNode; }

export function SectionTitle({ icon: IconCmp, children }: SectionTitleProps) {
  return (
    <h3 className="text-[12px] font-medium text-qc-textBody flex items-center gap-1.5 mb-3.5 uppercase tracking-wider">
      {IconCmp && <IconCmp size={14} className="text-qc-teal500" />}
      {children}
    </h3>
  );
}
```

### `Pill.tsx` y `Skeleton.tsx`

Pequeños, dejados a discreción de implementación. `Pill` para badges genéricas; `Skeleton` para loaders shimmer.

## Resumen de qué se necesita por Sprint

| Componente | Sprint 0 | Sprint 1 | Sprint 2 | Sprint 3 |
|---|:---:|:---:|:---:|:---:|
| Sidebar, SidebarItem, TenantSelect, TopBar | ✅ | | | |
| Login page + auth components | ✅ | | | |
| Card, SectionTitle, Pill | ✅ | | | |
| KpiCard, LetterBadge, DeltaPill, Sparkline | | ✅ | | |
| MonthlyMatrix, MatrixCell | | ✅ | | |
| FunnelBars, FunnelStageRow, FunnelDropLine | | ✅ | | |
| PeriodSwitcher | | ✅ | | |
| ActiveByStageGrid | | | ✅ | |
| VelocityCard | | | ✅ | |
| MonthHeatmap | | | ✅ | |
| FollowupGrid | | | ✅ | |
| InsightList, InsightCard | | | ✅ | |
| PredictionCard | | | ✅ | |
| (Kanban) | | | | (fuera de scope) |
| Cohort components | | | | ✅ |

Fin del documento 08.
