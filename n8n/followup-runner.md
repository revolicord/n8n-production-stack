# Workflow: followup-runner (v2)

Documentación de referencia del workflow `followup-runner`.  
Ejecuta cada 5 minutos para procesar follow-ups automáticos programados en `api.lead_crons`.  
Snapshot actual: `followup-runner(1).json`.

---

## Diagrama de nodos (v2)

```
Every 5 Minutes
      │
      ▼
Get Due Leads (Postgres)
      │
      ▼
Prepare Data (Code)
      │
      ▼
Loop Over Leads (Split in Batches)
      │ output 1 (loop)
      ▼
Has Template? (If)
  │ true                    │ false
  ▼                         ▼
Type is text? (If)     Archive lead_crons (Postgres)
  │ true   │ false          │
  ▼        ▼                └──► Loop Over Leads (output 0)
sendContent sendFlow
  │          │
  └──────────┘
       ▼
  After Send (Merge)
       │
       ▼
  Build SQL (Code)
       │
       ▼
  Insert followup log (Postgres)
       │
       ▼
  Insert n8n_chat_histories (Code)   ← nuevo en v2
       │
       ▼
  Insert chat history1 (Postgres)
       │
       ▼
  Update lead_crons (Postgres)
       │
       └──► Loop Over Leads (output 0)
```

---

## Archivos de referencia por nodo

| # | Nodo | Archivo |
|---|------|---------|
| 1 | Every 5 Minutes | — (Schedule Trigger sin config especial) |
| 2 | Get Due Leads | `nodes/followup/01-get-due-leads.md` |
| 3 | Prepare Data | `nodes/followup/02-prepare-data.md` |
| 4 | Loop Over Leads | `nodes/followup/03-loop-over-leads.md` |
| 5 | Has Template? | `nodes/followup/04-has-template.md` |
| 6 | Archive lead_crons | `nodes/followup/05-archive-lead-crons.md` |
| 7 | Type is text? | `nodes/followup/06-type-is-text.md` |
| 8 | sendContent | `nodes/followup/07-send-content.md` |
| 9 | sendFlow | `nodes/followup/08-send-flow.md` |
| 10 | After Send | `nodes/followup/09-after-send.md` |
| 11 | Build SQL | `nodes/followup/10-build-sql.md` |
| 12 | Insert followup log | `nodes/followup/11-insert-followup-log.md` |
| 13 | Insert n8n_chat_histories | `nodes/followup/12-insert-chat-histories-code.md` |
| 14 | Insert chat history1 | `nodes/followup/13-insert-chat-history-postgres.md` |
| 15 | Update lead_crons | `nodes/followup/14-update-lead-crons.md` |

---

## Cambios v1 → v2

| Aspecto | v1 (`followup-runner.json`) | v2 (`followup-runner(1).json`) |
|---------|----|----|
| **Delay units** | `delay_hours` | `delay_minutes` |
| **Campos SQL Get Due Leads** | Solo template básico | + `max_followups`, `content_text`, `image_context` |
| **Tipos de template soportados** | `text`, `flow` | `text`, `flow`, `content` |
| **Chat memory prep** | Embebido en Build SQL (string concat) | Nodo Code dedicado por tipo |
| **Insert chat history** | 1 nodo Postgres con SQL dinámico | Code prep + Postgres parametrizado |
| **Seguridad SQL** | String concatenation | Params `$1, $2` en chat history |

---

## Dependencias del DB

- `api.lead_crons` — crons activos con próximo follow-up
- `api.subscribers` — manychat_id y nombre del suscriptor
- `api.tenants` — config con `manychat_api_key`
- `api.funnel_stages` — `max_followups` por etapa
- `api.followup_templates` — plantillas por etapa + sequence + `delay_minutes`
- `api.followup_messages` — contenido de mensajes tipo `content` (texto + imagen)
- `api.lead_followup_log` — historial de follow-ups enviados
- `n8n_chat_histories` — memoria de chat del agente n8n

---

## ⚠️ Issue conocido

El nodo **Build SQL** genera un `histSql` que ya no se usa. Referencia legada que puede limpiarse en una futura refactor del nodo.
