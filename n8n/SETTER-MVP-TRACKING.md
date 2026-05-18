# Quantum Creators · Setter MVP — Seguimiento de implementación

> Documento vivo. Actualizado el 2026-05-15 tras implementación de ADRs 0010–0015.

## Estado en una frase

El schema de BD está completo (ADRs 0010–0015 migrados). La migración **no ha sido aplicada a producción** — falta `DATABASE_URL` + seed + cablear nodos en n8n. El prompt del setter y el workflow `agent-run` básico ya funcionan; los nuevos nodos están especificados listos para copiar.

## Decisiones tomadas

- **Funnel canónico:** Quantum Creators, 5 etapas `A/MS/B/C/D` + terminales (`disqualified`, `lost`, `escalated_human_call`). Confirmado con el founder el 2026-05-14. La documentación previa con etapas `nuevo/interesado/prospecto/cliente` (tenant "revolicord") queda **obsoleta**.
- **Persona del agente:** "Alex" (ver decisión abierta #1, sin cerrar).
- **El prompt vive** en el Set node `System Prompt` del workflow de n8n (ver `n8n/nodes/00c-system-prompt.md`); la fuente versionada es `n8n/prompts/setter-v1.md`. (Hasta v4 vivía en `tenants.config.system_prompt`; cambiado en v5 — 2026-05-16 — para iterar sin SQL.)
- **ADR-0014 Path B:** `current_stage_id UUID FK` se agrega a `lead_stages` (no a `subscribers`), preservando el schema existente. Ver `docs/adr/IMPLEMENTATION-REPORT.md`.

## Lo que YA funciona — no tocar

- Workflow `agent-run` cableado: `Webhook → Build Context → AI Agent → enviar texto → Prepare Callback → Callback`.
- Modelo Claude `sonnet 4.6` + Postgres Chat Memory.
- 2 tools conectadas: `trigger_manychat_flow`, `set_stage`.
- Capa de debounce/turnos en Fastify (ManyChat → Fastify → n8n).
- **Schema de BD**: migración `0002_polite_groot.sql` generada y validada (typecheck ✅). Tablas nuevas: `funnel_stages`, `stage_flows`, `followup_templates`, `lead_followup_log`, `lead_crons`. Columna `current_stage_id FK` añadida a `lead_stages`.

---

## P0 — bloquea el MVP

Sin esto el prompt no corre bien end-to-end.

- [ ] **Aplicar migración 0002** a la BD de producción: `DATABASE_URL="postgres://..." pnpm db:migrate` desde `packages/db/`. Crea las 5 tablas nuevas y agrega `current_stage_id` a `lead_stages`.
- [ ] **Ejecutar seed QC** (`packages/db/drizzle/seed_qc_funnel.sql`): reemplazar `<TENANT_ID>` con el UUID real del tenant → crea etapas A/MS/B/C/D + stage_flows + followup_templates.
- [ ] **Ejecutar backfill**: después del seed, correr el UPDATE comentado en `seed_qc_funnel.sql` para llenar `lead_stages.current_stage_id` en filas existentes.
- [ ] **Cargar el prompt** en el Set node `System Prompt` del workflow `agent-run` (copiar el bloque de `n8n/prompts/setter-v1.md` al campo `staticPrompt` del Set node).
- [ ] **Completar el copy del producto** en `setter-v1.md`: `{{QC_PRODUCT_ONELINER}}` y `{{QC_PRODUCT_NOTAS}}`. Solo lo sabe Alex. Sin esto el agente habla del producto con placeholders.
- [ ] **`set_stage`: ampliar los valores válidos** de `new_stage` a `A | MS | B | C | disqualified`. El endpoint `POST /admin/leads/:id/stage` fue diseñado para `nuevo/interesado/...`. Debe: aceptar valores nuevos, validar transiciones, guardar `reason` + `evidence`.
- [ ] **Cablear nodos nuevos en `agent-run`** (n8n UI): agregar `Get Stage Config` y `Get Subscriber CRM Context` antes de `Build Context`; reemplazar JS de `Build Context` con el de `n8n/nodes/01-build-context.md`; agregar `Upsert Lead Cron` después de `enviar texto`.
- [ ] **Confirmar `flow_ns` reales de ManyChat QC**: el seed usa `PENDIENTE_ns_video_hook` y `PENDIENTE_ns_video_vsl`. Verificar en la cuenta de ManyChat y actualizar `stage_flows` en la BD.
- [ ] **`calendly_url` en `tenants.config`**: link único de discovery para que Build Context lo inyecte. (El round-robin de closers es P1.)
- [ ] **Activar los flows en ManyChat**: están como STOPPED. Activarlos y anotar cada `flow_ns`.

## P1 — completa el setter

El happy path va sin esto, pero el setter no está "completo".

- [x] **Schema follow-ups**: tablas `followup_templates` y `lead_followup_log` diseñadas, migración generada, seed con templates para A/MS/B/C. Pendiente solo la aplicación en producción (ver P0).
- [x] **Spec `followup-runner`**: workflow completamente especificado en `n8n/workflows/followup-runner.md` (6 nodos, queries SQL, lógica de avance/archivado, INSERT en `n8n_chat_histories`). Pendiente: crear el workflow en la UI de n8n.
- [x] **Contexto dual agente**: bloque CRM (`Get Subscriber CRM Context` + `buildCrmBlock()`) especificado e integrado en `Build Context`. Pendiente: cablear en n8n.
- [ ] **Crear workflow `followup-runner` en n8n**: Schedule Trigger cada 5 min siguiendo `n8n/workflows/followup-runner.md`. Sin esto, el sistema no envía seguimientos automáticos.
- [ ] **Actualizar system prompt** (`setter-v1.md`): agregar instrucción sobre `[SEGUIMIENTO AUTOMÁTICO #N]` para que el agente use los seguimientos como contexto sin mencionarlos explícitamente.
- [ ] **Escalado a humano**: tabla `notifications` + tool `notify_human` + lógica tras follow-up #5 (`escalated_human_call`). Añadir al prompt cuando la tool exista.
- [ ] **Round-robin de closers**: tabla `closers` + endpoint Fastify con lock atómico + tool `send_calendly_link`. Hasta entonces: link único en config (P0).
- [ ] **Calendly webhook**: endpoint Fastify dedicado que verifica firma → marca etapa `D` → dispara notificación. Es lo único que mueve C→D.
- [ ] **Inyección de presencia**: el payload del API hacia n8n debe incluir `instagram_context.{last_seen, last_interaction}`. El prompt ya los consume; el payload aún no los manda.
- [ ] **Persistencia de señales del agente**: que el agente guarde notas/señales en `lead_stages.metadata` y Build Context las reinyecte.
- [ ] **Banco de objeciones**: tabla `objection_bank` + tool `get_objection_bank`.
- [ ] **`mark_disqualified`**: `set_stage("disqualified", reason, evidence)` ya cubre el caso — no construir tool aparte.

## P2 — robustez y escala

- [ ] **Memoria multinivel**: hoy solo Postgres Chat Memory (cronológico, sin recall semántico). Falta la capa episódica/semántica (pgvector / Zep / Mem0) + resumen "frío" de la conversación cada 5 turnos (doc 13). Sin esto, un lead que vuelve tras semanas se trata sin contexto profundo.
- [ ] **Restricciones de la API de Meta/ManyChat**: límite ~200 DMs/hora por cuenta, ventana de mensajería de 24 h, variación semántica del texto (evitar texto idéntico a >25 destinatarios/hora), encolado + backoff exponencial. Verificar qué cubre ManyChat por nosotros y qué hay que gestionar en la capa Fastify.
- [ ] **Formato de salida estructurado**: doc 13 propone que el agente devuelva JSON (`actions`, `response_to_user`, `stage_change`, `internal_notes`). Hoy la salida es texto plano que va directo a "enviar texto". Migrar a JSON requiere un nodo parser en n8n — decidir si compensa.
- [ ] **Telemetría / KPIs**: Open Rate, Reply Rate, CTR, Qualification Rate, Call-to-Appointment Rate, Show Rate, Speed-to-Lead, MSR/PRR/CSR/ABR. Benchmarks en `fundamentals/Informe ... Appointment Setting en Instagram`. Queries y dashboard en `docs/_archive/docs-dm-settings/14`.
- [ ] **HITL por confianza**: cuando la incertidumbre del modelo supera un umbral o detecta sentimiento muy negativo / tema legal → escalar a humano con resumen + borrador sugerido, en vez de actuar.
- [ ] **PII / GDPR**: DPA con Groq (y cualquier proveedor de modelo), garantía de zero-data-retention, auditabilidad de qué contexto exacto recibió el modelo en cada turno.
- [ ] **Versionado de prompts**: disciplina de git en `n8n/prompts/` (v1 → v2…) o tabla `prompt_versions`. Para no perder iteraciones del setter y poder hacer A/B.
- [ ] **Revisar el modelo**: `llama-3.3-70b` es de gama media para tool-calling multi-etapa. Si en pruebas el agente salta etapas, inventa flows o ignora restricciones, evaluar un modelo clase Claude / GPT-4o.

---

## Documentación a reconciliar

| Archivo | Estado |
|---------|--------|
| `n8n/prompts/setter-v1.md` | ✅ Prompt de producción. Pendiente: agregar instrucción `[SEGUIMIENTO AUTOMÁTICO #N]`. |
| `n8n/SETTER-MVP-TRACKING.md` | ✅ Este documento — actualizado 2026-05-15. |
| `n8n/stages.md` | ✅ Actualizado a `A/MS/B/C/D` + terminales. |
| `n8n/system-prompt.md` | ✅ Apunta a `setter-v1.md`. |
| `n8n/nodes/01-build-context.md` | ✅ Actualizado — selección ponderada + bloque CRM + elimina FLOW_MAP hardcodeado. |
| `n8n/nodes/00-get-stage-config.md` | ✅ Creado — query para leer funnel_stages + stage_flows. |
| `n8n/nodes/00b-get-crm-context.md` | ✅ Creado — query para bloque CRM del agente. |
| `n8n/nodes/99-upsert-lead-cron.md` | ✅ Creado — UPSERT post-respuesta + marca followups respondidos. |
| `n8n/workflows/followup-runner.md` | ✅ Creado — spec completo del workflow (6 nodos, queries SQL). |
| `docs/adr/IMPLEMENTATION-REPORT.md` | ✅ Creado — reporte de implementación ADRs 0010–0015. |
| `packages/db/src/schema.ts` | ✅ Actualizado — 5 tablas nuevas + `current_stage_id` en `lead_stages`. |
| `packages/db/drizzle/0002_polite_groot.sql` | ✅ Creado — migración lista para aplicar en producción. |
| `packages/db/drizzle/seed_qc_funnel.sql` | ✅ Creado — seed QC, requiere `<TENANT_ID>` real. |
| `n8n/nodes/02-ai-agent.md` | ⏳ Pendiente: sigue listando solo 2 tools. Actualizar cuando existan las tools de P1. |
| `n8n/flows-catalog.md` | ⏳ Pendiente: `ns` etiquetados "revolicord". Confirmar los `ns` reales de QC y actualizar `stage_flows` en BD. |
| `n8n/README.md` | ⏳ Pendiente: actualizar el diagrama de nodos con el nuevo chain y el cron de follow-ups. |
| `n8n/agent-run.json` | ⚠️ Vacío (0 bytes) — el JSON del workflow no se versiona (tiene tokens). Intencional. |
| `docs/_archive/docs-dm-settings/00 readme.md` | ⚠️ Menor: referencia `07-docker-compose-y-deploy.md` pero el archivo real es `07-docker-swarm-y-deploy.md`. |
| Nombre del negocio | ⚠️ Repo `revolicord/n8n-production-stack` vs. tenant Quantum Creators. Confirmar modelo: Revolicord = agencia, QC = primer tenant. Alinear `flows-catalog.md` y `slug` del tenant. |

---

## Decisiones de negocio abiertas — las necesita Alex

1. **Persona del agente.** ¿El agente *es* "Alex" (se hace pasar por el founder) o es "del equipo de Alex"? La segunda opción es más sostenible: explica la latencia entre mensajes y reduce el riesgo si un lead descubre que es automatizado. `docs/_archive/docs-dm-settings/13` dice que es "Alex" — el prompt sigue eso de momento.
2. **Copy del producto.** One-liner de Quantum Creators, qué incluye el programa, para quién es y para quién NO. Bloquea P0.
3. **Timing de la primera respuesta.** Los dos informes de `fundamentals/` se contradicen: uno recomienda 5-20 min de retraso deliberado (no parecer bot), el otro dice que 0-1 min convierte 21× más. El sistema tiene un debounce de 8 s. Esto NO es del prompt — es política de la capa de debounce/scheduling. Decidir.
4. **Criterios finos de descalificación.** Umbral de "cuenta de baja calidad" (nº de seguidores, antigüedad), lista exacta de países válidos.
5. **Cadencia y textos de follow-up.** Doc 13 propone días 1,2,3,5,7,9,11,13 con texto/audio/meme. Confirmar la cadencia y redactar los textos reales.

---

## Cómo probar el MVP — cuando P0 esté cerrado

Prueba manual end-to-end (basada en el Ejemplo 1 de `docs/_archive/docs-dm-settings/13`):

1. Enviar "hola" como DM a la cuenta de Instagram conectada.
2. Verificar: el agente responde cálido + breve, dispara `video_hook`, hace `set_stage("A", ...)`.
3. Responder "ya lo vi, interesante".
4. Verificar: `set_stage("MS", ...)` con `evidence` = la frase del usuario, dispara el flow del Vídeo 2 (VSL).
5. Responder "👍 me encanta".
6. Verificar: `set_stage("B", ...)`, y en el siguiente paso el agente envía el link de Calendly + `set_stage("C", ...)`.
7. Probar los casos de borde del prompt: preguntar el precio en A, preguntar "¿eres un bot?", soltar una objeción de dinero. Verificar que el agente NO da precio, NO admite ser bot, y NO descalifica al primer "no".
8. Reservar en Calendly → verificar que el sistema (no el agente) marca etapa `D`. ⚠️ Esto depende del webhook de Calendly (P1).
