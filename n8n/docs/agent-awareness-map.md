# Agent Awareness Map — Qué ve el agente de cada cosa enviada

**Última actualización:** 2026-05-23  
**ADRs relacionados:** ADR-0009, ADR-0011, ADR-0012, ADR-0015

Este documento responde a una sola pregunta: **cuando el agente arranca un nuevo turno, ¿qué sabe de cada tipo de mensaje que ya fue enviado al lead?**

Existen dos sistemas que envían mensajes: el **Router** (en cada turno del agente) y el **followup-runner** (scheduler automático). Cada uno deja rastros en distintas tablas. El agente los consume en la fase de contexto antes de razonar.

---

## 1. Mapa de escritura — quién escribe dónde

| Sistema | Tipo de envío | Tabla escrita | Canal de memoria |
|---------|--------------|---------------|-----------------|
| Router | `send_content` (flow/video) | `lead_content_sent` | `content_options` en `<context>` |
| Router | `reply_text` / `reply_text_with_link` / `reply_text_dynamic` | — (ninguna tabla) | `n8n_chat_histories` vía Postgres Chat Memory |
| Router | `change_stage` | `lead_stages` + `stage_transitions` | `stage.slug` en `<context>` del próximo turno |
| Followup-runner | `type='text'` | `lead_followup_log` | `n8n_chat_histories` (mensaje AI) + `contextJson.followups` |
| Followup-runner | `type='flow'` | `lead_followup_log` | `n8n_chat_histories` (mensaje AI) + `contextJson.followups` |
| Followup-runner | `type='content'` (imagen+texto) | `lead_followup_log` | `n8n_chat_histories` (mensaje AI) + `contextJson.followups` |

---

## 2. Flujo detallado por tipo

### 2.1 Router — `send_content` (flows de video/audio)

**Escritura (en el turno actual):**
```
Router → callManychatFlow(flowNs) → ManyChat sendFlow
       → firstSentInsertPayload → nodo lead_content_sent INSERT
         (tenant_id, subscriber_id, conversation_id, stage_slug, slug_id, flow_ns, turn_id)
```
Solo el **primer** `send_content` exitoso del turno genera el INSERT. Los subsiguientes se ejecutan pero no se registran en `lead_content_sent`.

**Lectura (en el próximo turno):**
```
Get Content History → SELECT slug_id, last_sent_at, ever_responded, times_sent
                      FROM lead_content_sent WHERE subscriber_id=? AND conversation_id=? AND stage_slug=?
Build Context → content_options[*] = {
  slug_id, last_sent: "hace N día(s)", lead_responded_to_it: bool, times_sent: N
}
```

Al inicio del turno, `Execute a SQL query1` marca `lead_responded = TRUE` en todos los registros de `lead_content_sent` con `lead_responded = FALSE` antes de que `Build Context` los lea. Así el agente ve el estado post-respuesta.

**Qué ve el agente en `<context>`:**
```json
"content_options": [
  {
    "slug_id": "QC_A_VIDEO_HOOK",
    "type": "video",
    "description": "Video hook 25s",
    "last_sent": "hace 2 día(s)",
    "lead_responded_to_it": true,
    "times_sent": 1
  }
]
```

---

### 2.2 Router — `reply_text` / `reply_text_with_link` / `reply_text_dynamic`

**Escritura (en el turno actual):**
```
Router → callManychatText(text) → ManyChat sendContent (tipo text)
       → (no hay INSERT en ninguna tabla propia)
```
El texto enviado no se persiste explícitamente. Solo existe como parte de la respuesta JSON del AI Agent que el nodo `Postgres Chat Memory` almacena en `n8n_chat_histories`.

**Lectura (en el próximo turno):**
```
Postgres Chat Memory → n8n_chat_histories WHERE session_id = manychat_subscriber_id
                     → historial conversacional entregado al AI Agent como contexto de LangChain
```
El agente ve el texto enviado como parte de sus mensajes previos (tipo `ai`) en la conversación. El texto está anidado dentro del JSON de acciones que el modelo emitió, no como un mensaje textual independiente.

**Qué ve el agente:**  
La respuesta completa del turno anterior (JSON de acciones + texto) como mensaje `ai` en su historial de LangChain.

---

### 2.3 Followup-runner — `type='text'`

**Escritura (runner):**
```
Nodo sendContent → ManyChat sendContent (texto interpolado con {{name}})
Nodo Build SQL   → INSERT lead_followup_log (text_sent, sequence_number, status='sent')
                 → INSERT n8n_chat_histories (
                     session_id = manychat_subscriber_id,
                     message = { type: 'ai', data: { content: '[SEGUIMIENTO AUTOMÁTICO #N] <texto>' } }
                   )
```

