# 06 — State and Assumptions
## Estado Real del Sistema + Supuestos Abiertos

---

> **Propósito:** Separar **hechos** de **supuestos**. Cada supuesto aquí es un riesgo si resulta falso.
>
> **Última actualización:** 2026-05-19 (alineado con respuesta del founder sobre estado MVP).

---

## 1. Estado Actual (Hechos Verificados)

### 1.1 Lo que YA funciona end-to-end

- **Infraestructura (`docker-stack.yml`):** Docker Swarm con Traefik, n8n-main, n8n-webhook, n8n-worker (×3), Postgres 16, Redis 7, MinIO. Operativo en producción.
- **API DM Setter (`apps/api/`):** Fastify + BullMQ. `POST /webhook/manychat` recibe webhooks de ManyChat, hace auth + idempotencia + debounce + persistencia + dispatch al workflow n8n.
- **Workflow `agent-run` en n8n:** cableado — `Webhook → Build Context → AI Agent (Claude Sonnet 4.6 + Postgres Chat Memory) → enviar texto → Prepare Callback → Callback`. **Agente respondiendo a DMs reales hoy.**
- **Tools del agente:** `trigger_manychat_flow` (envía contenido ManyChat) y `set_stage` (cambia etapa del lead) — ambas como Code Tools con JSON Schema.
- **Schema de funnel multi-etapa (ADR-0010 → 0015):** migración `0002_polite_groot.sql` aplicada (ver punto abierto sobre verificación). Tablas `funnel_stages`, `stage_flows`, `followup_templates`, `lead_followup_log`, `lead_crons` existentes. Columna `current_stage_id FK` en `lead_stages`.
- **Flow Registry (ADR-0016):** migración `0003_flow_registry.sql` aplicada. Endpoints `GET /tenants/:slug/tools` y `POST /tenants/:slug/tools/sync` operativos.
- **Endpoint `set_stage`:** acepta `A | MS | B | C | D | disqualified` con validación de transiciones y `reason`/`evidence` obligatorios.

### 1.2 Lo que existe pero NO está completo

- **Workflow `followup-runner`:** especificado en `docs/n8n/workflows/followup-runner.md` con 6 nodos + queries SQL. **No creado en la UI de n8n todavía** — sin él, el sistema no envía seguimientos automáticos.
- **Nodos del IMPLEMENTATION-REPORT:** `Get Stage Config`, `Get Subscriber CRM Context`, `Upsert Lead Cron` — especificados pero pendientes de cablear en la UI de n8n del workflow `agent-run`.
- **Webhook de Calendly C→D:** no existe. Hoy `D` se marca por confirmación verbal del lead vía agente.
- **Round-robin de closers:** no existe. Hoy Calendly es un link único en `tenant.config.calendly_url`.
- **Inyección de presencia IG (`last_seen`, `last_interaction`):** el prompt los consume; el payload del API aún no los envía.
- **Tool `notify_human`** para escalación activa: no existe.
- **Tabla `closers`, `notifications`, `objection_bank`** (P1 en SETTER-MVP): no creadas.

### 1.3 Cambio arquitectónico planificado

El founder ha decidido **migrar la salida del agente a JSON estructurado** para integrar flujo determinista + decisiones del agente. Hoy la salida es texto plano que va directo a "enviar texto" en ManyChat. El objetivo es que el agente devuelva un JSON con `actions`, `response_to_user`, `stage_change`, etc., parseable por n8n y aplicable de forma determinista.

> Esta decisión bloquea/condiciona varias docs (07, 08, 09, 10). Documento operativo pendiente — ver doc 14 (roadmap) y futuro ADR-0017.

---

## 2. Supuestos Activos

> ⚠️ Cada uno es una **asunción**, no un hecho. Si alguno resulta falso, hay que ajustar arquitectura.

### 2.1 Sobre el negocio

- ⚠️ **Asunción:** El funnel A/MS/B/C/D aplica uniformemente a las 3 fuentes de leads (inbound, comentarios, followers). En MVP no se ramifica por fuente. **Validar con métricas** una vez haya volumen.
- ⚠️ **Asunción:** Las objeciones se manejan con descalificación inmediata (política del prompt v3). **Validar:** que la tasa de "rescate" perdida no sea relevante vs. la simplicidad ganada.

