# Nodo: If (insert_content_sent vacío?)

**Tipo:** If  
**Posición en cadena:** Después de `Router`, antes de `lead_content_sent`  
**Propósito:** Bifurcar según si el Router decidió y logró enviar contenido multimedia. Si `send_content` fue `null` o falló, no hay nada que insertar en `lead_content_sent` — se omite la rama de persistencia.

---

## Condición

| Campo | Operador | Valor |
|-------|----------|-------|
| `{{ $json.insert_content_sent }}` | `empty` (object is empty / null) | — |

```
Si $json.insert_content_sent es null/vacío → TRUE (rama 0) → [FIN sin insertar]
Si $json.insert_content_sent tiene valor   → FALSE (rama 1) → lead_content_sent INSERT
```

## Salida del Router que llega aquí

```json
{
  "insert_content_sent": {
    "tenant_id":       "9d338f06-...",
    "subscriber_id":   "424ff9b1-...",
    "conversation_id": "4f112c3f-...",
    "stage_slug":      "A",
    "slug_id":         "QC_A_VIDEO_HOOK",
    "flow_ns":         "content20260511153207_699341",
    "turn_id":         "3ed543f7-..."
  },
  "subscriberDbId": "...",
  "conversationId": "...",
  "turnId": "...",
  "callbackUrl": "...",
  "callbackToken": "..."
}
```

Si `send_content` fue `null` o tuvo error, `insert_content_sent` = `null`.

## Conexiones

- **Rama TRUE (index 0):** → ninguna (FIN)
- **Rama FALSE (index 1):** → `lead_content_sent` (Postgres INSERT)
