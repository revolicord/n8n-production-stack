# Plan + Arquitectura — Feedback de Calendly por IG (workflow `calendly-feedback`)

**Estado:** propuesta para revisión — 2026-05-27
**Objetivo:** cuando un lead reserva en Calendly, el sistema (1) lo identifica, (2) lo marca
`D` (Booked) en el funnel, y (3) le manda un mensaje de confirmación por IG. Esto cierra la
pieza **P1** que `docs/14_ROADMAP_MVP_TO_V1.md` lista como pendiente (webhook Calendly C→D).

---

## 1. Decisiones tomadas

| # | Decisión | Elegida | Por qué |
|---|----------|---------|---------|
| 1 | **Matching de identidad** | UTM en el link (`utm_content`) | Sin fricción, no pide email. El agente manda `calendly_url?utm_content={subscriber.id}` y Calendly lo devuelve en `payload.tracking.utm_content`. |
| 2 | **Dónde vive la lógica** | Todo en n8n | El webhook ya está montado en n8n (`/webhook/calendly-feedback`). n8n orquesta; la mutación de DB se delega al endpoint `set-stage` existente (no se reimplementa). |
| 3 | **Alcance** | Solo agendamiento (`invitee.created`) | Cierra el caso principal. `invitee.canceled` / reschedule → 2ª iteración (§10). |

**Identificador en `utm_content`:** el **UUID interno** `subscriber.id` (no el `manychat_subscriber_id`).
Razón: lookup por PK, no expone el ID de ManyChat, y se inyecta directo en la URL de `set-stage`.

---

## 2. Lo que YA existe (no se toca)

| Pieza | Estado | Nota |
|-------|--------|------|
| `POST /admin/leads/:subscriberId/stage` (`set-stage.ts`) | ✅ Listo | Valida `C→D`, registra `stage_transitions`, cancela `lead_crons` activos. Su comentario ya anticipa "webhook externo de Calendly". |
| Auth para n8n → API | ✅ Listo | `verifyAdminAuth` acepta `Authorization: Bearer {N8N_CALLBACK_TOKEN}` (mismo token de `turn-completed`). |
| Funnel `C (Calendly'd) → D (Booked)` | ✅ Definido | `docs/n8n/stages.md`, `docs/10_CONVERSATION_STATE_MACHINE.md`. |
| `lead_stages` / `stage_transitions` | ✅ Listo | Sin migración. |
| `subscribers.metadata` (jsonb) | ✅ Listo | Para guardar datos de la reserva sin migración. |
| n8n → ManyChat sendContent (texto) | ✅ Listo | Mismo mecanismo del Router (`05-enviar-texto`). |
| Conciencia del agente vía `Get CRM Context` / `Get Stage Config` | ✅ Listo | Al marcar `D`, el próximo turno el agente ve el stage. |

**Conclusión de migración: NO hace falta migración de DB.** Todo encaja en tablas/columnas
existentes (`lead_stages`, `stage_transitions`, `subscribers.metadata`).

---

## 3. Arquitectura del flujo

```
[1] Etapa B→C — el agente manda el link CON identidad
    Build Context arma:  calendlyUrl = tenant.config.calendly_url + "?utm_content=" + subscriber.id
    AI Agent → reply_text_with_link → ManyChat → lead recibe el link con su UUID embebido

[2] El lead reserva en Calendly
    Calendly → POST https://paneln8n.revolicord.com/webhook/calendly-feedback
               body.event = "invitee.created"
               body.payload.tracking.utm_content = "<subscriber.id UUID>"
               body.payload.scheduled_event.{start_time,end_time,location.join_url}
               body.payload.timezone = "America/Santo_Domingo"

[3] Workflow n8n `calendly-feedback`:
    Webhook
      └─ Guard: event === "invitee.created" && utm_content != null   (si no, 200 y salir)
      └─ Resolver subscriber: SELECT manychat_subscriber_id, tenant_id, t.config
                              FROM subscribers s JOIN tenants t ON t.id = s.tenant_id
                              WHERE s.id = utm_content::uuid
      └─ Marcar D:  POST {API}/admin/leads/{utm_content}/stage
                    Authorization: Bearer {N8N_CALLBACK_TOKEN}
                    { new_stage:"D", reason:"calendly_booked", evidence:"<event_uri> @ <start_time>" }
      └─ Persistir reserva en subscribers.metadata.booking (fecha, join_url, etc.)
      └─ Disparar el AGENTE con un evento de sistema (§6) → el AI Agent genera la
         confirmación con SU voz y memoria, la manda por IG y la guarda en n8n_chat_histories

[4] Próximo turno del agente
    Get Stage Config → stage = D → el agente sabe que ya agendó. Además, el mensaje de
    confirmación que él mismo generó ya está en su memoria, así que mantiene coherencia.
```

