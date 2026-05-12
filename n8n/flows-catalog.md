# Catálogo de Flows de ManyChat

Catálogo de flows por etapa. El campo `ns` es lo que se inyecta directamente en el system prompt como `flow_name` y lo que el LLM pasa a `trigger_manychat_flow`. No hay paso de lookup en n8n — el LLM usa el `ns` como string exacto.

El campo `name` es solo para referencia humana (logs, documentación). El campo `description` es lo que ve el LLM junto al `ns` en el system prompt.

---

## Formato del catálogo en `tenants.config.flows_by_stage`

```json
{
  "flows_by_stage": {
    "nuevo": [
      {
        "name": "video_inicial_v1",
        "ns": "content20260511152354_558165",
        "description": "Video de presentación inicial que solicita pulgar arriba"
      }
    ],
    "prospecto": [
      {
        "name": "audio_presentacion",
        "ns": "content20260506163913_313256",
        "description": "Audio de presentación del producto"
      }
    ]
  }
}
```

---

## Flows actuales (tenant: revolicord)

| flow_name (para el LLM) | ns (ManyChat) | Descripción original | Etapa sugerida |
|------------------------|--------------|---------------------|----------------|
| `video_inicial_v1` | `content20260511152354_558165` | Enviar video inicial que pide pulgar arriba | `nuevo` |
| `video_inicial_v2` | `content20260511155655_840313` | Enviar video inicial que pide pulgar arriba versión 2 | `nuevo` |
| `video_inicial_v3` | `content20260511160051_518775` | Enviar video inicial que pide pulgar arriba versión 3 | `nuevo` |
| `video_cpchel` | `content20260511160458_294557` | Video que inicia en el cpchel que pide pulgar arriba | `nuevo` |
| `audio_vsl` | `content20260511153207_699341` | Audio antes de la VSL | `interesado` |
| `audio_presentacion` | `content20260506163913_313256` | Audio de presentación | `prospecto` |
| `imagenes` | `content20260507013255_914847` | Envío de imágenes | `prospecto` |
| `mensajes` | `content20260506035030_031926` | Envío de mensajes | `prospecto` |

> **Pendiente:** Confirmar las etapas correctas para cada flow con el equipo de negocio y actualizar `tenants.config.flows_by_stage` en la DB.

---

## Cómo actualizar

En psql o desde la interfaz admin del API:

```sql
UPDATE tenants
SET config = jsonb_set(
  config,
  '{flows_by_stage}',
  '{
    "nuevo": [
      {"name": "video_inicial_v1", "ns": "content20260511152354_558165", "description": "Video de presentación inicial que solicita pulgar arriba"}
    ],
    "interesado": [
      {"name": "audio_vsl", "ns": "content20260511153207_699341", "description": "Audio previo a la VSL"}
    ]
  }'::jsonb
)
WHERE slug = 'revolicord';
```
