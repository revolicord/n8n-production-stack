# 06 — Estructura de carpetas de `apps/dashboard/`

> Árbol completo de archivos a crear, con la responsabilidad exacta de cada uno.

## Vista general

```
apps/dashboard/
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md
├── biome.json                    ← extiende el raíz
├── next.config.mjs
├── next-env.d.ts                 ← generado por Next, no tocar
├── package.json
├── postcss.config.mjs
├── public/
│   ├── favicon.svg               ← reusar el del SPA admin
│   └── og-image.png              ← opcional, og:image para previews
├── tailwind.config.ts
├── tsconfig.json
└── src/
    ├── app/
    │   ├── globals.css
    │   ├── layout.tsx
    │   ├── page.tsx              ← redirige a /year/<year-current>
    │   ├── login/
    │   │   └── page.tsx
    │   ├── (dashboard)/          ← grupo de rutas con auth
    │   │   ├── layout.tsx        ← sidebar + topbar shell
    │   │   ├── year/
    │   │   │   └── [year]/
    │   │   │       └── page.tsx
    │   │   ├── month/
    │   │   │   └── [year]/
    │   │   │       └── [month]/
    │   │   │           └── page.tsx
    │   │   ├── funnel/
    │   │   │   └── page.tsx
    │   │   ├── prospects/        ← Sprint 3, en Sprint 1 placeholder
    │   │   │   └── page.tsx
    │   │   ├── velocity/         ← Sprint 2
    │   │   │   └── page.tsx
    │   │   └── cohorts/          ← Sprint 3
    │   │       └── page.tsx
    │   └── api/
    │       └── auth/
    │           ├── login/
    │           │   └── route.ts
    │           └── logout/
    │               └── route.ts
    ├── middleware.ts             ← protege /(dashboard)/* exigiendo cookie
    ├── components/
    │   ├── shell/
    │   │   ├── Sidebar.tsx
    │   │   ├── SidebarItem.tsx
    │   │   ├── TenantSelect.tsx
    │   │   ├── TopBar.tsx
    │   │   └── PeriodSwitcher.tsx
    │   ├── kpi/
    │   │   ├── KpiCard.tsx
    │   │   ├── DeltaPill.tsx
    │   │   ├── Sparkline.tsx
    │   │   └── LetterBadge.tsx
    │   ├── matrix/
    │   │   ├── MonthlyMatrix.tsx
    │   │   └── MatrixCell.tsx
    │   ├── funnel/
    │   │   ├── FunnelBars.tsx
    │   │   ├── FunnelStageRow.tsx
    │   │   ├── FunnelDropLine.tsx
    │   │   └── ActiveByStageGrid.tsx
    │   ├── velocity/
    │   │   └── VelocityCard.tsx
    │   ├── heatmap/
    │   │   └── MonthHeatmap.tsx
    │   ├── followups/
    │   │   └── FollowupGrid.tsx
    │   ├── insights/
    │   │   ├── InsightList.tsx
    │   │   └── InsightCard.tsx
    │   ├── prediction/
    │   │   └── PredictionCard.tsx
    │   └── primitives/
    │       ├── Card.tsx
    │       ├── SectionTitle.tsx
    │       ├── Pill.tsx
    │       └── Skeleton.tsx
    ├── lib/
    │   ├── db.ts
    │   ├── auth.ts
    │   ├── tenant.ts
    │   ├── stages.ts
    │   ├── format.ts              ← pct, number, days
    │   ├── theme.ts               ← color tokens TS-side si hace falta
    │   └── metrics/
    │       ├── _helpers.ts
    │       ├── funnel.ts
    │       ├── timeseries.ts
    │       ├── velocity.ts
    │       ├── heatmap.ts
    │       ├── followups.ts
    │       ├── prediction.ts
    │       └── insights.ts
    └── types/
        └── index.ts               ← tipos compartidos UI ↔ metrics
```

## Detalle por archivo

### Raíz del proyecto

**`apps/dashboard/package.json`** — Define el paquete, dependencias, scripts:

