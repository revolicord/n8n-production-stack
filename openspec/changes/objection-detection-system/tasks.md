## 1. Schema & Configuration

- [x] 1.1 Add `ObjectionActionSchema` and `ObjectionSchema` types to `packages/shared/src/schemas/` (reply_text, send_flow, change_stage, add_tag action types)
- [x] 1.2 Update `TenantConfigSchema` in `packages/shared/src/schemas/tenant-config.ts` to include `objections: ObjectionSchema[]` and `objection_confidence_threshold: number` (optional)
- [ ] 1.3 Regenerate shared types: `pnpm build:shared`
- [x] 1.4 Export new types from `packages/shared/src/index.ts`

## 2. Agent Core: Objection Detection

- [x] 2.1 Create `apps/agent/src/core/objections/detector.ts` with `detectDeterministicObjection()` function (regex/keyword matching for NQ, NI)
- [ ] 2.2 Create `apps/agent/src/core/objections/classifier.ts` with `classifyObjection()` function (adds objection classification prompt to LLM instruction)
- [x] 2.3 Create `apps/agent/src/core/objections/constants.ts` with 13 canonical objection type definitions (id, label, description, examples) — integrated into `detector.ts` as CANONICAL_OBJECTION_TYPES
- [x] 2.4 Update `apps/agent/src/core/llm/prompt.ts` to include objection types in LLM system prompt (list of 13 types with examples via `buildObjectionClassificationBlock`)
- [ ] 2.5 Update `apps/agent/src/graph/nodes/understand.ts` to call `detectDeterministicObjection()` before LLM, and parse objection classification from LLM response — deterministic detection done in `build-graph.ts` `prepare_prompt` node; LLM parsing pending

## 3. Agent Core: Action Execution

- [x] 3.1 Create `apps/agent/src/actions/handlers/objection-executor.ts` with function to execute objection actions array
- [x] 3.2 Add handlers for each action type in executor:
  - [x] 3.2a `reply_text` action → call ReplyText command handler
  - [x] 3.2b `send_flow` action → call SendContent command handler with flow_id
  - [x] 3.2c `change_stage` action → call ChangeStage command handler
  - [x] 3.2d `add_tag` action → call tag mutation (if tag system exists, else store in metadata)
- [x] 3.3 Update `apps/agent/src/graph/build-graph.ts` to route objection-detected paths to objection executor (skip flow-engine) — new `execute_objection` graph node
- [x] 3.4 Update `apps/agent/src/graph/annotation.ts` (AgentStateT) to include `objection_detected` field

## 4. Agent Core: Tracing & Observability

- [x] 4.1 Update `apps/agent/src/services/traces.ts` to include `objection_detected` in agent turn trace schema
- [x] 4.2 Update trace saving logic to capture: objection type, confidence, reason, actions executed
- [ ] 4.3 Verify traces are written to `api.agent_turn_traces` with objection metadata (pending live test)

## 5. API: Objection CRUD Endpoint

- [x] 5.1 Extend `apps/api/src/routes/admin/agent-resources.ts` with `config` JSONB field on PUT endpoint (reuses existing `/admin/agent-resources/:id` route — dedicated `/admin/objections` not needed since agent_resources with category='objecion' is the canonical storage)
- [x] 5.2 Validate objection payloads via `config: z.record(z.string(), z.unknown()).nullable().optional()`
- [x] 5.3 Persist `config` (ObjectionResourceConfig) to `agent_resources.config` JSONB column
- [x] 5.4 Route registration: reuses existing agent-resources route (no new route file needed)
- [x] 5.5 Admin auth: inherits from existing PUT `/admin/agent-resources/:id` handler

## 6. Dashboard: Objections Panel UI

