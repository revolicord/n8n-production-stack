Plan: Panel de configuración de negocio — multi-tenant sin código

 Contexto

 El sistema actual tiene la lógica de negocio (etapas del funnel, transiciones válidas, cascadas de contenido, razones de descalificación, persona
 del agente) en seeds SQL, JSON hardcodeado y código. Esto significa que cada vez que un cliente nuevo (inmobiliaria, bufete, infoproductor)
 arranca, o cuando el negocio cambia su funnel, hay que llamar al desarrollador.

 La solución: mover toda esa configuración a las tablas que YA existen en Postgres y construir la UI en /settings que las lea y escriba. El
 objetivo es que el dueño del negocio no necesite al desarrollador para cambiar su funnel después de los primeros 2 meses.

 Tablas ya en DB, sin UI: funnel_stages, stage_transitions_map, flow_definitions
 Endpoints que faltan: CRUD para las tres tablas + extensión del PATCH config

 ---
 Migración de DB (única)

 Archivo: packages/db/src/schema.ts
 Agregar a funnelStages:
 isTerminal: boolean('is_terminal').notNull().default(false),

 Luego pnpm db:generate + make migrate. Las etapas terminales (disqualified, lost) no reciben follow-ups — este flag lo hace data-driven en lugar
 del Set(['C','D','disqualified']) hardcodeado en set-stage.ts (línea ~16).

 Cambio derivado en apps/api/src/routes/admin/set-stage.ts: reemplazar el Set hardcodeado por una consulta a funnelStages donde isTerminal = true.

 ---
 Backend — nuevas rutas y extensiones

 1. Extender routes/admin/followups.ts

 UpdateFunnelStageBodySchema — actualmente solo acepta nurture_video_url y call_link. Extender a todos los campos editables:
 display_name, description, goal, max_followups, position, is_active, is_terminal, nurture_video_url, call_link

 Nuevas rutas en el mismo archivo:
 - POST /admin/tenants/:tenantId/funnel-stages — crea etapa; body: { slug, display_name, position, description?, goal?, max_followups?,
 is_terminal? }; 409 DUPLICATE_SLUG en conflicto
 - DELETE /admin/funnel-stages/:stageId — soft delete (isActive = false)

 Servicio: extender apps/api/src/services/followups.ts con createFunnelStage() y deactivateFunnelStage().

 2. Nuevo routes/admin/stage-transitions-map.ts

 Siguiendo el patrón exacto de agent-resources.ts:
 - GET /admin/tenants/:tenantId/stage-transitions — lista (query param ?include_inactive)
 - POST /admin/tenants/:tenantId/stage-transitions — { from_stage_slug, to_stage_slug, when_to_use }; 409 DUPLICATE_FROM_TO
 - PUT /admin/stage-transitions/:id — { when_to_use?, is_active? }
 - DELETE /admin/stage-transitions/:id — soft delete

 Servicio nuevo: apps/api/src/services/stage-transitions-map.ts — 4 funciones Drizzle puras.

 3. Nuevo routes/admin/flow-definitions.ts

 Punto crítico: cada write valida definition contra FlowDefinitionSchema (importado de @dm-api/shared) antes de tocar la DB.

 - GET /admin/tenants/:tenantId/flow-definitions — lista flows activos
 - GET /admin/tenants/:tenantId/stage-flows — lista stageFlows activos (para el dropdown de send_content en el builder de pasos)
 - POST /admin/tenants/:tenantId/flow-definitions — body: { definition: FlowDefinitionSchema }; crea versión nueva y desactiva la anterior en una
 transacción (db.transaction) para respetar el unique constraint oneActivePerFlow
 - PUT /admin/flow-definitions/:id — igual: nueva versión + desactiva vieja, en transacción
 - DELETE /admin/flow-definitions/:id — active = false

 Servicio nuevo: apps/api/src/services/flow-definitions.ts con createFlowDefinition(db, { tenantId, definition }) que maneja el versionado
 transaccional.

 4. Extender routes/admin/tenants.ts

 TenantConfigPatchSchema actualmente solo acepta notification_keywords y media_policy. Extender a:
 persona_prompt: z.string().optional(),
 disqualification_reasons: z.array(z.string()).optional(),
 calendly_url: z.string().url().or(z.literal('')).optional(),
 No hay cambio en el servicio — updateTenantConfig() ya hace shallow merge con cualquier campo válido de TenantConfigSchema.

 5. Registrar en routes/index.ts

 Importar y registrar stageTransitionsMapRoutes y flowDefinitionsRoutes.

 ---
 Frontend — 4 nuevas páginas + componentes

 Patrón a seguir

 Todos los pages son RSC que leen de DB directamente con Drizzle (como notificaciones/page.tsx), pasan datos a un componente 'use client', que
 llama Server Actions en settings/_actions/.

 Nuevas páginas

 ┌────────────────────────┬────────────────────────────────┬───────────────────┐
 │          Ruta          │            Archivo             │    Componente     │
 ├────────────────────────┼────────────────────────────────┼───────────────────┤
 │ /settings/agente       │ settings/agente/page.tsx       │ AgenteEditor      │
 ├────────────────────────┼────────────────────────────────┼───────────────────┤
 │ /settings/funnel       │ settings/funnel/page.tsx       │ FunnelEditor      │
 ├────────────────────────┼────────────────────────────────┼───────────────────┤
 │ /settings/transiciones │ settings/transiciones/page.tsx │ TransitionsEditor │
 ├────────────────────────┼────────────────────────────────┼───────────────────┤
 │ /settings/cascadas     │ settings/cascadas/page.tsx     │ CascadesEditor    │
 └────────────────────────┴────────────────────────────────┴───────────────────┘

 AgenteEditor.tsx (más simple — empezar aquí)

 3 secciones en un único formulario con un botón "Guardar cambios":
 1. Persona del agente — <textarea> grande para persona_prompt. Texto de ayuda: "Define el tono, restricciones y ejemplos del agente."
 2. URL de Calendly — input URL para calendly_url
 3. Razones de descalificación — mismo UX que keywords en NotificationsEditor: textarea "una por línea", se hace split('\n').filter(Boolean) al
 guardar

 Server action: settings/_actions/agente.ts → PATCH /admin/tenants/:id/config

 FunnelEditor.tsx

 Lista de StageCard + formulario "Add etapa" al final:
 - Slug: editable solo en creación (monospace, lock icon después)
 - Display name: inline edit on blur
 - Description / Goal: textareas colapsables
 - Max followups: number input
 - Position: number input (no drag-drop — evitar deps nuevas)
 - isTerminal: checkbox con badge "No recibe follow-ups"
 - isActive toggle: desactiva / reactiva

 Server actions: settings/_actions/funnel.ts → POST / PUT / DELETE

 TransitionsEditor.tsx

 Lista de cards "De [badge] → A [badge]: descripción". Formulario de alta al final con 2 <select> (populados con stages) y un <input> para
 whenToUse. Edición inline del campo whenToUse. Toggle de activación.

 Server actions: settings/_actions/transitions.ts

 CascadesEditor.tsx (más complejo — dejar para último)

 CascadeCard expone:
 - name (input), description (textarea)
 - Trigger: selector stage_transition | llm | system. Si stage_transition: dos <select> (from/to stages). Si llm: textarea de descripción.
 - Steps ordenados con botones ↑↓: cada step tiene tipo + config simplificada:
   - send_content → dropdown de stageFlows (muestra humanName (slugId))
   - reply_text → textarea con hint de variables {lead_in} {tenant.calendly_url} (reusar PlaceholderTextarea)
   - change_stage → dropdown de stages
 - El campo next se auto-computa como steps[i+1].id (lineal); el último step no lleva next
 - El flow_id se auto-genera como slug del name (lowercase, replace spaces con _); read-only tras creación
 - El id de cada step se genera como s1, s2, ... automáticamente

 Estado interno: un objeto FlowDefinition en useState. Validar con FlowDefinitionSchema.safeParse() en cliente antes de llamar la acción (da
 feedback inmediato sin round-trip).

 Server actions: settings/_actions/cascades.ts

 Modificar SettingsTabs.tsx

 Agregar 4 entradas al array TABS:
 { href: '/settings/agente',       label: 'Agente'       },
 { href: '/settings/funnel',       label: 'Etapas'       },
 { href: '/settings/transiciones', label: 'Transiciones' },
 { href: '/settings/cascadas',     label: 'Cascadas'     },

 Nuevos helpers Drizzle para pages RSC

 - apps/dashboard/src/lib/stage-transitions.ts — listTransitionRules(tenantId)
 - apps/dashboard/src/lib/flow-definitions.ts — listFlowDefinitions(tenantId), listStageFlowsForTenant(tenantId)

 ---
 Orden de implementación

 1. Migración DB → is_terminal en schema + pnpm db:generate
 2. Fix derivado → set-stage.ts consulta isTerminal = true en lugar del Set hardcodeado
 3. Backend paralelo: extender followups.ts + nuevo stage-transitions-map.ts + extender tenants.ts
 4. Backend: nuevo flow-definitions.ts (depende del schema migrado)
 5. Registrar rutas en routes/index.ts
 6. Frontend: AgenteEditor (más rápido, desbloquea el campo persona_prompt)
 7. Frontend: FunnelEditor + TransitionsEditor
 8. Frontend: CascadesEditor (más complejo, va último)
 9. SettingsTabs.tsx: añadir 4 tabs

 ---
 Verificación

 pnpm typecheck          # cero errores TS en todos los packages
 pnpm lint               # cero errores Biome (noConsoleLog solo warnings)
 pnpm test               # suite verde

 # Smoke test manual:
 # 1. Abrir /settings/agente → guardar persona_prompt → confirmar en psql que tenant.config lo tiene
 # 2. Crear etapa nueva en /settings/funnel → verificar fila en api.funnel_stages
 # 3. Añadir regla de transición en /settings/transiciones → verificar fila en api.stage_transitions_map
 # 4. Crear cascada "A→MS: enviar audio + avanzar a B" en /settings/cascadas →
 #    verificar fila en api.flow_definitions con definition que pasa FlowDefinitionSchema.parse()
 # 5. make rebuild-api → confirmar que un turno real usa las nuevas configuraciones

 ---
 Archivos críticos

 ┌────────────────────┬─────────────────────────────────────────────────────────────────────┐
 │       Acción       │                                Path                                 │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Modificar (schema) │ packages/db/src/schema.ts                                           │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Modificar          │ apps/api/src/routes/admin/followups.ts                              │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Modificar          │ apps/api/src/routes/admin/tenants.ts                                │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Modificar          │ apps/api/src/routes/admin/set-stage.ts                              │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Modificar          │ apps/api/src/routes/index.ts                                        │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/api/src/routes/admin/stage-transitions-map.ts                  │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/api/src/routes/admin/flow-definitions.ts                       │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/api/src/services/stage-transitions-map.ts                      │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/api/src/services/flow-definitions.ts                           │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Modificar          │ apps/api/src/services/followups.ts                                  │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Modificar          │ apps/dashboard/src/components/settings/SettingsTabs.tsx             │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/lib/stage-transitions.ts                         │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/lib/flow-definitions.ts                          │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/app/(dashboard)/settings/agente/page.tsx         │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/app/(dashboard)/settings/funnel/page.tsx         │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/app/(dashboard)/settings/transiciones/page.tsx   │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/app/(dashboard)/settings/cascadas/page.tsx       │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/app/(dashboard)/settings/_actions/agente.ts      │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/app/(dashboard)/settings/_actions/funnel.ts      │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/app/(dashboard)/settings/_actions/transitions.ts │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/app/(dashboard)/settings/_actions/cascadas.ts    │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/components/settings/AgenteEditor.tsx             │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/components/settings/FunnelEditor.tsx             │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/components/settings/TransitionsEditor.tsx        │
 ├────────────────────┼─────────────────────────────────────────────────────────────────────┤
 │ Crear              │ apps/dashboard/src/components/settings/CascadesEditor.tsx           │
 └────────────────────┴─────────────────────────────────────────────────────────────────────┘
