# ADR-0014: Migración de `lead_stage TEXT` a `current_stage_id UUID FK`

**Status:** Accepted  
**Date:** 2026-05-15  
**Deciders:** Equipo Revolicord

---

## Y-Statement

> _In the context of_ la tabla `subscribers` que almacena la etapa del lead como texto libre (`lead_stage TEXT`),  
> _facing_ la creación de la tabla `funnel_stages` con UUIDs como source of truth de las etapas,  
> _we decided_ agregar `current_stage_id UUID FK → funnel_stages(id)` a `subscribers` y mantener `lead_stage TEXT` como columna legacy durante la transición,  
> _to achieve_ integridad referencial, joins directos sin lookup por slug, y consistencia con el resto del schema,  
> _accepting_ un período de transición donde ambas columnas coexisten y deben mantenerse sincronizadas.

---

## Contexto

### Estado actual

```sql
-- subscribers (estado actual)
lead_stage TEXT  -- valores: 'nuevo', 'interesado', 'A', 'MS', 'B', 'C', 'D'
```

El valor es un slug de texto libre. Problemas:

| Problema | Impacto |
|---|---|
| Sin FK → `funnel_stages` | Typos silenciosos ('Nuevo' vs 'nuevo') |
| JOINs requieren `WHERE fs.slug = s.lead_stage` | Más lento; ambiguo en multi-tenant |
| `lead_crons.current_stage_id` requiere lookup por slug al hacer UPSERT | Lógica extra en cada turno |
| Sin constraint → cualquier string es válido | Corrupción de datos silenciosa |

---

## Decisión

### Paso 1 — Agregar columna nueva (non-breaking)

```sql
ALTER TABLE subscribers
  ADD COLUMN current_stage_id UUID REFERENCES funnel_stages(id);
```

La columna es nullable durante la migración. Sin `NOT NULL` todavía.

### Paso 2 — Backfill desde `lead_stage`

Ejecutar **después** de hacer el seed de `funnel_stages`:

```sql
UPDATE subscribers s
SET current_stage_id = fs.id
FROM funnel_stages fs
WHERE fs.slug = s.lead_stage
  AND fs.tenant_id = s.tenant_id   -- si subscribers tiene tenant_id
  AND s.current_stage_id IS NULL;

-- Verificar que todos los registros fueron actualizados
SELECT COUNT(*) FROM subscribers WHERE current_stage_id IS NULL;
-- Debe retornar 0 (o el número de subscribers sin etapa asignada)
```

### Paso 3 — Trigger de sincronía durante transición

Mientras el backend de Revolicord siga escribiendo `lead_stage` como texto, mantener ambas columnas en sync con un trigger:

```sql
CREATE OR REPLACE FUNCTION sync_stage_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lead_stage IS DISTINCT FROM OLD.lead_stage THEN
    SELECT id INTO NEW.current_stage_id
    FROM funnel_stages
    WHERE slug = NEW.lead_stage
      AND tenant_id = NEW.tenant_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_stage_id
  BEFORE UPDATE ON subscribers
  FOR EACH ROW EXECUTE FUNCTION sync_stage_id();
```

### Paso 4 — Migrar el backend a escribir `current_stage_id`

Una vez que el API de Revolicord actualice `current_stage_id` directamente:

```sql
-- Hacer NOT NULL cuando no haya NULLs
ALTER TABLE subscribers
  ALTER COLUMN current_stage_id SET NOT NULL;

-- Opcional: deprecar lead_stage (mantener por compatibilidad con el payload del webhook)
-- No eliminar aún — el webhook entrante incluye lead_stage como TEXT
```

### Paso 5 — Mantener `lead_stage` como columna computada (final)

Cuando todo el stack use `current_stage_id`, convertir `lead_stage` a columna generada:

```sql
ALTER TABLE subscribers DROP COLUMN lead_stage;
ALTER TABLE subscribers
  ADD COLUMN lead_stage TEXT GENERATED ALWAYS AS (
    (SELECT slug FROM funnel_stages WHERE id = current_stage_id)
  ) STORED;
```

> **Nota:** esto requiere PostgreSQL 12+. Verificar versión antes de ejecutar.

---

## Impacto en `agent-run`

El nodo `Upsert Lead Cron` puede usar `current_stage_id` directamente sin lookup:

```sql
-- Antes (requería JOIN por slug)
SELECT fs.id FROM funnel_stages fs WHERE fs.slug = $stage_slug AND fs.tenant_id = $tenant_id

-- Después (directo)
INSERT INTO lead_crons (..., current_stage_id, ...)
VALUES (..., (SELECT current_stage_id FROM subscribers WHERE id = $subscriber_id), ...)
```

## Impacto en `set_stage` tool

La herramienta `set_stage` llama `POST /admin/leads/:id/stage` con `{ new_stage: "MS" }`. El endpoint debe:

1. Validar que el slug existe en `funnel_stages` para ese tenant.
2. Actualizar `subscribers.current_stage_id` (y `lead_stage` si aún existe como columna real).
3. Insertar en `stage_transitions` (tabla de auditoría).
4. Retornar el nuevo `current_stage_id` en la respuesta.

---

## Consecuencias

**Positivas:**
- Integridad referencial: imposible asignar una etapa que no existe.
- JOINs directos por UUID (más rápidos, más simples).
- `lead_crons.current_stage_id` se puede poblar directamente desde `subscribers.current_stage_id`.
- Base para multi-tenant: el FK apunta a la etapa correcta del tenant correcto.

**Negativas:**
- Período de transición con dos columnas en sync requiere disciplina o trigger.
- El webhook entrante seguirá enviando `lead_stage` como TEXT — hay que mantener el lookup o el trigger durante la vida del webhook.
- `GENERATED ALWAYS AS ... STORED` no permite UPDATE directo sobre la columna generada.

---

## ADRs relacionados

- ADR-0010: Funnel stages en Postgres (define `funnel_stages`)
- ADR-0011: `lead_crons` como detector de inactividad (usa `current_stage_id`)
