# Nodo 05b: Archive lead_crons (sin template)

**Tipo:** Postgres — Execute Query (`n8n-nodes-base.postgres`)  
**ID:** `77c4686c-45fa-4dcb-ab3d-b6a00635a2d9`  
**Posición en cadena:** rama FALSE de `Has Template?`, retorna a `Loop Over Leads`  
**Propósito:** Archivar el cron cuando no existe template para el número de secuencia actual — la secuencia de follow-ups se ha agotado.

---

## Query SQL

```sql
UPDATE api.lead_crons
SET
  is_active      = FALSE,
  archived_at    = NOW(),
  archive_reason = 'max_followups',
  updated_at     = NOW()
WHERE id = $1
```

## Parámetros

| $N | Valor en n8n | Descripción |
|----|-------------|-------------|
| $1 | `=$json.cron_id` | `lead_crons.id` del lead actual |

## Configuración

```json
{
  "operation": "executeQuery",
  "query": "UPDATE api.lead_crons SET is_active = FALSE, archived_at = NOW(), archive_reason = 'max_followups', updated_at = NOW() WHERE id = $1",
  "options": {
    "queryReplacement": "=$json.cron_id"
  }
}
```

## Notas

- `archive_reason = 'max_followups'` se usa para métricas y diferenciarlo de `'agent_decision'` (archivado manual por el agente).
- Después de este UPDATE el lead deja de aparecer en la query de **Get Due Leads** (`WHERE lc.is_active = TRUE`).
- El nodo devuelve el control a **Loop Over Leads** para procesar el siguiente lead.
