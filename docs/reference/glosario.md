# Glosario

Términos del repo. Las decisiones arquitectónicas (ADRs) viven en [`../adr/`](../adr/) — no se duplican aquí.

**Agente / Agent**
Programa basado en un LLM que mantiene una conversación, usa tools y memoria. Aquí vive en n8n vía el nodo AI Agent (modelo Claude Sonnet 4.6).

**Backpressure**
Mecanismo para que un componente lento no sature al rápido. Aquí: si el LLM tarda, los mensajes se acumulan en buffer pero no disparan más turns hasta que el actual cierra.

**Batch / Lote**
Conjunto de mensajes agrupados por debounce que se envían como un único turno al agente.

**BullMQ**
Librería Node.js de colas con backing en Redis. Soporta jobs retrasados (delayed), reintentos, prioridades.

**Callback (turn-completed)**
Llamada HTTP de n8n hacia la API al terminar de procesar un turno. Lleva la respuesta del LLM, tokens consumidos y status.

**Circuit breaker**
Patrón que abre el circuito cuando un servicio externo falla repetidamente, evitando cascadas de errores.

**Correlation ID**
UUID único por request que se propaga por logs y servicios para seguir una operación end-to-end.

**Debounce**
Agrupar mensajes que llegan en ráfaga para procesarlos como uno solo. Variante "trailing con timer reset". Ver [04-debounce-y-turnos](../onboarding/03-debounce-y-turnos.md).

**Dead Letter Queue (DLQ)**
Tabla donde van los jobs que fallaron tras agotar reintentos. Se inspeccionan manualmente.

**Dispatch**
El acto de enviar un batch al workflow de n8n.

**Flow (ManyChat) / flow_ns**
Contenido pregrabado en ManyChat (vídeo, audio, imagen, sticker). `flow_ns` es su namespace interno (`content20260511...`). El agente los dispara con `trigger_manychat_flow`. Ver [09-flow-registry-manychat](../onboarding/09-flow-registry-manychat.md).

**Funnel stage / etapa**
Fase del lead en el funnel (A/MS/B/C/D para QC). Data-driven en `funnel_stages` por tenant.

**Idempotencia**
Que ejecutar la misma operación N veces produzca el mismo resultado que hacerla una vez. Crítico para webhooks reintentables.

**Lead cron**
Fila en `lead_crons` que programa el próximo follow-up de un lead. Ver [08-follow-ups-y-crons](../onboarding/08-follow-ups-y-crons.md).

**Lock de turno**
Clave Redis que indica que ya hay un turn en proceso para un subscriber. Evita turns concurrentes para el mismo usuario.

**ManyChat External Request**
Acción en ManyChat que hace un HTTP request a un endpoint externo. Tiene timeout duro de ~10 segundos.

**Max wait**
Techo absoluto del debounce: pasados X segundos desde el primer mensaje, despachar aunque sigan llegando.

**Multi-tenancy**
Capacidad de servir a varios clientes con la misma instancia, aislando sus datos por `tenant_id`.

**n8n queue mode**
Modo de despliegue de n8n donde la ejecución de workflows se distribuye en workers usando Redis como broker.

**PII (Personally Identifiable Information)**
Datos que identifican a una persona: nombre, teléfono, email, etc.

**Rate limiter**
Mecanismo que limita la tasa de operaciones permitidas por unidad de tiempo.

**Stalled job**
Job de BullMQ cuyo worker murió antes de terminarlo. BullMQ lo recupera tras un timeout.

**Subscriber**
Un usuario de Instagram tal como ManyChat lo identifica con su `manychat_subscriber_id`.

**Tenant**
Cliente de la agencia. Cada uno tiene su cuenta de Instagram, su flow de ManyChat y su workflow de n8n. La agencia/repo es *revolicord*; el primer tenant es Quantum Creators (`QC`).

**Token de cancelación (debounce token)**
UUID único que se genera con cada mensaje y se guarda en `debounce:*`. El job programado solo se ejecuta si su token coincide con el actual.

**Trailing debounce**
Variante donde la acción se ejecuta tras N tiempo sin nueva actividad, no al inicio.

**Turn / Turno**
Una iteración del agente: recibe un batch de mensajes del usuario, genera una respuesta, la envía. Equivale a una llamada al LLM.

**Ventana de 24 horas (Meta)**
Política de Instagram/Messenger: el bot solo puede enviar mensajes libremente dentro de las 24h posteriores al último mensaje del usuario.
