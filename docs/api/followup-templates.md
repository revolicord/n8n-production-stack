# API — Follow-up Templates (ADR-0015)

Gestión de las secuencias de mensajes de reactivación por etapa del funnel.
Estos endpoints permiten configurar follow-ups desde la UI de Revolicord sin tocar n8n.

**Implementación:**
- Handlers: `apps/api/src/routes/admin/followups.ts`
- Servicio (Drizzle): `apps/api/src/services/followups.ts`
- Tests de schema: `apps/api/src/routes/admin/followups.test.ts`
- Tablas: `followup_templates`, `lead_followup_log` (schema en `packages/db/src/schema.ts`)

**Auth:** todos los endpoints requieren `Authorization: Bearer <N8N_CALLBACK_TOKEN>`.

---

## Modelo de datos

### `followup_templates`

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID | PK |
| `stage_id` | UUID | FK a `funnel_stages` |
| `tenant_id` | UUID | Multi-tenancy |
| `sequence_number` | INT | Orden dentro de la secuencia (≥ 1). Unique por stage |
| `delay_minutes` | INT | Minutos de silencio del lead antes de enviar este paso |
| `type` | `'text'` \| `'flow'` | Tipo de mensaje |
| `text_template` | TEXT \| null | Texto a enviar (soporta `{{name}}`). Requerido si `type='text'` |
| `flow_ns` | TEXT \| null | Namespace de ManyChat. Requerido si `type='flow'` |
| `description` | TEXT \| null | Descripción para logs y memoria del agente |
| `is_active` | BOOL | `false` = soft-deleted; el runner ignora estas filas |
| `created_at` | TIMESTAMPTZ | Automático |

**Invariante:** `type='text'` exige `text_template` no nulo; `type='flow'` exige `flow_ns` no nulo.

### `lead_followup_log`

Registro inmutable de cada follow-up enviado. Solo lectura vía API.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID | PK |
| `tenant_id` | UUID | Multi-tenancy |
| `subscriber_id` | UUID | Lead |
| `conversation_id` | UUID | Conversación activa al momento del envío |
| `stage_id` | UUID \| null | Etapa en que estaba el lead |
| `template_id` | UUID \| null | Plantilla que se ejecutó |
| `sequence_number` | INT | Número de secuencia ejecutado |
| `text_sent` | TEXT \| null | Texto real enviado (con `{{name}}` ya interpolado) |
| `sent_at` | TIMESTAMPTZ | Cuándo se envió |
| `status` | `'sent'` \| `'failed'` \| `'responded'` \| `'skipped'` | Estado |
| `responded_at` | TIMESTAMPTZ \| null | Se rellena cuando el lead vuelve a escribir |

---

## Endpoints

### `GET /admin/funnel-stages/:stageId/followups`

Lista las plantillas de una etapa, ordenadas por `sequence_number` ascendente.

**Query params:**

| Parámetro | Tipo | Default | Descripción |
|---|---|---|---|
| `include_inactive` | `'true'` | omitido | Si se pasa, incluye plantillas con `is_active=false` |

**Ejemplo:**

