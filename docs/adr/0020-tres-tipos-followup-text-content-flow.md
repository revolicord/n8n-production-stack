# ADR-0020: Tres Tipos de Follow-up — text, content, flow

**Status:** Accepted  
**Date:** 2026-05-23  
**Deciders:** Equipo Revolicord

---

## Y-Statement

> _In the context of_ un sistema de follow-ups automáticos donde el runner envía mensajes a leads inactivos,  
> _facing_ la ausencia de flows de ManyChat dedicados a follow-ups (los flows existentes son de happy-path entre etapas) y la necesidad de enviar mensajes compuestos (imagen + texto) sin depender de ManyChat para editarlos,  
> _we decided_ mantener tres tipos de template mutuamente excluyentes: `text`, `content` y `flow`,  
> _to achieve_ flexibilidad completa: texto simple para copy rápido, mensajes compuestos construidos desde la BD para memes/multimedia, y flows de ManyChat cuando el contenido ya existe allí o requiere lógica de branching,  
> _accepting_ que el runner necesita un nodo Switch (3 ramas) en lugar del IF actual (2 ramas), y que los templates `type='content'` deben tener sus mensajes cargados en `followup_messages` antes de que el runner los procese.

---

## Contexto

### Situación actual

Los flows de ManyChat en producción son todos de **happy-path entre etapas** (envío de VSL, link de Calendly, confirmación de llamada). No existe ningún flow de ManyChat dedicado a follow-ups de inactividad.

El nodo 06 del followup-runner (`Type is text?`) es un IF de dos ramas:
- `true` → `sendContent` con texto plano
- `false` → `sendFlow` con `flow_ns`

Todos los templates actuales de las etapas B y C son `type='content'`, lo que significa que caen en la rama `false` e intentan un `sendFlow` con `flow_ns = NULL` → error silencioso en ManyChat.

### Por qué no usar solo flows de ManyChat

1. Crear un flow en ManyChat por cada follow-up de cada etapa requiere acceso al panel de ManyChat para cada edición de copy o imagen.
2. Los follow-ups son copy de performance que se itera frecuentemente (A/B, cambios de texto, swap de memes). Necesitan editarse desde el dashboard de la API, no desde ManyChat.
3. Un follow-up de inactividad no necesita lógica de branching — es un mensaje lineal (imagen + texto). `sendContent` lo maneja directamente.

### Por qué mantener `flow` como tipo válido

Nada quita que en el futuro un follow-up esté mejor servido por un flow de ManyChat (ej. un follow-up con botones de respuesta, encuesta, o secuencia con delays internos de ManyChat). El tipo `flow` debe existir y funcionar.

---

## Decisión

### Los tres tipos coexisten y son permanentes

| `type` | Cuándo usarlo | Qué campo usa | Cómo envía el runner |
|--------|--------------|---------------|----------------------|
| `text` | Mensaje de texto puro, sin imagen | `text_template` | `sendContent` con un mensaje `{type:'text'}` |
| `content` | Imagen + texto compuesto, editado desde el dashboard | `followup_messages[]` ordenados por `sort_order` | `sendContent` con array construido dinámicamente desde `followup_messages` |
| `flow` | Flow ya existente en ManyChat (happy-path, branching, botones) | `flow_ns` | `sendFlow` con el `flow_ns` |

### Invariantes por tipo

- `type='text'` → `text_template NOT NULL`, `flow_ns NULL`, sin `followup_messages`.
- `type='content'` → `text_template NULL`, `flow_ns NULL`, al menos un `followup_message` con `message_type IN ('text','image')`.
- `type='flow'` → `flow_ns NOT NULL`, `text_template NULL`, sin `followup_messages`.

### Estructura de `followup_messages` para `type='content'`

Un template compuesto estándar tiene dos filas:

```
sort_order=0 → message_type='image' → media_url='https://minio.../assets/tenant/...'
sort_order=1 → message_type='text'  → text_content='Hola {{name}}, ...'
```

El runner interpola `{{name}}` con `subscribers.display_name` antes de enviar.

