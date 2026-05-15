# Quantum Creators · Setter MVP — Seguimiento de implementación

> Documento vivo. Estado del gap entre lo que está cableado hoy en n8n y el funnel objetivo de
> `docs-dm-settings/13-funnel-y-agente.md`. Creado el 2026-05-14.

## Estado en una frase

El prompt del setter (`n8n/prompts/setter-v1.md`) está listo. Para que sea **ejecutable end-to-end**
falta cerrar el gap entre lo cableado hoy y el funnel de doc 13. Este documento lista ese gap,
priorizado: **P0 bloquea el MVP**, P1 lo completa, P2 es robustez/escala.

## Decisiones tomadas

- **Funnel canónico:** Quantum Creators, 5 etapas `A/MS/B/C/D` + terminales (`disqualified`, `lost`, `escalated_human_call`). Confirmado con el founder el 2026-05-14. La documentación previa con etapas `nuevo/interesado/prospecto/cliente` (tenant "revolicord") queda **obsoleta**.
- **Persona del agente:** "Alex" (ver decisión abierta #1, sin cerrar).
- **El prompt vive** en `tenants.config.system_prompt`; la fuente versionada es `n8n/prompts/setter-v1.md`.

## Lo que YA funciona — no tocar

- Workflow `agent-run` cableado: `Webhook → Build Context → AI Agent → enviar texto → Prepare Callback → Callback`.
- Modelo Claude `sonnet 4.6` + Postgres Chat Memory.
- 2 tools conectadas: `trigger_manychat_flow`, `set_stage`.
- Capa de debounce/turnos en Fastify (ManyChat → Fastify → n8n).

---

## P0 — bloquea el MVP

Sin esto el prompt no corre bien end-to-end.

- [ ] **Cargar el prompt** en `tenants.config.system_prompt` del tenant Quantum Creators (copiar el bloque de `n8n/prompts/setter-v1.md`).
- [ ] **Completar el copy del producto** en `setter-v1.md`: `{{QC_PRODUCT_ONELINER}}` y `{{QC_PRODUCT_NOTAS}}`. Solo lo sabe Alex. Sin esto el agente habla del producto con placeholders.
- [ ] **`set_stage`: ampliar los valores válidos** de `new_stage` a `A | MS | B | C | disqualified`. Hoy el prompt los usa, pero el endpoint `POST /admin/leads/:id/stage` fue diseñado para `nuevo/interesado/...`. El endpoint debe: aceptar los valores nuevos, validar transiciones (rechazar saltos A→C con 400), y guardar `reason` + `evidence`.
- [ ] **Build Context: actualizar el JS** — ya reflejado en `n8n/nodes/01-build-context.md`. Nuevo modelo de etapas + lectura de `tenant.config.system_prompt` + bloque de contexto dinámico. Copiar a n8n.
- [ ] **`flows_by_stage` en `tenants.config`**: configurar para `A/MS/B/C` con los `ns` reales de ManyChat de Quantum Creators. ⚠️ Verificar si los `ns` de `n8n/flows-catalog.md` (etiquetados "revolicord") corresponden a los flows reales de QC o son de otro proyecto.
- [ ] **Tabla `lead_stages`**: confirmar que existe en `schema api` y que `current_stage` soporta los valores nuevos. `docs-dm-settings/13` tiene el schema completo; el viejo `stages.md` tenía uno más simple — ahora `stages.md` apunta a doc 13.
- [ ] **`calendly_url` en `tenants.config`**: link único de discovery (`quantumcreators.es/llamada-de-discovery`) para que Build Context lo inyecte y el agente lo envíe en B→C. (El round-robin de closers es P1.)
- [ ] **Activar los flows en ManyChat**: doc 13 dice que están como STOPPED. Hay que activarlos y anotar cada `flow_ns`.

## P1 — completa el setter

El happy path va sin esto, pero el setter no está "completo".

- [ ] **Follow-ups**: tabla `follow_up_templates` + cron n8n cada 5 min + tools `schedule_follow_up` / `cancel_follow_ups`. Cadencia propuesta días 1,2,3,5,7,9,11,13 (doc 13). El prompt actual NO gestiona follow-ups todavía.
- [ ] **Escalado a humano**: tabla `notifications` + tool `notify_human` + lógica de escalado tras follow-up #5 (`escalated_human_call`). Añadir al prompt la rama de escalado cuando la tool exista.
- [ ] **Round-robin de closers**: tabla `closers` + endpoint Fastify con lock atómico + tool `send_calendly_link`. Hasta entonces: link único en config (P0).
- [ ] **Calendly webhook**: endpoint Fastify dedicado que verifica firma → marca etapa `D` → dispara notificación. Es lo único que mueve C→D.
- [ ] **Inyección de presencia**: el payload del API hacia n8n debe incluir `instagram_context.{last_seen, last_interaction}`. El prompt ya los consume; el payload aún no los manda. Habilita la heurística adaptativa de "Media Seen" de doc 13.
- [ ] **Persistencia de señales del agente**: que el agente guarde notas/señales en `lead_stages.metadata` y Build Context las reinyecte. Hoy no hay este loop.
- [ ] **Banco de objeciones**: tabla `objection_bank` (poblada por Alex) + tool `get_objection_bank`. Mejora el manejo de objeciones más allá de lo que trae el prompt.
- [ ] **`mark_disqualified`**: doc 13 lo lista como tool aparte, pero `set_stage("disqualified", reason, evidence)` ya cubre el caso. Decidir si se construye o se deja en `set_stage` (recomendado: dejarlo en `set_stage`, una tool menos).

## P2 — robustez y escala

- [ ] **Memoria multinivel**: hoy solo Postgres Chat Memory (cronológico, sin recall semántico). Falta la capa episódica/semántica (pgvector / Zep / Mem0) + resumen "frío" de la conversación cada 5 turnos (doc 13). Sin esto, un lead que vuelve tras semanas se trata sin contexto profundo.
- [ ] **Restricciones de la API de Meta/ManyChat**: límite ~200 DMs/hora por cuenta, ventana de mensajería de 24 h, variación semántica del texto (evitar texto idéntico a >25 destinatarios/hora), encolado + backoff exponencial. Verificar qué cubre ManyChat por nosotros y qué hay que gestionar en la capa Fastify.
- [ ] **Formato de salida estructurado**: doc 13 propone que el agente devuelva JSON (`actions`, `response_to_user`, `stage_change`, `internal_notes`). Hoy la salida es texto plano que va directo a "enviar texto". Migrar a JSON requiere un nodo parser en n8n — decidir si compensa.
- [ ] **Telemetría / KPIs**: Open Rate, Reply Rate, CTR, Qualification Rate, Call-to-Appointment Rate, Show Rate, Speed-to-Lead, MSR/PRR/CSR/ABR. Benchmarks en `fundamentals/Informe ... Appointment Setting en Instagram`. Queries y dashboard en `docs-dm-settings/14`.
- [ ] **HITL por confianza**: cuando la incertidumbre del modelo supera un umbral o detecta sentimiento muy negativo / tema legal → escalar a humano con resumen + borrador sugerido, en vez de actuar.
- [ ] **PII / GDPR**: DPA con Groq (y cualquier proveedor de modelo), garantía de zero-data-retention, auditabilidad de qué contexto exacto recibió el modelo en cada turno.
- [ ] **Versionado de prompts**: disciplina de git en `n8n/prompts/` (v1 → v2…) o tabla `prompt_versions`. Para no perder iteraciones del setter y poder hacer A/B.
- [ ] **Revisar el modelo**: `llama-3.3-70b` es de gama media para tool-calling multi-etapa. Si en pruebas el agente salta etapas, inventa flows o ignora restricciones, evaluar un modelo clase Claude / GPT-4o.

---

## Documentación a reconciliar — está "regado"

| Archivo | Estado |
|---------|--------|
| `n8n/prompts/setter-v1.md` | ✅ Creado en este pase — el prompt de producción. |
| `n8n/SETTER-MVP-TRACKING.md` | ✅ Este documento. |
| `n8n/stages.md` | ✅ Actualizado a `A/MS/B/C/D` + terminales. |
| `n8n/system-prompt.md` | ✅ Actualizado — apunta a `setter-v1.md` y documenta el contrato de inyección. |
| `n8n/nodes/01-build-context.md` | ✅ Actualizado — nuevo JS con modelo de etapas y contexto dinámico. |
| `n8n/nodes/02-ai-agent.md` | ⏳ Pendiente: sigue listando solo 2 tools. Actualizar cuando se construyan las tools de P1. |
| `n8n/flows-catalog.md` | ⏳ Pendiente: nombres y `ns` etiquetados "revolicord". Reconciliar con los nombres semánticos de doc 13 (`video_hook`, `video_vsl`, `audio_did_you_see_video`…) y confirmar los `ns` reales de QC. |
| `n8n/README.md` | ⏳ Pendiente: actualizar el diagrama de nodos cuando exista el cron de follow-ups. |
| `n8n/agent-run.json` | ⚠️ Archivo vacío (0 bytes). El JSON del workflow no se versiona (tiene tokens). Confirmar que es intencional o borrarlo. |
| `docs-dm-settings/00 readme.md` | ⚠️ Menor: referencia `07-docker-compose-y-deploy.md` pero el archivo real es `07-docker-swarm-y-deploy.md`. |
| Nombre del negocio | ⚠️ El repo es `revolicord/n8n-production-stack`, `.env` y flows hablan de "revolicord", pero el funnel es Quantum Creators. Confirmar el modelo: ¿Revolicord = agencia/plataforma, Quantum Creators = primer tenant? Alinear `flows-catalog.md` y el `slug` del tenant. |

---

## Decisiones de negocio abiertas — las necesita Alex

1. **Persona del agente.** ¿El agente *es* "Alex" (se hace pasar por el founder) o es "del equipo de Alex"? La segunda opción es más sostenible: explica la latencia entre mensajes y reduce el riesgo si un lead descubre que es automatizado. `docs-dm-settings/13` dice que es "Alex" — el prompt sigue eso de momento.
2. **Copy del producto.** One-liner de Quantum Creators, qué incluye el programa, para quién es y para quién NO. Bloquea P0.
3. **Timing de la primera respuesta.** Los dos informes de `fundamentals/` se contradicen: uno recomienda 5-20 min de retraso deliberado (no parecer bot), el otro dice que 0-1 min convierte 21× más. El sistema tiene un debounce de 8 s. Esto NO es del prompt — es política de la capa de debounce/scheduling. Decidir.
4. **Criterios finos de descalificación.** Umbral de "cuenta de baja calidad" (nº de seguidores, antigüedad), lista exacta de países válidos.
5. **Cadencia y textos de follow-up.** Doc 13 propone días 1,2,3,5,7,9,11,13 con texto/audio/meme. Confirmar la cadencia y redactar los textos reales.

---

## Cómo probar el MVP — cuando P0 esté cerrado

Prueba manual end-to-end (basada en el Ejemplo 1 de `docs-dm-settings/13`):

1. Enviar "hola" como DM a la cuenta de Instagram conectada.
2. Verificar: el agente responde cálido + breve, dispara `video_hook`, hace `set_stage("A", ...)`.
3. Responder "ya lo vi, interesante".
4. Verificar: `set_stage("MS", ...)` con `evidence` = la frase del usuario, dispara el flow del Vídeo 2 (VSL).
5. Responder "👍 me encanta".
6. Verificar: `set_stage("B", ...)`, y en el siguiente paso el agente envía el link de Calendly + `set_stage("C", ...)`.
7. Probar los casos de borde del prompt: preguntar el precio en A, preguntar "¿eres un bot?", soltar una objeción de dinero. Verificar que el agente NO da precio, NO admite ser bot, y NO descalifica al primer "no".
8. Reservar en Calendly → verificar que el sistema (no el agente) marca etapa `D`. ⚠️ Esto depende del webhook de Calendly (P1).
