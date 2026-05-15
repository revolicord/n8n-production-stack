# ADR-0010: Gestión de Etapas del Funnel en PostgreSQL

**Status:** Accepted  
**Date:** 2026-05-15  
**Deciders:** Equipo Revolicord  
**Supersedes:** Sección `FLOW_MAP` del nodo `Build Context` en `agent-run`

---

## Y-Statement

> _In the context of_ un agente IA que opera sobre un funnel de ventas multi-etapa en Instagram DM,  
> _facing_ el hecho de que el mapa de etapas y sus flows de ManyChat está hardcodeado en un nodo JavaScript de n8n,  
> _we decided_ mover la definición de etapas (`funnel_stages`) y sus flows asociados (`stage_flows`) a tablas PostgreSQL consultadas en tiempo de ejecución,  
> _to achieve_ control CRUD de etapas sin tocar n8n, configuración por tenant, y A/B testing ponderado entre variantes de flow,  
> _accepting_ una query adicional a Postgres en cada turno del agente.

---

## Contexto

El nodo `Build Context` del workflow `agent-run` contiene un objeto literal `FLOW_MAP` que mapea cada slug de etapa a uno o varios `flow_ns` de ManyChat:

```javascript
const FLOW_MAP = {
  nuevo: ['content20260511152354_558165', 'content20260511155655_840313', ...],
  interesado: ['content20260511153207_699341'],
  A: ['PENDIENTE_ns_video_hook'],
  ...
};
```

**Problemas con este enfoque:**

| Problema | Impacto |
|---|---|
| Cambiar o agregar un flow requiere editar n8n y redesplegar | Fricción alta para ajustes de negocio |
| Dos funnels distintos (Revolicord + Quantum Creators) mezclados en el mismo objeto | Imposible escalar a multi-tenant |
| Sin pesos entre variantes | A/B es puramente aleatorio (50/50 siempre) |
| Descripciones de flows hardcodeadas en `FLOW_DESC` | Doble mantenimiento al agregar flows |
| Sin versionado ni historial de cambios de configuración | Imposible auditar qué flow se usó en qué turno |

---

## Decisión

### Tabla `funnel_stages`

Una fila por etapa por tenant. Reemplaza las claves del `FLOW_MAP`.

```sql
CREATE TABLE funnel_stages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL,
  slug          TEXT        NOT NULL,          -- 'nuevo', 'A', 'MS', 'B', 'C', 'D'
  display_name  TEXT        NOT NULL,          -- nombre legible para UI y logs
  position      INT         NOT NULL,          -- orden del funnel (1 = entrada)
  description   TEXT,                          -- instrucción para el agente sobre qué hacer en esta etapa
  max_followups INT         DEFAULT 3,         -- máximo de follow-ups antes de archivar
  is_active     BOOL        DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);
```

### Tabla `stage_flows`

N filas por etapa. Reemplaza los valores del `FLOW_MAP`. El campo `weight` habilita A/B ponderado.

```sql
CREATE TABLE stage_flows (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id    UUID        NOT NULL REFERENCES funnel_stages(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL,
  flow_ns     TEXT        NOT NULL,   -- namespace ManyChat: 'content20260511...'
  description TEXT,                   -- descripción del flow (antes en FLOW_DESC)
  weight      INT         DEFAULT 1,  -- peso relativo; mayor = más probable
  is_active   BOOL        DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### Nodo `Get Stage Config` en `agent-run`

Se agrega **antes** de `Build Context`. Ejecuta esta query con `tenant_id` y `slug` del payload:

```sql
SELECT
  fs.id           AS stage_id,
  fs.slug,
  fs.display_name,
  fs.description,
  fs.max_followups,
  COALESCE(
    json_agg(
      json_build_object(
        'flow_ns',     sf.flow_ns,
        'description', sf.description,
        'weight',      sf.weight
      )
    ) FILTER (WHERE sf.id IS NOT NULL AND sf.is_active = TRUE),
    '[]'::json
  ) AS flows
FROM funnel_stages fs
LEFT JOIN stage_flows sf ON sf.stage_id = fs.id AND sf.is_active = TRUE
WHERE fs.tenant_id = $1
  AND fs.slug      = $2
  AND fs.is_active = TRUE
