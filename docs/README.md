# Documentación — Instagram DM Setter

Plataforma de *appointment setting* por Instagram DM. Un agente de IA (**Claude Sonnet 4.6**, ejecutado en n8n) atiende a los leads que entran por DM, los lleva por las etapas de un funnel y los empuja hasta que **agendan una llamada de discovery**. Si un lead deja de responder, unos crons le envían follow-ups automáticos, y el agente es consciente de ellos a través de su memoria.

```
Instagram DM ─► ManyChat ─► DM Setter API (Fastify)         ─► n8n (modo cola)        ─► PostgreSQL
                            auth · idempotencia · debounce      agente IA Sonnet 4.6      fuente de verdad
                            turnos · BullMQ                      tools · memoria · funnel
```

- **ManyChat** es el adaptador Instagram ⇆ webhook (y el emisor de contenido pregrabado: vídeos, audios, stickers).
- **DM Setter API** (`apps/api`, Fastify): recibe los webhooks, agrupa los mensajes en ráfaga (debounce), garantiza idempotencia y orquesta los turnos hacia n8n. **No contiene lógica de IA.**
- **n8n** (modo cola): aquí vive el agente — prompt, modelo, tools, memoria, decisiones de etapa y follow-ups.
- **PostgreSQL** es la fuente de verdad; Redis es estado caliente (buffers, locks, cola BullMQ).

## Por dónde empezar

Lee `onboarding/` en orden. Es la columna vertebral conceptual del repo.

| # | Documento | Para qué |
|---|---|---|
| 01 | [`onboarding/01-vision-y-arquitectura.md`](onboarding/01-vision-y-arquitectura.md) | Visión global, componentes, flujo end-to-end |
| 02 | [`onboarding/02-frontera-codigo-vs-n8n.md`](onboarding/02-frontera-codigo-vs-n8n.md) | **Qué va en código y qué en n8n** (lectura obligatoria) |
| 03 | [`onboarding/03-debounce-y-turnos.md`](onboarding/03-debounce-y-turnos.md) | El algoritmo central: timer reset + token + lock de turno |
| 04 | [`onboarding/04-modelo-de-datos.md`](onboarding/04-modelo-de-datos.md) | Esquema Postgres real + claves Redis |
| 05 | [`onboarding/05-api-fastify-endpoints.md`](onboarding/05-api-fastify-endpoints.md) | Contrato HTTP de la API (lo implementado y lo pendiente) |
| 06 | [`onboarding/06-integracion-n8n.md`](onboarding/06-integracion-n8n.md) | Cómo n8n consume y observa esta capa |
| 07 | [`onboarding/07-funnel-y-agente.md`](onboarding/07-funnel-y-agente.md) | Las etapas del funnel, el agente y sus decisiones |
| 08 | [`onboarding/08-follow-ups-y-crons.md`](onboarding/08-follow-ups-y-crons.md) | Follow-ups automáticos, `lead_crons` y memoria del agente |
| 09 | [`onboarding/09-flow-registry-manychat.md`](onboarding/09-flow-registry-manychat.md) | Naming `QC_*` y sincronización de flows de ManyChat |
| 10 | [`onboarding/10-manychat-setup.md`](onboarding/10-manychat-setup.md) | Configuración de ManyChat (custom fields, flows, body) |
| 11 | [`onboarding/11-deploy-docker-swarm.md`](onboarding/11-deploy-docker-swarm.md) | Deploy del stack en Docker Swarm |
| 12 | [`onboarding/12-observabilidad.md`](onboarding/12-observabilidad.md) | Logs, métricas y alertas |
| 13 | [`onboarding/13-dashboard-y-metricas.md`](onboarding/13-dashboard-y-metricas.md) | Panel de métricas y notificaciones — **diseño, pendiente** |
| 14 | [`onboarding/14-seguridad-y-compliance.md`](onboarding/14-seguridad-y-compliance.md) | Firma, PII, ventana de 24h de Meta |

## Otros directorios

- [`status.md`](status.md) — **estado real del MVP**: qué funciona y qué falta. Empieza aquí si quieres saber dónde está el proyecto.
- [`reference/`](reference/) — material de consulta: [`funnel-engine.md`](reference/funnel-engine.md) (diseño del motor de funnel), [`mcp-n8n-setup.md`](reference/mcp-n8n-setup.md), [`glosario.md`](reference/glosario.md).
- [`adr/`](adr/) — Architecture Decision Records (0001–0016). El *porqué* de cada decisión.
- [`n8n/`](../n8n/) — referencia de los workflows y nodos de n8n (código de los Code nodes, prompts, etapas). Los nodos (`n8n/nodes/`) y workflows (`n8n/workflows/`) son la fuente de verdad de esa capa.
- [`_archive/`](_archive/) — documentos obsoletos conservados por historia. No reflejan el estado actual.

## Convenciones del repo

Las reglas operativas para trabajar en el código viven en [`../CLAUDE.md`](../CLAUDE.md) (raíz). En resumen: TypeScript estricto, pnpm workspaces, Fastify + BullMQ + Drizzle + Redis + Zod + pino, multi-tenancy desde el día 1, y la **frontera código/n8n** del doc 02 como principio rector.
