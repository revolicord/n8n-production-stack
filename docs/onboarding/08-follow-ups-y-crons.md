# 08 · Follow-ups y crons

Cuando un lead deja de responder, el sistema le envía follow-ups automáticos según una secuencia por etapa, y **el agente es consciente de ellos** porque se escriben en su memoria. Esto reactiva leads silenciosos sin intervención humana.

> Implementa ADR-0011 (`lead_crons`), ADR-0012 (follow-ups en la memoria del agente) y ADR-0015 (secuencias por etapa). El diseño completo está en [`reference/funnel-engine.md`](../reference/funnel-engine.md); el spec del workflow, en [`n8n/workflows/followup-runner.md`](../../n8n/workflows/followup-runner.md).

## Las piezas

| Tabla / workflow | Rol |
|---|---|
| `lead_crons` | **El timer.** Una fila por (tenant, subscriber, conversation). Guarda `next_followup_at`, `next_sequence_number`, `is_active`. |
| `followup_templates` | **Qué enviar.** Por etapa (`stage_id`) y `sequence_number`: `delay_hours`, `type` (`text`/`flow`), `text_template` o `flow_ns`. |
| `lead_followup_log` | **Registro inmutable** de cada follow-up enviado (con `status`: sent/failed/responded/skipped). |
| `followup-runner` (n8n) | **El motor.** Schedule Trigger cada 5 min que despacha lo vencido. |

## Cómo se programa el timer (desde `agent-run`)

Tras la respuesta del agente, el nodo **`Upsert Lead Cron`** del workflow `agent-run` (ver [`n8n/nodes/99-upsert-lead-cron.md`](../../n8n/nodes/99-upsert-lead-cron.md)) hace dos cosas:

1. **Resetea el timer**: `next_followup_at = NOW() + delay` del template #1 de la etapa actual (releída fresca desde la BD, por si el agente acaba de cambiarla con `set_stage`), `next_sequence_number = 1`.
2. **Marca como respondidos** los follow-ups pendientes en `lead_followup_log` (`status = 'responded'`), porque el lead acaba de hablar.

Es decir: mientras el lead responde, el timer se reinicia y nunca se le manda follow-up. Solo cuando calla, el `followup-runner` actúa.

## El `followup-runner` (cada 5 min)

```
Schedule (5 min)
  └─► Get Due Leads        ← lead_crons WHERE is_active AND next_followup_at <= NOW()  (LIMIT 50)
        └─► Split in Batches
              └─► IF ¿hay template para next_sequence_number?
                    ├─ SÍ → sendContent (text) | sendFlow (flow) a ManyChat
                    │        └─► Insert lead_followup_log (status='sent')
                    │              └─► Insert n8n_chat_histories  ([SEGUIMIENTO AUTOMÁTICO #N])
                    │                    └─► Update lead_crons (avanzar al siguiente, o archivar si no hay más)
                    └─► NO → archivar lead_crons (is_active=FALSE, archive_reason='max_followups')
```

La query `Get Due Leads` hace JOIN con `followup_templates` para traer el template actual (`next_sequence_number`) **y** el siguiente (para calcular el próximo `delay_hours`). Detalle SQL en el spec del workflow.

## El agente es consciente de los follow-ups (ADR-0012)

Cada follow-up enviado se inserta también en `n8n_chat_histories` (la memoria del agente) con este prefijo:

```
[SEGUIMIENTO AUTOMÁTICO #2] Oye Carlos, ¿pudiste ver el vídeo? 👀
```

Se usa `session_id = manychat_subscriber_id` (el mismo que el nodo Postgres Chat Memory del agente). En el próximo turno, el agente ve estos mensajes en su historial y el bloque CRM de `Build Context` le dice cuántos se enviaron. El system prompt le instruye:

> *"Si ves mensajes con el prefijo `[SEGUIMIENTO AUTOMÁTICO #N]`, los envió el sistema mientras el lead no respondía. No los menciones explícitamente; úsalos como contexto para calibrar tu tono."*

Así, un lead que responde "perdona, estaba liado" tras dos follow-ups recibe una respuesta cálida y coherente, no un saludo de primer contacto.

## Ciclo de vida del cron

```
agent-run responde → Upsert Lead Cron (timer = NOW() + delay #1, seq=1)
   │
   │ (lead calla)
   ▼
followup-runner: envía #1 → log + memoria → avanza a seq=2 (timer = NOW()+delay #2)
   │
   │ (lead sigue callando)
   ▼
… hasta agotar la secuencia → archivar (is_active=FALSE, archive_reason='max_followups')
   │
   │ (en cualquier momento, lead responde)
   ▼
agent-run → Upsert Lead Cron resetea timer + marca pendientes 'responded'
```

## Archivado por decisión del agente

El agente puede archivar un lead muerto con la tool `archive_conversation` (ADR-0013), que pondría `lead_crons.is_active = FALSE` con `archive_reason = 'agent_decision'`.

> **Pendiente**: el endpoint `POST /admin/conversations/:id/archive` que necesita esta tool **no está implementado** todavía (ver [05-api-fastify-endpoints](05-api-fastify-endpoints.md) y [`status.md`](../status.md)). El archivado por secuencia agotada (`max_followups`) sí funciona: lo hace el propio runner vía SQL.

## Notas operativas

- **Límite de 50 leads/ejecución** para evitar timeouts. Con volumen alto: bajar el intervalo o agrandar el batch.
- **Idempotencia**: si el runner falla a mitad, el siguiente ciclo (5 min) reprocesa los vencidos. No hay constraint de unicidad en `lead_followup_log` por `(subscriber, sequence)`; añadir si aparecen duplicados.
- **Errores de ManyChat**: el envío se envuelve en try/catch; si falla, se registra `status='failed'` y **no** se avanza `next_sequence_number`.
- **Estadísticas de follow-ups** (enviados por etapa, tasa de respuesta, archivados): forman parte del **panel de métricas pendiente** — ver [13-dashboard-y-metricas](13-dashboard-y-metricas.md).
