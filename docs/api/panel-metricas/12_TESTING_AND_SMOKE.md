# 12 — Testing y smoke checklist

> Checklist manual end-to-end por sprint. Tests automatizados están descritos en cada doc de sprint; esto es el complemento manual que **siempre** debe correrse antes de cerrar el sprint.

## Filosofía de testing en este paquete

El panel es **principalmente lectura** sobre BD existente. Eso simplifica drásticamente el QA:

- **Sí cubrir automatizadamente:**
  - Helpers puros (`format.ts`, `_helpers.ts`): tests unitarios completos.
  - Funciones de métricas que tienen lógica derivada (ratios, predicciones, insights): tests con datos sintéticos.
- **No cubrir automatizadamente:**
  - Queries Drizzle contra BD real (esto vive en tests del package `db`, no aquí).
  - Render de componentes pixel-perfect (visual; manual contra mockups).
  - Auth flow (manual con curl según doc 11).

Stack: **vitest**, alineado con el resto del repo. Tests al lado del fichero con `*.test.ts`.

---

## Tests automatizados mínimos por sprint

### Sprint 0

```
src/lib/format.test.ts
src/lib/metrics/_helpers.test.ts
```

**`format.test.ts`** — 4 tests obligatorios:

```ts
import { describe, it, expect } from 'vitest';
import { fmtNumber, fmtPct, fmtDays, fmtDelta } from './format';

describe('format', () => {
  it('fmtNumber formats with es-ES separators', () => {
    expect(fmtNumber(2847)).toBe('2.847');
    expect(fmtNumber(0)).toBe('0');
  });

  it('fmtPct returns em dash for null', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(0.43, 0)).toBe('43%');
    expect(fmtPct(0.051, 1)).toBe('5.1%');
  });

  it('fmtDays handles null', () => {
    expect(fmtDays(null)).toBe('—');
    expect(fmtDays(6.5)).toBe('6.5 días');
  });

  it('fmtDelta prefixes positives with plus', () => {
    expect(fmtDelta(12)).toBe('+12%');
    expect(fmtDelta(-3)).toBe('-3%');
    expect(fmtDelta(0)).toBe('+0%');
  });
});
```

**`_helpers.test.ts`** — 3 tests obligatorios:

```ts
import { describe, it, expect } from 'vitest';
import { safeDivide, getPeriodRange } from './_helpers';

describe('safeDivide', () => {
  it('returns null on zero denominator', () => {
    expect(safeDivide(10, 0)).toBeNull();
    expect(safeDivide(0, 0)).toBeNull();
  });
  it('returns ratio when valid', () => {
    expect(safeDivide(50, 100)).toBe(0.5);
  });
});

describe('getPeriodRange', () => {
  it('returns whole-year range when month omitted', () => {
    const r = getPeriodRange(2026);
    expect(r.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(r.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('returns month range with December crossing year', () => {
    const r = getPeriodRange(2026, 12);
    expect(r.start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(r.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
```

### Sprint 1

Añadir:

```
src/lib/metrics/funnel.test.ts       — solo ratiosFromCounts (puro)
src/lib/metrics/prediction.test.ts   — proyección lineal (puro, no toca BD)
```

**`funnel.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { ratiosFromCounts } from './funnel';

describe('ratiosFromCounts', () => {
  it('computes 8 ratios from typical counts', () => {
    const r = ratiosFromCounts({ a: 100, ms: 40, b: 20, c: 5, d: 2 });
    expect(r.msr).toBe(0.4);
    expect(r.prr).toBe(0.2);
    expect(r.csr).toBe(0.05);
    expect(r.abr).toBe(0.02);
    expect(r.msToB).toBe(0.5);
    expect(r.bToC).toBe(0.25);
    expect(r.cToD).toBe(0.4);
  });

  it('returns null when denominator is zero', () => {
    const r = ratiosFromCounts({ a: 0, ms: 0, b: 0, c: 0, d: 0 });
    expect(r.msr).toBeNull();
    expect(r.msToB).toBeNull();
  });

  it('partial zero only nullifies the affected ratio', () => {
    const r = ratiosFromCounts({ a: 100, ms: 0, b: 5, c: 1, d: 0 });
    expect(r.msr).toBe(0);
    expect(r.msToB).toBeNull(); // ms = 0
    expect(r.bToC).toBe(0.2);
    expect(r.cToD).toBe(0);
  });
});
```