GROUP BY fs.id;
```

### Selección ponderada en `Build Context`

Reemplaza `Math.random() * variants.length` por selección ponderada:

```javascript
function pickFlowWeighted(flows) {
  if (!flows || flows.length === 0) return null;
  const total = flows.reduce((s, f) => s + (f.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const f of flows) {
    r -= (f.weight ?? 1);
    if (r <= 0) return f;
  }
  return flows[flows.length - 1];
}
```

---

## Seed data inicial (Quantum Revolicord)

```sql
INSERT INTO funnel_stages (tenant_id, slug, display_name, position, description, max_followups) VALUES
('<tenant_id>', 'nuevo',      'Nuevo Lead',      1, 'Primer contacto — enviar video de enganche 25s, pedir pulgar arriba', 3),
('<tenant_id>', 'interesado', 'Interesado',       2, 'Mostró interés — enviar audio intro antes de la VSL',               3),
('<tenant_id>', 'prospecto',  'Prospecto',        3, 'Audio de presentación completa del producto',                         2),
('<tenant_id>', 'A',          'Enganche',         4, 'Video de enganche 25s — primer contacto, pedir pulgar arriba',        3),
('<tenant_id>', 'MS',         'VSL',              5, 'VSL 1:58 — enviar cuando confirmó ver el Video 1',                   3),
('<tenant_id>', 'B',          'Calendly',         6, 'Enviar link de Calendly por texto — no hay flow multimedia',          2),
('<tenant_id>', 'C',          'Llamada agendada', 7, 'Lead con llamada agendada — esperar o confirmar',                    1),
('<tenant_id>', 'D',          'Cliente',          8, 'Cerrado — sin follow-ups automáticos',                                0);

INSERT INTO stage_flows (stage_id, tenant_id, flow_ns, description, weight)
SELECT id, tenant_id, 'content20260511152354_558165', 'video hook v1', 1 FROM funnel_stages WHERE slug='nuevo'
UNION ALL
SELECT id, tenant_id, 'content20260511155655_840313', 'video hook v2', 1 FROM funnel_stages WHERE slug='nuevo'
UNION ALL
SELECT id, tenant_id, 'content20260511160051_518775', 'video hook v3', 1 FROM funnel_stages WHERE slug='nuevo'
UNION ALL
SELECT id, tenant_id, 'content20260511160458_294557', 'video hook cpchel', 1 FROM funnel_stages WHERE slug='nuevo'
UNION ALL
SELECT id, tenant_id, 'content20260511153207_699341', 'audio intro VSL', 1 FROM funnel_stages WHERE slug='interesado'
UNION ALL
SELECT id, tenant_id, 'content20260506163913_313256', 'audio presentación', 1 FROM funnel_stages WHERE slug='prospecto';
```

---

## CRUD de etapas

La API de Revolicord debe exponer endpoints REST sobre estas tablas:

| Método | Ruta | Acción |
|---|---|---|
| GET | `/admin/funnel-stages` | Lista ordenada por `position` |
| POST | `/admin/funnel-stages` | Crear etapa |
| PUT | `/admin/funnel-stages/:id` | Editar nombre, descripción, `max_followups` |
| DELETE | `/admin/funnel-stages/:id` | Soft delete (`is_active = FALSE`) |
| GET | `/admin/funnel-stages/:id/flows` | Flows de una etapa |
| POST | `/admin/funnel-stages/:id/flows` | Agregar flow (nueva variante A/B) |
| PUT | `/admin/stage-flows/:id` | Cambiar `weight`, activar/desactivar |
| DELETE | `/admin/stage-flows/:id` | Eliminar flow |

---

## Consecuencias

**Positivas:**
- Agregar, renombrar o reordenar etapas sin tocar n8n.
- A/B testing con pesos configurables (ej. 70/30).
- Cada tenant tiene su propio set de etapas y flows.
- `description` de la etapa llega al system prompt del agente, dándole instrucciones específicas por etapa sin editar prompts.

**Negativas:**
- Una query adicional a Postgres en cada turno del agente (~5–15 ms).
- Si la query falla y no hay fallback, el agente no sabe qué flow enviar (manejar con `try/catch` en `Build Context`).

---

## ADRs relacionados

- ADR-0008: Inyección dinámica de tools — este ADR extiende ese patrón al nivel de etapas
- ADR-0011: `lead_crons` como detector de inactividad
- ADR-0014: Migración de `lead_stage TEXT` a `current_stage_id UUID FK`
