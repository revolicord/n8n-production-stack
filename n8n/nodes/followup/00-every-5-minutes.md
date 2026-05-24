# Nodo: Every 5 Minutes

**Tipo:** Schedule Trigger  
**ID:** `497294b6-81f8-48c9-b100-b948fd5697e7`  
**Posición en flujo:** 1 de 17 (trigger de entrada del workflow)

---

## Propósito

> ⚠️ *Pendiente documentar — nodo nuevo.*

Dispara el workflow cada 5 minutos para procesar leads con follow-ups vencidos.

---

## Configuración

```json
{
  "rule": {
    "interval": [
      { "field": "minutes" }
    ]
  }
}
```

Intervalo: **cada 1 minuto** según configuración por defecto del campo `minutes`. En la UI de n8n se puede ajustar el valor numérico del intervalo.

---

## Conexión posterior

→ **Get Due Leads**
