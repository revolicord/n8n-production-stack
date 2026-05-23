# Nodo: Postgres Chat Memory

**Tipo:** `@n8n/n8n-nodes-langchain.memoryPostgresChat`  
**typeVersion:** 1.3  
**Conexión:** `ai_memory` → `AI Agent`

---

## Configuración

| Campo | Valor |
|-------|-------|
| Session ID type | `customKey` |
| Session Key | `=$json.subscriberId` |
| Credencial | Postgres (mismo servidor que el API) |

---

## Notas

- La clave de sesión es el `manychat_subscriber_id` del usuario, **no** el `conversationId`.
- Usar `conversationId` crearía una nueva sesión de memoria en cada conversación → el agente no recordaría interacciones previas.
- Usar `manychat_subscriber_id` garantiza memoria persistente por usuario a lo largo de todas sus conversaciones.
- La tabla que usa este nodo es `n8n_chat_histories` (creada automáticamente por n8n en el schema de Postgres configurado).
