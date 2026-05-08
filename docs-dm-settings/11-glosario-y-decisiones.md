# 11 · Glosario y decisiones (ADRs)

## Glosario

**Agente / Agent**
Programa basado en un LLM que mantiene una conversación, usa tools y memoria. Aquí vive en n8n vía AI Agent node.

**Backpressure**
Mecanismo para que un componente lento no sature al rápido. Aquí: si el LLM tarda, los mensajes se acumulan en buffer pero no disparan más turns hasta que el actual cierra.

**Batch / Lote**
Conjunto de mensajes agrupados por debounce que se envían como un único turno al LLM.

**BullMQ**
Librería Node.js de colas con backing en Redis. Soporta jobs retrasados (delayed), reintentos, prioridades.

**Callback (turn-completed)**
Llamada HTTP de n8n hacia la API al terminar de procesar un turno. Lleva la respuesta del LLM, tokens consumidos y status.

**Circuit breaker**
Patrón que abre el circuito cuando un servicio externo falla repetidamente, evitando cascadas de errores.

**Correlation ID**
UUID único por request que se propaga por todos los logs y servicios para seguir una operación end-to-end.

**Debounce**
En el contexto del repo: agrupar mensajes que llegan en ráfaga para procesarlos como uno solo. Variante "trailing con timer reset".

**Dead Letter Queue (DLQ)**
Cola/tabla donde van los jobs que fallaron tras agotar reintentos. Se inspeccionan manualmente.

**Dispatch**
El acto de enviar un batch al workflow de n8n.

**Idempotencia**
Que ejecutar la misma operación N veces produzca el mismo resultado que hacerla una sola. Crítico para webhooks reintentables.

**Lock de turno**
Clave Redis que indica que ya hay un turn en proceso para un subscriber. Evita turns concurrentes para el mismo usuario.

**ManyChat External Request**
Acción en ManyChat que hace un HTTP request a un endpoint externo. Tiene timeout duro de 10 segundos.

**Max wait**
Techo absoluto de tiempo de debounce: pasados X segundos desde el primer mensaje, despachar aunque sigan llegando.

**Multi-tenancy**
Capacidad de servir a varios clientes con la misma instancia, aislando sus datos.

**n8n queue mode**
Modo de despliegue de n8n donde la ejecución de workflows se distribuye en workers usando Redis como broker.

**PII (Personally Identifiable Information)**
Datos que identifican a una persona: nombre, teléfono, email, etc.

**Rate limiter (token bucket / sliding window)**
Mecanismo que limita la tasa de operaciones permitidas por unidad de tiempo.

**Row Level Security (RLS)**
Feature de Postgres que filtra automáticamente las filas que ve cada conexión según el `tenant_id` actual.

**Stalled job**
Job de BullMQ cuyo worker murió antes de terminarlo. BullMQ lo recupera tras un timeout.

**Subscriber**
Un usuario de Instagram tal como ManyChat lo identifica con su `manychat_id`.

**Tenant**
Cliente de la agencia. Cada uno tiene su cuenta de Instagram, su flow de ManyChat y su workflow de n8n.

**Token de cancelación (debounce token)**
UUID único que se genera con cada mensaje y se guarda en `debounce:*`. El job programado solo se ejecuta si su token coincide con el actual.

**Trailing debounce**
Variante donde la acción se ejecuta tras N tiempo sin nueva actividad, no al inicio.

**Turn / Turno**
Una iteración del agente: recibe un batch de mensajes del usuario, genera una respuesta, la envía. Equivale a una llamada al LLM.

**Ventana de 24 horas (Meta)**
Política de Instagram/Messenger: el bot solo puede enviar mensajes libremente dentro de las 24h posteriores al último mensaje del usuario.

---

## Architecture Decision Records (ADRs)

Formato MADR. Una decisión por entrada. Numerar secuencialmente.

### ADR-0001: Stack base Fastify + BullMQ + Postgres + Redis

**Estado**: aceptado · **Fecha**: 2026-05-07

**Contexto**: Solo founder con formación técnica, asistencia IA, n8n ya en queue mode. Necesita capa intermedia entre ManyChat y n8n para debounce robusto.

**Decisión**: TypeScript + Node 20 + Fastify (HTTP) + BullMQ (jobs) + PostgreSQL (persistencia) + Redis (estado caliente y broker).

**Alternativas consideradas**:
- FastAPI + arq + Postgres + Redis: equivalente, pero el founder no tiene preferencia Python y el stack JS le permite compartir runtime con n8n.
- Elixir/Phoenix: técnicamente ideal, pero curva de aprendizaje injustificable para solo founder.
- Cloudflare Workers + Durable Objects: lock-in y cambio de modelo mental.

**Consecuencias**:
- ✅ Mismo lenguaje que n8n (depurable y portable).
- ✅ BullMQ es el estándar para jobs delayed.
- ✅ Hiring futuro de devs JS/TS es trivial.
- ⚠️ Ecosistema LLM ligeramente menos maduro que Python, pero Vercel AI SDK / Anthropic SDK Node son suficientes.

---

### ADR-0002: Debounce en código, no en n8n

**Estado**: aceptado · **Fecha**: 2026-05-07

