# Plan: Vista de Prospectos — Tabla tipo Excel

**Contexto:** Sprint 3 del dashboard QC (Quantum Creators). Alex pregunta cómo ver en el panel lo mismo que tiene en su DM Sorcery Tracker Excel: la tabla mensual de leads con nombre, link al perfil de Instagram y colores por etapa alcanzada.

**Referencia:** `docs/api/panel-metricas/01_CONTENT_AND_GOAL.md` + `04_DATA_MODEL_MAPPING.md` + `09_VIEWS_SPECIFICATION.md` + `13_OUT_OF_SCOPE_AND_FUTURE.md` (sección A.1)

---

## 1. Qué quiere ver Alex (referencia visual)

El Excel tiene una hoja por mes (Jan, Feb, ..., Dec). Cada hoja es una tabla con esta estructura:

| Nombre / IG | Profile Link | 1A | MS | 1B | 2B | 3B | Notas |
|---|---|---|---|---|---|---|---|
| Jorge `@jorgeemc5` | instagram.com/jorgeemc5 | 02.2 | 04.2 | 🟢 04.2 | | | |
| Silvia `@vilagallardo` | instagram.com/vilagallardo | 02.2 | 🔴 04.2 | | | | ni |
| Mario `@ruralmetal202` | instagram.com/ruralmetal202 | 02.2 | 04.2 | 🟢 04.2 | 🟠 07.2 | | |

Las columnas de fecha (02.2, 04.2…) son `día.mes` en que ocurrió esa acción.

### Sistema de colores

| Color | Hex | Significado |
|---|---|---|
| **Verde** | `#86EFAC` | El lead AVANZÓ / respondió ese follow-up |
| **Rosa/Salmón** | `#FCA5A5` | Lead activo en esa etapa, aún no avanzó |
| **Naranja** | `#FED7AA` | Follow-up enviado, sin respuesta, ya en otra etapa |
| **Vacío** | — | Sin actividad en esa columna |

---

## 2. Estado actual en el dashboard

`/prospects` muestra un placeholder:
> *"Próximamente: Kanban de prospectos con drag & drop entre etapas — Sprint 3 estimado."*

Archivo: `app/(dashboard)/prospects/page.tsx` — reemplazar completo.

El schema de BD ya tiene todo lo necesario **sin migraciones nuevas**:

- `api.subscribers` → nombre, usuario IG, fecha de entrada
- `api.lead_stages` → etapa actual del lead
- `api.stage_transitions` → historial de cambios de etapa con timestamps
- `api.lead_followup_log` → follow-ups enviados (1B, 2B…) con `sent_at` y `responded_at`
- `api.followup_templates` → catálogo con `sequence_number`

---

## 3. Campos de BD necesarios

| Campo | Tabla | Uso en la UI |
|---|---|---|
| `display_name` | `api.subscribers` | Nombre del lead |
| `ig_username` | `api.subscribers` | Usuario IG → link: `instagram.com/{ig_username}` |
| `first_seen_at` | `api.subscribers` | Fecha en que entró al funnel (columna `1A`) |
| `current_stage` | `api.lead_stages` | Etapa actual del lead (determina el color de fila) |
| `to_stage, created_at` | `api.stage_transitions` | Historial de avance por etapas |
| `sent_at, responded_at` | `api.lead_followup_log` | Follow-ups enviados + si respondió |
| `sequence_number` | `api.followup_templates` | Número del follow-up (1B, 2B, 3B…) |

---

## 4. Lógica de colores

| Condición | Color | Significado |
|---|---|---|
| `responded_at IS NOT NULL` | Verde `#86EFAC` | El lead respondió → avanzó |
| `sent_at NOT NULL` AND `responded_at IS NULL` AND es etapa actual | Salmón `#FCA5A5` | Enviado, sin respuesta, sigue aquí |
| `sent_at NOT NULL` AND `responded_at IS NULL` AND ya pasó a otra etapa | Naranja `#FED7AA` | Enviado, sin respuesta, ya pasó |
| Sin datos | Vacío | Sin actividad |

> **Importante:** el color es por celda individual, no por fila entera. Una misma fila puede tener celdas verdes (etapas alcanzadas) y celdas salmón (etapa actual).

---

## 5. Query principal: `getLeadsForMonth()`

Crear en `lib/metrics/prospects.ts`:

