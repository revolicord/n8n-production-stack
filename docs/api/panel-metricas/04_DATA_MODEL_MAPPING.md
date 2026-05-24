# 04 — Mapeo de datos: Excel → schema actual

> **Tesis del documento:** cada métrica que Alex tenía en el Excel se puede computar **leyendo del schema actual sin crear ninguna tabla nueva**. Este doc demuestra el mapeo uno-a-uno.

## Schema de referencia (resumen de las tablas que toca el panel)

```ts
// packages/db/src/schema.ts (versión vigente)

api.tenants              // clientes (Alex = uno)
api.subscribers          // usuarios de Instagram, multi-tenant
api.lead_stages          // estado ACTUAL de etapa de cada subscriber
api.stage_transitions    // log INMUTABLE de cambios de etapa
api.funnel_stages        // catálogo de etapas por tenant (A, MS, B, C, D)
api.lead_content_sent    // contenido enviado al subscriber (story view = MS)
api.lead_followup_log    // follow-ups enviados (las columnas 1B-8B del Excel)
api.followup_templates   // plantillas de follow-up por etapa (catálogo)
```

**Lo único que el panel consulta directamente.** Si en una query aparece otra tabla (messages, turns, conversations), revisar — probablemente no hace falta.

## Mapeo etapa-por-etapa

### Cómo identificamos un subscriber en cada etapa

Hay **dos modelos de verdad** complementarios:

1. **Estado actual**: `api.lead_stages.current_stage` (texto) o `current_stage_id` (FK a `funnel_stages`). Una fila por subscriber. "Donde está AHORA".
2. **Histórico**: `api.stage_transitions`. Cada cambio es una fila. "Cómo llegó hasta donde está".

Para conteos por mes (las cinco filas A/MS/B/C/D del Dashboard del Excel), usamos el **histórico**:

- "Cuántos subscribers entraron a etapa B en mayo" = `COUNT(DISTINCT subscriber_id) FROM stage_transitions WHERE to_stage='B' AND created_at en mayo`.

Para "cuántos están AHORA en cada etapa" (la sección "Prospectos activos ahora" del mockup Funnel), usamos el **estado actual**:

- `COUNT(*) FROM lead_stages WHERE current_stage='B' AND tenant_id=...`.

### Etapa A — Initiated

**Definición de Alex:** "le escribí primero a esta cuenta este mes".

**Mapeo:**

```sql
-- Subscribers que fueron creados en el período (= cuando el agente IA inicia DM)
SELECT COUNT(*) AS a_count
FROM api.subscribers
WHERE tenant_id = $1
  AND first_seen_at >= $2  -- inicio del mes/año
  AND first_seen_at <  $3; -- inicio del siguiente
```

**Por qué `first_seen_at` y no `created_at`:** ambos están seteados al `NOW()` por defecto en el schema. Usamos `first_seen_at` porque es semánticamente más preciso ("la primera vez que el agente vio a este lead").

**Alternativa equivalente (igualmente válida):**

```sql
-- Vía stage_transitions: la primera transición de cada subscriber
SELECT COUNT(DISTINCT subscriber_id)
FROM api.stage_transitions st
WHERE tenant_id = $1
  AND created_at >= $2 AND created_at < $3
  AND NOT EXISTS (
    SELECT 1 FROM api.stage_transitions earlier
    WHERE earlier.subscriber_id = st.subscriber_id
      AND earlier.created_at < st.created_at
  );
```

**Recomendación:** usar `subscribers.first_seen_at`. Es la fuente más directa y eficiente.

### Etapa MS — Media Seen

**Definición de Alex:** "vio mi contenido (story view u otro)".

**Mapeo:**

```sql
-- Subscribers a los que se les envió contenido y se marcó como visto
-- según el modelo del repo, MS se evidencia con lead_content_sent (el flow fue enviado)
SELECT COUNT(DISTINCT lcs.subscriber_id) AS ms_count
FROM api.lead_content_sent lcs
WHERE lcs.tenant_id = $1
  AND lcs.sent_at >= $2 AND lcs.sent_at < $3;
```

**Nota importante:** en el modelo actual del repo, "Media seen" se aproxima como "Media sent al subscriber". Si Alex ya distingue entre "enviado" y "visto" (vía algún evento de webhook de Instagram que actualice `lead_responded` o algo similar), hay que ajustar.

