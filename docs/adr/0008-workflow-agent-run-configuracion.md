# ADR-0008: Configuración del workflow `agent-run` en n8n

**Status:** Accepted  
**Date:** 2026-05-12

---

## Contexto

El workflow `agent-run` es el núcleo del agente IA. Recibe el turno desde el API, genera respuesta con el LLM, la envía al usuario vía ManyChat y notifica al API que el turno completó. Este documento captura la configuración que funciona en producción, incluyendo las decisiones de sintaxis de expresiones y los patrones que resuelven limitaciones de n8n.

---

## Cadena de nodos

```
Webhook → Get Tools → Build Context → AI Agent → enviar texto → Prepare Callback → Callback
                                           ↑
                              Groq Chat Model (ai_languageModel)
                              Postgres Chat Memory (ai_memory)
```

---

## Nodos — configuración clave

### 1. Webhook
- **Method:** POST  
- **Path:** `agent-run`  
- **webhookId fijo** — no cambiar después del primer deploy (ManyChat apunta a esta URL).

### 2. Get Tools
- **Method:** GET  
- **URL:** `={{ 'https://api.revolicord.com/tenants/' + ($json.body?.tenant?.slug ?? $json.tenant?.slug) + '/tools' }}`
- **Authorization header value:** `Bearer <TOKEN_REVOLICORD_API>` (estático, sin template)
- La URL usa sintaxis `={{ }}` (expresión completa) para concatenar el slug dinámico.

### 3. Build Context (Code node)
Extrae y normaliza todos los valores del payload entrante. Expone como `$json.*` para los nodos descendentes:

```javascript
const raw = $('Webhook').first().json;
const body = raw.body ?? raw;
const tools = $('Get Tools').first().json.tools || [];

const messages = body.messages.map(m => {
  if (m.reply_type === 'thumbs_up') return '👍 [el contacto envió pulgar arriba]';
  if (m.media_urls && m.media_urls.length > 0 && !m.text) return `[${m.reply_type ?? 'media'} recibido]`;
  return m.text ?? '[mensaje sin texto]';
}).filter(Boolean).join('\n');

const subscriberName = body.subscriber.display_name || body.subscriber.ig_username || 'Usuario';
const stage = body.subscriber.metadata?.stage ?? 'nuevo';

const toolsList = tools.length > 0
  ? '\n\nContenido disponible (usa activar_flow con el flow_id exacto):\n'
    + tools.map(t => `- flow_id: "${t.flow_id}" — cuándo usarlo: ${t.description}`).join('\n')
  : '';

return [{
  json: {
    chatInput: messages,
    systemPrompt: `Eres un asistente de ventas amable de Revolicord. Responde siempre en el idioma del usuario. Sé conciso y cálido, máximo 2-3 oraciones. Sin markdown. El usuario se llama ${subscriberName}. Etapa actual del lead: ${stage}.${toolsList}`,
    subscriberId: body.subscriber.manychat_subscriber_id,
    mcApiKey: body.tenant?.config?.manychat_api_key || '',
    conversationId: body.conversation.id,
    turnId: body.turn_id,
    callbackUrl: body.callback_url,
    callbackToken: body.callback_token
  }
}];
```

### 4. AI Agent
- **Prompt type:** Define  
- **Text:** `={{ $json.chatInput }}`  
- **System message:** `={{ $json.systemPrompt }}`  
- Sub-nodos conectados:
  - `Groq Chat Model` → `ai_languageModel`
  - `Postgres Chat Memory` → `ai_memory`

### 5. Groq Chat Model
- **Model:** `llama-3.3-70b-versatile`
- Credencial: Groq API (free tier, cuenta en console.groq.com)

### 6. Postgres Chat Memory
- **Session ID type:** Custom Key  
- **Session Key:** `={{ $('Build Context').first().json.subscriberId }}`
- Usar `manychat_subscriber_id` como clave (no `conversationId`) para persistir memoria entre conversaciones del mismo usuario.

