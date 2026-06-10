# 14 · Vista Kanban de Prospectos (read-only)

**Estado:** ✅ Implementado y en producción (`dashboard.revolicord.com/prospects`)
**Commit:** `77cafb8 feat(dashboard): añadir vista Kanban (read-only) en pestaña Prospectos`
**Fecha:** 2026-05-29

---

## 1. Contexto

La pestaña `/prospects` ya tenía **una sola vista**: la tabla estilo Excel de Alex
(columna `Lead` combinada + celdas de fecha/color `1A`, `MS`, `1B`, `2B`, `1C`…),
documentada en `Plan vista prospectos.md`. Ese plan dejó el **Kanban explícitamente
fuera de alcance** ("Sprint posterior", sección 10).

Este cambio implementa ese Kanban como **segunda vista conmutable**, sin tocar la tabla
existente.

### Decisiones confirmadas con el usuario

1. **Toggle de vistas** en `/prospects`: `Tabla` (la Excel actual, intacta) ↔ `Kanban`.
2. El **Kanban es un board por etapas**: una columna por etapa del funnel
   (A, MS, B, C, D + terminales). Cada lead es una **tarjeta** que muestra el **nombre
   del lead** y el **@usuario** como dos campos separados.
3. **Solo lectura, sin drag & drop.** Respeta la regla de `CLAUDE.md`: *el panel solo lee
   BD, nunca escribe*. Cero migraciones, cero endpoints, cero mutaciones.

> Nota de diseño: la petición original "una columna para el nombre y otra para el usuario"
> se materializa **dentro de cada tarjeta** (Nombre arriba, @usuario debajo), no como
> columnas de tabla.

---

## 2. Qué se construyó

Un toggle `Tabla | Kanban` en la cabecera de `/prospects` (vía `?view=`), que alterna entre:

- **Tabla** (default) — la vista Excel existente, sin cambios.
- **Kanban** — board read-only con una columna por etapa del funnel:
  - Cabecera de columna = `displayName` de la etapa + **badge con el conteo** de leads.
  - Tarjetas con **Nombre** (`display_name`) y **@usuario** (`ig_username`, enlace a IG).
  - Fecha de inicio (`first_seen_at`) en formato `DD.M`.
  - Columnas vacías muestran "Sin leads".
  - **Columnas extra** al final para etapas presentes en los datos pero fuera del catálogo
    activo (p. ej. `disqualified`, `lost`, `escalated_human_call`) → ningún lead se pierde.

El **periodo (mes/año) y la vista se preservan** mutuamente al cambiar uno u otro.

---

## 3. Arquitectura y reutilización

El Kanban **no añade queries nuevas de leads**: reutiliza los datos que ya devuelve
`getLeadsForMonth()` (cada `LeadRow` ya trae `currentStage`). Solo necesita además la
lista de etapas ordenadas, que ya provee `getStagesForTenant()`.

```
/prospects (Server Component, revalidate=30)
  ├─ getActiveTenant()
  ├─ getLeadsForMonth({ tenantId, year, month })   → leads (con currentStage) + columnas
  └─ view === 'kanban' ? getStagesForTenant(tenantId) : []
        │
        ├─ view='table'  → <ProspectsTable columns={...} leads={...} />   (sin cambios)
        └─ view='kanban' → <ProspectsKanban leads={...} stages={...} />
                              └─ agrupa leads por currentStage → columnas
                                 └─ <LeadCard lead={...} />  (Nombre + @usuario + fecha)
```

La selección de vista es por `searchParams` (`?view=kanban`), **sin estado de cliente**,
coherente con el SSR + `revalidate = 30` del resto del panel.

---

## 4. Archivos

