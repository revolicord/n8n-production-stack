# Acción: notify_human (escalado a humano)

**Tipo:** nueva acción del plan del AI Agent, ejecutada por el nodo `Router`
**Endpoint:** `POST {PUBLIC_API_URL}/admin/leads/{subscriber_id}/notify-human`
**Auth:** `Authorization: Bearer {N8N_CALLBACK_TOKEN}` (igual que `set-stage`)
**Estado:** pendiente de aplicar en la UI de n8n (el código del API ya está en producción)

---

## Qué hace

Cuando el agente decide que la conversación necesita un humano, emite la acción
`notify_human` y el Router llama al API. El API crea una fila en
`api.notifications` (kind=`agent`) y el worker BullMQ `notify` manda la alerta
a Telegram con botones **[⏸ Pausar bot] [✅ Resuelto]**. No pausa al lead
automáticamente: la pausa es decisión del humano (botón de Telegram o página
Escalaciones del dashboard).

El API aplica un throttle de 10 min por lead (kind=`agent`): si el agente
escala dos veces seguidas, la segunda devuelve `202 {throttled: true}` y no
duplica la alerta.

## Contrato

```
POST /admin/leads/:subscriberId/notify-human
Authorization: Bearer <N8N_CALLBACK_TOKEN>
Content-Type: application/json

{
  "reason": "lead pide hablar con una persona",     // obligatorio
  "summary": "preguntó precio 2 veces y duda de si soy un bot",  // opcional
  "turn_id": "<uuid>",          // opcional
  "conversation_id": "<uuid>"   // opcional
}

→ 202 { "accepted": true, "notification_id": "<uuid>" }
→ 202 { "accepted": true, "throttled": true }   // ya hubo escalado hace <10 min
→ 404 { "error": { "code": "NOT_FOUND" } }
```

## Cambio en el Router (snippet)

Añadir el case al iterador de `actions` (mismo patrón que `change_stage` →
`callSetStage`):

```javascript
async function execNotifyHuman(action) {
  const url = `${API_BASE}/admin/leads/${subscriberId}/notify-human`;
  await withRetry(() =>
    axios.post(
      url,
      {
        reason: action.reason,
        summary: action.summary ?? undefined,
        turn_id: turnId,
        conversation_id: conversationId,
      },
      { headers: { Authorization: `Bearer ${CALLBACK_TOKEN}` }, timeout: 15000 },
    ),
  );
}

// en el switch del loop de actions:
case 'notify_human':
  await execNotifyHuman(action);
  break;
```

Y en el JSON Schema del structured output del agente, añadir al enum de
`actions[].type` el valor `notify_human` con propiedades:

```json
{
  "type": "notify_human",
  "reason": "string (obligatorio, motivo corto)",
  "summary": "string (opcional, resumen de la conversación)"
}
```

## Regla de prompt

Ver `docs/n8n/prompts/setter-v1.md` (v8, regla 7 — ESCALADO A HUMANO):
el agente emite `notify_human` cuando el lead pide explícitamente hablar con
una persona, está agresivo, o el agente tiene incertidumbre alta. La detección
determinista (audio + keywords) NO pasa por el agente: vive en
`webhook-manychat.ts` y es complementaria.

## Configuración relacionada

- `tenant.config.telegram_chat_id` — chat destino por tenant (fallback `TELEGRAM_DEFAULT_CHAT_ID`).
- `tenant.config.notification_keywords` — keywords del detector determinista, ej.
  `["humano","persona real","eres un bot","robot","operador"]`.
- Webhook de botones: registrar una vez con `bash scripts/telegram-set-webhook.sh`.