**Lectura (próximo turno del agente):**
- **Canal 1 — Historial conversacional:** Postgres Chat Memory lee `n8n_chat_histories`. El agente ve el follow-up como un mensaje `ai` propio con el prefijo `[SEGUIMIENTO AUTOMÁTICO #N]`.
- **Canal 2 — contextJson:** `Get CRM Context` lee `lead_followup_log` → `contextJson.followups = { sent: N, max: M, history: [{seq, days_ago, responded}] }`

**Qué ve el agente:**
```
[historial de chat]
AI: "[SEGUIMIENTO AUTOMÁTICO #1] Oye Carlos, ¿pudiste ver el video que te mandé?"
AI: "[SEGUIMIENTO AUTOMÁTICO #2] Hola Carlos, no quiero molestarte pero..."
Human: "Sí! me gustó mucho"

[<context>]
"followups": { "sent": 2, "max": 3, "history": [
  { "seq": 1, "days_ago": 2, "responded": true },
  { "seq": 2, "days_ago": 1, "responded": true }
]}
```

El agente sabe que mandó 2 follow-ups de texto y que el lead respondió al segundo. También puede leer el texto exacto en su historial.

---

### 2.4 Followup-runner — `type='flow'`

**Escritura (runner):**
```
Nodo sendFlow → ManyChat sendFlow (flow_ns del template)
Nodo Build SQL → INSERT lead_followup_log (text_sent = '[flow: <ns>] — <description>', ...)
              → INSERT n8n_chat_histories (
                  message = { type: 'ai', data: { content: '[SEGUIMIENTO AUTOMÁTICO #N] [flow: <ns>] — <description>' } }
                )
```

**Lectura (próximo turno):** idéntica al `type='text'` — historial conversacional + `contextJson.followups`.

**Qué ve el agente en historial:**
```
AI: "[SEGUIMIENTO AUTOMÁTICO #1] [flow: content20260514123456_1] — Video de reactivación semana 1"
```

El agente sabe que se envió un flow automático pero **no tiene el `slug_id`** — solo el `flow_ns` raw y la descripción del template. No puede cruzar este dato con `content_options` para marcar el slug como ya enviado.

---

### 2.5 Followup-runner — `type='content'` (imagen + texto, etapas B y C)

**Escritura (runner):**
```
Nodo 06c Code → construye mcMessages: [{ type:'image', url:... }, { type:'text', text:... }]
Nodo 07c HTTP → ManyChat sendContent (array de mensajes)
Nodo After Send → Merge
Nodo Build SQL → INSERT lead_followup_log (
                   text_sent = '[IMAGEN ENVIADA: <ai_image_context>] <text_content>'
                 )
              → INSERT n8n_chat_histories (
                  message = { type: 'ai', data: { content: '[SEGUIMIENTO AUTOMÁTICO #N] [IMAGEN ENVIADA: <context>] <texto>' } }
                )
```

La columna `ai_image_context` en `followup_messages` provee la descripción semántica de la imagen que se almacena tanto en el log como en la memoria del agente. Ejemplo: `"Meme de esqueleto esperando en una silla"`.

**Lectura (próximo turno):**  
- Historial conversacional con descripción semántica de la imagen  
- `contextJson.followups.history` con conteo y estado de respuesta

**Qué ve el agente en historial:**
```
AI: "[SEGUIMIENTO AUTOMÁTICO #3] [IMAGEN ENVIADA: Meme de esqueleto esperando en silla] Oye Carlos, sigo aquí..."
```

---

## 3. Diagrama de consciencia del agente al inicio de turno

```
Al arrancar cada turno (agent-run):

  Execute a SQL query1
    └─ UPDATE lead_content_sent SET lead_responded=TRUE (marca como respondido)

  [En paralelo]
  Get Stage Config ──────────────┐
  Get CRM Context ───────────────┤  Build Context
  Get Content History ───────────┤  └─ construye chatInput + contextJson
  System Prompt ─────────────────┘

  Postgres Chat Memory
    └─ carga n8n_chat_histories[session=manychat_subscriber_id]
         contiene:
           • Mensajes humanos (lead)
           • Respuestas AI del agente (JSON de acciones)
           • [SEGUIMIENTO AUTOMÁTICO #N] del runner (texto/flow/content)

  AI Agent recibe:
    1. System prompt (setter-v1.md v6, incluye instrucción sobre [SEGUIMIENTO AUTOMÁTICO])
    2. Historial LangChain (de n8n_chat_histories)
    3. chatInput = <context>{ followups, content_options, stage, lead }</context>
                  <lead_message>{ texto del lead }</lead_message>
```

---

## 4. Deuda técnica

### DT-01 — `reply_text` no tiene tabla de tracking (MEDIA)

**Problema:** Textos enviados por el Router (`reply_text`, `reply_text_with_link`, `reply_text_dynamic`) no se persisten en ninguna tabla dedicada. Solo existen en `n8n_chat_histories` como parte del JSON de respuesta del agente.

