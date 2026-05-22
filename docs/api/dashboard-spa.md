# Dashboard SPA — Arquitectura y convenciones

El dashboard de Quantum Creators es una SPA vanilla (HTML + JS + Tailwind CDN) servida por Fastify bajo `/dashboard`.

- HTML: `apps/api/public/index.html`
- Lógica: `apps/api/public/app.js`
- Estilos adicionales: `apps/api/public/styles.css`

La ruta raíz `/dashboard` redirige a `/dashboard/`. Todos los assets se sirven como estáticos desde `apps/api/public/` vía `@fastify/static`.

---

## Estado global (`STATE`)

```js
const STATE = {
  token,          // JWT de admin (localStorage)
  tenantId,       // UUID del tenant activo
  tenantSlug,     // Slug del tenant activo
  stages,         // FunnelStage[] — camelCase (displayName, slug, position)
  activeStageId,
  activeSection,  // 'cierre' | 'objecion' | 'general' | null
  templates,      // FollowupTemplate[] — camelCase (sequenceNumber, delayMinutes, textTemplate…)
  messages,       // { [templateId]: FollowupMessage[] } — snake_case (message_type, media_url…)
  resources,      // AgentResource[] — snake_case (display_name, trigger_hint…)
  dirty,          // Set<id> — IDs con cambios no guardados
};
```

---

## Convención camelCase / snake_case

> **Esta asimetría es un gotcha clave.** Si se añaden nuevos campos al frontend, usar la convención correcta para cada tipo de objeto.

| Objeto | Convención | Motivo |
|---|---|---|
| `stages` (`funnelStages`) | **camelCase** | Drizzle devuelve las filas tal cual; sin `toResponse()` |
| `templates` (`followupTemplates`) | **camelCase** | Ídem |
| `messages` (`followupMessages`) | **snake_case** | El handler usa `toResponse()` explícito que mapea a snake_case |
| `resources` (`agentResources`) | **snake_case** | Ídem |

**Request bodies** (enviados al API): siempre **snake_case** (`delay_minutes`, `text_template`, `message_type`). Los schemas Zod del backend usan snake_case en la validación de entrada.

Ejemplo — leer `sequenceNumber` de un template y enviarlo al API:
```js
// Leer (camelCase)
const seq = t.sequenceNumber;

// Enviar (snake_case en el body)
await api(`/admin/followup-templates/${t.id}`, {
  method: 'PUT',
  body: JSON.stringify({ delay_minutes: 30 }),
});
```

---

## Ciclo de vida de una etapa

```
selectStage(stageId)
  → GET /admin/funnel-stages/:stageId/followups
  → filter isActive !== false           ← camelCase
  → for each template type='content':
      GET /admin/followup-templates/:id/messages  ← snake_case via toResponse()
  → renderMain()
    → renderStagePanel()
      → templateCard(t, stage)         ← pasa `stage` para construir header
```

---

## Cards de follow-up (unified layout)

Todos los tipos de template muestran el mismo layout desde 2026-05-22:

```
┌─────────────────────────────────────────────────┐
│  1B · meme_plus_text              Delay: [___] min │
│                                                   │
│  [textarea — texto principal]                     │
│                                                   │
│  Imagen (opcional):                               │
│  [thumbnail si existe]                            │
│  [Subir archivo input]                            │
└─────────────────────────────────────────────────┘
```

**Header:** `${t.sequenceNumber}${stage.slug.toUpperCase()} · ${t.description ?? t.type}`

### type = 'text'
- Textarea lee/escribe `t.textTemplate`.
- Sección de imagen muestra upload vacío.
- Al subir imagen: `uploadAndConvertToContent()` convierte el template a `content` creando 2 mensajes (imagen + texto) y haciendo PUT al tipo.

### type = 'content'
- Textarea muestra el primer mensaje `message_type='text'` (guarda con `saveContentText()`).
- Sección de imagen muestra el primer mensaje `message_type='image'`.
- Al subir imagen: actualiza el mensaje imagen existente o crea uno nuevo.
- Si hay más de 2 mensajes: se despliega un `<details>` con la sección completa de mensajes.

### type = 'flow'
- Solo muestra el `flowNs` en un bloque `<code>`.

---

## Conversión text → content

`uploadAndConvertToContent(event, templateId)`:

1. Sube el archivo a MinIO vía `POST /admin/assets/upload?tenant_id=...`
2. `PUT /admin/followup-templates/:id` con `{ type: 'content', text_template: null }`
3. `POST .../messages` con `{ message_type: 'image', media_url: url, sort_order: 0 }`
4. `POST .../messages` con `{ message_type: 'text', text_content: <valor del textarea>, sort_order: 1 }`
5. `selectStage(activeStageId)` para recargar

---

## Edición inline de nombres de cards (2026-05-23)

Los títulos de los cards son editables con click-to-edit. No pasan por `STATE.dirty` — se guardan de forma inmediata en el blur.

### Follow-up templates (Fase B / Fase C)

El label editable es la parte `description` del header (`1B · <label>`). El prefijo numérico-slug es siempre estático.

| Elemento | Valor |
|---|---|
| Campo en BD | `followup_templates.description` |
| API | `PUT /admin/followup-templates/:id` con `{ description: "..." }` |
| Fallback si `description` es null | muestra `t.type` |

Funciones implicadas:
- `startEditLabel(templateId)` — lee `span.dataset.label`, reemplaza el span por un `<input>` enfocado.
- `commitEditLabel(templateId, original, newValue)` — restaura el span, llama al API si el valor cambió; hace rollback en error.

### Recursos (General / Cierres / Objeciones)

| Elemento | Valor |
|---|---|
| Campo en BD | `agent_resources.display_name` |
| API | `PUT /admin/agent-resources/:id` con `{ display_name: "..." }` |

Funciones implicadas:
- `startEditResourceName(resourceId)` — lee `span.dataset.name`, reemplaza el span por un `<input>` enfocado.
- `commitEditResourceName(resourceId, original, newValue)` — restaura el span, llama al API si cambió.

### Comportamiento

| Acción | Resultado |
|---|---|
| Click en el nombre | Input enfocado con texto seleccionado |
| Enter | Blur → guarda |
| Escape | Restaura original, blur sin llamada al API |
| Click fuera | Guarda si cambió, no-op si es igual |
| Error de API | Rollback al nombre original + toast de error |
| Éxito | Toast "Nombre actualizado", `STATE` actualizado en memoria |

> **Gotcha de implementación:** el valor se pasa como atributo `data-label` / `data-name` (no inline en `onclick`). Usar `JSON.stringify()` dentro de `onclick="..."` rompe el HTML cuando el texto contiene comillas.

---

## Guardar cambios

El botón "Guardar cambios" llama a `saveAllFollowups()`, que itera sobre `STATE.dirty` y hace `PUT` solo a las plantillas marcadas. Solo afecta a campos de la tabla `followup_templates` (delay, texto, tipo). Los mensajes de tipo `content` se guardan de forma individual y automática (`saveContentText` con `onchange`).

La edición inline de nombres **no pasa por `STATE.dirty`** — se guarda de forma inmediata y autónoma.

---

## Dependencias del frontend

No hay bundler. Se carga en runtime:
- [Tailwind CDN](https://cdn.tailwindcss.com) — clases utility
- Browser `fetch` — todas las llamadas al API
- `localStorage` — persistencia del JWT y tenant activo entre sesiones