| Archivo | Tipo | Responsabilidad |
|---|---|---|
| `apps/dashboard/src/lib/format.ts` | mod | Nuevo helper `fmtDayMonth(d)` → formato `"DD.M"` (Excel) |
| `apps/dashboard/src/components/prospects/StageCell.tsx` | mod | Usa `fmtDayMonth` compartido (se eliminó el `formatCellDate` duplicado) |
| `apps/dashboard/src/components/prospects/LeadCard.tsx` | **nuevo** | Tarjeta de lead: Nombre + @usuario (enlace IG) + fecha de inicio |
| `apps/dashboard/src/components/prospects/ProspectsKanban.tsx` | **nuevo** | Board: agrupa leads por `currentStage`, columnas por etapa + extra |
| `apps/dashboard/src/app/(dashboard)/prospects/page.tsx` | mod | Lee `?view=`, fetch de etapas en modo kanban, toggle (reusa `PeriodSwitcher`), render condicional |

Reutilizaciones clave:
- `getLeadsForMonth()` / tipos `LeadRow`, `FollowupColumn` — `lib/metrics/prospects.ts`
- `getStagesForTenant()` / tipo `Stage` — `lib/stages.ts`
- `PeriodSwitcher` (API `label`/`href`/`active`) — reusado como switch de vista **y** de periodo
- Patrón de enlace a IG (`target=_blank rel=noopener`) — copiado de `ProspectRow.tsx`

---

## 5. Lógica de colores (tabla) y agrupación (kanban)

La **tabla** conserva su semántica de color por celda (sin cambios):

| Condición | Color |
|---|---|
| `responded_at IS NOT NULL` | Verde — respondió/avanzó |
| `sent_at NOT NULL` AND `responded_at IS NULL` AND es etapa actual | Salmón — activo sin avanzar |
| `sent_at NOT NULL` AND `responded_at IS NULL` AND ya pasó | Naranja — enviado sin respuesta, ya pasó |

El **kanban** agrupa por `lead.currentStage`:
- Columnas del catálogo (`getStagesForTenant`, ordenadas por `position`).
- Fallback: cualquier `currentStage` no presente en el catálogo se añade como columna extra
  al final, usando el slug como etiqueta.
- Fallbacks de tarjeta: sin `display_name` → `—`; sin `ig_username` → `—` y sin enlace.

---

## 6. Verificación realizada

Antes del deploy se verificó el render real levantando el dashboard contra un **Postgres
temporal** (no producción) con el schema materializado desde `schema.ts`
(`drizzle-kit push`) y datos sintéticos del tenant Quantum Creators (7 leads repartidos
en A/MS/B/C/disqualified, con follow-ups y media).

Resultados confirmados (screenshots):
- ✅ Build, lint y typecheck en verde.
- ✅ **Tabla** intacta con colores correctos (verde/salmón/naranja según spec).
- ✅ **Kanban** con columnas por etapa + badges de conteo correctos.
- ✅ Tarjetas con Nombre + @usuario separados; enlaces a `instagram.com/{usuario}`.
- ✅ Fallbacks: lead sin nombre/usuario → `—`; columna extra `disqualified`.
- ✅ Toggle preserva mes/año en ambos sentidos.
- ✅ Cero mutaciones (solo enlaces a IG y a `?view=` / `?month=`).

---

## 7. Deploy

```bash
make rebuild-dashboard   # docker build dm-dashboard:local + service update n8n_dashboard
```

Verificado: `n8n_dashboard` → réplicas **1/1**, imagen `dm-dashboard:local`, servicio
convergido. Runbook completo en `docs/api/dashboard-deploy-runbook.md`.

---

## 8. Fuera de alcance (no implementado)

- Drag & drop / mutaciones de etapa (`set_stage`) — rompería la regla "panel solo lee".
- Foto de perfil de IG (requiere Instagram Graph API).
- Edición de notas (lo cubre el SPA admin / `/settings`).

> **Actualización:** paginación, búsqueda y filtro por etapa ya están implementados
> (read-only, server-side, sin migraciones). Ver `15_PAGINACION_PROSPECTOS.md`.

### Posible mejora futura
En el Kanban, con muchas etapas (catálogo + terminales) las columnas que exceden el ancho
quedan tras scroll horizontal. Si se prefiere, las etapas terminales podrían colapsarse u
ocultarse por defecto.
