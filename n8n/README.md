# Workflow: agent-run

Documentación de referencia del workflow principal `agent-run` (v3).  
El JSON del workflow **no se versiona** en texto plano (contiene tokens); exportarlo como `agent-run(N).json` para snapshots.  
Todo lo necesario para reconstruirlo está en esta carpeta.

---

## Diagrama de nodos (v3 — actual)

```
Webhook ──┬──► Get Stage Config (Postgres) ─────────────────────────────────┐
          │                                                                   │ input 0
          └──► Get Subscriber CRM Context (Postgres) ──► Get Content History ─► Combine Contexts (Merge)
                                                                                        │ input 1
                                                                               System Prompt (Set)
                                                                                        │
                                                                           Execute a SQL query1 (Postgres)
                                                                           [marca lead_content_sent como responded]
                                                                                        │
                                                                               Build Context (Code)
                                                                                        │
                                                                                     AI Agent
                                                                                   ├─◄ Anthropic Chat Model (ai_languageModel)
                                                                                   ├─◄ Postgres Chat Memory  (ai_memory)
                                                                                   └─◄ Structured Output Parser (ai_outputParser)
                                                                                        │
                                                                                      Router (Code)
                                                                                        │
                                                                                  If (insert_content_sent vacío?)
                                                                                  ├─[true / null]─► [FIN]
                                                                                  └─[false / hay insert]─► lead_content_sent (Postgres INSERT)
                                                                                                                  │
                                                                                                           Upsert Lead Cron (Postgres)
                                                                                                                  │
                                                                                                       Mark Followups Responded (Postgres)
                                                                                                                  │
                                                                                                               [FIN] ⚠️ BUG: falta nodo turn-completed
```

> **v3 vs v2:** el agente ya no usa herramientas (`trigger_manychat_flow`, `set_stage`).
> Devuelve un JSON estructurado con `send_content`, `change_stage`, `reply_text`.
> El **Router** ejecuta ese plan. El **Structured Output Parser** valida el schema.

---

## ⚠️ Bugs conocidos en el workflow vivo (pendientes de corregir en UI)

| # | Nodo | Bug | Fix requerido |
|---|------|-----|---------------|
| 1 | `Get Content History` | `queryReplacement` en formato roto (`=$1 = val $2 = val`) en lugar de comma-separated | Cambiar a `={{ val1 }},{{ val2 }},{{ val3 }}` |
| 2 | `Execute a SQL query1` | Mismo formato roto para 2 parámetros | Cambiar a `={{ sub_id }},{{ conv_id }}` |
| 3 | `lead_content_sent` | Mismo formato roto para 7 parámetros | Cambiar a comma-separated |
| 4 | **Toda la cadena** | **Falta nodo `turn-completed`** al final — el turn lock nunca se libera | Añadir HTTP Request al final que llame `POST {{ callbackUrl }}` |
| 5 | `Router` → `callManychatText` | `message_tag: 'ACCOUNT_UPDATE'` aún presente — ManyChat devuelve 400 en ventana de 24h | Quitar `message_tag`; añadir `actions: []`, `quick_replies: []` |

---

## Checklist de setup desde cero

- [ ] Importar workflow desde el panel de n8n
- [ ] Reconectar credencial **Anthropic** en nodo `Anthropic Chat Model` (Claude Sonnet 4.6)
- [ ] Reconectar credencial **Postgres** en nodos Postgres (hay 6)
- [ ] Verificar que el Webhook esté activo y la URL coincide con `n8n_workflow_url` en `tenants.config`
- [ ] Corregir bugs 1-5 de la tabla anterior
- [ ] Añadir nodo HTTP Request `turn-completed` al final de cada rama

---

## Archivos de referencia

| Archivo | Contenido |
|---------|-----------|
| `nodes/00-get-stage-config.md` | SQL y params del nodo Get Stage Config |
| `nodes/00b-get-crm-context.md` | SQL y params del nodo Get Subscriber CRM Context |
| `nodes/00c-system-prompt.md` | Configuración del Set node System Prompt |
| `nodes/00d-get-content-history.md` | SQL y params del nodo Get Content History (nuevo v3) |
| `nodes/00e-mark-content-responded.md` | SQL del nodo Execute a SQL query1 (nuevo v3) |
| `nodes/01-build-context.md` | Código JS completo del nodo Build Context v3 |
| `nodes/02-ai-agent.md` | Configuración del AI Agent + Structured Output Parser |
| `nodes/08-router-v1.md` | Código JS completo del Router |
| `nodes/09-if-content-sent.md` | Condición del nodo If |
| `nodes/10-lead-content-sent.md` | SQL INSERT en lead_content_sent |
| `nodes/99-upsert-lead-cron.md` | SQL Upsert Lead Cron + Mark Followups Responded |
| `flows-catalog.md` | Mapeo slug_id → flow_ns de ManyChat + etapa |
| `stages.md` | Definición de etapas y transiciones válidas |
| `system-prompt.md` | System prompt base (fuente de verdad, copiar al Set node) |
| `followup-runner.md` | Documentación del workflow followup-runner (v2) |
| `nodes/followup/` | Docs por nodo del followup-runner (14 archivos) |

---

## Payload de entrada (Webhook)

El API envía estos campos relevantes en `body`:

```json
{
  "schema_version": "v1",
  "turn_id": "<uuid>",
  "callback_url": "https://api.revolicord.com/admin/turn-completed",
  "callback_token": "<token>",
  "tenant": {
    "id": "<uuid>",
    "slug": "revolicord",
    "config": {
      "manychat_api_key": "...",
      "calendly_url": "https://...",
      "n8n_workflow_url": "...",
      "model": "...",           // IGNORADO — n8n usa Claude Sonnet 4.6 hardcoded
      "system_prompt": "..."    // IGNORADO — n8n usa el Set node System Prompt
    }
  },
  "subscriber": {
    "id": "<uuid-db>",
    "manychat_subscriber_id": "1724803790",
    "ig_username": "...",
    "display_name": "...",
    "lead_stage": "A",
    "metadata": {}
  },
  "conversation": { "id": "<uuid>", "opened_at": "..." },
  "messages": [{ "id": "...", "text": "...", "reply_type": "...", "ts": 0, "media_urls": [] }],
  "trigger": { "source": "instagram_dm", "channel": "instagram_dm" }
}
```

> Campos **no enviados** (el API no los incluye aún): `instagram_context`, `lead_state`.
> Build Context los lee con fallback gracioso (`|| {}`).

---

## Variables de entorno requeridas (servidor API)

```
N8N_CALLBACK_TOKEN=<token>          # debe coincidir con callback_token en el payload
PUBLIC_API_URL=https://api.revolicord.com
```

## Dependencias del API — tablas Postgres

- `api.funnel_stages` — definición de etapas (slug, goal, max_followups)
- `api.stage_flows` — flows disponibles por etapa (slug_id, flow_ns, variant_group, weight)
- `api.stage_transitions_map` — transiciones válidas entre etapas (from→to + when_to_use)
- `api.lead_crons` — próximo follow-up programado por subscriber
- `api.lead_followup_log` — historial de follow-ups enviados
- `api.lead_content_sent` — historial de contenido enviado (slug_id, flow_ns, responded)
