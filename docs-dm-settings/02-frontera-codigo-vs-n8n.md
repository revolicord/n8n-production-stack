# 02 · Frontera código vs. n8n

Este es el documento **más importante** del repo. La regla mental:

> **Código (Fastify + workers)** = lo que debe ser determinista, testeable, idempotente, rápido y aburrido.
> **n8n** = lo que debe ser visual, iterable sin redeploy, y donde la "lógica del negocio del agente" cambia frecuentemente.

Si confundes esto, acabas con un n8n gigante imposible de mantener, **o** con código rígido que toca tocar cada vez que el cliente quiere un prompt distinto.

## Tabla de decisión

| Responsabilidad | Vive en | Por qué |
|---|---|---|
| Recepción de webhook ManyChat | **Código** | Hay que verificar firma, validar payload, responder en <1s, controlar idempotencia. n8n no da garantías aquí. |
| Verificación de token / firma | **Código** | Crítico de seguridad, no debe ser editable en una UI. |
| Idempotencia (dedup de webhooks) | **Código** | Race conditions en n8n con múltiples webhook processors. |
| Rate limiting por suscriptor | **Código** | Necesita atomicidad real con Lua/Redis. |
| Persistencia raw de mensajes | **Código** | Audit log, formato fijo, no puede romperse. |
| **Debounce (timer reset + token)** | **Código** | El nodo Wait de n8n consume slots de worker y tiene race conditions documentadas. |
| Lock de turno | **Código** | Atomicidad imprescindible. |
| Programar BullMQ jobs | **Código** | Es el motor de la cola. |
| Reintentos / DLQ | **Código** | Lógica de reintentos con backoff exponencial. |
| Fan-out a n8n (HTTP call al webhook interno) | **Código** | Es el "punto de entrada" del workflow del agente. |
| Callback de n8n (turn-completed) | **Código** | Cierra el lock y persiste métricas. |
| **Lógica del agente (prompts, tools, memoria)** | **n8n** | Cambia a menudo, queremos iterar sin redeploy. |
| Selección de modelo LLM (GPT-4o vs mini) | **n8n** | Decisión por cliente / por tenant, ajustable en UI. |
| Tools del agente (CRM, calendario, RAG) | **n8n** | Visual, fácil de añadir nodos. |
| Memoria de conversación (chat history) | **n8n (Redis Chat Memory node)** | Ya existe out-of-the-box, no reinventar. |
| Llamada a ManyChat API para enviar la respuesta | **n8n** | Forma parte de la lógica del agente. |
| Routing por intención / handoff humano | **n8n** | Lógica de negocio, cambia. |
| Triggers programados (campañas, recordatorios) | **n8n** | Para eso es n8n. |
| Integraciones con CRM externo, Google Sheets, etc. | **n8n** | Para eso es n8n. |
| Workflows administrativos (pausar usuario, reintentar turno) | **n8n llamando a Fastify** | n8n hace el botón, Fastify ejecuta la mutación. |
| Dashboards de negocio | **Postgres + Grafana o admin propio** | Datos en Postgres, visualización separada. |

## Heurística: "¿Esto va en código o en n8n?"

Hazte estas preguntas en orden:

1. **¿Tiene que responder en <1s con garantías de idempotencia?** → Código.
2. **¿Va a fallar de formas raras si lo cambia alguien que no sabe TypeScript?** → Código.
3. **¿Se va a tocar 5 veces por semana ajustando prompts o tools?** → n8n.
4. **¿Necesita visualización del flujo para entenderlo?** → n8n.
5. **¿Es algo que harías diferente para cada cliente?** → n8n (con datos del tenant en Postgres).
6. **¿Es seguridad / compliance?** → Código.

## Diagrama de responsabilidades

```
┌────────────────────── CÓDIGO (Fastify + workers) ──────────────────────┐
│                                                                          │
│  Recepción webhook → Auth → Idempotencia → Rate limit → Persist raw     │
│       ↓                                                                   │
│  Buffer Redis → Debounce (timer reset + token) → Lock turno              │
│       ↓                                                                   │
│  Fan-out HTTP → POST n8n /webhook/agent-run                              │
│                                                                          │
│  ←  Callback POST /admin/turn-completed  ←  Cierra lock + métricas      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────── n8n (workflows) ──────────────────────────────┐
│                                                                          │
│  Webhook /agent-run                                                      │
│       ↓                                                                   │
│  Lookup tenant config (Postgres node)                                    │
│       ↓                                                                   │
│  Hidratar memoria (Redis Chat Memory)                                    │
│       ↓                                                                   │
│  AI Agent node (LLM + tools)                                             │
│       ↓                                                                   │
│  Postprocess: trocear mensaje largo, decidir delays                      │
│       ↓                                                                   │
│  ManyChat API: setCustomField + sendFlow (envía al usuario)              │
│       ↓                                                                   │
│  HTTP Request → POST {api}/admin/turn-completed                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Antipatrones a evitar

### ❌ Hacer el debounce con el nodo Wait de n8n
Consume un slot de worker durante toda la espera. En queue mode, satura los workers cuando hay tráfico. Además tiene race conditions cuando hay múltiples webhook processors. Por eso el debounce vive en código con BullMQ.

### ❌ Llamar al LLM desde Fastify
Tentador para "ahorrar un hop", pero pierdes la capacidad de iterar prompts/tools sin redeploy. Mantén Fastify como infraestructura, no como lógica del agente.

### ❌ Replicar lógica entre Fastify y n8n
Si te ves escribiendo "validar disponibilidad" en los dos lados, algo está mal. Decide dónde vive esa lógica y exponla como endpoint o como tool.

### ❌ Que n8n acceda directamente a Redis para mutar el debounce
n8n puede **leer** Redis para depurar (`buffer:*`, `debounce:*`). Pero **no debe escribir** en esas claves: rompes la atomicidad. Si n8n necesita "purgar el buffer de un usuario", llama a `POST /admin/buffer/{tenant}/{subscriber}/purge` en Fastify.

### ❌ Que Fastify lea workflows de n8n
Fastify no debe saber nada del workflow de n8n más allá de la URL del webhook. Si necesita algo del agente, lo pide vía respuesta del webhook o vía callback.

### ❌ Hardcodear el comportamiento del agente en código
Si "responder en español si el usuario es de LATAM" vive en TypeScript, has perdido. Eso vive en el prompt en n8n.

## Checklist mental para nuevas features

Antes de añadir cualquier cosa al sistema, pregúntate:

- [ ] ¿Esta lógica cambia con cada cliente? → n8n + tabla `tenant_configs`
- [ ] ¿Cambia con cada experimento de prompt? → n8n
- [ ] ¿Es algo que un dev junior debería ser capaz de leer/cambiar sin tocar TypeScript? → n8n
- [ ] ¿Tiene requisitos de latencia <1s? → código
- [ ] ¿Implica mover dinero, datos sensibles, o tiene impacto legal? → código
- [ ] ¿Es un cron / schedule? → n8n
- [ ] ¿Es una mutación de estado del sistema (lock, buffer, retry)? → código, expuesto como endpoint admin