**Impacto:** El agente puede inferir que mandó texto leyendo su historial, pero no hay forma de hacer queries analíticas sobre "¿cuántos leads recibieron el link de Calendly?" sin parsear `n8n_chat_histories`.

**Mitigación actual:** El turno completo (incluyendo `trace` del Router) se guarda en `turns.response_text` vía turn-completed. Suficiente para auditoría manual.

**Fix potencial:** Agregar INSERT en una tabla `lead_texts_sent` similar a `lead_content_sent`, o extender `lead_content_sent` con un campo `content_type = 'flow' | 'text'` y almacenar el texto ahí.

---

### DT-02 — `send_content` solo registra el primer envío por turno (BAJA)

**Problema:** `firstSentInsertPayload` en el Router solo captura el **primer** `send_content` exitoso. Si una cascada (ej. `A→MS`) envía audio + VSL, solo el audio queda en `lead_content_sent`.

**Impacto:** El agente en el próximo turno ve `QC_MS_AUDIO, times_sent=1` pero `QC_MS_VIDEO_vsl, times_sent=0`. Podría intentar re-enviar la VSL.

**Mitigación actual:** El Router sí ejecuta todos los sends; el rastro completo está en `turns.response_text` (campo `trace`). La VSL sí llega al lead aunque no quede en `lead_content_sent`.

**Fix potencial:** Cambiar `firstSentInsertPayload` por un array y hacer múltiples INSERTs en el nodo `lead_content_sent` (requiere cambiar el nodo de Postgres por un Code node + loop).

---

### DT-03 — follow-ups `type='flow'` no tienen `slug_id` en memoria (BAJA-MEDIA)

**Problema:** Cuando el runner envía un `type='flow'`, el agente ve en su historial `[flow: content20260514_1] — descripción` pero no el `slug_id` semántico (ej. `QC_B_AUDIO_REACTIVACION`). No puede cruzarlo con `content_options`.

**Impacto:** Si un follow-up de tipo flow usa el mismo flow_ns que una `stage_flow` del agente, el agente no sabrá que ya fue enviado (su `content_options` mostrará `times_sent: 0`).

**Mitigación actual:** En QC, los follow-ups de etapas A/MS son todos `type='text'` y los de B/C son `type='content'`. No hay overlap con `stage_flows` actualmente.

**Fix potencial:** Cuando el runner envía `type='flow'`, buscar el `slug_id` en `stage_flows` por `flow_ns` e insertar también en `lead_content_sent`.

---

### DT-04 — ~~Migración `0012_add_image_context` no deployada~~ ✅ Resuelto

Migración commiteada (`fb68003`) y journal actualizado. Dashboard `contentCardBody` ahora muestra el textarea de descripción IA directamente sin depender de `messagesSection`.

---

### DT-05 — System prompt v6 necesita copiarse al Set node en n8n (ALTA)

**Problema:** La regla 6 sobre `[SEGUIMIENTO AUTOMÁTICO #N]` fue añadida a `setter-v1.md` pero el Set node `System Prompt` del workflow `agent-run` en la UI de n8n sigue con la versión anterior.

**Fix:** Copiar el bloque del prompt desde `setter-v1.md` al campo `staticPrompt` del Set node en n8n.

---

### DT-06 — `followup-runner.md` monolítico desactualizado (BAJA)

**Problema:** El Nodo 6 en `followup-runner.md` documenta `$1 * INTERVAL '1 hour'` cuando la implementación real usa string interpolation de minutos (`INTERVAL 'N minutes'`). También el nodo 3 sigue documentado como IF en lugar de Switch.

**Impacto:** Solo afecta a quien lea el `.md` monolítico en lugar de los archivos en `followup-runner/`. Los archivos individuales (especialmente `09-build-sql.md`) son correctos.

**Fix:** Sincronizar `followup-runner.md` con el estado real del workflow `followup-runner copy`.

---

## 5. Estado de implementación

| Componente | Estado |
|-----------|--------|
| `lead_content_sent` tracking de flows del Router | ✅ Implementado |
| `n8n_chat_histories` para follow-ups del runner | ✅ Implementado |
| `contextJson.followups` métricas en contexto del agente | ✅ Implementado |
| Instrucción `[SEGUIMIENTO AUTOMÁTICO]` en system prompt | ✅ En `setter-v1.md` v6 — ⚠️ pendiente copiar a n8n UI |
| Switch text/flow/content en followup-runner | ✅ Implementado en `followup-runner copy` |
| Migración `0012_add_image_context` | ✅ Commiteada y en journal — pendiente `make migrate` en prod |
| Dashboard: textarea `ai_image_context` en content templates | ✅ Visible en `contentCardBody` (antes solo en `messageCard`) |
| Tracking de `reply_text` del Router | ❌ No implementado (DT-01) |
| Multi-send tracking por turno | ❌ Solo primer send (DT-02) |