---

## 4. Componentes a construir

### 4.1 Cambio en `Build Context` (workflow `agent-run`) — inyectar `utm_content`
- **Qué:** donde hoy se interpola `{calendlyUrl}` con `tenant.config.calendly_url`, construir
  `calendlyUrl = config.calendly_url + (config.calendly_url.includes('?') ? '&' : '?') + 'utm_content=' + subscriber.id`.
- **Dónde:** nodo Build Context (`01-build-context.md`). `subscriber.id` ya viaja en el payload
  del webhook agent-run (`body.subscriber.id`).
- **System prompt:** añadir una línea: *"Envía el link de Calendly EXACTAMENTE como aparece en
  `{calendlyUrl}`, sin modificar ni quitar parámetros."* (los LLMs a veces "limpian" URLs).

### 4.2 Workflow nuevo `calendly-feedback` (n8n)
Nodos:
1. **Webhook** — `POST /calendly-feedback` (ya existe).
2. **Guard (IF/Code)** — continuar solo si `body.event === "invitee.created"` y
   `body.payload.tracking.utm_content` no es null. Si no, responder 200 y terminar.
3. **Get Subscriber (Postgres)** — `SELECT s.manychat_subscriber_id, s.tenant_id, t.config
   FROM api.subscribers s JOIN api.tenants t ON t.id = s.tenant_id WHERE s.id = $1::uuid`
   con `$1 = utm_content`. Si no hay fila → log + 200 (lead desconocido).
4. **Set Stage (HTTP Request)** — `POST {API_BASE}/admin/leads/{utm_content}/stage`,
   header `Authorization: Bearer {N8N_CALLBACK_TOKEN}`, body
   `{ "new_stage":"D", "reason":"calendly_booked", "evidence":"<scheduled_event.uri> @ <start_time>" }`.
   - **Manejo de error:** si responde `400 INVALID_TRANSITION` (el lead no estaba en `C`),
     **igual mandamos el feedback IG** pero logueamos el caso (lead agendó sin pasar por C).
     No abortamos el mensaje por esto.
5. **(Opcional) Persist booking (Postgres)** — `UPDATE api.subscribers
   SET metadata = metadata || $2::jsonb WHERE id = $1::uuid` con la reserva
   (`{booking:{event_uri,start_time,end_time,join_url,timezone,reschedule_url,cancel_url}}`).
6. **Format datetime (Code)** — `start_time` (UTC) → hora local usando `payload.timezone`.
7. **ManyChat sendContent (HTTP Request)** — texto de confirmación (§6) al
   `manychat_subscriber_id` con el `manychat_api_key` del `tenant.config`.

---

## 5. Matching UTM — detalle

- El agente envía `https://calendly.com/<org>/<evento>?utm_content=<subscriber.id>`.
- Calendly conserva los UTM de query string en links directos a un event type y los devuelve
  en `payload.tracking.utm_content` del webhook `invitee.created`.
- **Por qué hoy llega `null`:** el link de prueba que se mandó no llevaba el parámetro. Tras 4.1,
  todo link nuevo lo llevará.
- **Limitación conocida:** si el lead abre el link, navega fuera y vuelve por otra vía, el UTM
  puede perderse. Para el flujo directo de Quantum (link directo al event type) se conserva.
  Si `utm_content` llega `null` en producción tras 4.1 → cae al log de "no identificado"
  (no rompe nada, solo no manda feedback). Métrica a vigilar.

---

## 5.1 El link de Calendly se envía en 3 lugares — los 3 necesitan el `utm_content`

Si solo inyectamos el UTM en el agent-run, los bookings que vengan de un follow-up llegarán con
`utm_content: null` y **no se identificarán**. El link sale en:

| # | Dónde | Fuente del link hoy | Cómo se interpola hoy |
|---|-------|---------------------|------------------------|
| 1 | **agent-run** (etapa B→C, el agente manda el link) | `tenant.config.calendly_url` → `{calendlyUrl}` | Build Context |
| 2 | **followup-runner** — etapa B, follow-up #8 | `funnel_stages.call_link` → `{{call_link}}` | prepare-data / build-content-messages |
| 3 | **followup-runner** — etapa C | `funnel_stages.call_link` → `{{call_link}}` | prepare-data / build-content-messages |

