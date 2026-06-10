# Quantum Creators · Setter MVP — Seguimiento de implementación

> Documento vivo. Actualizado el 2026-05-29.

## Estado en una frase

El core del setter (agent-run + followup-runner) y el panel admin `/settings` están en producción. El API corre imagen antigua — hace falta `make rebuild-api` para aplicar ADR-0021. Calendly Frentes 1, 2 y 3-B (n8n) pendientes del founder.

---

## Decisiones tomadas

- **Funnel canónico:** Quantum Creators, 5 etapas `A/MS/B/C/D` + terminales (`disqualified`, `lost`, `escalated_human_call`). Confirmado con el founder el 2026-05-14.
- **Persona del agente:** "Alex" (ver decisión abierta #1, sin cerrar).
- **El prompt vive** en el Set node `System Prompt` del workflow de n8n (ver `n8n/prompts/setter-v1.md`). (Hasta v4 vivía en `tenants.config.system_prompt`; cambiado en v5 — 2026-05-16.)
- **ADR-0014 Path B:** `current_stage_id UUID FK` en `lead_stages` (no en `subscribers`).
- **Panel admin:** reescrito como rutas `/settings/*` nativas del dashboard Next.js (ADR-0021, Fase 4 completada 2026-05-29). SPA legacy eliminado.
- **Calendly matching:** UTM — `calendly_url?utm_content={subscriber.id}`. Todo en n8n. Cero migración.
- **Calendly sistema-event:** Frente 3-A (API) en producción — endpoint `POST /admin/leads/:id/system-event` (PR #2, commit `93577ad`). Frentes 1+2+3-B pendientes del founder.

---

## Lo que YA funciona — en producción

- Workflow `agent-run` (ID `6QJs9dHcR8NX8MZe`): **15 nodos, ACTIVO**
  - Webhook → Get Stage Config + Get CRM Context (paralelo) → Merge → Build Context → AI Agent (Claude Sonnet 4.6) → enviar texto → Upsert Lead Cron → Mark Followups Responded → Code → Callback.
  - ADR-0010, ADR-0011, ADR-0013 implementados.
- Workflow `followup-runner` (ID `hEXWrZBCqNyZGf2v`): **14 nodos, ACTIVO** — cron cada 5 min.
- Schema de BD: migraciones `0001`–`0013` aplicadas. Tablas: `funnel_stages`, `stage_flows`, `followup_templates`, `followup_messages`, `lead_followup_log`, `lead_crons`, `agent_resources`. FK `current_stage_id` en `lead_stages`. Columnas `call_link`/`nurture_video_url` en `funnel_stages`.
- Seed QC: tenant `revolicord` (UUID `9d338f06`), etapas A/MS/B/C/D, 9 followup_templates, stage_flows (con `PENDIENTE_ns_*`).
- Panel de configuración Next.js `/settings`: general, fase-b, fase-c, cierres, objeciones. Proxy admin re-firma JWT. Uploads a MinIO por proxy.
- MinIO bucket `assets` público de lectura — subida de imágenes para follow-ups multimedia.
- Endpoint `POST /admin/leads/:id/system-event` — B2: BufferMessage con `reply_type:'system_event'` por el flujo normal del worker. Autenticación Bearer.
- Vista Kanban (read-only) en pestaña Prospectos del dashboard (commits `77cafb8`, `778fa6f`).
- Capa de debounce/turnos Fastify (ManyChat → Fastify → n8n).
- 2 tools en el agente: `trigger_manychat_flow`, `set_stage`.

---

## P0 — bloquea la prueba real end-to-end

- [x] ~~Aplicar migración 0002~~ — aplicada, y además 0003–0013 ya en prod.
- [x] ~~Ejecutar seed QC~~ — aplicado.
- [x] ~~Cargar el prompt~~ — en Set node `System Prompt` del workflow.
- [x] ~~Cablear nodos nuevos en `agent-run`~~ — 15 nodos activos con Build Context actualizado.
- [x] ~~Crear workflow `followup-runner` en n8n~~ — activo (ID `hEXWrZBCqNyZGf2v`).
- [ ] **Copy del producto** en `setter-v1.md`: `{{QC_PRODUCT_ONELINER}}` y `{{QC_PRODUCT_NOTAS}}`. Solo lo sabe Alex.
- [ ] **`flow_ns` reales de ManyChat QC**: el seed usa `PENDIENTE_ns_video_hook` y `PENDIENTE_ns_video_vsl`. Verificar en la cuenta de ManyChat y actualizar `stage_flows` en la BD.
- [ ] **Activar los flows en ManyChat**: están como STOPPED.
- [ ] **`make rebuild-api`**: la imagen actual del API es anterior a ADR-0021 (Fase 4 del panel). Rebuild obligatorio. ⚠️ NO correr `make deploy` antes del rebuild — el stack.yml ya no pasa `ADMIN_PASSWORD` y el código viejo lo exige (Zod .min(8)) → crash loop.
- [ ] **Verificar credencial Anthropic** en n8n UI: nodo `Anthropic Chat Model` del `agent-run`.
- [ ] **Test end-to-end**: enviar DM de Instagram y verificar que el agente responde correctamente.

---

## P1 — completa el setter

- [x] Schema follow-ups + followup-runner ACTIVO.
- [x] Contexto dual agente (bloque CRM) cableado en agent-run.
- [x] Panel de configuración `/settings` Next.js completo (general, fase-b, fase-c, cierres, objeciones).
- [x] MinIO assets + followup-messages (`type='content'`) — ADR-0018.
- [x] Tres tipos de follow-up (text, content, flow) — ADR-0020.
- [x] `agent_resources` (cierres, objeciones, general) — ADR-0019.
- [x] Endpoint Calendly C→D (`system-event`) — ADR Frente 3-A en prod.
- [x] `call_link`/`nurture_video_url` en funnel_stages — migración 0013 aplicada; placeholder `{{call_link}}` y `{{nurture_video}}` disponibles.
- [ ] **Calendly Frente 1 (n8n)**: `docs/n8n/calendly-impl-1-links-dinamicos.md` — links UTM en 3 puntos:
  - Build Context: `calendlyUrl` ya tiene `?utm_content=` appended (commit `ac043bd` — docs listos, founder lo aplica en n8n UI).
  - followup-runner `get-due-leads`: añadir `fs.call_link` al SELECT + interpolar `{{call_link}}` con UTM en prepare-data y build-content-messages. ⚠️ Hoy `{{call_link}}` se envía literal.
- [ ] **Calendly Frente 2 (n8n)**: `docs/n8n/calendly-impl-2-workflow.md` — workflow `calendly-feedback` (Webhook→Guard→Get Subscriber→Set Stage D→persist booking). Pendiente del founder.
- [ ] **Calendly Frente 3-B (n8n)**: `docs/n8n/calendly-impl-3-feedback-agente.md` — Build Context (buildSystemEventText + ramificar chatInput), system prompt (regla eventos sistema), extender workflow calendly-feedback (Format datetime + HTTP a /system-event). Pendiente del founder.
- [ ] **UTM risk**: verificar que `?utm_content=` llega en `payload.tracking.utm_content` cuando se agenda en el link real de Calendly. El payload de prueba traía `null`.
- [ ] **Actualizar system prompt** (`setter-v1.md`): agregar instrucción `[SEGUIMIENTO AUTOMÁTICO #N]` + regla eventos sistema para Calendly.
- [ ] **followup-runner nodo 06 → Switch** (3 ramas: text / content / flow): el nodo actual es IF de 2 ramas; templates `type='content'` caen en rama `false` e intentan `sendFlow` con `flow_ns=NULL` → error silencioso. Ver ADR-0020.
- [ ] **followup-runner nodo 02 → json_agg**: el LATERAL join actual debe reemplazarse con `json_agg` de `followup_messages` para que la rama `content` funcione. Ver ADR-0020.
- [ ] **ADR-0017 Turn Timeout Watchdog**: watchdog periódico que detecta turns huérfanos (lock expirado + estado `dispatched`). Código pendiente: `workers/watchdog.ts`, `findStuckDispatched()` en turns.ts, queue `WATCHDOG_QUEUE`. Propuesto, no implementado.
- [ ] Escalado a humano: tabla `notifications` + tool `notify_human` + lógica tras follow-up #5.
- [ ] Round-robin de closers: tabla `closers` + endpoint Fastify + tool `send_calendly_link`.
- [ ] Persistencia de señales del agente en `lead_stages.metadata`.
- [ ] Banco de objeciones: tabla `objection_bank` + tool `get_objection_bank`.

---

## P2 — robustez y escala

- [ ] Memoria multinivel (pgvector / Zep / Mem0 + resumen "frío" cada 5 turnos).
- [ ] Restricciones API Meta/ManyChat: límite ~200 DMs/hora, ventana 24 h, variación semántica.
- [ ] Formato de salida estructurado (JSON con `actions`, `response_to_user`, etc.).
- [ ] Telemetría / KPIs: Open Rate, Reply Rate, CTR, Qualification Rate, Speed-to-Lead.
- [ ] HITL por confianza / sentimiento negativo.
- [ ] PII / GDPR: DPA, zero-data-retention, auditabilidad.
- [ ] Versionado de prompts (tabla `prompt_versions` o disciplina git en `n8n/prompts/`).

---

## Documentación

| Archivo | Estado |
|---------|--------|
| `n8n/prompts/setter-v1.md` | ✅ Prompt de producción. Pendiente: instrucción `[SEGUIMIENTO AUTOMÁTICO #N]` + regla sistema-event. |
| `n8n/SETTER-MVP-TRACKING.md` | ✅ Este documento — actualizado 2026-05-29. |
| `n8n/stages.md` | ✅ `A/MS/B/C/D` + terminales. |
| `n8n/nodes/01-build-context.md` | ✅ UTM docs añadidos (commit `ac043bd`). Pending: founder aplica cambio en n8n UI. |
| `n8n/nodes/00-get-stage-config.md` | ✅ Query funnel_stages + stage_flows. |
| `n8n/nodes/00b-get-crm-context.md` | ✅ Query bloque CRM. |
| `n8n/nodes/99-upsert-lead-cron.md` | ✅ UPSERT post-respuesta. |
| `n8n/workflows/followup-runner.md` | ✅ Spec base del workflow. |
| `n8n/workflows/followup-runner/06-type-is-text.md` | ⚠️ IF de 2 ramas — actualizar a Switch 3 ramas (ADR-0020). |
| `n8n/workflows/followup-runner/02-get-due-leads.md` | ⚠️ LATERAL join → reemplazar con json_agg (ADR-0020). |
| `n8n/calendly-feedback-plan.md` | ✅ Plan completo (2026-05-27). |
| `n8n/calendly-impl-1-links-dinamicos.md` | ✅ Listo para founder. |
| `n8n/calendly-impl-2-workflow.md` | ✅ Listo para founder. |
| `n8n/calendly-impl-3-feedback-agente.md` | ✅ Listo para founder. |
| `docs/adr/0017-turn-timeout-watchdog.md` | ⏳ Propuesto — pendiente implementación. |
| `docs/adr/0018-followup-messages-minio-assets.md` | ✅ Implementado. |
| `docs/adr/0019-agent-resources.md` | ✅ Implementado. |
| `docs/adr/0020-tres-tipos-followup-text-content-flow.md` | ✅ ADR aceptado — nodos n8n pendientes actualización en UI. |
| `docs/adr/0021-consolidate-admin-panel-settings.md` | ✅ Fase 4 completada (2026-05-29). SPA borrado. |
| `packages/db/src/schema.ts` | ✅ Todas las tablas. |
| `n8n/nodes/02-ai-agent.md` | ⏳ Pendiente: actualizar tools cuando existan las P1. |
| `n8n/flows-catalog.md` | ⏳ `ns` etiquetados "revolicord". Confirmar `ns` reales de QC. |
| `n8n/README.md` | ⏳ Pendiente: actualizar diagrama con new chain + cron follow-ups + Calendly. |

---

## Decisiones de negocio abiertas — las necesita Alex

1. **Copy del producto.** One-liner de Quantum Creators, qué incluye el programa, para quién es y para quién NO. Bloquea test end-to-end.
2. **`flow_ns` reales de ManyChat QC.** Semillas usan `PENDIENTE_ns_video_hook` y `PENDIENTE_ns_video_vsl`.
3. **Timing de la primera respuesta.** Debounce actual: 8 s (configurable). Decidir si mantener.
4. **Cadencia y textos de follow-up.** Confirmar la cadencia de días y redactar los textos reales.
5. **Persona del agente.** ¿"Alex" o "del equipo de Alex"?
6. **UTM risk.** Verificar que `?utm_content=` atraviesa el dominio `quantumcreators.es` hasta Calendly.

---

## Cómo probar el MVP — cuando P0 esté cerrado

1. Enviar "hola" como DM a la cuenta de Instagram conectada.
2. Verificar: el agente responde cálido + breve, dispara `video_hook`, hace `set_stage("A", ...)`.
3. Responder "ya lo vi, interesante".
4. Verificar: `set_stage("MS", ...)`, dispara el flow del Vídeo 2 (VSL).
5. Responder "👍 me encanta".
6. Verificar: `set_stage("B", ...)`, el agente envía link de Calendly + `set_stage("C", ...)`.
7. Probar casos de borde: precio en A, "¿eres un bot?", objeción de dinero.
8. Agendar en Calendly → verificar que el sistema marca etapa `D` (depende de Frentes 1+2+3-B).