**Contexto**: Existen plantillas de n8n para hacer debounce (Codango, Message Buffer System). Funcionan pero presentan race conditions con múltiples webhook processors y consumen workers.

**Decisión**: Debounce implementado en código (Fastify + BullMQ + Lua atómico), no en workflows de n8n.

**Consecuencias**:
- ✅ Atomicidad garantizada vía Lua.
- ✅ No se consumen slots de n8n esperando.
- ✅ Testeable en CI sin levantar n8n.
- ⚠️ Hay que mantener código TypeScript adicional.

---

### ADR-0003: Postgres y Redis compartidos entre API y n8n

**Estado**: aceptado · **Fecha**: 2026-05-07

**Contexto**: Solo VPS. Tener instancias separadas duplica operación.

**Decisión**: Una única instancia de Postgres con schemas separados (`api`, `n8n`) y una única Redis con prefijos distintos.

**Consecuencias**:
- ✅ Menos containers, menos memoria, menos backups.
- ✅ n8n puede leer datos de la API directamente con su nodo Postgres (read-only user `n8n_reader`).
- ⚠️ Si Postgres o Redis caen, todo cae. Mitigado con: backups frecuentes, monitorización, plan de recovery documentado.
- ⚠️ Rendimiento compartido. Validar con métricas que ninguno satura al otro.

**Reversibilidad**: si la carga lo justifica, separar Redis primero (es más fácil que Postgres). Mover BullMQ a una segunda Redis dedicada.

---

### ADR-0004: Patrón asíncrono con ManyChat (200 OK inmediato + callback API)

**Estado**: aceptado · **Fecha**: 2026-05-07

**Contexto**: ManyChat External Request tiene timeout duro de 10 segundos, insuficiente para LLMs.

**Decisión**: La API responde 200 OK al webhook inmediatamente. La respuesta al usuario se envía con la **API de ManyChat** (`sendFlow`) desde el workflow de n8n al final.

**Consecuencias**:
- ✅ Nunca timeout en ManyChat.
- ✅ Permite LLMs lentos (>10s) sin degradar.
- ✅ Permite postprocesos y trocear respuestas.
- ⚠️ Requiere configurar API key de ManyChat en cada tenant.

---

### ADR-0005: Frontera código/n8n explícita

**Estado**: aceptado · **Fecha**: 2026-05-07

**Contexto**: Riesgo de duplicar lógica o de meter lógica de negocio en código rígido.

**Decisión**: Definida en `02-frontera-codigo-vs-n8n.md`. Resumen: código = infraestructura determinista; n8n = lógica de agente iterable.

**Consecuencias**: Toda nueva feature pasa por la heurística del doc. Si no encaja claramente, ADR.

---

### ADR-0006: Multi-tenancy por `tenant_id` con RLS, no schemas separados

**Estado**: aceptado · **Fecha**: 2026-05-07

**Contexto**: La agencia tendrá varios clientes. Aislamiento necesario.

**Decisión**: Una sola tabla por entidad con `tenant_id` y Row Level Security. No schemas ni bases separadas.

**Consecuencias**:
- ✅ Operación simple (un único schema, una migración).
- ✅ Cross-tenant queries triviales para admin global.
- ⚠️ Si un cliente exige aislamiento físico contractual, se replica a su propio deploy.

---

### ADR-0007: API admin con dos roles (`admin`, `n8n`)

**Estado**: aceptado · **Fecha**: 2026-05-07

**Contexto**: n8n necesita poder llamar a la API para acciones (pausar usuario, retry turn, etc.) pero no debe tener permisos completos.

**Decisión**: JWT admin con scopes. Token específico `N8N_CALLBACK_TOKEN` con scope limitado para n8n.

**Consecuencias**:
- ✅ Workflows n8n pueden ejecutar acciones sin riesgo de admin completo.
- ✅ Comprometer el token de n8n no da acceso a borrar tenants.

---

### ADR-0008: Idempotencia con Redis SET NX EX 24h

**Estado**: aceptado · **Fecha**: 2026-05-07

**Contexto**: ManyChat reintenta webhooks. Mismo mensaje puede llegar varias veces.

**Decisión**: Hash sha256 del `(tenant + subscriber + external_message_id)` en Redis con TTL 24h. Si existe, descartar. Backup persistente en `processed_webhooks` 7 días.

**Consecuencias**:
- ✅ Atómico y rápido.
- ⚠️ Si Redis cae justo en ventana, reintentos pueden duplicarse. La UNIQUE en `messages_raw(tenant_id, idempotency_hash)` es la red de seguridad final.

---

### Plantilla para nuevos ADRs

```markdown
### ADR-NNNN: [título corto]

**Estado**: propuesto | aceptado | sustituido por ADR-XXXX · **Fecha**: YYYY-MM-DD

**Contexto**:
[Cuál es el problema o decisión que enfrentamos]

**Decisión**:
[Qué decidimos hacer]

**Alternativas consideradas**:
- Alternativa A: razón de descarte
- Alternativa B: razón de descarte

**Consecuencias**:
- ✅ Positivas
- ⚠️ Negativas o trade-offs

**Reversibilidad** (opcional):
[Cómo deshacer si fuera necesario]
```
