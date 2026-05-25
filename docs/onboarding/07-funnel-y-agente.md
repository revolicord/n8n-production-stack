# 07 · Funnel y agente

Cómo el agente lleva a un lead por las etapas del funnel hasta que agenda una llamada de discovery. Es la **lógica de negocio del agente**: vive en **n8n + Postgres**. La capa Fastify no la conoce — solo pasa el batch al agente vía webhook y recibe el callback con la respuesta.

> El modelo de datos real (`funnel_stages`, `lead_stages`, `stage_transitions`) está en [04-modelo-de-datos](04-modelo-de-datos.md). Los follow-ups automáticos, en [08-follow-ups-y-crons](08-follow-ups-y-crons.md). El motor completo, en [`reference/funnel-engine.md`](../reference/funnel-engine.md). La definición canónica de etapas y criterios, en [`n8n/stages.md`](../../n8n/stages.md).

## Las 5 etapas (Quantum Creators)

Las etapas son **data-driven** (`funnel_stages` por tenant, ADR-0010), no hardcodeadas. El funnel de QC:

| Sigla | Nombre | Quién maneja | Qué significa |
|---|---|---|---|
| **A** | Initiated | bot | Lead recibió el primer mensaje + Vídeo 1 (enganche, 25 s) |
| **MS** | Media Seen | bot | Confirmó (verbal o emoji, tras pregunta del agente) que vio el Vídeo 1 |
| **B** | Engaged | bot | Recibió el Vídeo 2 (VSL) y reaccionó positivo |
| **C** | Calendly'd | bot | Recibió el link de agendamiento |
| **D** | Booked | handoff a closer | Reservó en Calendly — el closer toma desde aquí |