**`prediction.test.ts`** — Aislar la lógica de proyección de la query a BD. Refactorizar `getMonthPrediction` para extraer una función pura `projectFromRate(current, daysElapsed, daysInMonth)` que se pueda testear sin BD.

```ts
import { describe, it, expect } from 'vitest';
import { projectFromRate } from './prediction';

describe('projectFromRate', () => {
  it('projects linear rate to month end', () => {
    expect(projectFromRate(5, 15, 30)).toBe(10); // 5/15 * 30
  });

  it('handles day 1 of month without dividing by zero', () => {
    expect(projectFromRate(0, 1, 30)).toBe(0);
  });

  it('saturates at days elapsed = days in month', () => {
    expect(projectFromRate(20, 30, 30)).toBe(20);
  });
});
```

### Sprint 2

Añadir:

```
src/lib/metrics/heatmap.test.ts      — levelFor con percentiles
src/lib/metrics/insights.test.ts     — cada regla con datos sintéticos
src/lib/metrics/velocity.test.ts     — solo composición de aToD (puro)
```

**`heatmap.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { levelFor } from './heatmap';

describe('levelFor', () => {
  it('returns 0 for zero count regardless of max', () => {
    expect(levelFor(0, 100)).toBe(0);
    expect(levelFor(0, 0)).toBe(0);
  });

  it('bucket boundaries', () => {
    expect(levelFor(10, 100)).toBe(1); // 10% < 25%
    expect(levelFor(25, 100)).toBe(2); // 25% inclusive en lvl 2
    expect(levelFor(50, 100)).toBe(3);
    expect(levelFor(75, 100)).toBe(4);
    expect(levelFor(100, 100)).toBe(4);
  });
});
```

**`insights.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { buildInsights } from './insights';

const baseSeries = {
  year: 2026,
  months: [],
  totals: { a: 0, ms: 0, b: 0, c: 0, d: 0 },
  avgRatios: { msr: 0.4, prr: 0.18, csr: 0.05, abr: 0.013, aToMs: 0.4, msToB: 0.4, bToC: 0.3, cToD: 0.3 },
};

describe('buildInsights — Rule 1 (B→C bottleneck)', () => {
  it('fires when current bToC is below 90% of historical', () => {
    const insights = buildInsights({
      current: { counts: { a: 100, ms: 40, b: 20, c: 4, d: 1 }, ratios: { /* ... */ bToC: 0.2 } as any, drops: {} as any },
      yearSeries: baseSeries,
      velocity: { aToMs: null, msToB: null, bToC: null, cToD: null, aToD: null },
      active: { a: 0, ms: 0, b: 0, c: 0, d: 0 },
    });
    expect(insights.find((i) => i.title.includes('B→C'))).toBeDefined();
  });

  it('does not fire when current bToC is within 10% of historical', () => {
    const insights = buildInsights({
      current: { counts: { a: 100, ms: 40, b: 20, c: 6, d: 2 }, ratios: { /* ... */ bToC: 0.3 } as any, drops: {} as any },
      yearSeries: baseSeries,
      velocity: { aToMs: null, msToB: null, bToC: null, cToD: null, aToD: null },
      active: { a: 0, ms: 0, b: 0, c: 0, d: 0 },
    });
    expect(insights.find((i) => i.title.includes('B→C'))).toBeUndefined();
  });
});
```

Repetir patrón para Rule 2, Rule 3, Rule 4.

### Sprint 3

Añadir tests de cohortes (función pura que arma la matriz semana × edad) y tests del rango de predicción (proyección con upper/lower bound).

---