```typescript
// lib/metrics/prospects.ts

export interface FollowupCell {
  stage: string;          // "B" | "C"
  sequence: number;       // 1-8
  sentAt: Date | null;
  respondedAt: Date | null;
}

export interface LeadRow {
  subscriberId: string;
  displayName: string;
  igUsername: string;
  profileUrl: string;             // https://instagram.com/{igUsername}
  initiatedAt: Date;              // first_seen_at → columna "1A"
  currentStage: string;           // A | MS | B | C | D
  mediaSentAt: Date | null;       // lead_content_sent.sent_at → columna "MS"
  transitions: StageTransition[];
  followups: FollowupCell[];      // 1B-8B, 1C-4C
}

export async function getLeadsForMonth({
  tenantId, year, month
}: { tenantId: string; year: number; month: number }): Promise<LeadRow[]> {
  const { start, end } = getPeriodRange(year, month);

  // 1. Subscribers iniciados en el mes
  const subs = await db.select().from(api.subscribers)
    .where(and(
      eq(api.subscribers.tenantId, tenantId),
      gte(api.subscribers.firstSeenAt, start),
      lt(api.subscribers.firstSeenAt, end)
    ))
    .orderBy(api.subscribers.firstSeenAt);

  // 2. Etapa actual
  const stages = await db.select().from(api.lead_stages)
    .where(eq(api.lead_stages.tenantId, tenantId));
  const stageMap = new Map(stages.map(s => [s.subscriberId, s.currentStage]));

  // 3. Media sent
  const mediaSent = await db.select().from(api.lead_content_sent)
    .where(and(
      eq(api.lead_content_sent.tenantId, tenantId),
      gte(api.lead_content_sent.sentAt, start),
      lt(api.lead_content_sent.sentAt, end)
    ));
  const mediaMap = new Map(mediaSent.map(m => [m.subscriberId, m.sentAt]));

  // 4. Transiciones de etapa
  const transitions = await db.select().from(api.stage_transitions)
    .where(eq(api.stage_transitions.tenantId, tenantId))
    .orderBy(api.stage_transitions.createdAt);

  // 5. Follow-ups
  const followups = await db.select({
      subscriberId: api.lead_followup_log.subscriberId,
      sentAt: api.lead_followup_log.sentAt,
      respondedAt: api.lead_followup_log.respondedAt,
      sequence: api.followup_templates.sequenceNumber,
      stage: api.funnel_stages.slug,
    })
    .from(api.lead_followup_log)
    .innerJoin(api.followup_templates,
      eq(api.followup_templates.id, api.lead_followup_log.templateId))
    .innerJoin(api.funnel_stages,
      eq(api.funnel_stages.id, api.followup_templates.stageId))
    .where(eq(api.lead_followup_log.tenantId, tenantId));

  // 6. Ensamblar
  return subs.map(sub => ({
    subscriberId: sub.id,
    displayName: sub.displayName ?? sub.igUsername,
    igUsername: sub.igUsername,
    profileUrl: `https://instagram.com/${sub.igUsername}`,
    initiatedAt: sub.firstSeenAt,
    currentStage: stageMap.get(sub.id) ?? 'A',
    mediaSentAt: mediaMap.get(sub.id) ?? null,
    transitions: transitions.filter(t => t.subscriberId === sub.id),
    followups: followups
      .filter(f => f.subscriberId === sub.id)
      .map(f => ({
        stage: f.stage,
        sequence: f.sequence,
        sentAt: f.sentAt,
        respondedAt: f.respondedAt,
      })),
  }));
}
```

---

## 6. Componentes a crear

| Archivo | Ruta | Responsabilidad |
|---|---|---|
| `StageCell.tsx` | `components/prospects/` | Celda individual. Props: `date?`, `responded?`, `active?`. Devuelve la clase de color correcta. |
| `LeadRow.tsx` | `components/prospects/` | Fila de la tabla. Recibe `LeadRow` completo y renderiza nombre, link y celdas. |
| `ProspectsTable.tsx` | `components/prospects/` | Tabla completa. Pasa props de la query a `LeadRow`. |
| `getLeadsForMonth()` | `lib/metrics/prospects.ts` | Query principal (ver sección 5). |
| `page.tsx` | `app/(dashboard)/prospects/` | Reemplazar el placeholder por la vista real. |

---

## 7. Lógica de color en `StageCell.tsx`

```tsx
// components/prospects/StageCell.tsx

interface StageCellProps {
  date?: Date;           // fecha de la acción en esa celda
  responded?: boolean;   // para followups: si respondió
  active?: boolean;      // si el lead está AHORA en esta etapa
}