Etapas terminales (no avanzan): `disqualified` (motivo en `reason`), `lost` (secuencia de follow-ups agotada), `escalated_human_call` (tras el follow-up #5, el agente avisa para llamada por IG).

> El default de `lead_stages.current_stage` en el schema es `'nuevo'`; el seed de QC crea las etapas `A/MS/B/C/D`. El funnel es genérico: otro tenant podría tener etapas distintas.

## Qué hace el agente en cada turno

Cuando el debounce dispara un batch (webhook a n8n), el agente hace **dos cosas**:

1. **Decide qué responder** al usuario (texto y/o disparar contenido pregrabado de ManyChat).
2. **Decide si la etapa cambia** y lo registra (`set_stage` → `lead_stages` + `stage_transitions`).

Lo decide con base en: el batch de mensajes nuevos, la memoria conversacional, la etapa actual (inyectada por `Get Stage Config`) y el contexto CRM (follow-ups previos, inyectado por `Get CRM Context`). El chain de nodos está en [06-integracion-n8n](06-integracion-n8n.md) y [`n8n/README.md`](../../n8n/README.md).

## Memoria conversacional

El agente usa el nodo **Postgres Chat Memory** de n8n: el historial vive en la tabla `n8n_chat_histories` (schema `n8n`), con `session_id = manychat_subscriber_id`. Tanto los turnos del agente como los follow-ups automáticos (marcados `[SEGUIMIENTO AUTOMÁTICO #N]`) se escriben ahí, así que el agente es consciente de lo que pasó fuera de su turno. Ver ADR-0009 y ADR-0012.

> Pendiente (ver [`status.md`](../status.md)): memoria semántica/episódica para recall profundo de leads que vuelven tras semanas. Hoy la memoria es cronológica.

## Tools del agente

**Implementadas hoy** (nodos del AI Agent, vía HTTP a Fastify o a ManyChat):

| Tool | Qué hace |
|---|---|
| `trigger_manychat_flow(flow_ns)` | Dispara un flow pregrabado de ManyChat (vídeo, audio, imagen, sticker). El agente recibe los flows disponibles por etapa en el prompt (ver [09-flow-registry-manychat](09-flow-registry-manychat.md)) y nunca inventa un `flow_ns`. |
| `set_stage(new_stage, reason, evidence)` | Avanza/cambia la etapa. Descalificar = `set_stage("disqualified", ...)`. Llama a `POST /admin/leads/:subscriberId/stage`. |

**El timer de follow-up no es una tool**: tras la respuesta del agente, el nodo `Upsert Lead Cron` resetea `lead_crons.next_followup_at`. No hay `schedule_follow_up`/`cancel_follow_ups` que invoque el agente. Ver [08-follow-ups-y-crons](08-follow-ups-y-crons.md).

**Pendientes** (diseño, no implementadas — ver [`status.md`](../status.md)): `archive_conversation` (necesita endpoint), `notify_human` (necesita tabla `notifications`), `send_calendly_link` con round-robin de closers, `get_objection_bank`. El envío del link de Calendly hoy es texto con `tenant.config.calendly_url`.

## El system prompt

Un **único agente con un system prompt extendido** que conoce las etapas, en vez de 5 sub-agentes (más fácil de iterar; los modelos modernos lo manejan bien). El modelo es **Claude Sonnet 4.6**. El prompt vive en `tenants.config.system_prompt`; la fuente versionada es [`n8n/prompts/setter-v1.md`](../../n8n/prompts/setter-v1.md). **No vive en código TypeScript.** El detalle de personalidad, producto y reglas está en ese archivo y en [`n8n/system-prompt.md`](../../n8n/system-prompt.md).

## Criterios de transición

El agente avanza **una etapa por vez** (no salta A→C). Resumen (canónico en [`n8n/stages.md`](../../n8n/stages.md)):

- **A → MS**: el lead confirma haber visto el Vídeo 1 (verbal: "ya lo vi", "interesante"; o emoji 👍/✅ **después** de que el agente preguntó).
- **MS → B**: tras el Vídeo 2 (VSL), reacciona positivo ("me encanta", "quiero saber más", "cómo funciona").
- **B → C**: tras un mensaje positivo claro, el agente envía el link de Calendly.
- **C → D**: lo dispara el **webhook de Calendly**, no el agente (pendiente de implementar — ver `status.md`).

### Descalificación
- `no_money`: "no tengo dinero", "no me lo puedo permitir" (tras un intento de reencuadre).
- `not_interested`: "no me interesa", "déjame en paz".
- `geographic`: fuera de países hispanohablantes / zona horaria inviable.
- `fake_account` / `no_quality`: cuenta sin foto, casi sin seguidores, inactiva.
- Pregunta por precio antes de B → no dar precio: "es lo que vemos en la llamada de discovery, primero asegúrate de que encajamos".

## Ejemplo end-to-end (lead nuevo por Default Reply)

```
T+0    Usuario: "hola"  → webhook → debounce
T+15s  Agente (lead nuevo, sin etapa):
       1. trigger_manychat_flow(<flow QC_A_video_hook>)
       2. responde: "Eyy! Qué tal? Te paso un vídeo rápido 👇"
       3. set_stage("A", "first_contact", "lead inició conversación")
       → Upsert Lead Cron: next_followup_at = T+ (delay del template #1 de A)

T+18h  Usuario: "ya lo vi, interesante"
       1. set_stage("MS", "user_confirmed_video", evidence="ya lo vi, interesante")
       2. trigger_manychat_flow(<flow QC_MS_video_vsl>)
       3. responde: "Genial! Te paso un segundo vídeo más completo 🎯"
       → Upsert Lead Cron resetea el timer

T+19h  Usuario: "👍 me encanta"
       1. set_stage("B", "vsl_engaged", evidence="me encanta")
       2. responde con el link de Calendly (tenant.config.calendly_url)
       3. set_stage("C", "calendly_sent")

(C→D lo movería el webhook de Calendly — pendiente)
```

## Detección de "Media Seen" — heurística de presencia

El agente decide *cuándo* preguntar "¿pudiste ver el vídeo?" según señales de presencia que recibe en el payload (`instagram_context.last_seen`, `last_interaction`): si el lead está caliente (visto hace pocos minutos), pregunta ya; si lleva horas, programa; si lleva >24h, sigue la cadencia normal de follow-ups. Esta lógica vive en el prompt.

> Pendiente: el payload de la API hacia n8n aún no inyecta de forma fiable `instagram_context.{last_seen, last_interaction}` — ver `status.md`.

## Antipatrones del funnel

- ❌ **Hardcodear etapas en código**: viven en `funnel_stages` por tenant, no como enum en TS.
- ❌ **`set_stage` sin `evidence`**: cada cambio lleva la frase del usuario que lo justifica (auditoría + mejora del prompt).
- ❌ **Saltar etapas** (A→C directo): el avance es de una en una.
- ❌ **Descalificar a la primera objeción**: el prompt instruye reencuadrar antes de descartar.
- ❌ **Que el agente invente un `flow_ns`**: solo usa los que recibe en "CONTENIDO DISPONIBLE".

## Métricas que habilita

Las transiciones (`stage_transitions`) y los conteos por etapa (`lead_stages`) alimentan MSR/PRR/CSR/ABR y el embudo. Las queries y el panel están en [13-dashboard-y-metricas](13-dashboard-y-metricas.md) — **pendiente de implementar**.
