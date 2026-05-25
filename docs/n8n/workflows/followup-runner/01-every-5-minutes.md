# Nodo 01: Every 5 Minutes

**Tipo:** Schedule Trigger (`n8n-nodes-base.scheduleTrigger`)  
**ID:** `f4fdfc8c-11a3-4ebc-8346-0a0ad94dbf47`  
**Posición en cadena:** inicio del workflow  
**Propósito:** Disparar el runner de follow-ups cada 5 minutos para que ningún lead espere más de ese intervalo antes de recibir su mensaje.

---

## Configuración

| Parámetro | Valor |
|-----------|-------|
| `rule.interval[0].field` | `minutes` |
| Intervalo implícito | 5 min (valor por defecto del campo `minutes`) |

```json
{
  "rule": {
    "interval": [
      { "field": "minutes" }
    ]
  }
}
```

## Salida

No inyecta campos propios. Pasa un único ítem vacío `{}` a **Get Due Leads**.

## Notas

- Con volumen alto (>50 leads vencidos por ciclo) reducir a 2-3 min o aumentar el `LIMIT` en **Get Due Leads** y monitorear timeouts de Postgres.
- El nodo no tiene reintentos configurados; si falla la ejecución completa, el siguiente ciclo (máx 5 min después) reintenta todos los leads con `next_followup_at <= NOW()` — el diseño es inherentemente idempotente.