function formatDate(d: Date): string {
  // Formato "DD.MM" igual que el Excel
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

export function StageCell({ date, responded, active }: StageCellProps) {
  let bg = '';
  if (!date)          bg = '';
  else if (responded) bg = 'bg-green-300';   // verde: respondió/avanzó
  else if (active)    bg = 'bg-red-200';     // salmón: activo sin avanzar
  else                bg = 'bg-orange-200';  // naranja: enviado, sin respuesta

  return (
    <td className={`px-2 py-1.5 text-[11px] border border-qc-border ${bg}`}>
      {date ? formatDate(date) : ''}
    </td>
  );
}
```

---

## 8. Vista `/prospects` actualizada

Reemplazar el contenido actual de `app/(dashboard)/prospects/page.tsx`:

```tsx
// app/(dashboard)/prospects/page.tsx
import { getActiveTenant } from '@/lib/tenant';
import { getLeadsForMonth } from '@/lib/metrics/prospects';
import { ProspectsTable } from '@/components/prospects/ProspectsTable';
import { TopBar } from '@/components/shell/TopBar';
import { PeriodSwitcher } from '@/components/shell/PeriodSwitcher';
import { MONTH_LABELS_LONG_ES } from '@/lib/format';

export const revalidate = 30;

export default async function ProspectsPage({
  searchParams,
}: { searchParams: { year?: string; month?: string } }) {
  const now = new Date();
  const year = parseInt(searchParams.year ?? String(now.getUTCFullYear()), 10);
  const month = parseInt(searchParams.month ?? String(now.getUTCMonth() + 1), 10);

  const tenant = await getActiveTenant();
  const leads = await getLeadsForMonth({ tenantId: tenant.id, year, month });

  const monthLabel = MONTH_LABELS_LONG_ES[month - 1] ?? String(month);

  // PeriodSwitcher: mes anterior / actual / siguiente (igual que en /month)
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;

  const switcherOptions = [
    { label: MONTH_LABELS_LONG_ES[prevMonth - 1].slice(0, 3),
      href: `/prospects?year=${prevYear}&month=${prevMonth}` },
    { label: monthLabel.slice(0, 3),
      href: `/prospects?year=${year}&month=${month}`, active: true },
    { label: MONTH_LABELS_LONG_ES[nextMonth - 1].slice(0, 3),
      href: `/prospects?year=${nextYear}&month=${nextMonth}` },
  ];

  return (
    <div className="px-6 py-5">
      <TopBar
        title={`Prospectos · ${monthLabel} ${year}`}
        badge={{ label: 'en vivo' }}
        right={<PeriodSwitcher options={switcherOptions} />}
      />
      <div className="overflow-x-auto">
        <ProspectsTable leads={leads} />
      </div>
    </div>
  );
}
```

---

## 9. Criterios de aceptación (DoD)

- [ ] La tabla muestra una fila por cada lead iniciado en el mes seleccionado
- [ ] Cada fila tiene: nombre (`display_name` o `ig_username` si no hay) + link clicable al perfil de IG
- [ ] La columna `1A` muestra `first_seen_at` en formato `DD.MM`
- [ ] La columna `MS` muestra `lead_content_sent.sent_at` en formato `DD.MM`
- [ ] Las columnas `1B`, `2B`, `3B`, `4B` muestran los follow-ups de etapa B con colores correctos
- [ ] Las columnas `1C`, `2C` muestran los follow-ups de etapa C con colores correctos
- [ ] Verde = `responded_at IS NOT NULL`
- [ ] Salmón = `sent_at NOT NULL` AND `responded_at IS NULL` AND es etapa actual del lead
- [ ] Naranja = `sent_at NOT NULL` AND `responded_at IS NULL` AND lead ya pasó a otra etapa
- [ ] Celdas vacías = sin dato, en blanco (nunca mostrar `0` ni `null`)
- [ ] Hay PeriodSwitcher para cambiar mes/año
- [ ] La tabla es scrollable horizontalmente si hay muchas columnas
- [ ] Todos los queries filtran por `tenantId`

---

## 10. Lo que NO entra (según `docs/api/panel-metricas/13_OUT_OF_SCOPE_AND_FUTURE.md`)

- **Drag & drop / Kanban** → Sprint posterior
- **Mutaciones a la BD** → el panel solo lee, nunca escribe
- **Foto de perfil de IG** → requiere Instagram Graph API, fuera de scope
- **Filtros, búsqueda, paginación virtual** → si hay <200 leads/mes no es urgente
- **Edición inline de notas** → el SPA admin cubre esto

---

## 11. Orden de implementación

1. Crear `lib/metrics/prospects.ts` con `getLeadsForMonth()` y los tipos `LeadRow` / `FollowupCell`
2. Crear `components/prospects/StageCell.tsx` con la lógica de colores
3. Crear `components/prospects/LeadRow.tsx` que usa `StageCell`
4. Crear `components/prospects/ProspectsTable.tsx` con la tabla completa
5. Reemplazar `app/(dashboard)/prospects/page.tsx` con la vista real (sección 8)
6. Verificar en local con seed QC que los colores son correctos
7. El sidebar ya tiene `SidebarItem href="/prospects"` — con la ruta real ya no muestra placeholder

---

## Notas para Claude Code

- El panel **solo lee BD, nunca escribe**. Ninguna Server Action de mutación.
- Todos los queries filtran por `tenantId` — nunca sin él.
- Si `ig_username` es null → mostrar `—` en nombre y deshabilitar el link.
- Los colores deben usar clases Tailwind del sistema `qc-*` donde sea posible, no hex hardcodeados en JSX.
- `formatDate` debe devolver `"DD.MM"` (ej: `"04.2"`) igual que el Excel — sin padding de ceros en el mes.
- Verificar con el seed QC que los slugs de etapa son literalmente `"A"`, `"MS"`, `"B"`, `"C"`, `"D"` antes de filtrar (ver `04_DATA_MODEL_MAPPING.md` sección "Validación del mapeo").
