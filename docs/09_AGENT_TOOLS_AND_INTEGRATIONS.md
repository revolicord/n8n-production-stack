# 09 — Agent Tools and Integrations
## Tools del Agente Setter (Quantum Creators)

---

> **Propósito:** Documentar cada tool/integración que el agente puede invocar, su contrato y cuándo se usa.
>
> **Implementación viva:** el contrato real está en `docs/n8n/nodes/02-ai-agent.md` (JSON Schemas + JS) y en las rutas Fastify (`apps/api/src/routes/`).

---

## 1. Tools Conectadas al Agente Hoy

| Tool | Tipo | Sistema destino | Propósito |
|------|------|-----------------|-----------|
| `trigger_manychat_flow` | Code Tool (n8n) | ManyChat API (`/fb/sending/sendFlow`) | Disparar contenido multimedia (vídeo, audio, imagen, texto preescrito) al lead |
| `set_stage` | Code Tool (n8n) | DM API (`POST /admin/leads/:subscriberId/stage`) | Avanzar la etapa del lead en el funnel o descalificar |

Estas dos son las **únicas tools del agente en MVP**. Todo lo demás se gestiona fuera del LLM:

- Envío de texto plano: el output del agente va directo a `POST /fb/sending/sendContent` (nodo HTTP "enviar texto" en n8n, ADR-0007).
- Follow-ups automáticos: workflow `followup-runner` (cron) — el agente no los dispara.
- Cambio de etapa por evento externo (webhook Calendly): el sistema lo marca, no el agente (P1).
- Memoria conversacional: Postgres Chat Memory en n8n — el agente la consume implícitamente.

---

## 2. Detalle por Tool

### 2.1 `trigger_manychat_flow`

- **Sistema:** ManyChat API vía n8n Code Tool.
- **Input schema:**
  ```json
  {
    "type": "object",
    "required": ["flow_name"],
    "properties": {
      "flow_name": {
        "type": "string",
        "pattern": "^content[0-9]+_[0-9]+$",
        "description": "ns exacto de ManyChat — copiar carácter por carácter del bloque CONTENIDO DISPONIBLE."
      }
    }
  }
  ```
- **Output al LLM:** string `"ok: flow X enviado a subscriber Y"` o `"error: ..."`.
- **Cuándo se usa:** una sola llamada por turno. Es la acción principal del agente — el texto solo acompaña.
- **Restricciones:** el `flow_name` se valida con regex tanto en el JSON Schema como en el JS de la tool. Si el LLM inventa un ns, la tool devuelve error en lenguaje natural y el LLM puede corregir.

### 2.2 `set_stage`

- **Sistema:** DM API vía `POST /admin/leads/:subscriberId/stage` (Bearer `N8N_CALLBACK_TOKEN`).
- **Input schema:**
  ```json
  {
    "type": "object",
    "required": ["new_stage", "reason", "evidence"],
    "properties": {
      "new_stage": { "enum": ["A", "MS", "B", "C", "D", "disqualified"] },
      "reason":    { "type": "string" },
      "evidence":  { "type": "string", "minLength": 1 }
    }
  }
  ```
- **Output al LLM:** `"ok: stage changed A → MS"` / `"ok: stage already MS (no change)"` / `"error: HTTP 400 — INVALID_TRANSITION"`.
- **Reglas del endpoint:**
  - Solo transiciones válidas (`A→MS`, `MS→B`, `B→C`, `C→D`, cualquiera→`disqualified`).
  - Para `disqualified`, `reason` debe ser uno de: `no_money`, `not_interested`, `geographic`, `no_quality`, `fake_account`.
  - `evidence` debe ser una cita textual del lead.
  - Toda transición se loguea inmutablemente en `api.stage_transitions`.

---

## 3. Tools Planificadas (NO en MVP)

| Tool | Para | Estado |
|------|------|--------|
| `archive_conversation` | El agente archiva manualmente cuando no hay interés real | Endpoint existe en spec (`POST /admin/conversations/:id/archive`); tool no creada |
| `notify_human` | Escalación a Alex (insulto, lead VIP, lead caliente) | Tabla `notifications` y tool sin implementar |
| `send_calendly_link` | Round-robin de closers — selección atómica con lock | Pendiente (P1). Hoy: link único en `tenant.config.calendly_url` |
| `get_objection_bank` | Lookup de objeciones entrenadas | Pendiente (P1). Hoy: política = descalificación inmediata |
| `mark_disqualified` | — | **No se construye**. Cubierto por `set_stage("disqualified", reason, evidence)`. |