**Decisión por defecto del panel:** usar `lead_content_sent.sent_at`. Si en code review se confirma que existe un campo `seen_at` o un evento distinto, ajustar.

### Etapa B — Engaged

**Definición de Alex:** "respondió, hay conversación".

**Mapeo:**

```sql
SELECT COUNT(DISTINCT subscriber_id) AS b_count
FROM api.stage_transitions
WHERE tenant_id = $1
  AND to_stage = 'B'
  AND created_at >= $2 AND created_at < $3;
```

> Aquí `to_stage` es texto. Confirmar el slug exacto en el seed (`seed_qc_funnel.sql`) — debería ser literalmente `'B'`, pero si el seed lo nombra `'engaged'` o similar, ajustar el filtro.

### Etapa C — Calendly'd

**Definición de Alex:** "le envié link de Calendly".

**Mapeo:**

```sql
SELECT COUNT(DISTINCT subscriber_id) AS c_count
FROM api.stage_transitions
WHERE tenant_id = $1
  AND to_stage = 'C'
  AND created_at >= $2 AND created_at < $3;
```

### Etapa D — Booked

**Definición de Alex:** "reservó la llamada".

**Mapeo:**

```sql
SELECT COUNT(DISTINCT subscriber_id) AS d_count
FROM api.stage_transitions
WHERE tenant_id = $1
  AND to_stage = 'D'
  AND created_at >= $2 AND created_at < $3;
```

## Ratios (las 4 grandes del Excel)

Una vez tenemos los 5 conteos del período, los ratios son aritmética simple:

| Ratio | Fórmula | Significado |
|---|---|---|
| **MSR** (Media Seen Rate) | `ms_count / a_count` | De los que inicié, qué % vio mi media |
| **PRR** (Personal Response Rate) | `b_count / a_count` | De los que inicié, qué % respondió |
| **CSR** (Calendly Send Rate) | `c_count / a_count` | De los que inicié, qué % recibió Calendly |
| **ABR** (Appointment Booking Rate) | `d_count / a_count` | De los que inicié, qué % bookeó |

**Conversiones etapa-a-etapa:**

| Conversión | Fórmula |
|---|---|
| `A → MS` | `ms_count / a_count` (= MSR) |
| `MS → B` | `b_count / ms_count` |
| `B → C` | `c_count / b_count` |
| `C → D` | `d_count / c_count` |

**Edge case crítico:** división por cero. Si `ms_count = 0` y queremos `MS→B`, devolver `null` (la UI lo pinta como `—`). Misma regla para todos los ratios. NUNCA devolver `0%` cuando es "no aplicable".

## Métricas más allá del Excel (las que dan "wow")

Estas no están en el Excel pero son fáciles con el schema actual.

### Velocidad del funnel (tiempo promedio entre etapas)

```sql
-- Tiempo promedio A → MS en días para subscribers que llegaron al menos a MS
SELECT AVG(EXTRACT(EPOCH FROM (lcs.sent_at - s.first_seen_at)) / 86400.0) AS avg_days
FROM api.subscribers s
JOIN api.lead_content_sent lcs ON lcs.subscriber_id = s.id
WHERE s.tenant_id = $1
  AND s.first_seen_at >= $2 AND s.first_seen_at < $3;
```

Mismo patrón para MS→B, B→C, C→D, sustituyendo el JOIN por `stage_transitions` filtrado por `to_stage`.

**Total A → D:** se computa cliente-side sumando los 4 avg, o en SQL con CTEs.

### Heatmap calendario (actividad por día)

```sql
SELECT
  DATE(first_seen_at AT TIME ZONE 'UTC') AS day,
  COUNT(*) AS initiated_count
FROM api.subscribers
WHERE tenant_id = $1
  AND first_seen_at >= $2 AND first_seen_at < $3
GROUP BY day
ORDER BY day;
```

UI usa estos counts para asignar nivel de intensidad (0–4).

### Follow-ups del mes (las columnas 1B-8B del Excel)

```sql
SELECT
  ft.sequence_number,
  fs.slug AS stage_slug,
  COUNT(lfl.id) AS sent_count,
  COUNT(lfl.responded_at) AS responded_count
FROM api.lead_followup_log lfl
JOIN api.followup_templates ft ON ft.id = lfl.template_id
JOIN api.funnel_stages fs ON fs.id = ft.stage_id
WHERE lfl.tenant_id = $1
  AND lfl.sent_at >= $2 AND lfl.sent_at < $3
GROUP BY ft.sequence_number, fs.slug
ORDER BY fs.position, ft.sequence_number;
```

