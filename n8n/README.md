# Workflow: agent-run

Documentación de referencia del workflow principal. El JSON del workflow **no se versiona** (contiene tokens). Todo lo necesario para reconstruirlo está en esta carpeta.

---

## Diagrama de nodos

```
Webhook
  └─► Build Context (Code)
        └─► AI Agent
              ├─◄ Chat Model — Claude Sonnet 4.6 (ai_languageModel)
              ├─◄ Postgres Chat Memory (ai_memory)
              ├─◄ trigger_manychat_flow (ai_tool)
              └─◄ set_stage            (ai_tool)
              └─► enviar texto (HTTP Request)
                    └─► Prepare Callback (Code)
                          └─► Callback (HTTP Request)
```

> **Nota:** este diagrama puede ir por detrás del workflow real. El chain en producción incluye además `Get Stage Config` (lee `funnel_stages` + `stage_flows`), `Get CRM Context` y `Upsert Lead Cron`. Fuentes autoritativas: [`../docs/reference/funnel-engine.md`](../docs/reference/funnel-engine.md), [`../docs/onboarding/08-follow-ups-y-crons.md`](../docs/onboarding/08-follow-ups-y-crons.md) y [`../docs/status.md`](../docs/status.md).

---

## Checklist de setup desde cero

- [ ] Importar workflow desde el panel de n8n
- [ ] Reconectar la credencial del modelo (**Claude Sonnet 4.6**) en el nodo del Chat Model
- [ ] Reconectar credencial **Postgres** en nodo `Postgres Chat Memory`
- [ ] Verificar que el Webhook esté activo y la URL coincide con `n8n_workflow_url` en `tenants.config`
- [ ] Verificar el registro `stage_flows` por etapa (ver `flows-catalog.md` y `../docs/onboarding/09-flow-registry-manychat.md`)

---

## Archivos de referencia

| Archivo | Contenido |
|---------|-----------|
| `nodes/01-build-context.md` | Código JS del nodo Build Context |
| `nodes/02-ai-agent.md` | Configuración del agente y referencia al system prompt |
| `nodes/03-groq-chat-model.md` | Modelo y credencial (nombre histórico; el modelo en uso es Claude Sonnet 4.6) |
| `nodes/04-postgres-memory.md` | Session key |
| `nodes/05-enviar-texto.md` | HTTP Request a ManyChat sendContent |
| `nodes/06-prepare-callback.md` | Código JS del nodo Prepare Callback |
| `nodes/07-callback.md` | HTTP Request al API |
| `flows-catalog.md` | Mapeo flow_name → ns de ManyChat + etapa |
| `stages.md` | Definición de etapas y criterios de transición |
| `system-prompt.md` | System prompt base y formato de inyección dinámica |

---

## Variables de entorno requeridas (servidor API)

```
N8N_CALLBACK_TOKEN=<token>          # debe coincidir con callback_token en el payload
PUBLIC_API_URL=https://api.revolicord.com
```

## Dependencias del API

Tablas necesarias en PostgreSQL (ver ADR-0008):
- `api.lead_stages` — etapa actual por subscriber
- `api.stage_transitions` — log inmutable de cambios de etapa
- `funnel_stages` + `stage_flows` (Postgres) — etapas y flows por etapa (ver `../docs/onboarding/09-flow-registry-manychat.md`)
