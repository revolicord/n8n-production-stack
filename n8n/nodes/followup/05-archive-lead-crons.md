# Nodo: Archive lead_crons

**Tipo:** Postgres — Execute Query  
**ID:** `6a3f8241-8755-45a2-befb-b65c157bb5f7`  
**Posición en flujo:** rama false de Has Template? → vuelve a Loop Over Leads

---

## Propósito

Desactiva el cron de un lead cuando ya no existe plantilla para el `next_sequence_number` (el lead agotó todos sus follow-ups).

---

## SQL

```sql
UPDATE api.lead_crons
SET
  is_active     = FALSE,
  archived_at   = NOW(),
  archive_reason = 'max_followups',
  updated_at    = NOW()
WHERE id = $1
```

## Query Replacement

```
={{ $json.cron_id }}
```

---

## Conexión posterior

→ **Loop Over Leads (input 0)** — regresa al loop para procesar el siguiente lead.

---

## Campos utilizados

| Campo | Fuente |
|-------|--------|
| `cron_id` | `$json.cron_id` (lead_crons.id) |