### 7. enviar texto (HTTP Request)
- **Method:** POST  
- **URL:** `https://api.manychat.com/fb/sending/sendContent` (estático)
- **Authorization header value:** `Bearer {{ $('Build Context').first().json.mcApiKey }}` (template `{{ }}`)
- **Specify Body:** JSON  
- **JSON Body:**
```json
{
  "subscriber_id": "{{ $('Build Context').first().json.subscriberId }}",
  "data": {
    "version": "v2",
    "content": {
      "messages": [{ "type": "text", "text": "{{ $json.output }}" }]
    }
  }
}
```
- Sin `message_tag` — Instagram DM no acepta `HUMAN_AGENT` (solo Messenger).

### 8. Prepare Callback (Code node)
Necesario porque los templates `{{ $('Node Name') }}` dentro del JSON Body del nodo HTTP Request no evalúan referencias cruzadas cuando el texto contiene caracteres especiales (comillas, saltos de línea).

```javascript
return [{
  json: {
    turn_id: $('Build Context').first().json.turnId,
    status: 'completed',
    response_text: $('AI Agent').first().json.output,
    callbackUrl: $('Build Context').first().json.callbackUrl,
    callbackToken: $('Build Context').first().json.callbackToken
  }
}];
```

### 9. Callback (HTTP Request)
- **Method:** POST  
- **URL:** `={{ $json.callbackUrl }}`
- **Authorization header value:** `Bearer {{ $json.callbackToken }}`
- **Specify Body:** JSON  
- **Content Type:** `application/json`  
- **Body parameters (Using Fields Below):**
  - `turn_id` → `{{ $json.turn_id }}`
  - `status` → `{{ $json.status }}`
  - `response_text` → `{{ $json.response_text }}`

---

## Lecciones de sintaxis de expresiones en n8n

| Campo | Sintaxis correcta | Notas |
|-------|------------------|-------|
| URL, System Message, Prompt | `={{ expresión }}` | Expresión JS completa |
| Header value | `Bearer {{ expr }}` | Template sin `=` delante |
| JSON Body (raw string) | `{{ expr }}` | Template; falla con texto que tenga comillas |
| Body Parameters (key-value) | `{{ $json.campo }}` | Más seguro para valores con caracteres especiales |
| Session Key | `={{ $json.campo }}` | Con `=` en campos de configuración de sub-nodos |

**Regla práctica:** Usar siempre `={{ }}` para campos de configuración de nodos. Usar `{{ }}` en JSON Body strings solo para valores simples (IDs, slugs). Para texto libre (respuesta del AI), usar Body Parameters o un Code node previo.

---

## Problemas resueltos durante implementación

| Error | Causa | Solución |
|-------|-------|----------|
| Get Tools 404 "Tenant not found" | URL con sintaxis mixta `=https://...{{ }}` | Usar `={{ 'url' + expr + 'path' }}` completo |
| Callback 401 Unauthorized | Template `{{ }}` en header value no evaluaba | Cambiar a `Bearer {{ $json.campo }}` desde `$json` directo |
| Callback 400 "Invalid uuid" para turn_id | Template `{{ $('Node') }}` en JSON Body no evalúa con refs cruzadas | Añadir nodo Prepare Callback que expone todo en `$json` |
| Callback "not valid JSON" | `response_text` con comillas del AI rompe el string JSON | Usar Body Parameters (key-value) en vez de JSON Body raw |
| sendContent "Unsupported message tag" | `HUMAN_AGENT` no válido para Instagram DM | Eliminar `message_tag` |
| Memoria de chat perdida entre sesiones | Session Key = `conversationId` (cambia cada vez) | Usar `manychat_subscriber_id` (permanente) |

---

## Variables de entorno necesarias en el API

```
N8N_CALLBACK_TOKEN=<token-para-verificar-callbacks-de-n8n>
PUBLIC_API_URL=https://api.revolicord.com
```

El `callback_token` que el API envía en el payload a n8n debe coincidir exactamente con `N8N_CALLBACK_TOKEN`. Si no coinciden → 401.

---

## Estado actual

- Conversación de texto end-to-end funcionando: Instagram DM → API → n8n → Groq → ManyChat → respuesta al usuario
- Memoria Postgres persistente por `manychat_subscriber_id`
- Callback al API marcando turno como completado
- **Pendiente:** Implementar tools del agente (`activar_flow`) con modelo compatible con tool calling

---

## Referencias

- ADR-0007: Envío de respuesta IA vía sendContent directo
- ADR-0006: Adaptación del payload de ManyChat al DM API
- Workflow en n8n: `agent-run` (no versionar JSON — contiene tokens)