```json
{
  "name": "@revolicord/dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "biome lint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest"
  },
  "dependencies": {
    "@revolicord/db": "workspace:*",
    "@tabler/icons-react": "^3.0.0",
    "drizzle-orm": "<misma version que packages/db>",
    "jose": "^5.9.0",
    "next": "^15.0.0",
    "postgres": "<misma version que packages/db>",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "autoprefixer": "^10",
    "postcss": "^8",
    "tailwindcss": "^3.4",
    "typescript": "^5",
    "vitest": "^2"
  }
}
```

> Ajustar versiones exactas a las del raíz `package.json` (Drizzle, postgres-js, vitest). NO subir versiones que ya existen en otros paquetes.

**`apps/dashboard/tsconfig.json`** — Extiende el `tsconfig.base.json` del repo, añade `paths` para `@/*`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    },
    "jsx": "preserve",
    "incremental": true,
    "moduleResolution": "bundler"
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**`apps/dashboard/next.config.mjs`** — Output standalone para Docker, server externals para Drizzle:

```js
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@revolicord/db'],
  experimental: {
    typedRoutes: true,
  },
};
export default nextConfig;
```

**`apps/dashboard/tailwind.config.ts`** — Ver doc 02 sección "Paleta exacta" para el contenido completo.

**`apps/dashboard/biome.json`**:

```json
{ "extends": ["../../biome.json"] }
```

**`apps/dashboard/.env.example`**:

```
DATABASE_URL=postgres://user:pass@localhost:5432/n8n
PANEL_PASSWORD=changeme
PANEL_JWT_SECRET=<openssl rand -hex 32>
```

### `src/app/` — rutas y layouts

**`src/app/layout.tsx`** — Root layout. HTML, body, importa globals.css. No tiene UI propia; los grupos de rutas tienen sus layouts.

**`src/app/globals.css`** — Tailwind directives + reset mínimo:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body { height: 100%; }
body {
  background: #0d0d0d;
  color: #e5e7eb;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

**`src/app/page.tsx`** — Redirige a la vista anual del año actual:

```tsx
import { redirect } from 'next/navigation';

export default function HomePage() {
  const year = new Date().getUTCFullYear();
  redirect(`/year/${year}`);
}
```

**`src/app/login/page.tsx`** — Página de login (ver doc 07 para implementación completa).

**`src/app/(dashboard)/layout.tsx`** — Layout con sidebar + main. Aplica a todas las rutas del grupo. Es un Server Component que carga `tenant` y `stages` y los pasa a `<Sidebar />`:

```tsx
import { Sidebar } from '@/components/shell/Sidebar';
import { TopBar } from '@/components/shell/TopBar';
import { getActiveTenant } from '@/lib/tenant';
import { getStagesForTenant } from '@/lib/stages';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getActiveTenant();
  const stages = await getStagesForTenant(tenant.id);

  return (
    <div className="flex h-screen overflow-hidden bg-qc-bg text-qc-textBody">
      <Sidebar tenant={tenant} stages={stages} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
```

**`src/app/(dashboard)/year/[year]/page.tsx`** — Vista Anual. Ver doc 09 para layout completo y queries.

**`src/app/(dashboard)/month/[year]/[month]/page.tsx`** — Vista Mensual. Ver doc 09.

**`src/app/(dashboard)/funnel/page.tsx`** — Vista Funnel. Ver doc 09.

**`src/app/(dashboard)/prospects/page.tsx`** — Placeholder Sprint 1:

```tsx
export default function ProspectsPage() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-medium text-white mb-2">Prospectos</h1>
      <p className="text-sm text-qc-textMuted">Próximamente: Kanban de prospectos con drag & drop entre etapas.</p>
    </div>
  );
}
```

Igual para `velocity/` y `cohorts/`.

**`src/app/api/auth/login/route.ts`** y **`logout/route.ts`** — Endpoints de auth. Ver doc 07.

### `src/middleware.ts` — proteger rutas

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { verifyPanelSession } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  // Excluir /login y assets
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/login') || pathname.startsWith('/_next') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }
  const cookie = req.cookies.get('panel_session')?.value;
  const valid = cookie ? await verifyPanelSession(cookie) : false;
  if (!valid) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon|.*\\.svg).*)'],
};
```

### `src/components/`

Cada componente es un archivo .tsx con props tipadas y un único default export. Ver doc 08 para la especificación visual + props de cada uno.

**Componente Server vs Client:** por defecto Server Component. Marcar `'use client'` SOLO si:

- Usa hooks (`useState`, `useEffect`).
- Tiene event handlers (`onClick`, `onChange`).
- Necesita `localStorage` o APIs de navegador.

En la primera iteración, componentes que necesitan ser cliente: `Sidebar` (selección activa visual), `TenantSelect` (cambio de tenant), `PeriodSwitcher` (cambio de año/mes via `useRouter`), `MatrixCell` (hover cross-highlight).

### `src/lib/`

**`src/lib/db.ts`** — Cliente Drizzle propio (ver doc 03 para el snippet completo).

**`src/lib/auth.ts`** — Funciones de auth con `jose`:

```ts
import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.PANEL_JWT_SECRET!);