## Smoke test manual (e2e) por sprint

> Hacer **siempre** en navegador real, sin caché (DevTools → Network → Disable cache). Sin esto, falsos positivos.

### Smoke Sprint 0

| # | Acción | Resultado esperado |
|---|---|---|
| 0.1 | Abrir `http://localhost:3001` | Redirige a `/login` |
| 0.2 | Entrar con password incorrecta | Mensaje "Contraseña incorrecta", no se setea cookie |
| 0.3 | Entrar con password correcta | Redirige a `/year/<año>`, ves nombre "Quantum Creators" |
| 0.4 | Recargar `/year/<año>` | Sigue mostrando el contenido (cookie persiste) |
| 0.5 | Devtools → Application → Cookies | `panel_session` aparece con `HttpOnly ✓`, `Secure: depende env`, `SameSite: Lax` |
| 0.6 | Click en cualquier item del sidebar | Navega; el item se marca activo (border-left teal) |
| 0.7 | Click en "Cerrar sesión" | Cookie eliminada, redirige a `/login` |
| 0.8 | Volver atrás en el navegador | No muestra contenido protegido, redirige a `/login` |
| 0.9 | DevTools → Console | Sin errores en rojo |
| 0.10 | DevTools → Network → `_next/static/*` | Todos 200 o 304, ninguno 404 |

### Smoke Sprint 1

| # | Acción | Resultado esperado |
|---|---|---|
| 1.1 | Visitar `/year/<año-actual>` con datos reales en BD | KPI cards muestran totales del año, no ceros |
| 1.2 | Inspeccionar sparkline de Initiated | Tiene 12 puntos, línea visible, sin valores negativos |
| 1.3 | Inspeccionar matriz | 9 filas (A, MS, B, C, D, MSR, PRR, CSR, ABR), 13 columnas (12 meses + Total) |
| 1.4 | Meses con datos | Muestran números formateados (`2.847` con punto separador) |
| 1.5 | Meses futuros | Muestran `—` no `0` |
| 1.6 | Click en celda de un mes con datos | Navega a `/month/<año>/<mes>` |
| 1.7 | Funnel del año | 5 barras, widths decrecientes, drop lines en rojo entre cada par |
| 1.8 | Insights en columna derecha | Máximo 3 cards visibles |
| 1.9 | Cambiar año en period switcher | Datos cambian, URL se actualiza |
| 1.10 | Vista mensual: KPIs | 5 cards con "X por día" como hint |
| 1.11 | Vista mensual: ratio ribbon | 8 ratios visibles en una banda |
| 1.12 | Vista mensual: velocity card | 4 transiciones + total A→D, valores plausibles |
| 1.13 | Vista mensual: predicción | Card con gradiente teal, número "~X bookings" |
| 1.14 | Click breadcrumb del año en vista mes | Vuelve a `/year/<año>` |
| 1.15 | Navegar mes anterior con `< Abr` | URL actualiza, datos cambian |
| 1.16 | Navegar de enero al año anterior | URL: `/month/<año-1>/12` |
| 1.17 | DevTools → Network → cualquier request al panel | Tiempo de respuesta razonable (<2s) |
| 1.18 | Refrescar tras 30s | Datos pueden cambiar si hubo cambios en BD (revalidate funciona) |

### Smoke Sprint 2

