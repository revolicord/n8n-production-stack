# Workflow: agent-run

Documentación de referencia del workflow principal. El JSON del workflow **no se versiona** (contiene tokens). Todo lo necesario para reconstruirlo está en esta carpeta.

---

## Diagrama de nodos

```
Webhook
  └─► Get Stage Config (Postgres)            ┐ (pendiente de cablear en UI)
  └─► Get Subscriber CRM Context (Postgres)  ┘
        └─► Build Context (Code)
              └─► AI Agent
                    ├─◄ Anthropic Chat Model (Claude Sonnet 4.6)  (ai_languageModel)
                    ├─◄ Postgres Chat Memory                       (ai_memory)
                    ├─◄ trigger_manychat_flow                      (ai_tool)
                    └─◄ set_stage                                  (ai_tool)
                    └─► enviar texto (HTTP Request)
                          └─► Upsert Lead Cron (Postgres)  (pendiente de cablear)
                                └─► Prepare Callback (Code)
                                      └─► Callback (HTTP Request)
```

**Nodo eliminado:** `Get Tools` (HTTP Request) — los flows ya vienen en el payload desde el API, filtrados en `Build Context`.

---

## Checklist de setup desde cero

- [ ] Importar workflow desde el panel de n8n
- [ ] Reconectar credencial **Anthropic** en nodo `Anthropic Chat Model` (Claude Sonnet 4.6)
- [ ] Reconectar credencial **Postgres** en nodo `Postgres Chat Memory`
- [ ] Verificar que el Webhook esté activo y la URL coincide con `n8n_workflow_url` en `tenants.config`
- [ ] Configurar `flows_by_stage` en `tenants.config` (ver `stages.md` y `flows-catalog.md`)

---

## Archivos de referencia

| Archivo | Contenido |
|---------|-----------|
| `nodes/01-build-context.md` | Código JS del nodo Build Context |
| `nodes/02-ai-agent.md` | Configuración del agente y referencia al system prompt |
| `nodes/03-groq-chat-model.md` | Modelo y credencial (histórico: ahora es Claude Sonnet 4.6 vía Anthropic — pendiente renombrar el archivo) |
| `nodes/04-postgres-memory.md` | Session key |
| `nodes/05-enviar-texto.md` | HTTP Request a ManyChat sendContent |
| `nodes/06-prepare-callback.md` | Código JS del nodo Prepare Callback |
| `nodes/07-callback.md` | HTTP Request al API |
| `flows-catalog.md` | Mapeo flow_name → ns de ManyChat + etapa |
| `stages.md` | Definición de etapas y `flows_by_stage` config |
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
- `tenants.config.flows_by_stage` — mapa etapa → flows permitidos