export async function createPanelSession(): Promise<string> {
  return new SignJWT({ kind: 'panel' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

export async function verifyPanelSession(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}
```

**`src/lib/tenant.ts`**, **`src/lib/stages.ts`** — Ver doc 05.

**`src/lib/format.ts`** — Helpers de formateo UI:

```ts
export function fmtNumber(n: number): string {
  return new Intl.NumberFormat('es-ES').format(n);
}

export function fmtPct(p: number | null, decimals = 0): string {
  if (p == null) return '—';
  return `${(p * 100).toFixed(decimals)}%`;
}

export function fmtDays(d: number | null): string {
  if (d == null) return '—';
  return `${d.toFixed(1)} días`;
}

export function fmtDelta(d: number): string {
  const sign = d > 0 ? '+' : '';
  return `${sign}${d}%`;
}

export const MONTH_LABELS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
export const MONTH_LABELS_LONG_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
```

**`src/lib/metrics/*`** — Ver doc 05 para implementación completa.

### `src/types/index.ts`

Re-exporta los tipos de las funciones de métricas para que la UI no tenga que importar de varios sitios:

```ts
export type {
  FunnelCounts, FunnelRatios, FunnelView, ActiveByStage,
} from '@/lib/metrics/funnel';
export type { MonthlySeries } from '@/lib/metrics/timeseries';
export type { Velocity } from '@/lib/metrics/velocity';
export type { HeatmapDay } from '@/lib/metrics/heatmap';
export type { FollowupCell } from '@/lib/metrics/followups';
export type { Prediction } from '@/lib/metrics/prediction';
export type { Insight, InsightType } from '@/lib/metrics/insights';
```

## Workspace integration

**`pnpm-workspace.yaml`** (raíz) — verificar que `apps/*` está incluido. Si lo está, no tocar. Si no, añadir.

**`tsconfig.base.json`** (raíz) — verificar que tiene `compilerOptions.paths` para `@revolicord/*`. Si no, añadir:

```json
{
  "paths": {
    "@revolicord/db": ["./packages/db/src/index.ts"],
    "@revolicord/db/*": ["./packages/db/src/*"]
  }
}
```

## Archivos que NO se crean en Sprint 0/1

- `src/app/(dashboard)/cohorts/page.tsx` — Sprint 3.
- `src/app/(dashboard)/velocity/page.tsx` — Sprint 2 lo expande. Placeholder en Sprint 1.
- `src/components/cohort/*` — Sprint 3.
- `src/components/kanban/*` — Sprint 3 (Kanban de prospectos, fuera de scope).
- Tests: en Sprint 0 cubrir solo `_helpers.ts` y `format.ts`. Más tests en sprints siguientes (ver doc 12).

Fin del documento 06.