Esto genera la grilla 1B/2B/3B... y 1C/2C/3C... del mockup mensual.

### Tasa de respuesta a follow-up

```
respondedCount / sentCount
```

por secuencia. Misma regla del null para evitar división por cero.

### Predicción simple

Regla hardcodeada (sin LLM):

```ts
const daysInMonth = new Date(year, month, 0).getDate();
const daysElapsed = new Date().getDate();
const rate = bookedThisMonth / daysElapsed;
const projected = Math.round(rate * daysInMonth);
```

### Insights generados (reglas, NO LLM)

5 reglas hardcodeadas (las del mockup Funnel):

1. **Cuello de botella**: `if conversion[X→Y] < avgHistorical[X→Y] * 0.9 → warning`.
2. **Métrica fuerte**: `if MSR > avgHistorical.MSR * 1.05 → ok`.
3. **Prospectos B estancados**: `count(WHERE current_stage='B' AND updated_at < NOW() - INTERVAL '48 hours') > 10 → warning`.
4. **Velocidad mejorando**: `if avgVelocity < historicalAvg → info`.
5. **Mejor día**: `argmax(initiated_count_by_dow.convertedToB / initiated_count_by_dow.total) → info`.

Todo SQL, todo determinista. LLM no entra en Sprint 1–3.

## Subscriber detail (Sprint 3, vista lateral)

Cuando Alex haga click en un prospecto (Sprint 3), el drawer lateral muestra:

- Info del subscriber (`subscribers.ig_username`, `display_name`, `first_seen_at`, `last_seen_at`).
- Stage actual + histórico de transiciones (`stage_transitions` ordenado desc).
- Follow-ups enviados (`lead_followup_log` ordenado por `sent_at`).
- Última conversación si existe (`conversations` + último `turns.response_text`).

Esto está fuera de scope de Sprint 1, documentado aquí por completitud.

## Validación del mapeo (Paso obligatorio antes de Sprint 1)

Antes de implementar nada, **Claude Code debe ejecutar estos checks** contra la BD local con seed QC aplicado:

```sql
-- 1. Verificar que el seed creó las 5 etapas
SELECT slug, display_name, position FROM api.funnel_stages
WHERE tenant_id = '<UUID_QC>'
ORDER BY position;
-- Debe devolver A, MS, B, C, D (orden y nombres exactos)

-- 2. Verificar que hay subscribers para probar
SELECT COUNT(*) FROM api.subscribers WHERE tenant_id = '<UUID_QC>';
-- Si es 0, no se puede validar el panel. Insertar fixtures de prueba.

-- 3. Verificar el formato de to_stage en stage_transitions
SELECT DISTINCT to_stage FROM api.stage_transitions WHERE tenant_id = '<UUID_QC>';
-- Confirma si los slugs son 'A','MS','B','C','D' o algo más
```

Si los slugs no coinciden con `'A'`, `'MS'`, `'B'`, `'C'`, `'D'`, **parar** y abrir issue. Las queries de doc 05 asumen estos slugs literales.

## Caveats conocidos del modelo de datos

1. **`first_seen_at` vs primera transición:** un subscriber puede crearse pero no entrar a etapa A inmediatamente. En la práctica, el flow del repo crea ambos casi a la vez. Si hay desfase notable, ajustar a `stage_transitions WHERE to_stage='A'`.

2. **MS no es un cambio de etapa sino un evento de contenido:** por eso usamos `lead_content_sent` y no `stage_transitions WHERE to_stage='MS'`. Confirmar que ese es el modelo del repo (revisar `n8n/stages.md`).

3. **Backfill:** si hay subscribers viejos sin `stage_transitions`, los conteos pueden ser inconsistentes. El seed debería garantizar coherencia. Si no, abrir issue.

4. **Timezones:** los `timestamp with time zone` se guardan en UTC. La UI muestra todo en horario del tenant (configurable en `tenants.config.timezone`, default `America/Mexico_City` según ADR-0001 sección 7). Las queries deben aceptar el offset.

Fin del documento 04.