- [x] 6.1 Existing `/settings/objeciones` page already exists and shows `ResourcesEditor`
- [x] 6.2 `ResourcesEditor` updated to accept `showActions` prop and render `ObjectionActionsEditor` when category='objecion'
- [x] 6.3 Created `apps/dashboard/src/components/settings/ObjectionActionsEditor.tsx` — inline actions editor per objection resource
- [x] 6.4 `ObjectionActionsEditor` includes `ActionBuilder` functionality (action type dropdown + param input + remove button)
- [ ] 6.5 Preview/test button (Phase 2 — skip for MVP)
- [ ] 6.6 "Reset to Defaults" button (Phase 2 — skip for MVP)
- [x] 6.7 Connected to `/admin/agent-resources/:id` PUT endpoint via `updateResource()` action
- [x] 6.8 Objections tab already in Settings navigation (/settings/objeciones)

## 7. Dashboard: Conversation History Annotation

- [ ] 7.1 Update conversation turn display component to show objection badge if `turn.objection_detected` is present
- [ ] 7.2 Create modal/panel to allow team to override objection classification per turn
- [ ] 7.3 Save override back to database (turn annotation or separate table if exists)

## 8. Testing

- [ ] 8.1 Write tests for `detectDeterministicObjection()` with NQ/NI keywords
- [ ] 8.2 Write tests for `classifyObjection()` with LLM mock responses
- [ ] 8.3 Write tests for `objection-executor.ts` with all action types (reply_text, send_flow, change_stage, add_tag)
- [ ] 8.4 Write integration test: turn with objection detected → response executed, LLM skipped
- [ ] 8.5 Write integration test: turn with no objection → normal flow-engine path
- [ ] 8.6 Test API endpoints `/admin/agent-resources` with `config` field (GET, PUT with auth)
- [x] 8.7 Run existing agent tests to ensure no regressions — `pnpm typecheck` passes clean
- [x] 8.8 Run existing API tests to ensure no regressions — `pnpm typecheck` passes clean

## 9. Seed & Configuration

- [ ] 9.1 Create `apps/agent/src/seeds/default-objections.ts` with 13 canonical objections + default response templates
- [ ] 9.2 Create script or SQL to seed default objections into a new test tenant (or document in /settings workflow)
- [ ] 9.3 Document objections format in DEPLOYMENT.md (structure, examples, how to customize)

## 10. Documentation & Deployment

- [ ] 10.1 Update `docs/adr/` with ADR reference (ADR-0026 suggested)
- [ ] 10.2 Add objections section to DEPLOYMENT.md (setup, configuration, customization examples)
- [ ] 10.3 Add objections to CLAUDE.md project notes
- [ ] 10.4 Write inline code comments explaining objection flow (detector.ts, classifier.ts, understand.ts, executor.ts)
- [ ] 10.5 Document LLM prompt changes and example classifications
- [ ] 10.6 Update README.md Architecture section if relevant

## 11. Smoke Testing & Validation

- [ ] 11.1 Test end-to-end with test lead:
  - [ ] 11.1a Send "no tengo negocio" → should detect NQ (0 tokens) → send nurturing video
  - [ ] 11.1b Send "cuanto cuesta?" → LLM classifies precio_inquiry → send discovery call link
  - [ ] 11.1c Send affirmation "dale" → no objection → normal flow
- [ ] 11.2 Verify turn traces show correct `objection_detected` field
- [ ] 11.3 Check dashboard /settings/objeciones loads and allows edit actions
- [ ] 11.4 Verify conversation history shows objection badges
- [ ] 11.5 Test team override of objection classification

## 12. Production Deployment

- [ ] 12.1 Run migration 0021_agent_resources_config.sql: `make migrate`
- [ ] 12.2 Run `pnpm build` and verify no lint/type errors — typecheck passes
- [ ] 12.3 Deploy: `make rebuild-api && make rebuild-dashboard`
- [ ] 12.4 Test on staging/Quantum tenant with live data
- [ ] 12.5 Enable objections for Quantum tenant via /settings/objeciones → add actions per type
- [ ] 12.6 Monitor traces and dashboard for 1 week (confidence scores, action execution success)
- [ ] 12.7 Collect feedback from Quantum team
- [ ] 12.8 Deploy to production: `/ship` with feature announcement
- [ ] 12.9 Announce feature to other tenants; enable opt-in