| # | Acción | Resultado esperado |
|---|---|---|
| 2.1 | Visitar `/funnel?period=month` | Header "Funnel", sección "Prospectos activos ahora" con 5 cards |
| 2.2 | Active by stage | Los 5 conteos suman a un número plausible de subscribers activos |
| 2.3 | Cambiar a `?period=7d` | URL actualiza, datos del último 7d, conteos pueden ser menores |
| 2.4 | Insights | Aparecen al menos 2-3, ninguno vacío, cada uno con icon y color correcto |
| 2.5 | Insight de "B→C" si aplica | Action link "Ver follow-ups" presente y clickable |
| 2.6 | Predicción solo en `period=month` | En `period=7d` o `30d` no aparece |
| 2.7 | Vista mensual: heatmap | 5 filas × 7 cols (DOW), niveles de intensidad visibles |
| 2.8 | Hover sobre celda del heatmap | Tooltip nativo con fecha y count |
| 2.9 | Días futuros del mes en curso | Vacíos / nivel 0 |
| 2.10 | Vista mensual: followup grid | Cells `1B`, `2B`, etc., conteos plausibles |
| 2.11 | KPI cards en vista anual | Fade-up animation al cargar, stagger de 50ms |
| 2.12 | Funnel bars | Llenado animado de izquierda a derecha al entrar a vista funnel |
| 2.13 | Hover sobre celda de matriz | Cross-highlight de fila + columna |
| 2.14 | Recargar vista funnel varias veces | Sin parpadeos visibles, sin layout shifts |

### Smoke Sprint 3

| # | Acción | Resultado esperado |
|---|---|---|
| 3.1 | `/cohorts` | Tabla de cohortes semanal con celdas coloreadas |
| 3.2 | Cohortes con pocas semanas de datos | Solo las semanas con datos, no inventar |
| 3.3 | `/velocity` | Gráfico de líneas, top subscribers list |
| 3.4 | Toggle de tema Wow | Estilos cambian al instante (glassmorphism, gradientes) |
| 3.5 | Recargar tras toggle | Tema persiste (localStorage) |
| 3.6 | Predicción anual | Muestra rango "~85–105 bookings" |
| 3.7 | `/prospects` | Sigue siendo placeholder "Próximamente" (NO se implementa el Kanban) |

---

## Validación de datos contra fuente

**Antes de cerrar Sprint 1**, hacer este cross-check con Alex o con el Excel histórico:

1. Pedirle a Alex el Excel del último mes cerrado.
2. Tomar el conteo A, MS, B, C, D según el Excel.
3. Tomar los mismos del panel para ese mes.
4. Diferencia esperada: **<5% en cualquier métrica**.
5. Si difiere más:
   - Verificar que el seed QC corresponde al periodo real.
   - Verificar el slug de las transitions (mayúsculas/minúsculas, ver doc 04).
   - Verificar el campo de tiempo (`first_seen_at` vs `created_at`).
   - Verificar timezone (UTC vs `America/Mexico_City`).

Documentar discrepancias en un issue antes de "cerrar" el sprint.

---

## Performance smoke (Sprint 2+)

```
Lighthouse → Performance score ≥ 85 en mobile
TTFB de /year/<año> < 500ms en producción
Time to Interactive < 2s con conexión cable
```

Si no se cumple:

- Sospechar `getMonthlySeries` (48 queries naive). Considerar la versión agregada en SQL.
- Verificar que `revalidate = 30` está activo y no se está re-rendereando cada navegación.
- Verificar que los Server Components no son `'use client'` accidentalmente.

---

## Pre-merge checklist (para cada PR)

- [ ] `pnpm --filter @revolicord/dashboard typecheck` → verde
- [ ] `pnpm --filter @revolicord/dashboard lint` → verde
- [ ] `pnpm --filter @revolicord/dashboard test` → verde
- [ ] `pnpm --filter @revolicord/dashboard build` → completa sin warnings críticos
- [ ] Smoke test del sprint correspondiente: todos los items marcados
- [ ] No hay `console.log` olvidados (excepto `console.error` legítimos)
- [ ] No hay TODO sin issue asociado
- [ ] `.env.example` actualizado si se añade alguna variable
- [ ] Doc actualizado si se cambia algo del contrato (queries, rutas, schema)

---

## Logs que SÍ deben estar en producción

```ts
// Errores de queries críticas
console.error('[metrics:funnel]', err);

// Auth fallida (para detectar abuse)
console.warn('[auth] invalid login attempt');
```

Logs que NUNCA deben estar:

- Contenido de cookies o JWTs.
- `DATABASE_URL`.
- Cualquier PII de subscribers (usernames, links) en stdout — solo en BD.

Fin del documento 12.