### 2.2 Sobre el sistema técnico

- ⚠️ **Asunción:** `Build Context` con `pickFlowWeighted` (selección ponderada) es preferible a round-robin secuencial estricto. Pesos en `stage_flows.weight` controlan la distribución A/B.
- ⚠️ **Asunción:** Postgres Chat Memory + system prompt estático + bloque dinámico CRM es suficiente para mantener contexto. Sin memoria semántica (Mem0/Zep/pgvector) — un lead que vuelve tras semanas se trata sin recall profundo. P2 en SETTER-MVP.
- ⚠️ **Asunción:** Claude Sonnet 4.6 es el modelo apropiado para tool-calling multi-etapa. Anterior a v4 era llama-3.3-70b vía Groq — migrado por adherencia. **Validar:** costo/latencia en volumen real.

### 2.3 Sobre Meta/ManyChat

- ⚠️ **Asunción:** La ventana de 24h de Meta no es un cuello de botella significativo en el funnel actual (las respuestas ocurren típicamente dentro de esa ventana). **Validar** con datos.
- ⚠️ **Asunción:** ManyChat gestiona internamente los límites de Meta (200 DMs/h por cuenta, variación semántica para evitar spam). **Validar** qué cubre ManyChat vs. qué hay que gestionar en la capa Fastify (P2).

---

## 3. Decisiones Tomadas (Trade-offs Aceptados)

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Funnel uniforme A/MS/B/C/D para las 3 fuentes en MVP | Ramificar por fuente | Mantener MVP simple, refinar con datos |
| Postgres como única fuente de verdad del CRM | Close CRM como CRM operativo | Reduce dependencias externas; Close se integra V1+ y se nutrirá de Postgres |
| `set_stage` con validación de transiciones + `reason`/`evidence` obligatorios | Estado libre | Bloquea saltos accidentales del LLM; deja audit trail |
| Selección ponderada de flows (`pickFlowWeighted`) | Round-robin secuencial estricto | Permite A/B con pesos configurables vía DB sin tocar código |
| Persona del agente = "Alex" + cero admisión de IA | Persona "asistente de Alex" / admisión transparente | Decisión del founder (SETTER-MVP decisión #1) — política asumida en prompt v3 |
| Salida del agente como **texto plano** (hoy) → migrar a **JSON estructurado** (próximo) | Mantener texto plano indefinidamente | Habilita flujo determinista híbrido — bloquea iteraciones que requieran control fino sobre la acción |
| Prompt en Set node `System Prompt` de n8n (no en DB) | Prompt en `tenants.config.system_prompt` (v4) | Iterar prompt en producción sin SQL ni re-deploy |
| Mantener prospección manual por Alex | Automatizar prospección | ManyChat no puede; fuera de scope MVP |
| Close CRM **fuera del MVP** | Integración inmediata con Close | Postgres es source-of-truth; Close llega V1+ tirando de Postgres |

---

## 4. Riesgos de Asunciones Críticas

| Asunción | Probabilidad de ser falsa | Impacto si falla | Mitigación |
|---|---|---|---|
| El agente respeta el patrón `flow_name = ns exacto` sin alucinar | Media | El send a ManyChat falla → lead sin respuesta | Validación regex en JSON Schema + segunda validación en Code Tool |
| La cadencia de follow-up actual (24h/48h/72h) es la correcta | Alta — no calibrada con datos | Quema de leads / oportunidades perdidas | Logging exhaustivo en `lead_followup_log` para iterar |
| El cambio a JSON estructurado se puede hacer sin romper el flujo en vivo | Media | Caída del agente durante migración | Plan de rollback + feature flag (pendiente ADR) |
| Una caída de Groq/Anthropic durante un turno deja al lead sin respuesta | Media | Latencia o silencio | Fallback / retry — pendiente diseño |

---

## 5. Cómo Mantener Este Documento

- Cuando una asunción se valida → mover a Sección 1 (hechos).
- Cuando una asunción se invalida → mover a "Decisiones Tomadas" con la nueva decisión.
- Nuevas asunciones se agregan a Sección 2 conforme surjan.
- El cambio arquitectónico a JSON estructurado debe documentarse como ADR cuando esté diseñado.
