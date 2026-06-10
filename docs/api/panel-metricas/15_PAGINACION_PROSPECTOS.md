# 15 · Paginación, búsqueda y filtros en Prospectos

Vista `/prospects` del dashboard (`apps/dashboard/`). Antes traía **todos** los leads del mes
y los pintaba de golpe; con ~600 leads/etapa (~3.000+/mes) el cuello de botella es el **DOM**.
Esta tanda añade paginación server-side, búsqueda, filtro por etapa y orden — **read-only, sin
migraciones y sin endpoints nuevos**. La fuente de verdad sigue siendo la URL + SSR
(`revalidate = 30`), igual que el resto del panel.

## 1. Contrato de URL (searchParams)

`/prospects?year&month&view&page&size&q&stage&sort`

| Param | Valores | Default | Notas |
|-------|---------|---------|-------|
| `year` / `month` | int | mes UTC actual | igual que antes |
| `view` | `table` \| `kanban` | `table` | |
| `page` | ≥ 1 | `1` | solo tabla |
| `size` | `25` \| `50` \| `100` | `50` | solo tabla |
| `q` | texto libre | — | ILIKE sobre `display_name` / `ig_username` |
| `stage` | slug de etapa | — (todas) | incluye terminales |
| `sort` | `recent` \| `old` | `recent` | por `first_seen_at` |

Cambiar `q` / `stage` / `size` / `sort` **resetea `page` a 1**. Solo se serializan valores
no-default para mantener las URLs limpias. El helper **`buildHref(overrides)`**
(`prospects/page.tsx`) parte del set actual de params y aplica overrides; lo usan el toggle de
vista, el PeriodSwitcher, el paginador, los filtros y el enlace "ver todos →" del Kanban.

## 2. Capa de datos — `src/lib/metrics/prospects.ts`

Se conserva el patrón **"cohorte → enriquecer por `inArray(ids)`"**, que restringe
stages/media/follow-ups a los ids de la página automáticamente.

- **`enrichLeads(tenantId, subs)`** (privado): pasos 2–5 (stage/media/follow-ups + ensamblado a
  `LeadRow[]`), preservando el orden de entrada. Lo comparten tabla y Kanban.
- **`getProspectsPage({ tenantId, year, month, page, size, q, stage, sort })`**
  `→ { columns, leads, total }`. Where base = tenant + rango de mes (`getPeriodRange`); `q` =
  `OR(ilike displayName, ilike igUsername)`; `stage` = `COALESCE(current_stage,'A') = stage` vía
  LEFT JOIN a `lead_stages` (único por subscriber, así incluye leads sin fila al filtrar `A`);
  `total` = `COUNT(*)` con el mismo where; cohorte con `LIMIT/OFFSET` → `enrichLeads`.
- **`getProspectsKanban({ tenantId, year, month, perColumn })`** `→ KanbanStage[]`. Una sola
  consulta raw (`db.execute(sql\`…\`)`) con `ROW_NUMBER() OVER (PARTITION BY current_stage ORDER
  BY first_seen_at DESC)` + `COUNT(*) OVER (PARTITION BY current_stage)` (LEFT JOIN + `COALESCE`),
  filtrando `rn <= perColumn` (default 50). Devuelve por etapa `{ slug, total, leads }`.

> **Sin migraciones.** A ~3.000 filas/mes Postgres va sobrado. Mejora futura opcional (con ADR):
> índice `(tenant_id, first_seen_at)` + trigram para ILIKE.

## 3. Componentes — `src/components/prospects/`

| Archivo | Tipo | Responsabilidad |
|---------|------|-----------------|
| `ProspectsSearch.tsx` | **client** | Input debounced (~300 ms) → `router.push` con `?q=` + reset de `page`. Único componente cliente nuevo. |
| `Pagination.tsx` | server | `« ‹ 1 … 4 5 6 … 12 › »` + "Mostrando X–Y de Z". Recibe `page/size/total` + `buildHref`. |
| `StageFilter.tsx` | server | Chips de etapa (incluye "Todas") → `?stage=` + reset de `page`. |
| `PageSizeSelect.tsx` | server | Chips 25/50/100 → `?size=` + reset de `page`. |
| `ProspectsTable.tsx` | mod | Cabecera (`sticky top-0`) y columna "Lead" (`sticky left-0`) fijas. Estado "sin resultados para «q»" diferenciado del vacío. |
| `ProspectsKanban.tsx` | mod | Recibe columnas ya agrupadas con `total`. Badge `N de TOTAL` si hay recorte; pie "ver todos →" a `?view=table&stage=<slug>`. Mantiene columnas terminales. |

Reutiliza `PeriodSwitcher` (chips), `LeadCard`, `ProspectRow`, `StageCell`, `getStagesForTenant`,
`getPeriodRange`, `fmtDayMonth`/`MONTH_LABELS_LONG_ES` y los tokens `qc-*`.

## 4. Despliegue

`make rebuild-dashboard` (runbook `docs/api/dashboard-deploy-runbook.md`) o `/ship --dashboard`.