```bash
curl -s "http://localhost:3000/admin/funnel-stages/550e8400-e29b-41d4-a716-446655440000/followups" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta `200`:**

```json
{
  "followups": [
    {
      "id": "a1b2c3d4-...",
      "stageId": "550e8400-...",
      "tenantId": "f47ac10b-...",
      "sequenceNumber": 1,
      "delayMinutes": 24,
      "type": "text",
      "textTemplate": "Oye {{name}}, ¿pudiste ver el video que te mandé? 👀",
      "flowNs": null,
      "description": "Follow-up #1 — 24h sin respuesta",
      "isActive": true,
      "createdAt": "2026-05-22T10:00:00.000Z"
    },
    {
      "id": "b2c3d4e5-...",
      "sequenceNumber": 2,
      "delayMinutes": 48,
      "type": "text",
      "textTemplate": "Hola {{name}}, no quiero molestarte pero me gustaría saber qué te pareció 🙌",
      ...
    }
  ]
}
```

**Errores:** `400` (stageId no es UUID), `401`, `404` (stage no existe).

---

### `POST /admin/funnel-stages/:stageId/followups`

Crea un nuevo paso en la secuencia de una etapa. El `tenant_id` se toma automáticamente de la etapa.

**Body:**

```json
{
  "sequence_number": 1,
  "delay_minutes": 24,
  "type": "text",
  "text_template": "Oye {{name}}, ¿pudiste ver el video que te mandé? 👀",
  "description": "Follow-up #1 — 24h sin respuesta"
}
```

Para `type='flow'`:

```json
{
  "sequence_number": 2,
  "delay_minutes": 48,
  "type": "flow",
  "flow_ns": "QC_A_VIDEO_video_gancho_25s",
  "description": "Follow-up #2 — video de refuerzo"
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `sequence_number` | int ≥ 1 | sí | Posición en la secuencia |
| `delay_minutes` | int > 0 | sí | Minutos de silencio antes de enviar |
| `type` | `'text'` \| `'flow'` | sí | Tipo de mensaje |
| `text_template` | string | si `type='text'` | Texto; soporta `{{name}}` |
| `flow_ns` | string | si `type='flow'` | Namespace de ManyChat |
| `description` | string | no | Descripción libre |

**Respuesta `201`:** la fila insertada (mismo formato que GET).

**Errores:**
- `400` — validación fallida o invariante `type/field` rota.
- `404` — la etapa no existe.
- `409 DUPLICATE_SEQUENCE` — ya existe un template con ese `sequence_number` en esa etapa.

```json
{ "error": { "code": "DUPLICATE_SEQUENCE" } }
```

---

### `PUT /admin/followup-templates/:id`

Edita una plantilla existente. Se envía solo lo que cambia (patch parcial).

El handler hace merge con la fila existente antes de validar la invariante `type/field`, por lo que puedes cambiar solo `delay_minutes` sin necesidad de repetir `text_template`.

**Body (todos opcionales):**

```json
{
  "delay_minutes": 36,
  "text_template": "{{name}}, último intento 💪"
}
```

Para limpiar un campo nullable, envía `null`:

```json
{ "description": null }
```

**Respuesta `200`:** la fila actualizada.

**Errores:**
- `400` — validación fallida o el merge produce una combinación `type/field` incoherente.
- `404` — template no encontrado.
- `409 DUPLICATE_SEQUENCE` — el nuevo `sequence_number` ya está ocupado en esa etapa.

**Ejemplo — cambiar solo el delay:**

```bash
curl -s -X PUT "http://localhost:3000/admin/followup-templates/a1b2c3d4-..." \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"delay_minutes": 36}'
```

---

### `DELETE /admin/followup-templates/:id`

Soft delete: pone `is_active = false`. La fila permanece en la DB para auditoría; el `followup-runner` la ignora.

**Respuesta `200`:**

```json
{ "id": "a1b2c3d4-...", "isActive": false }
```

**Errores:** `400` (UUID inválido), `401`, `404`.

---

### `GET /admin/leads/:subscriberId/followup-history`

Historial completo de follow-ups enviados a un lead, ordenado por `sent_at` descendente (más reciente primero). El `tenant_id` se resuelve desde el subscriber.

**Ejemplo:**

```bash
curl -s "http://localhost:3000/admin/leads/c0a80101-0000-0000-0000-000000000001/followup-history" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta `200`:**

```json
{
  "history": [
    {
      "id": "d4e5f6a7-...",
      "tenantId": "f47ac10b-...",
      "subscriberId": "c0a80101-...",
      "conversationId": "e5f6a7b8-...",
      "stageId": "550e8400-...",
      "templateId": "a1b2c3d4-...",
      "sequenceNumber": 2,
      "textSent": "Hola Juan, no quiero molestarte pero me gustaría saber qué te pareció 🙌",
      "sentAt": "2026-05-22T14:30:00.000Z",
      "status": "responded",
      "respondedAt": "2026-05-22T15:10:00.000Z"
    },
    {
      "sequenceNumber": 1,
      "textSent": "Oye Juan, ¿pudiste ver el video que te mandé? 👀",
      "sentAt": "2026-05-21T14:30:00.000Z",
      "status": "responded",
      ...
    }
  ]
}
```

**Errores:** `400` (UUID inválido), `401`, `404` (subscriber no encontrado).

---

## Flujo típico de configuración

```
1. Obtener el UUID de la etapa (de funnel_stages)
   → GET /admin/funnel-stages/:id/followups   (lista vacía inicialmente)

2. Crear los pasos de la secuencia uno a uno:
   → POST /admin/funnel-stages/:id/followups  (seq 1, delay 24h)
   → POST /admin/funnel-stages/:id/followups  (seq 2, delay 48h)
   → POST /admin/funnel-stages/:id/followups  (seq 3, delay 72h)

3. Si el runner ya corrió y envió alguno, consultar el historial:
   → GET /admin/leads/:subscriberId/followup-history

4. Ajustar un delay sin tocar n8n:
   → PUT /admin/followup-templates/:id  { "delay_minutes": 36 }

5. Desactivar un paso sin borrar el historial:
   → DELETE /admin/followup-templates/:id
```

---

## Relación con el `followup-runner`

El workflow `followup-runner` en n8n consulta `followup_templates` directamente vía nodo Postgres.  
Esta API **no** interactúa con n8n — es solo el plano de control para que la UI de Revolicord gestione la configuración.

Ver: `docs/adr/0015-sistema-followups-por-etapa.md` para la arquitectura completa del sistema.
