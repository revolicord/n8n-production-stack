Plan de implementación ADR-0024 — apps/agent: motor de diálogo CALM sobre LangGraph.js

 ▎ Entregable al aprobar este plan: este documento se escribe en el repo como
 ▎ docs/adr/0024-implementation-plan.md (commit docs(adr): plan de implementación ADR-0024),
 ▎ y se arranca la Fase 1 (contratos Zod) en una rama nueva feat/agent-fase1-contratos.

 Contexto

 El ADR-0024 cerró la decisión: el cerebro conversacional sale de n8n y se muda a apps/agent,
 un motor de diálogo con patrones CALM (command generator LLM + flow engine determinista +
 dialogue stack + repair patterns) orquestado por LangGraph.js, en el mismo monorepo TS.
 Este plan descompone esa decisión en tareas ejecutables: archivos, schemas Zod completos,
 migraciones Drizzle, integración con el worker, shadow mode y riesgos.

 Decisiones fijadas con el founder en esta sesión (ya no abiertas):
 1. apps/agent es una librería del workspace (@dm-api/agent) que el worker BullMQ
 importa y ejecuta con await runTurn(). No es un servicio HTTP separado.
 2. El LLM se llama con @anthropic-ai/sdk directo (tool-use para structured output,
 JSON Schema generado desde Zod con zod-to-json-schema, ya en el stack). LangGraph
 queda solo como runtime del grafo.

 Hallazgos del repo que condicionan el plan:
 - No existe tabla messages (el prompt del ADR la menciona, pero el schema real solo
 tiene messages_raw). Hoy el transcript se reconstruye así: mensajes del lead en
 messages_raw (direction in) + texto del bot en turns.response_text. Los envíos del
 Router via ManyChat no se persisten como mensajes. El motor nuevo escribe sus salidas
 en messages_raw con direction='out' — eso da la memoria propia sin tabla nueva.
 - El prompt vivo en el Set node es la variante v8 (3 tipos de acción: send_content,
 change_stage, reply_text; sin notify_human ni handoff_state) — confirmado por el
 founder pegando el texto literal. El .md del repo va por v10. La paridad de shadow mode
 se mide contra lo que está vivo, y el bloque de persona se extrae del texto vivo.
 - set-stage.ts tiene VALID_TRANSITIONS y DISQUALIFIED_REASONS hardcodeados (la fuga),
 pero stage_transitions_map y funnel_stages.valid_next_stages ya existen en DB — la
 versión data-driven no necesita tablas nuevas para transiciones.
 - packages/db usa postgres.js; @langchain/langgraph-checkpoint-postgres usa pg.
 Incompatibilidad de driver confirmada → se maneja con un Pool pg dedicado (riesgo R2).

 ---
 1. Estructura de apps/agent

 apps/agent/
 ├── package.json              # @dm-api/agent — deps abajo
 ├── tsconfig.json             # extiende el patrón de apps/api (strict, noUncheckedIndexedAccess)
 ├── vitest.config.ts
 └── src/
     ├── index.ts              # API pública: runTurn(), resumeConversation(), tipos re-exportados
     ├── run-turn.ts           # entry: compila el grafo (singleton), invoke con TurnInput, cleanup checkpoint
     ├── resume.ts             # resumeConversation(): Command({resume}) sobre el thread suspendido
     ├── config.ts             # getAgentConfig() — Zod env (ANTHROPIC_API_KEY, AGENT_*)
     ├── deps.ts               # inyección: db (drizzle), pgPool (checkpointer), redis, logger, clock, rng
     │
     ├── graph/                # ÚNICO directorio que importa @langchain/langgraph
     │   ├── annotation.ts     # DialogueAnnotation (Annotation.Root)
     │   ├── build-graph.ts    # StateGraph: wiring de los 5 nodos + PostgresSaver + edges
     │   └── nodes/            # wrappers finos: adaptan state ⇄ funciones puras de core/
     │       ├── assemble-context.ts
     │       ├── understand.ts
     │       ├── flow-engine.ts      # aquí vive el interrupt() de HumanHandoff
     │       ├── execute-actions.ts
     │       └── respond.ts
     │
     ├── core/                 # TS PURO — cero imports de LangGraph, 100% testeable con vitest
     │   ├── context/
     │   │   ├── assemble.ts   # port tipado de Build Context v6 (función pura sobre datos cargados)
     │   │   ├── weighted.ts   # pickWeighted, collapseVariantGroups (RNG inyectable)
     │   │   └── handoff.ts    # buildHandoffState tipado
     │   ├── flow-engine/
     │   │   ├── engine.ts     # advanceDialogue(): el intérprete del stack — IP del producto
     │   │   ├── steps.ts      # ejecución de collect | action | branch | link
     │   │   ├── conditions.ts # mini-lenguaje cerrado de guards (eq/neq/exists/in/gte/lte)
     │   │   ├── stack.ts      # push/pop/peek de FlowFrame, pattern_continue_interrupted
     │   │   └── repair.ts     # transiciones de repair_context
     │   ├── llm/
     │   │   ├── client.ts     # wrapper @anthropic-ai/sdk (tool-use emit_plan, prompt caching)
     │   │   ├── prompt.ts     # composePrompt(platformSkeleton, personaBlock, context)
     │   │   └── parse.ts      # Zod parse de la salida + 1 retry con feedback de errores
     │   └── memory/
     │       └── transcript.ts # últimos N turnos desde messages_raw (in+out) → mensajes Anthropic
     │
     ├── actions/
     │   ├── registry.ts       # ActionRegistry + interface ActionHandler
     │   ├── events.ts         # emitDomainEvent() → tabla domain_events (outbox)
     │   └── handlers/
     │       ├── send-content.ts      # resuelve slug→flow_ns (variantes) y llama channel adapter
     │       ├── reply-text.ts        # templating {lead_in} {tenant.calendly_url} {slots.*}
     │       ├── change-stage.ts      # transición data-driven (stage_transitions_map) + cascadas
     │       ├── notify-human.ts      # insert notifications + encola NOTIFY_QUEUE (reusa worker notify)
     │       ├── schedule-followup.ts # upsert lead_crons
     │       └── http-request.ts      # conector declarativo simple (url_ref, body templado, save_as)
     │
     ├── channel/
     │   ├── types.ts          # interface ChannelAdapter { sendFlow, sendText } — el puerto
     │   └── manychat.ts       # port del Router: fetch + withRetry [500,1500], timeout 30s
     │
     └── services/             # acceso a datos con drizzle (queries del agente)
         ├── dialogue-states.ts
         ├── flow-definitions.ts
         ├── context-queries.ts  # stage config, stage_flows all-stages, lead_content_sent, notifications
         └── shadow-runs.ts

 package.json (deps nuevas en negrita):

 {
   "name": "@dm-api/agent",
   "private": true,
   "type": "module",
   "main": "./dist/index.js",
   "types": "./src/index.ts",
   "exports": { ".": { "types": "./src/index.ts", "import": "./dist/index.js" } },
   "scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc --noEmit", "test": "vitest run --passWithNoTests" },
   "dependencies": {
     "@anthropic-ai/sdk": "...",
     "@langchain/langgraph": "...",
     "@langchain/langgraph-checkpoint-postgres": "...",
     "pg": "...",
     "@dm-api/db": "workspace:*",
     "@dm-api/shared": "workspace:*",
     "zod": "3.23.8",
     "zod-to-json-schema": "3.23.5",
     "pino": "9.5.0"
   },
   "devDependencies": { "@types/pg": "...", "typescript": "5.6.3", "vitest": "2.1.5" }
 }

 Registro en el workspace: automático (pnpm-workspace.yaml ya incluye apps/*).
 pnpm -r lo agarra para build/typecheck/test/CI sin tocar nada. apps/api agrega
 "@dm-api/agent": "workspace:*" a sus deps. El Dockerfile de dm-api ya buildea el monorepo
 completo (pnpm -r build), así que make rebuild-api despliega el agente sin servicio nuevo.

 Los contratos Zod viven en packages/shared/src/schemas/dialogue/ (no en apps/agent):
 los necesitan el worker (TurnInput/AgentResponse), el dashboard /settings (editor de flows)
 y el agente. Archivos: commands.ts, flow.ts, state.ts, turn.ts, index.ts.

 ---
 2. Fase 1 — Contratos Zod (2-3 días, sin runtime)

 Branch feat/agent-fase1-contratos. Solo packages/shared + packages/db + seeds JSON.
 Commits: feat(shared): vocabulario de comandos y flows ADR-0024, feat(db): flow_definitions + dialogue_states,
 test(shared): fixtures QC y Bufete validan contra el vocabulario.

 2.1 DialogueCommand — packages/shared/src/schemas/dialogue/commands.ts

 import { z } from 'zod';

 export const SlotValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
 export type SlotValue = z.infer<typeof SlotValueSchema>;

 export const RepairPatternSchema = z.enum([
   'human_handoff', 'cannot_handle', 'continue_interrupted', 'clarify', 'correction',
 ]);
 export type RepairPattern = z.infer<typeof RepairPatternSchema>;

 const StartFlowCommand = z.object({
   type: z.literal('StartFlow'),
   flow_id: z.string().min(1),
   inputs: z.record(z.string(), SlotValueSchema).default({}),
   evidence: z.string().min(1),
 });

 const SetSlotCommand = z.object({
   type: z.literal('SetSlot'),
   slot: z.string().min(1),          // notación 'materia' o 'conflict_result.has_conflict'
   value: SlotValueSchema,
   evidence: z.string().min(1),
 });

 const CancelFlowCommand = z.object({
   type: z.literal('CancelFlow'),
   flow_id: z.string().optional(),   // sin flow_id = top del stack
   reason: z.string().min(1),
 });

 const ClarifyCommand = z.object({
   type: z.literal('Clarify'),
   about: z.string().min(1),
   text: z.string().min(1).max(300), // pregunta corta al lead
 });

 const HumanHandoffCommand = z.object({
   type: z.literal('HumanHandoff'),
   kind: z.enum(['audio', 'keyword', 'media', 'agent']),  // espeja notifications.kind
   reason: z.string().min(1),        // 'media_unread' | 'explicit_request' | ... (texto libre validado por persona)
   summary: z.string().optional(),
   source: z.enum(['code', 'llm']).default('llm'),
 });

 const ReplyTextCommand = z.object({
   type: z.literal('ReplyText'),
   text: z.string().min(1).max(500),
 });

 const SendContentCommand = z.object({
   type: z.literal('SendContent'),
   slug_id: z.string().min(1),
   evidence: z.string().min(1),
   lookup_stage: z.string().optional(), // solo flows declarativos lo setean (ex lookup_stage del Router)
 });

 const ChangeStageCommand = z.object({
   type: z.literal('ChangeStage'),
   to_stage: z.string().min(1),      // slugs son DATOS del tenant → string, validado contra stage_transitions_map en runtime
   reason: z.string().nullable(),    // razones de descalificación = datos (tenant.config.disqualification_reasons)
   evidence: z.string().min(1),
   lead_in: z.string().max(200).optional(),
   cascade: z.boolean().default(true), // false dentro de un flow → no re-dispara trigger flows (anti-recursión)
 });

 const ScheduleFollowupCommand = z.object({
   type: z.literal('ScheduleFollowup'),
   delay_minutes: z.number().int().positive(),
   note: z.string().optional(),
 });

 export const DialogueCommandSchema = z.discriminatedUnion('type', [
   StartFlowCommand, SetSlotCommand, CancelFlowCommand, ClarifyCommand, HumanHandoffCommand,
   ReplyTextCommand, SendContentCommand, ChangeStageCommand, ScheduleFollowupCommand,
 ]);
 export type DialogueCommand = z.infer<typeof DialogueCommandSchema>;

 // Subconjunto que el LLM puede emitir (ScheduleFollowup es solo del sistema/flows):
 export const LlmCommandSchema = z.discriminatedUnion('type', [
   StartFlowCommand, SetSlotCommand, CancelFlowCommand, ClarifyCommand,
   HumanHandoffCommand, ReplyTextCommand, SendContentCommand, ChangeStageCommand,
 ]);
 export const LlmPlanSchema = z.object({
   reasoning: z.string().min(1),
   commands: z.array(LlmCommandSchema).max(6),
 });

 ▎ El vocabulario está cerrado a nivel de tipos; los valores (slugs de etapa, razones,
 ▎ slug_ids de contenido) son datos del tenant validados en runtime contra Postgres. Eso es
 ▎ exactamente la separación mecanismo/política del ADR.

 2.2 FlowStep y FlowDefinition — packages/shared/src/schemas/dialogue/flow.ts

 export const ConditionSchema = z.object({
   slot: z.string().min(1),          // soporta dot-path en slots ('conflict_result.has_conflict')
   op: z.enum(['eq', 'neq', 'exists', 'not_exists', 'in', 'gte', 'lte']),
   value: z.union([SlotValueSchema, z.array(SlotValueSchema)]).optional(),
 });
 export type Condition = z.infer<typeof ConditionSchema>;

 const StepBase = { id: z.string().min(1), next: z.string().optional() }; // next omitido = step siguiente del array

 const CollectStep = z.object({
   ...StepBase,
   type: z.literal('collect'),
   slot: z.string().min(1),
   prompt_hint: z.string().min(1),   // instrucción al LLM de cómo pedir el dato (no texto literal → la persona lo redacta)
   validation: z.enum(['text', 'number', 'boolean', 'option']).default('text'),
   options: z.array(z.string()).optional(),
   skip_if_filled: z.boolean().default(true),
 });

 const ActionStep = z.object({
   ...StepBase,
   type: z.literal('action'),
   action: z.string().min(1),        // nombre en el ActionRegistry: 'send_content' | 'reply_text' | ...
   config: z.record(z.string(), z.unknown()).default({}), // validado por el Zod propio de cada handler
   save_as: z.string().optional(),   // guarda el resultado en slots.<save_as> (lo usa branch)
   on_failure: z.enum(['abort', 'continue', 'handoff']).default('abort'),
 });

 const BranchStep = z.object({
   ...StepBase,
   type: z.literal('branch'),
   cases: z.array(z.object({ when: ConditionSchema, next: z.string().min(1) })).min(1),
   default: z.string().optional(),   // sin default y sin match = fin del flow (pop)
 });

 const LinkStep = z.object({
   ...StepBase,
   type: z.literal('link'),
   flow_id: z.string().min(1),       // tail-call: reemplaza el frame actual por el flow destino
 });

 export const FlowStepSchema = z.discriminatedUnion('type', [CollectStep, ActionStep, BranchStep, LinkStep]);
 export type FlowStep = z.infer<typeof FlowStepSchema>;

 export const FlowTriggerSchema = z.discriminatedUnion('type', [
   z.object({ type: z.literal('llm'), description: z.string().min(1) }),       // el LLM lo arranca con StartFlow; description = when_to_use
   z.object({ type: z.literal('stage_transition'),
              from: z.string().min(1),  // '*' = cualquier etapa origen
              to: z.string().min(1) }),
   z.object({ type: z.literal('system') }),                                    // followups / eventos externos
 ]);

 export const FlowDefinitionSchema = z.object({
   flow_id: z.string().regex(/^[a-z0-9_]+$/),
   name: z.string().min(1),
   description: z.string().optional(),
   trigger: FlowTriggerSchema,
   slots: z.array(z.object({
     name: z.string().min(1),
     type: z.enum(['text', 'number', 'boolean', 'option']),
     description: z.string().optional(),
     options: z.array(z.string()).optional(),
   })).default([]),
   steps: z.array(FlowStepSchema).min(1)
     .refine((s) => new Set(s.map((x) => x.id)).size === s.length, 'step ids must be unique'),
 });
 export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;

 2.3 DialogueState — state.ts

 export const FlowFrameSchema = z.object({
   flow_id: z.string(),
   flow_version: z.number().int().positive(),  // ← versionado: el frame fija la versión con la que arrancó
   step_id: z.string(),
   frame_slots: z.record(z.string(), SlotValueSchema).default({}), // slots locales del flow
   started_at: z.string().datetime(),
   interrupted_at: z.string().datetime().nullable().default(null),
 });

 export const DialogueStateSchema = z.object({
   version: z.literal(1),
   stack: z.array(FlowFrameSchema).default([]),       // LIFO — último = activo
   slots: z.record(z.string(), SlotValueSchema).default({}), // slots globales de la conversación (señales del lead)
   repair_context: z.object({
     pattern: RepairPatternSchema,
     since: z.string().datetime(),
     payload: z.record(z.string(), z.unknown()).default({}),
   }).nullable().default(null),
   last_turn_id: z.string().uuid().nullable().default(null),
 });
 export type DialogueState = z.infer<typeof DialogueStateSchema>;

 2.4 TurnInput y AgentResponse — turn.ts

 export const TurnTriggerSchema = z.object({
   source: z.enum(['lead_message', 'system_followup', 'system_event', 'human_echo']),
   channel: z.string().default('instagram'),
 });

 export const TurnInputSchema = z.object({
   schema_version: z.literal('v1'),
   turn_id: z.string().uuid(),
   tenant_id: z.string().uuid(),
   subscriber_id: z.string().uuid(),
   conversation_id: z.string().uuid(),
   trigger: TurnTriggerSchema,
   messages: z.array(N8nDispatchMessageSchema),  // misma shape que hoy (se renombra DispatchMessageSchema)
   system_commands: z.array(DialogueCommandSchema).default([]), // ej: HumanHandoff(kind=audio, source=code) desde Fastify
   dry_run: z.boolean().default(false),
 });

 export const ActionResultSchema = z.object({
   command_type: z.string(),
   status: z.enum(['sent', 'changed', 'noted', 'scheduled', 'skipped', 'error', 'dry_run']),
   detail: z.record(z.string(), z.unknown()).default({}),
   attempts: z.number().int().default(1),
 });

 export const AgentResponseSchema = z.object({
   turn_id: z.string().uuid(),
   status: z.enum(['completed', 'interrupted', 'failed', 'dry_run']),
   commands: z.array(DialogueCommandSchema),       // LLM + system + flows, en orden de ejecución
   action_results: z.array(ActionResultSchema),
   response_texts: z.array(z.string()),            // lo enviado (o lo que se habría enviado en dry_run)
   final_stage: z.string(),
   dialogue_state: DialogueStateSchema,            // snapshot post-turno (para shadow diff)
   interrupt: z.object({ reason: z.string(), notification_id: z.string().uuid() }).optional(),
   metrics: z.object({
     model: z.string().nullable(), input_tokens: z.number().int().nullable(),
     output_tokens: z.number().int().nullable(), llm_ms: z.number().int().nullable(),
     total_ms: z.number().int(),
   }),
 });
 export type AgentResponse = z.infer<typeof AgentResponseSchema>;

 ▎ Contrato mínimo a propósito: el agente recarga tenant/subscriber/etapa desde DB en
 ▎ assembleContext (una sola fuente de verdad) en vez de recibir snapshots del worker.

 2.5 Traducción de QC: TRANSITION_MACROS + stages.md → flow_definitions JSONB

 Cuatro filas (seed packages/db/src/seeds/flows-qc.json):

 { "flow_id": "qc_cascade_a_ms", "name": "Cascada A→MS: audio + VSL y avance a B",
   "trigger": { "type": "stage_transition", "from": "A", "to": "MS" },
   "steps": [
     { "id": "s1", "type": "action", "action": "send_content",
       "config": { "slug_id": "QC_MS_AUDIO_se envia antes de la vsl", "lookup_stage": "MS" } },
     { "id": "s2", "type": "action", "action": "send_content",
       "config": { "slug_id": "QC_MS_VIDEO_vsl que demuestra resultados", "lookup_stage": "MS" } },
     { "id": "s3", "type": "action", "action": "change_stage",
       "config": { "to_stage": "B", "reason": null, "evidence": "auto: contenido core entregado tras señal positiva", "cascade": false } }
   ] }

 { "flow_id": "qc_cascade_ms_b", "name": "Cascada MS→B: reenvío de audio + VSL",
   "trigger": { "type": "stage_transition", "from": "MS", "to": "B" },
   "steps": [
     { "id": "s1", "type": "action", "action": "send_content",
       "config": { "slug_id": "QC_MS_AUDIO_se envia antes de la vsl", "lookup_stage": "MS" } },
     { "id": "s2", "type": "action", "action": "send_content",
       "config": { "slug_id": "QC_MS_VIDEO_vsl que demuestra resultados", "lookup_stage": "MS" } }
   ] }

 { "flow_id": "qc_cascade_b_c", "name": "Cascada B→C: lead_in + link de Calendly",
   "trigger": { "type": "stage_transition", "from": "B", "to": "C" },
   "steps": [
     { "id": "s1", "type": "action", "action": "reply_text",
       "config": { "template": "{lead_in} {tenant.calendly_url}",
                   "fallback": "Aquí tienes, elige el horario que te venga: {tenant.calendly_url}" } }
   ] }

 { "flow_id": "qc_farewell_disqualified", "name": "Despedida al descalificar",
   "trigger": { "type": "stage_transition", "from": "*", "to": "disqualified" },
   "steps": [
     { "id": "s1", "type": "action", "action": "reply_text",
       "config": { "template": "{lead_in}", "fallback": "Vale, no es tu momento. Éxitos." } }
   ] }

 Notas de mapeo:
 - lookup_stage deja de ser un campo del Router y pasa a config del handler send_content
 (resuelve slug→flow_ns contra stage_flows de ese stage, con variantes colapsadas).
 - El agentTriggeredMacro del Router (evitar macros recursivas) se vuelve regla del motor:
 change_stage con cascade:false (default en steps de flow) no re-dispara trigger flows.
 El ChangeStage del LLM lleva cascade:true.
 - Las 4 macros X->disqualified colapsan en una sola fila con from: "*" (mejora directa).
 - VALID_TRANSITIONS no se traduce a flows: ya vive en stage_transitions_map (datos). Las
 razones de descalificación se mueven a tenant.config.disqualification_reasons: string[].

 2.6 Traducción del Bufete sintético

 Etapas/transiciones/razones = filas en funnel_stages, stage_transitions_map y
 tenant.config.disqualification_reasons (cero código). Flows (seed flows-bufete.json):

 { "flow_id": "bg_intake", "name": "Intake del caso",
   "trigger": { "type": "llm", "description": "El lead describe un asunto legal y quiere asesoría" },
   "slots": [
     { "name": "materia", "type": "option", "options": ["penal", "laboral", "civil", "familiar"] },
     { "name": "contraparte", "type": "text", "description": "Persona o empresa contra quien sería el asunto" },
     { "name": "jurisdiccion", "type": "text" }
   ],
   "steps": [
     { "id": "s1", "type": "collect", "slot": "materia",
       "prompt_hint": "Pregunte formalmente, de usted, qué tipo de asunto legal desea consultar" },
     { "id": "s2", "type": "collect", "slot": "jurisdiccion",
       "prompt_hint": "Pregunte en qué ciudad o jurisdicción ocurre el asunto" },
     { "id": "s3", "type": "branch",
       "cases": [ { "when": { "slot": "jurisdiccion_valida", "op": "eq", "value": false }, "next": "s4" } ],
       "default": "s5" },
     { "id": "s4", "type": "action", "action": "change_stage",
       "config": { "to_stage": "disqualified", "reason": "jurisdicción_equivocada", "evidence": "auto: fuera de jurisdicción" } },
     { "id": "s5", "type": "collect", "slot": "contraparte",
       "prompt_hint": "Pregunte contra quién sería el asunto (nombre completo o razón social)" },
     { "id": "s6", "type": "action", "action": "change_stage",
       "config": { "to_stage": "conflict_check", "reason": null, "evidence": "auto: intake completo", "cascade": true } }
   ] }

 { "flow_id": "bg_cascade_conflict_check", "name": "Cascada intake→conflict_check: verificación de conflictos",
   "trigger": { "type": "stage_transition", "from": "intake", "to": "conflict_check" },
   "steps": [
     { "id": "s1", "type": "action", "action": "http_request", "save_as": "conflict_result",
       "config": { "connector": "check_conflicts", "method": "POST",
                   "url_ref": "connectors.check_conflicts.url",
                   "body": { "contraparte": "{slots.contraparte}", "materia": "{slots.materia}" } },
       "on_failure": "handoff" },
     { "id": "s2", "type": "branch",
       "cases": [ { "when": { "slot": "conflict_result.has_conflict", "op": "eq", "value": true }, "next": "s3" } ],
       "default": "s4" },
     { "id": "s3", "type": "action", "action": "change_stage",
       "config": { "to_stage": "disqualified", "reason": "conflicto_de_interés", "evidence": "auto: conflicto detectado" } },
     { "id": "s4", "type": "action", "action": "reply_text",
       "config": { "template": "Hemos completado la verificación. Podemos proceder a agendar su consulta inicial." } }
   ] }

 El PDF de presentación = stage_flows con un grupo de 1 variante (el mecanismo ponderado
 degrada solo). Keywords ("demanda", "urgente", "plazo vence") = tenant.config.notification_keywords.
 Agenda propia = config del conector en tenant.config.connectors.scheduling (action reply_text
 con {tenant.connectors.scheduling.url}). Persona formal = bloque de persona en DB.

 Fugas detectadas en el ejercicio (y cómo se resuelven):
 1. "espera resultado" del conector — se modela síncrono (http_request con timeout dentro
 del turno). Si el caso real fuera asíncrono (resultado por webhook horas después), el
 vocabulario necesitaría un step wait — no se agrega ahora; regla del ADR: se extiende
 solo cuando un caso real lo exija dos veces.
 2. Validación de jurisdicción (jurisdiccion_valida) — alguien tiene que derivar ese boolean.
 Lo deriva el LLM vía SetSlot guiado por la persona ("jurisdicciones atendidas: Madrid,
 Barcelona") — es política en datos, no código. Documentado como patrón "slot derivado".
 3. Ninguna pieza del Bufete requirió un tipo de step ni de comando nuevo → el vocabulario
 pasa el test de agnosticidad en papel.

 ---
 3. Migración de base de datos

 packages/db/src/schema.ts (mismo pgSchema('api')), luego pnpm db:generate (revisar el SQL
 generado — gotcha conocido del journal con 0003/0004) y make migrate.

 // flow_definitions — flows declarativos versionados por tenant (ADR-0024)
 export const flowDefinitions = apiSchema.table('flow_definitions', {
   id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
   tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
   flowId: text('flow_id').notNull(),
   version: integer('version').notNull().default(1),
   definition: jsonb('definition').notNull(),        // FlowDefinitionSchema — Zod-parse al leer y al escribir
   active: boolean('active').notNull().default(false),
   createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
 }, (t) => ({
   tenantFlowVersionUnique: uniqueIndex('flow_definitions_tenant_flow_version_unique')
     .on(t.tenantId, t.flowId, t.version),
   oneActivePerFlow: uniqueIndex('flow_definitions_one_active_unique')
     .on(t.tenantId, t.flowId).where(sql`active = true`),
 }));

 // dialogue_states — UN estado de diálogo por conversación (la fuente de verdad)
 export const dialogueStates = apiSchema.table('dialogue_states', {
   conversationId: uuid('conversation_id').primaryKey().references(() => conversations.id, { onDelete: 'cascade' }),
   tenantId: uuid('tenant_id').notNull(),
   stack: jsonb('stack').notNull().default(sql`'[]'::jsonb`),       // FlowFrame[]
   slots: jsonb('slots').notNull().default(sql`'{}'::jsonb`),
   repairContext: jsonb('repair_context'),
   lastTurnId: uuid('last_turn_id'),
   updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
 }, (t) => ({ tenantIdx: index('dialogue_states_tenant_idx').on(t.tenantId) }));

 // domain_events — outbox mínimo (lead.stage_changed, conversation.escalated, content.sent, ...)
 export const domainEvents = apiSchema.table('domain_events', {
   id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
   tenantId: uuid('tenant_id').notNull(),
   type: text('type').notNull(),
   payload: jsonb('payload').notNull(),
   turnId: uuid('turn_id'),
   createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
   processedAt: timestamp('processed_at', { withTimezone: true }),
 }, (t) => ({ typeIdx: index('domain_events_tenant_type_idx').on(t.tenantId, t.type, t.createdAt) }));

 // agent_shadow_runs — resultados dry-run del agente en Fase 3 (se puede dropear tras cutover)
 export const agentShadowRuns = apiSchema.table('agent_shadow_runs', {
   turnId: uuid('turn_id').primaryKey(),
   tenantId: uuid('tenant_id').notNull(),
   commands: jsonb('commands').notNull(),
   responseTexts: jsonb('response_texts').notNull(),
   finalStage: text('final_stage'),
   dialogueState: jsonb('dialogue_state'),
   error: text('error'),
   durationMs: integer('duration_ms'),
   createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
 });

 Decisión: dialogue_states propia + checkpoint LangGraph con roles separados

 dialogue_states es la fuente de verdad durable. El checkpoint de LangGraph es scratch
 efímero, solo para turnos suspendidos por interrupt(). Argumentos:

 1. No repetir n8n_chat_histories: el checkpoint serializa el estado del grafo en formato
 interno de LangChain — opaco, versionado por la librería, ilegible desde SQL. Hacerlo
 fuente de verdad sería recrear exactamente "la memoria en formato interno de otra
 herramienta" que este ADR mata.
 2. Lectores externos: dashboard /settings (Kanban, editor de slots), queries de ops y el
 harness de replay necesitan leer stack/slots con SQL plano.
 3. Regla de oro del runtime: si mañana se cambia LangGraph por otra cosa, los flows y el
 estado sobreviven intactos.
 4. No hay duplicación real: el grafo se invoca por turno; assembleContext carga
 dialogue_states al inicio y respond lo persiste al final. El checkpoint solo existe
 entre interrupt() y resume (handoff humano — minutos u horas). Al completar un turno
 normal, run-turn.ts borra el thread del checkpointer (deleteThread). Un solo estado.

 El PostgresSaver corre con un Pool de pg dedicado (max 3 conexiones, mismo
 DATABASE_URL), tablas en schema langgraph (parámetro del saver) para no mezclar con api.
 checkpointer.setup() se invoca desde un script one-shot junto a make migrate.

 ---
 4. Fase 2 — Implementación de apps/agent (1-1.5 semanas)

 Grafo (en build-graph.ts):

 assemble_context → understand → flow_engine → execute_actions → respond
                        ▲              │  ▲           │
                        │       interrupt()  └────────┘  (loop si un action result
                   (skip si solo                          tiene save_as y el flow
                    system_commands)                      sigue con branch/steps)

 thread_id = conversation_id. Edge condicional execute_actions → flow_engine cuando el
 flow activo quedó esperando un resultado (save_as); en QC nunca loopea (cascadas lineales),
 en el Bufete loopea una vez (conflict check).

 assembleContext (graph/nodes/assemble-context.ts + core/context/assemble.ts)

 - Carga (en services/context-queries.ts, queries Drizzle tipadas, todas con tenant_id):
 tenant + parseTenantConfig; subscriber + lead_stages; funnel_stages (goal,
 valid_next_stages) + stage_transitions_map (when_to_use); stage_flows de TODOS los
 stages (catálogo para lookup_stage); historial lead_content_sent agregado por slug;
 notifications recientes (handoff_state); lead_crons + lead_followup_log (followups
 sent/max/history); dialogue_states (o estado inicial vacío); transcript: últimos N
 mensajes de messages_raw (in + out) — los [SEGUIMIENTO AUTOMÁTICO #N] ya están ahí
 como direction out a partir de Fase 5; mientras tanto se anexan desde lead_followup_log.
 - Port de Build Context v6 como función pura: assembleContext(data, { rng, now }) →
 AssembledContext (mismo shape del contextJson actual + dialogue_state + transcript).
 pickWeighted y collapseVariantGroups van a core/context/weighted.ts con RNG
 inyectable (en tests, determinista; en replay, seeded).
 - Tests unitarios prioritarios (test(agent):):
   a. El bug de variantes v5: grupo con v1/v2, sentMap solo tiene v2 → la opción colapsada
 debe reportar times_sent: 1 y last_sent de v2 (regresión del bug que hacía reenviar).
   b. pickWeighted: distribución respeta pesos (RNG fijo), casos degenerados (array vacío →
 null, un elemento, weights 0/undefined → tratados como 1).
   c. collapseVariantGroups: singletons pasan directo; grupo de 1 variante degrada (caso Bufete).
   d. buildHandoffState: pending → open_escalations, resolved → human_handled, vacío → null.
   e. Placeholders por content_class idénticos a mediaPlaceholder() de shared (se importa,
 no se duplica — adiós al "espejo" copy-paste).

 understand (graph/nodes/understand.ts + core/llm/)

 - Prompt en dos bloques (por fin separados):
   - Esqueleto de plataforma (core/llm/prompt.ts, versionado en el repo, igual para todos
 los tenants): cómo emitir comandos del vocabulario, semántica de cada uno, regla
 anti-silencio, reglas de repair (handoff_state abierto → pedir texto, no re-escalar;
 human_handled → reconocer continuidad; continue_interrupted → retomar el flow
 apilado), contrato de content_options/valid_transitions, prohibición de inventar
 slugs/etapas.
   - Bloque de persona del tenant: nueva clave tenant.config.persona_prompt (editable en
 /settings). Para QC se extrae del prompt vivo pegado por el founder (ROL Alex, tono
 seco, cero emojis, manejo de objeciones, ejemplos, restricciones de negocio) casi literal
 — minimizar la regresión conductual. Las partes mecánicas del prompt vivo (formato JSON,
 cascadas, lista de campos del contexto) NO van en la persona: las cubre el esqueleto.
 - Structured output: @anthropic-ai/sdk, modelo tenant.config.model ?? 'claude-sonnet-4-6',
 un solo tool emit_plan con input_schema = zodToJsonSchema(LlmPlanSchema) y
 tool_choice: { type: 'tool', name: 'emit_plan' }. Prompt caching (cache_control) sobre
 esqueleto + persona (estables por tenant).
 - Validación del vocabulario cerrado: LlmPlanSchema.safeParse(toolInput). Si falla →
 1 reintento anexando los issues de Zod al mensaje. Si vuelve a fallar → repair_context = cannot_handle + comando Clarify de cortesía (en shadow:
 se loggea como error de paridad).
 - Skip: si TurnInput.trigger.source === 'system_event' y solo hay system_commands
 deterministas (ej. handoff por audio sin batch de texto), el nodo no llama al LLM.

 flowEngine (graph/nodes/flow-engine.ts + core/flow-engine/engine.ts)

 Firma del intérprete (TS puro, sin IO — el IP del producto):

 export interface FlowEngineInput {
   state: DialogueState;
   commands: DialogueCommand[];          // LLM + system_commands, en orden
   flows: Map<string, { version: number; def: FlowDefinition }>;  // activos del tenant
   transitions: TransitionRule[];        // de stage_transitions_map
   currentStage: string;
 }
 export interface FlowEngineResult {
   state: DialogueState;                                  // nuevo estado (inmutable)
   invocations: ActionInvocation[];                       // para executeActions
   pendingCollect: { slot: string; prompt_hint: string } | null; // el flow espera dato del lead
   interrupt: { reason: string; kind: string; summary?: string } | null;
 }
 export function advanceDialogue(input: FlowEngineInput): FlowEngineResult;

 - Algoritmo del stack LIFO: (1) procesar comandos en orden — SetSlot muta slots,
 StartFlow push frame (si ya hay frame activo, marca interrupted_at del anterior),
 CancelFlow pop, ChangeStage valida contra transitions y, si cascade, push del
 trigger-flow from->to (match exacto primero, luego *->to); ReplyText/SendContent
 pasan directo a invocations. (2) correr el frame del top: ejecutar steps en secuencia —
 action emite invocation (si tiene save_as, el motor queda en ese step esperando el
 loop de resultados), branch evalúa conditions.ts sobre slots, link reemplaza el
 frame, collect con slot vacío corta y devuelve pendingCollect (el flow queda apilado
 hasta el próximo turno). (3) al completar el último step → pop; si el frame de abajo tiene
 interrupted_at → repair_context = continue_interrupted (el próximo prompt le dice al
 LLM que retome — la regla 8 muere como parche y nace como patrón).
 - Comandos sin LLM desde Fastify: la detección determinista de webhook-manychat.ts
 (audio, keywords, media_policy) deja de insertar notifications directamente y pasa
 system_commands: [{ type: 'HumanHandoff', kind: 'audio', source: 'code', ... }] en el
 TurnInput — entra al mismo motor que los comandos del LLM. Un solo camino de escalado.
 - interrupt() para HumanHandoff (en el wrapper, no en el core): cuando
 result.interrupt != null, el nodo (1) persiste la notification (reusa
 services/notifications + encola NOTIFY_QUEUE → Telegram), (2) persiste dialogue_states
 con repair_context = human_handoff, y (3) llama interrupt({ reason, conversationId, notificationId }) → el checkpoint congela el grafo. Resume:
 el camino existente de
 resolución (dashboard/Telegram → notification resolved con nota) llama
 resumeConversation(conversationId, { note }) → graph.invoke(new Command({ resume: { note } }), { configurable: { thread_id } }); el motor pasa
 repair_context a
 continue_interrupted con la nota en payload y el turno continúa hasta respond.

 executeActions (graph/nodes/execute-actions.ts + actions/)

 export interface ActionContext {
   tenant: Tenant; tenantConfig: TenantConfig;
   subscriber: Subscriber; conversationId: string; turnId: string;
   channel: ChannelAdapter;            // ManyChat hoy; el puerto para web chat mañana
   db: DbClient; log: Logger; dryRun: boolean;
   stageCatalog: StageCatalog;         // stage_flows colapsados por stage (para lookup)
 }
 export interface ActionHandler {
   readonly type: string;
   readonly configSchema: z.ZodTypeAny;  // valida el config del step al cargar el flow
   execute(invocation: ActionInvocation, ctx: ActionContext): Promise<ActionResult>;
 }

 - Registry: Map<string, ActionHandler> poblado en registry.ts con los 6 handlers.
 Agregar una action = un archivo + una línea de registro = un PR normal.
 - Adapter ManyChat (channel/manychat.ts): port directo de callManychatFlow /
 callManychatText del Router v4.5 — fetch + AbortSignal.timeout(30_000), withRetry
 con delays [500, 1500] y los mismos códigos retriables. En dryRun no llama la red:
 retorna status: 'dry_run' con el payload que habría enviado.
 - change_stage sin fugas: el handler valida contra stage_transitions_map +
 funnel_stages.valid_next_stages (datos), razones contra
 tenant.config.disqualification_reasons, hace upsertLeadStage + createStageTransition
   - archivado de lead_crons (la lógica de set-stage.ts se extrae a una función
 applyStageTransition() en apps/agent/src/actions/handlers/change-stage.ts; la ruta
 set-stage.ts se refactoriza en Fase 2 para leer las mismas tablas — la fuga muere en
 ambos caminos antes del cutover). Emite lead.stage_changed.
 - Eventos de dominio: emitDomainEvent(db, { type, payload, turnId }) → insert en
 domain_events. Tipos en Fase 2: lead.stage_changed, conversation.escalated,
 content.sent, lead.disqualified. Sin consumidor todavía (outbox para CRM/dashboard).

 respond (graph/nodes/respond.ts)

 - Persiste: turns (status completed, response_text = join de textos enviados,
 tokens/costo/modelo/prompt_version/duration_ms — mismas columnas que llena hoy
 turn-completed); cada texto/contenido saliente como fila en messages_raw
 (direction='out', payload = ActionResult); lead_content_sent para los send_content
 exitosos (reemplaza al nodo If/Lead Content Sent de n8n); dialogue_states (upsert
 con el estado final); touchBotMsg.
 - Limpia el thread del checkpointer si el turno terminó sin interrupt.
 - No toca el lock — retorna AgentResponse y el worker libera en finally.

 ---
 5. Integración con el worker existente

 Nuevo apps/api/src/services/dispatch-agent.ts:

 import { runTurn } from '@dm-api/agent';
 import type { AgentResponse, TurnInput } from '@dm-api/shared';

 export async function dispatchToAgent(opts: { input: TurnInput; log: Logger }): Promise<AgentResponse> {
   const res = await runTurn(opts.input);
   opts.log.info({ turn_id: res.turn_id, status: res.status, final_stage: res.final_stage }, 'agent turn done');
   return res;
 }

 Diff de apps/api/src/workers/process-batch.ts (paso 6 — el resto del job no cambia):

      // 6. Dispatch
      const leadStage = await getLeadStage(getDb(), { tenantId, subscriberId });
 +    const engine = tenantConfig.engine ?? 'n8n';
 +
 +    const turnInput: TurnInput = {
 +      schema_version: 'v1',
 +      turn_id: turn.id, tenant_id: tenantId, subscriber_id: subscriberId,
 +      conversation_id: conversation.id,
 +      trigger: { source: 'lead_message', channel: subscriber.currentChannel ?? 'instagram' },
 +      messages, system_commands: systemCommands,   // ver §4 flowEngine: escalado determinista
 +      dry_run: false,
 +    };
 +
 +    if (engine === 'agent') {
 +      try {
 +        const res = await dispatchToAgent({ input: turnInput, log });
 +        if (res.status === 'failed') throw new Error(`agent turn failed: ${res.turn_id}`);
 +        return { status: 'dispatched', turn_id: turn.id, batch_size: messages.length };
 +      } catch (err) {
 +        await markTurnFailed(getDb(), { turnId: turn.id, error: String(err) });
 +        throw err;                       // BullMQ reintenta con backoff
 +      } finally {
 +        // La clase de bugs "el lock nunca se libera" muere aquí, por diseño.
 +        await releaseTurnLock(getRedis(), { tenantId, subscriberId, turnId });
 +      }
 +    }
 +
 +    // engine === 'n8n' (camino actual, intacto: el lock lo libera turn-completed)
      const { flows_by_stage: _removed, ...configForN8n } = tenantConfig as Record<string, unknown>;
      const dispatchPayload: N8nDispatchPayload = { /* ... sin cambios ... */ };
      try {
        const dispatchResult = await dispatchToN8n({ workflowUrl, payload: dispatchPayload, log: logger() });
        await markTurnDispatched(getDb(), { turnId: turn.id, n8nExecutionId: dispatchResult.executionId });
 +
 +      // Shadow mode (Fase 3): el agente corre en dry-run SIN bloquear el turno real.
 +      if (tenantConfig.shadow_agent === true) {
 +        void dispatchToAgent({ input: { ...turnInput, dry_run: true }, log })
 +          .then((res) => saveShadowRun(getDb(), turn.id, res))
 +          .catch((err) => log.error({ err, turn_id: turn.id }, 'shadow agent run failed'));
 +      }
        return { status: 'dispatched', turn_id: turn.id, batch_size: messages.length };

 TenantConfigSchema (shared) suma:

 engine: z.enum(['n8n', 'agent']).optional(),        // default 'n8n' — el flag de cutover por tenant
 shadow_agent: z.boolean().optional(),
 persona_prompt: z.string().optional(),
 disqualification_reasons: z.array(z.string()).optional(),
 connectors: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),

 config.ts de la API suma ANTHROPIC_API_KEY: z.string().min(1) (+ .env.example y
 docker-stack.yml env del servicio dm-api-worker). En Fase 4 (cutover QC) mueren del camino
 nuevo: turn-completed.ts, dispatch-n8n.ts, watchdog ADR-0017, callback_url/callback_token.

 ▎ Nota de capacidad: con engine='agent' el job retiene un worker BullMQ durante el turno
 ▎ LLM (~5-20 s). WORKER_CONCURRENCY=10 da margen de sobra al volumen actual;
 ▎ LOCK_TTL_MS=90s > presupuesto de turno (timeout duro del agente: 60 s).

 ---
 6. Fase 3 — Shadow mode (3-5 días con tráfico real)

 - Activación: UPDATE api.tenants SET config = config || '{"shadow_agent": true}' para QC.
 n8n sigue respondiendo al lead; el agente corre dry-run en paralelo (fire-and-forget).
 - Qué se loggea/persiste (agent_shadow_runs, una fila por turno): commands emitidos
 (con reasoning), flow path tomado (dialogue_state.stack + steps ejecutados en
 action_results), response_texts, final_stage, error si lo hubo, duración. El diff
 contra n8n se computa con SQL: join agent_shadow_runs ⨝ turns (response_text del camino
 real) ⨝ stage_transitions del turno (transición real). Query de paridad versionada en
 apps/agent/scripts/parity-report.sql.
 - Replay/eval con messages_raw: script apps/agent/scripts/replay.ts — toma un
 subscriber (o un export), reconstruye los batches por turno desde messages_raw +
 turns.batch_message_ids, y los re-ejecuta con dry_run: true, RNG seeded y clock
 congelado al started_at original. Sirve como dataset de regresión del prompt: se corre
 tras cada ajuste de persona/esqueleto (conecta con 12_SUCCESS_METRICS_AND_EVAL).
 - Criterio de paridad para cutover (sobre ≥200 turnos o 5 días, lo que sea mayor):
   a. 100% de las transiciones de etapa coinciden (misma transición o ambos sin transición)
 — divergencia de etapa = bug, sin excepciones.
   b. ≥90% de turnos con acción de negocio equivalente (mismo grupo de contenido enviado;
 variante puede diferir por el RNG).
   c. Texto libre: revisión humana muestral de 30 turnos divergentes; cero violaciones de
 restricciones duras (emojis, precio, admisión de IA).
   d. Cero failed del agente por errores de plataforma en los últimos 3 días.

 ---
 7. Riesgos técnicos reales

 #: R1
 Riesgo: Regresión conversacional de Alex — el prompt vivo v8 + Claude en n8n está calibrado; partir el prompt y cambiar el formato de salida
   (actions→commands) puede mover el comportamiento
 Prob.: A
 Impacto: Alto (es el producto en prod)
 Mitigación concreta: Persona extraída casi literal del prompt vivo; mapeo 1:1 send_content/change_stage/reply_text → comandos homónimos; shadow
   mode obligatorio con criterio §6; replay de transcripts reales tras cada ajuste; cutover reversible con un UPDATE (engine='n8n')
 ────────────────────────────────────────
 #: R2
 Riesgo: checkpoint-postgres usa pg, Drizzle usa postgres.js — no comparten pool
 Prob.: A (certeza)
 Impacto: Bajo
 Mitigación concreta: Pool pg dedicado max 3 conexiones (+3 sobre las 10 de postgres.js — Postgres 16 lo absorbe); tablas en schema langgraph; el
   checkpoint solo vive en turnos suspendidos (uso bajísimo). Plan B si molesta: CheckpointSaver propio sobre postgres.js (~150 líneas, interfaz
   pública estable)
 ────────────────────────────────────────
 #: R3
 Riesgo: Inner-platform creep del vocabulario — la tentación de agregar steps (wait, loop, js_eval)
 Prob.: M
 Impacto: Alto a largo plazo
 Mitigación concreta: Regla escrita en el doc del motor: nuevo step/comando solo con 2 casos reales que lo exijan; conditions.ts cerrado a 7
   operadores; PR que toque flow.ts requiere actualizar el test de agnosticidad del Bufete
 ────────────────────────────────────────
 #: R4
 Riesgo: Migración de n8n_chat_histories — formato interno LangChain, y los envíos del bot vía flows ManyChat no están en messages_raw
 Prob.: M
 Impacto: Medio
 Mitigación concreta: No se parsea el formato LangChain. El transcript se reconstruye de messages_raw (in) + turns.response_text (out histórico);
   el contenido enviado ya está en lead_content_sent; el estado inicial de dialogue_states para leads vivos se sintetiza de lead_stages +
   lead_content_sent (script one-shot en el cutover). Pérdida aceptada: matices de texto del bot pre-cutover más allá de response_text
 ────────────────────────────────────────
 #: R5
 Riesgo: La lección del "Maximum call stack" del Router — estado con proxies/objetos no serializables rompiendo el runtime
 Prob.: B
 Impacto: Medio
 Mitigación concreta: Todo lo que entra/sale de un nodo del grafo pasa por Zod parse (garantiza plain JSON); el core es puro y retorna objetos
   nuevos; test de serialización round-trip del DialogueState; nada de pasar instancias (db, logger) por el state del grafo — van por closure/deps
 ────────────────────────────────────────
 #: R6
 Riesgo: Turno síncrono largo dentro del worker — LLM lento agota LOCK_TTL_MS (90s) o reintentos de Anthropic apilan jobs
 Prob.: M
 Impacto: Medio
 Mitigación concreta: Timeout duro de 60 s en runTurn (AbortSignal) < LOCK_TTL; sin retry interno de red en el SDK más allá del default; si el
   turno falla, markTurnFailed + lock liberado en finally → el post-lock drain recupera; métrica total_ms en cada AgentResponse para vigilar p95
 en
    shadow

 ---
 8. Checklist de done por fase (binario)

 Fase 0 — congelar (ya en curso, fuera de este plan)
 - [ ] ADR-0023 aplicado en la UI de n8n (los 4 nodos) y verificado con un turno real
 - [ ] Freeze declarado: ningún feature nuevo en agent-run/n8n, solo hotfixes

 Fase 1 — contratos (2-3 días)
 - [ ] packages/shared/src/schemas/dialogue/ compila con strict y exporta los 7 contratos
 - [ ] Migración con flow_definitions, dialogue_states, domain_events, agent_shadow_runs aplicada en dev
 - [ ] Los 4 flows de QC (seeds) pasan FlowDefinitionSchema.parse() y un test los compara contra TRANSITION_MACROS acción por acción
 - [ ] Los flows del Bufete sintético validan contra el mismo schema sin ningún tipo de step/comando nuevo ni código tenant-specific (el test de
 agnosticidad, en CI)
 - [ ] CI verde (lint + typecheck + build + test)

 Fase 2 — apps/agent (1-1.5 semanas)
 - [ ] pnpm --filter @dm-api/agent test verde con el core (engine, weighted, conditions, repair) testeado sin instanciar LangGraph
 - [ ] El test del bug de variantes v5 existe y pasa
 - [ ] Turno end-to-end en dev: mensaje → runTurn → respuesta en ManyChat sandbox + filas en turns/messages_raw/dialogue_states
 - [ ] Cascada A→MS ejecuta audio+VSL+avance a B leyendo flow_definitions (no hardcode)
 - [ ] HumanHandoff suspende con interrupt(), notifica Telegram, y resumeConversation retoma el turno
 - [ ] set-stage.ts refactorizado a transiciones data-driven (la fuga cerrada también en el camino viejo)
 - [ ] make rebuild-api despliega el worker con el agente embebido sin servicio nuevo

 Fase 3 — shadow (3-5 días de tráfico)
 - [ ] shadow_agent: true en QC y agent_shadow_runs poblándose con tráfico real
 - [ ] parity-report.sql corre y reporta los 4 criterios de §6
 - [ ] replay.ts reproduce ≥3 conversaciones históricas completas en dry-run
 - [ ] Criterios de paridad de §6 cumplidos 3 días consecutivos

 Fase 4 — cutover QC
 - [ ] engine: 'agent' en QC; n8n agent-run desactivado pero no borrado (fallback frío 1 semana)
 - [ ] Script one-shot de dialogue_states inicial para leads vivos ejecutado
 - [ ] 1 semana sin rollback → archivar workflow n8n, borrar turn-completed/dispatch-n8n/watchdog, ADR-0009 y 0017 marcados superseded

 ---
 Decisión abierta restante para el founder (1)

 - Umbral de paridad del criterio §6.2 (propuesto: ≥90% de equivalencia de acciones de
 negocio). Es una decisión de apetito de riesgo comercial, no técnica — se puede ratificar
 durante la Fase 3 viendo los primeros reportes.

 Verificación del plan (cómo se prueba cada entrega)

 - Fase 1: pnpm lint && pnpm typecheck && pnpm test (los fixtures QC/Bufete son tests);
 make migrate en dev y \d api.flow_definitions en psql.
 - Fase 2: suite vitest del core; turno e2e contra un subscriber de prueba del tenant dev
 (make seed-tenant); verificación manual del interrupt/resume vía el botón de resolución
 del dashboard.
 - Fase 3: parity-report.sql + revisión muestral; replay.ts como regresión.

 Archivos críticos

 ┌───────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │      Acción       │                                                          Path                                                          │
 ├───────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Crear             │ packages/shared/src/schemas/dialogue/{commands,flow,state,turn,index}.ts                                               │
 ├───────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Crear             │ apps/agent/** (árbol §1)                                                                                               │
 ├───────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Crear             │ apps/api/src/services/dispatch-agent.ts                                                                                │
 ├───────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Modificar         │ packages/db/src/schema.ts + migración generada                                                                         │
 ├───────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Modificar         │ apps/api/src/workers/process-batch.ts (diff §5)                                                                        │
 ├───────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Modificar         │ packages/shared/src/schemas/tenant-config.ts, apps/api/src/config.ts, .env.example, docker-stack.yml                   │
 │                   │ (ANTHROPIC_API_KEY)                                                                                                    │
 ├───────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Modificar (Fase   │ apps/api/src/routes/admin/set-stage.ts (transiciones data-driven)                                                      │
 │ 2)                │                                                                                                                        │
 ├───────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Modificar (Fase   │ apps/api/src/routes/webhook-manychat.ts (escalado determinista → system_commands)                                      │
 │ 2)                │                                                                                                                        │
 ├───────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Eliminar (Fase 4) │ apps/api/src/routes/admin/turn-completed.ts, apps/api/src/services/dispatch-n8n.ts                                     │
 └───────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
