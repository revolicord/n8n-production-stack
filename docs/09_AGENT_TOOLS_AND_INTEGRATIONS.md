# 09 — Agent Tools and Integrations
## Qué Herramientas Usa el Agente

---

> **Propósito:** Documentar cada tool/integración que el agente puede invocar, su contrato (input/output) y cuándo se usa.

---

## 1. Resumen de Tools

| Tool | Sistema | Propósito |
|---|---|---|
| `send_message` | ManyChat | Enviar mensaje de texto al lead |
| `send_media` | ManyChat | Enviar video / audio / imagen |
| `update_lead_stage` | Close CRM | Cambiar etapa del lead en pipeline |
| `log_conversation` | Close CRM | Registrar el intercambio en historial |
| `schedule_followup` | n8n scheduler | Programar mensaje futuro |
| `send_calendly_link` | ManyChat | Enviar link de agendado |
| `escalate_to_human` | _[completar]_ | Notificar a Alex / closer |
| `get_lead_state` | Close CRM | Recuperar estado actual del lead |

---

## 2. Detalle por Tool

### 2.1 `send_message`
- **Sistema:** ManyChat (vía n8n)
- **Input:** `{ subscriber_id, text }`
- **Output:** `{ success, message_id }`
- **Cuándo se usa:** cualquier respuesta de texto al lead.
- **Restricciones:** ventana de 24h de Meta.

### 2.2 `send_media`
- **Sistema:** ManyChat (vía n8n)
- **Input:** `{ subscriber_id, asset_id, asset_type }`
- **Output:** `{ success, message_id }`
- **Cuándo se usa:** envío de videos 25s, audio pre-VSL, VSL.

### 2.3 `update_lead_stage`
- **Sistema:** Close CRM
- **Input:** `{ lead_id, new_stage, metadata }`
- **Output:** `{ success }`
- **Cuándo se usa:** cada vez que el lead avanza/retrocede de etapa.
- **Etapas posibles:** ver `10_CONVERSATION_STATE_MACHINE.md`.

### 2.4 `log_conversation`
> 🚧 Pendiente

### 2.5 `schedule_followup`
> 🚧 Pendiente

### 2.6 `send_calendly_link`
> 🚧 Pendiente

### 2.7 `escalate_to_human`
> 🚧 Pendiente: definir canal (Slack? email? etiqueta en Close?)

### 2.8 `get_lead_state`
> 🚧 Pendiente

---

## 3. Integraciones Externas

### 3.1 ManyChat API
- **Documentación:** _[completar URL]_
- **Auth:** _[completar — API key, OAuth]_
- **Rate limits:** _[completar]_

### 3.2 Close CRM API
- **Documentación:** _[completar URL]_
- **Auth:** _[completar]_
- **Rate limits:** _[completar]_

### 3.3 Calendly API
- **Documentación:** _[completar URL]_
- **Auth:** _[completar]_
- **Webhook de evento agendado:** _[completar — ¿a dónde notifica cuando alguien agenda?]_

### 3.4 n8n
- **Workflows expuestos:** _[completar]_

---

## 4. Modelo de IA Usado

| Campo | Valor |
|---|---|
| Proveedor | _[completar — OpenAI / Anthropic / otro]_ |
| Modelo | _[completar]_ |
| Modo | _[completar — completion / chat / tool calling]_ |
| Costo estimado por conversación | _[completar]_ |

---

## 5. Gaps y Preguntas Abiertas

- [ ] Definir contratos exactos de cada tool
- [ ] Confirmar canal de escalación a humano
- [ ] Confirmar modelo IA elegido y razón
- [ ] Documentar manejo de errores por tool