---

## 4. Integraciones Externas

### 4.1 ManyChat API
- **Endpoints usados:**
  - `POST /fb/sending/sendFlow` — disparado desde la tool `trigger_manychat_flow` y desde el `followup-runner` para follow-ups tipo flow.
  - `POST /fb/sending/sendContent` — para texto plano (output del agente) y para follow-ups tipo texto.
  - `GET /fb/page/getFlows` — usado por `GET /tenants/:slug/tools` para sincronizar `stage_flows`.
- **Auth:** Bearer token, almacenado en `tenants.config.manychat_api_key` (jsonb).
- **Rate limits:** según plan ManyChat — pendiente confirmar y proteger en capa Fastify (P2).

### 4.2 DM API (callbacks de n8n)
- `POST /admin/turn-completed` — cierra el turno, libera el lock de Redis, persiste métricas (tokens, costo, duración, modelo).
- `POST /admin/leads/:subscriberId/stage` — utilizado por la tool `set_stage`.
- Ambos usan Bearer `N8N_CALLBACK_TOKEN`.

### 4.3 Calendly
- **Hoy:** link único embebido en `tenant.config.calendly_url`. El agente lo envía por texto en la etapa B→C.
- **Pendiente (P1):** webhook entrante con verificación de firma → endpoint Fastify dedicado → marca `D` automáticamente.

### 4.4 Close CRM
- **Estado:** **NO integrado en MVP.** Se integrará en V1+ y se alimentará desde Postgres (la fuente de verdad sigue siendo Postgres).
- **Implicación operativa:** hoy no hay "creación de lead en Close", "actualización de stage en Close", etc. Toda esa información vive en `api.subscribers` + `api.lead_stages` + `api.stage_transitions`.

---

## 5. Modelo IA Usado

| Campo | Valor |
|---|---|
| Proveedor | Anthropic |
| Modelo | Claude Sonnet 4.6 (`claude-sonnet-4-6`) |
| Modo | Chat con tool-calling nativo vía API |
| Memoria | Postgres Chat Memory (`n8n_chat_histories`), `session_id = manychat_subscriber_id` |
| Costo estimado por conversación | Pendiente — el callback `turn-completed` persiste `cost_usd` por turn; agregar dashboard (P2) |
| Migración previa | v1–v3: llama-3.3-70b vía Groq. v4: migrado a Claude Sonnet 4.6 por adherencia en tool-calling multi-etapa y al copiar `ns` literalmente |

---

## 6. Cambio Arquitectónico Planificado: Salida JSON Estructurada

Hoy la salida del agente es **texto plano** que va directo al nodo HTTP "enviar texto". Decisión del founder: migrar a **JSON estructurado** donde el agente devuelve un objeto parseable por n8n con:

- `response_to_user` — texto a enviar (si aplica).
- `actions` — lista de acciones determinísticas a aplicar (`trigger_flow`, `set_stage`, `archive`, `notify_human`, ...).
- `internal_notes` — anotaciones del agente para auditoría.

**Consecuencias:**
- Las tools dejan de ser efecto colateral del LLM; pasan a ser **decisiones declaradas** que un nodo determinista aplica.
- n8n añade un parser JSON + dispatcher por tipo de acción.
- Mejora la auditabilidad y permite políticas duras (ej: validar `actions` antes de aplicar).

**Pendiente:** ADR específico + plan de migración sin romper el flujo en vivo.

---

## 7. Gaps y Preguntas Abiertas

- [ ] Diseño del schema JSON exacto de la nueva salida estructurada
- [ ] Estrategia de fallback si el agente no devuelve JSON válido
- [ ] Costo por conversación en tiempo real (dashboard) — hoy solo se guarda por turn
- [ ] Webhook Calendly + verificación de firma (P1)
- [ ] Plan de integración con Close (V1+) — cómo se reflejan transiciones y mensajes en Close