El campo `ai_image_context` en la fila de imagen es opcional — sirve para que el agente principal sepa qué contenido se envió al lead (memoria del agente, no envío).

### Payload ManyChat para `type='content'`

```json
{
  "subscriber_id": "<manychat_subscriber_id>",
  "data": {
    "version": "v2",
    "content": {
      "type": "instagram",
      "messages": [
        { "type": "image", "url": "<media_url>" },
        { "type": "text",  "text": "<text_content interpolado>" }
      ]
    }
  }
}
```

El array se construye leyendo `followup_messages` ordenados por `sort_order ASC`. Puede tener N mensajes (no solo imagen + texto).

---

## Cambios pendientes en el followup-runner

### Nodo 06 — convertir IF en Switch

**Estado actual:** nodo `If` — dos ramas (`text` / no-text).  
**Estado requerido:** nodo `Switch` — tres ramas:

| Regla | Condición | Destino |
|-------|-----------|---------|
| 1 | `followup_type === 'text'` | → 07a `sendContent` (texto puro) |
| 2 | `followup_type === 'flow'` | → 07b `sendFlow` |
| 3 | `followup_type === 'content'` | → Code node + 07c `sendContent` compuesto |

### Nodo 02 — Get Due Leads

El LATERAL join actual ya extrae `content_text` e `image_context` de `followup_messages`. Para el envío compuesto se necesita el array completo. Reemplazar el LATERAL por un subquery `json_agg`:

```sql
COALESCE(
  (
    SELECT json_agg(
      json_build_object(
        'message_type', fm.message_type,
        'text_content',  fm.text_content,
        'media_url',     fm.media_url,
        'sort_order',    fm.sort_order
      ) ORDER BY fm.sort_order ASC
    )
    FROM api.followup_messages fm
    WHERE fm.template_id = ft.id
  ),
  '[]'::json
) AS followup_messages
```

### Nodo nuevo — Code node antes de 07c

Construye `mcMessages[]` interpolando `{{name}}` y arma el campo `textSent` para el log:

```javascript
const item = $input.item.json;
const displayName = item.display_name ?? 'amig@';
const rawMessages = Array.isArray(item.followup_messages) ? item.followup_messages : [];

const mcMessages = rawMessages
  .sort((a, b) => a.sort_order - b.sort_order)
  .map((m) => {
    if (m.message_type === 'image') return { type: 'image', url: m.media_url };
    const text = (m.text_content ?? '').replace(/\{\{name\}\}/g, displayName);
    return { type: 'text', text };
  });

const textSent = rawMessages.map((m) => m.text_content).filter(Boolean).join(' | ');
return [{ json: { ...item, mcMessages, textSent } }];
```

Ver implementación completa en `docs/n8n/workflows/followup-runner/07c-send-content-messages.md`.

---

## Consecuencias

### Positivas
- Los follow-ups de inactividad no dependen de flows de ManyChat para existir.
- El copy y las imágenes se editan desde el dashboard sin tocar ManyChat.
- Si en el futuro se necesita un flow para un follow-up específico, el tipo `flow` ya está soportado.

### Negativas / Riesgos
- Los templates `type='content'` sin `followup_messages` cargados no envían nada (el array llega vacío). El runner no falla pero el mensaje es un `sendContent` con `messages: []` — ManyChat puede rechazarlo o ignorarlo silenciosamente. Hay que validar esto al implementar.
- El nodo 06 debe actualizarse manualmente en la UI de n8n (no hay deploy automático de workflows).

---

## Referencias

- ADR-0015: Sistema de Follow-ups por Etapa (diseño de `followup_templates`)
- ADR-0018: Follow-up Messages como Assets en MinIO (diseño de `followup_messages` y bucket `assets`)
- `docs/n8n/workflows/followup-runner/06-type-is-text.md` — nodo a convertir en Switch
- `docs/n8n/workflows/followup-runner/07c-send-content-messages.md` — implementación de la rama `content`
- `docs/n8n/workflows/followup-runner/02-get-due-leads.md` — SQL a actualizar con `json_agg`