### Hallazgo: `{{call_link}}` está a medio cablear ⚠️
El commit `8a296bf` (2026-05-26, migración **0013**) agregó las columnas
`funnel_stages.call_link` / `nurture_video_url`, el endpoint `PUT /admin/funnel-stages/:id` y el
dashboard para configurarlos. **Pero el followup-runner todavía no los usa:** `get-due-leads` no
selecciona `fs.call_link`/`fs.nurture_video_url`, y los nodos de interpolación (`prepare-data`,
`build-content-messages`) solo reemplazan `{{name}}`. → Los placeholders `{{call_link}}` /
`{{nurture_video}}` se pueden configurar e insertar, pero **hoy se envían literales** ("…agenda
aquí 👉 {{call_link}}").

### Plan unificado (consistente en los 3 puntos)
La **columna guarda el link base, sin parámetros**. Cada punto de envío le añade el UTM en runtime:

```
linkFinal = base + (base.includes('?') ? '&' : '?') + 'utm_content=' + subscriber.id
```

- **Punto 1 (agent-run):** Build Context arma `{calendlyUrl}` con el UTM (ya en §4.1).
- **Puntos 2 y 3 (followup-runner):**
  1. Añadir `fs.call_link, fs.nurture_video_url` al SELECT de `get-due-leads` (hoy faltan).
  2. En `prepare-data` (type=text) y `build-content-messages` (type=content), reemplazar
     `{{call_link}}` por `linkFinal` (con UTM) y `{{nurture_video}}` por su URL.
  El `subscriber.id` ya está disponible en el runner (procesa por subscriber).

> **Doble fuente del link (deuda a consolidar, no bloqueante):** agent-run usa
> `tenant.config.calendly_url`; los follow-ups usan `funnel_stages.call_link` (por etapa). Lo
> ideal es una sola fuente — que agent-run también lea `funnel_stages.call_link` de la etapa C.
> Refactor opcional; por ahora conviven y ambos llevan el mismo patrón de UTM.

> **Migración:** ninguna. La 0013 ya añadió las columnas; el UTM se inyecta en runtime.
> Lo pendiente es **lógica de interpolación en el runner** (completar `{{call_link}}` + sumar UTM).

---

## 6. Feedback por IG — lo genera EL AGENTE (no un texto fijo)

**Objetivo:** que la confirmación salga con la voz del agente y su contexto, no como un mensaje
canned. Para eso, el webhook no manda texto: **dispara el loop del agente con un "evento de
sistema"**.

### 6.1 El evento de sistema como nuevo input del agent-run

Hoy el `chatInput` del agent-run es `<context>…</context>\n\n<lead_message>…</lead_message>`
(`01-build-context.md`). El disparador siempre es un mensaje del lead. Introducimos un segundo
tipo de disparador: un **evento de sistema**, donde en vez de `<lead_message>` va:

```
<system_event type="booking_confirmed">
El lead acaba de agendar la llamada para el {fecha} a las {hora} ({timezone}).
Confírmaselo brevemente con tu estilo cálido y humano. No repitas el link ni inventes datos.
</system_event>
```

El AI Agent carga su memoria (toda la conversación), ve `stage = D` en el contexto, redacta la
confirmación con su voz, la manda por ManyChat (`reply_text`) y la guarda en `n8n_chat_histories`.
El dato `{fecha}/{hora}` viene de `scheduled_event.start_time` formateado a `payload.timezone`
(determinista, fuera del LLM) y se le entrega ya resuelto para que **no alucine la fecha**.

> Esto generaliza el input del agente: a futuro otros eventos (recordatorio, no-show, cancelación)
> reusan el mismo `<system_event>`. **No cambia el modelo de datos** — solo el `chatInput`.

### 6.2 Cómo se dispara el agent-run desde calendly-feedback — DECISIÓN ABIERTA (lock)

El agent-run normal pasa por el **lock de turno** de la API (`lock.ts`) para evitar dos turnos
concurrentes del mismo subscriber. Hay dos formas de disparar el evento:

| Opción | Cómo | Trade-off |
|--------|------|-----------|
| **B1 — n8n invoca agent-run directo** | `calendly-feedback` hace HTTP a `/webhook/agent-run` con el `system_event`. | "Todo en n8n", simple. **Salta el lock**: si el lead escribe por IG en ese instante, dos turnos podrían pisarse (doble respuesta / desorden en memoria). Riesgo bajo: el lead acaba de salir a Calendly, no está escribiendo. El followup-runner ya manda sin este lock y funciona. |
| **B2 — la API orquesta con lock** | `calendly-feedback` llama a un endpoint nuevo (`POST /admin/leads/:id/system-event`) que adquiere el lock y despacha agent-run vía `dispatch-n8n`. | Respeta toda la maquinaria de concurrencia. Cuesta código nuevo en la API (rompe el "todo en n8n"). |

**Decidido (2026-05-27): B1** — n8n invoca `/webhook/agent-run` directo con el `system_event`.
Se acepta el riesgo de concurrencia (mínimo por el timing del booking); endurecer a B2 solo si se
observa colisión en producción. No requiere migración.

### Datos para la confirmación
- `{fecha}/{hora}`: `scheduled_event.start_time` → formateado a `payload.timezone`.
- Enlace Meet: `scheduled_event.location.join_url` (puede venir `status:"processing"` al instante
  — el agente NO lo necesita repetir; ManyChat/Calendly ya lo entrega por correo).
- Nombre: usar `subscribers.display_name` (IG), nunca el `name` de Calendly (`"Ingeniero IA"`).

---

## 7. Conciencia persistente del agente

- Al marcar `D`, el `Get Stage Config` del siguiente turno ya refleja el stage → el agente
  "sabe" que el lead reservó.
- Si guardamos la reserva en `subscribers.metadata.booking` (paso 5.5), podemos exponerla en
  `Build Context` (`contextJson.booking`) para que el agente referencie la fecha si el lead
  escribe ("¿a qué hora era?"). **Opcional para MVP** — el stage `D` ya basta para que no
  vuelva a empujar el Calendly.

---

## 8. Seguridad del webhook

- **Estado actual:** el payload no muestra header `Calendly-Webhook-Signature` → la suscripción
  probablemente se creó sin signing key. El path es secreto pero no verificado.
- **Recomendación (no bloqueante para MVP):** crear la suscripción vía API
  (`POST /webhook_subscriptions`), guardar el `signing_key` y verificar el HMAC en un Code node
  (`Calendly-Webhook-Signature: t=…,v1=…`). Mientras tanto, el Guard (paso 2) y el lookup por
  UUID actúan como filtro mínimo: un payload sin `utm_content` válido no produce efectos.
- **PAT de Calendly:** NO se necesita para este flujo — `invitee.created` ya trae todos los datos.
  Solo haría falta para el GET de enriquecimiento (`/scheduled_events/.../invitees/...`), que
  reservamos para reschedule en la 2ª iteración.

---

## 9. Decisiones de producto abiertas

1. **Copy del mensaje** (§6) — confirmar texto final y si incluye el join_url.
2. **Mensaje fijo vs voz del agente** — recomendación: fijo para MVP.
3. **`first_name`** — usar `display_name` de IG (el de Calendly es poco fiable).

---

## 10. Segunda iteración (fuera de alcance ahora)

- **`invitee.canceled` / reschedule:** Calendly dispara `canceled` (con `rescheduled:true` si es
  reprogramación) + `created`. Requiere decidir transición en el funnel (hoy no existe `D→C`).
  Opciones a evaluar: marcar una sub-etapa `D_canceled`, reactivar follow-ups, o notificar al
  closer. Documentar antes de implementar.
- **Verificación HMAC de la firma** (§8).
- **Multi-tenant:** hoy el webhook es de la cuenta Calendly de Quantum/Revolicord (single-tenant).
  Al sumar tenants, mapear `event_memberships[].user` u `organization` → `tenant_id` en vez de
  asumir Quantum.

---

## 11. Checklist de implementación

**Identidad / UTM (los 3 puntos de envío del link — §5.1):**
- [ ] Build Context (agent-run): `{calendlyUrl}` con `?utm_content={subscriber.id}` (§4.1).
- [ ] System prompt: línea "envía el link exacto sin modificar parámetros" (§4.1).
- [ ] followup-runner: añadir `fs.call_link, fs.nurture_video_url` al SELECT de `get-due-leads`.
- [ ] followup-runner: interpolar `{{call_link}}` (con UTM) y `{{nurture_video}}` en
      `prepare-data` (text) y `build-content-messages` (content). ⚠️ hoy solo se hace `{{name}}`.
- [ ] Verificar que `funnel_stages.call_link` (etapas B y C) y `tenant.config.calendly_url` estén
      configurados y sean links directos al event type.

**Webhook + stage (§4.2):**
- [ ] Workflow n8n `calendly-feedback`: guard → resolver subscriber → `set-stage` D.
- [ ] Confirmar `N8N_CALLBACK_TOKEN` y `API_BASE` disponibles como credencial/variable en n8n.
- [ ] Persistir reserva en `subscribers.metadata.booking`.

**Feedback humanizado (§6) — disparo B1 decidido:**
- [x] Disparo del agente: **B1** — n8n → `/webhook/agent-run` directo con `system_event` (§6.2).
- [ ] agent-run: aceptar `<system_event>` como input alterno a `<lead_message>` (Build Context +
      una línea en el system prompt para que sepa qué hacer al recibir un evento de sistema).
- [ ] Formatear fecha/hora a `payload.timezone` antes de pasarla al evento.

**Validación:**
- [ ] E2E agendamiento: lead en C → agenda → el agente confirma con su voz por IG → stage = D →
      `lead_crons` cancelados → memoria coherente.
- [ ] E2E follow-up: link enviado en follow-up #8 (B) y en C lleva el UTM → booking identificado.
- [ ] (Recomendado) Suscripción Calendly vía API + verificación HMAC (§8).
```
