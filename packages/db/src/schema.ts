import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const apiSchema = pgSchema('api');

// ───────────────────────────────────────────────────────────────
// tenants — clientes de la agencia
// ───────────────────────────────────────────────────────────────
export const tenants = apiSchema.table(
  'tenants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    manychatAccountId: text('manychat_account_id'),
    manychatApiKeyEncrypted: text('manychat_api_key_encrypted'),
    isActive: boolean('is_active').notNull().default(true),
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex('tenants_slug_unique').on(t.slug),
  }),
);

// ───────────────────────────────────────────────────────────────
// subscribers — usuario de Instagram (vía ManyChat)
// ───────────────────────────────────────────────────────────────
export const subscribers = apiSchema.table(
  'subscribers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    manychatSubscriberId: text('manychat_subscriber_id').notNull(),
    igUserId: text('ig_user_id'),
    igUsername: text('ig_username'),
    displayName: text('display_name'),
    locale: text('locale'),
    currentChannel: text('current_channel'),
    optIns: jsonb('opt_ins').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('active'),
    pausedUntil: timestamp('paused_until', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    // Última presencia IG recibida de ManyChat (last_seen, last_interaction,
    // messaging_window, etc.). El worker la reenvía a n8n (Build Context).
    instagramContext: jsonb('instagram_context').notNull().default(sql`'{}'::jsonb`),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantManychatUnique: uniqueIndex('subscribers_tenant_manychat_unique').on(
      t.tenantId,
      t.manychatSubscriberId,
    ),
    tenantStatusIdx: index('subscribers_tenant_status_idx').on(t.tenantId, t.status),
    tenantLastSeenIdx: index('subscribers_tenant_last_seen_idx').on(t.tenantId, t.lastSeenAt),
  }),
);

// ───────────────────────────────────────────────────────────────
// messages_raw — auditoría completa, fuente de verdad
// ───────────────────────────────────────────────────────────────
export const messagesRaw = apiSchema.table(
  'messages_raw',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    subscriberId: uuid('subscriber_id').notNull(),
    channel: text('channel').notNull().default('instagram'),
    externalMessageId: text('external_message_id'),
    idempotencyHash: text('idempotency_hash').notNull(),
    direction: text('direction').notNull(),
    payload: jsonb('payload').notNull(),
    text: text('text'),
    hasMedia: boolean('has_media').notNull().default(false),
    mediaUrls: text('media_urls').array(),
    triggerSource: text('trigger_source'),
    triggerChannel: text('trigger_channel'),
    triggerRef: text('trigger_ref'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencyUnique: uniqueIndex('messages_raw_idempotency_unique').on(
      t.tenantId,
      t.idempotencyHash,
    ),
    tenantSubscriberIdx: index('messages_raw_tenant_subscriber_idx').on(
      t.tenantId,
      t.subscriberId,
      t.receivedAt,
    ),
  }),
);

// ───────────────────────────────────────────────────────────────
// conversations — sesiones lógicas de chat
// ───────────────────────────────────────────────────────────────
export const conversations = apiSchema.table(
  'conversations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    subscriberId: uuid('subscriber_id').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    lastUserMsgAt: timestamp('last_user_msg_at', { withTimezone: true }),
    lastBotMsgAt: timestamp('last_bot_msg_at', { withTimezone: true }),
    status: text('status').notNull().default('open'),
    summary: text('summary'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    tenantSubscriberStatusIdx: index('conversations_tenant_sub_status_idx').on(
      t.tenantId,
      t.subscriberId,
      t.status,
    ),
    tenantLastUserMsgIdx: index('conversations_tenant_last_user_msg_idx').on(
      t.tenantId,
      t.lastUserMsgAt,
    ),
  }),
);

// ───────────────────────────────────────────────────────────────
// turns — cada batch enviado al LLM
// ───────────────────────────────────────────────────────────────
export const turns = apiSchema.table(
  'turns',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    subscriberId: uuid('subscriber_id').notNull(),
    batchSize: integer('batch_size').notNull(),
    batchText: text('batch_text').notNull(),
    batchMessageIds: uuid('batch_message_ids').array().notNull(),
    llmModel: text('llm_model'),
    promptVersion: text('prompt_version'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    responseText: text('response_text'),
    status: text('status').notNull().default('pending'),
    n8nExecutionId: text('n8n_execution_id'),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
    triggerSource: text('trigger_source'),
    triggerChannel: text('trigger_channel'),
    parentTurnId: uuid('parent_turn_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
  },
  (t) => ({
    tenantStatusIdx: index('turns_tenant_status_idx').on(t.tenantId, t.status, t.startedAt),
    tenantSubscriberIdx: index('turns_tenant_sub_idx').on(t.tenantId, t.subscriberId, t.startedAt),
  }),
);

// ───────────────────────────────────────────────────────────────
// lead_stages — etapa actual del lead por subscriber
// current_stage_id agrega FK a funnel_stages (ADR-0014 Path B)
// ───────────────────────────────────────────────────────────────
export const leadStages = apiSchema.table(
  'lead_stages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subscriberId: uuid('subscriber_id')
      .notNull()
      .references(() => subscribers.id, { onDelete: 'cascade' }),
    currentStage: text('current_stage').notNull().default('A'),
    currentStageId: uuid('current_stage_id').references(() => funnelStages.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantSubscriberUnique: uniqueIndex('lead_stages_tenant_subscriber_unique').on(
      t.tenantId,
      t.subscriberId,
    ),
  }),
);

// ───────────────────────────────────────────────────────────────
// stage_transitions — log inmutable de cambios de etapa
// ───────────────────────────────────────────────────────────────
export const stageTransitions = apiSchema.table(
  'stage_transitions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    subscriberId: uuid('subscriber_id').notNull(),
    turnId: uuid('turn_id').references(() => turns.id),
    fromStage: text('from_stage').notNull(),
    toStage: text('to_stage').notNull(),
    reason: text('reason'),
    agentEvidence: text('agent_evidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantSubscriberIdx: index('stage_transitions_tenant_sub_idx').on(
      t.tenantId,
      t.subscriberId,
      t.createdAt,
    ),
  }),
);

// ───────────────────────────────────────────────────────────────
// dead_letter_queue — fallos persistentes (Sprint 2 lo explota)
// ───────────────────────────────────────────────────────────────
export const deadLetterQueue = apiSchema.table(
  'dead_letter_queue',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    source: text('source').notNull(),
    payload: jsonb('payload').notNull(),
    error: text('error').notNull(),
    retryCount: integer('retry_count').notNull(),
    relatedTurnId: uuid('related_turn_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
  },
  (t) => ({
    tenantResolvedIdx: index('dlq_tenant_resolved_idx').on(t.tenantId, t.resolvedAt),
  }),
);

// ───────────────────────────────────────────────────────────────
// funnel_stages — etapas del funnel por tenant (ADR-0010)
// ───────────────────────────────────────────────────────────────
export const funnelStages = apiSchema.table(
  'funnel_stages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    position: integer('position').notNull(),
    description: text('description'),
    // Objetivo de la etapa + transiciones válidas (usadas por el routing de n8n)
    goal: text('goal'),
    validNextStages: text('valid_next_stages').array().notNull().default(sql`'{}'::text[]`),
    maxFollowups: integer('max_followups').default(3),
    nurtureVideoUrl: text('nurture_video_url'),
    callLink: text('call_link'),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantSlugUnique: uniqueIndex('funnel_stages_tenant_slug_unique').on(t.tenantId, t.slug),
    tenantActiveIdx: index('funnel_stages_tenant_active_idx').on(t.tenantId, t.isActive),
  }),
);

// ───────────────────────────────────────────────────────────────
// stage_flows — variantes A/B de flows ManyChat por etapa (ADR-0010)
// ───────────────────────────────────────────────────────────────
export const stageFlows = apiSchema.table(
  'stage_flows',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => funnelStages.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    flowNs: text('flow_ns').notNull(),
    description: text('description'),
    weight: integer('weight').default(1),
    isActive: boolean('is_active').default(true),
    // ADR-0016 (Flow Registry): metadatos semánticos del flow ManyChat
    humanName: text('human_name'),
    mediaType: text('media_type'),
    contentDescription: text('content_description'),
    usageCondition: text('usage_condition'),
    variantGroup: text('variant_group'),
    pendingNs: text('pending_ns'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    // Identificador corto del contenido (referenciado por lead_content_sent)
    slugId: text('slug_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    stageActiveIdx: index('stage_flows_stage_active_idx').on(t.stageId, t.isActive),
    humanNameTenantIdx: index('stage_flows_human_name_tenant_idx').on(t.tenantId, t.humanName),
    pendingNsIdx: index('stage_flows_pending_ns_idx')
      .on(t.tenantId, t.pendingNs)
      .where(sql`pending_ns IS NOT NULL`),
  }),
);

// ───────────────────────────────────────────────────────────────
// followup_templates — secuencias de follow-up por etapa (ADR-0015)
// ───────────────────────────────────────────────────────────────
export const followupTemplates = apiSchema.table(
  'followup_templates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => funnelStages.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    delayMinutes: integer('delay_minutes').notNull(),
    type: text('type').notNull(),
    textTemplate: text('text_template'),
    flowNs: text('flow_ns'),
    description: text('description'),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    stageSeqUnique: uniqueIndex('followup_templates_stage_seq_unique').on(
      t.stageId,
      t.sequenceNumber,
    ),
  }),
);

// ───────────────────────────────────────────────────────────────
// followup_messages — mensajes individuales de un template type='content' (ADR-0015)
// ───────────────────────────────────────────────────────────────
export const followupMessages = apiSchema.table(
  'followup_messages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    templateId: uuid('template_id')
      .notNull()
      .references(() => followupTemplates.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    messageType: text('message_type').notNull(), // 'text' | 'image'
    textContent: text('text_content'),
    mediaUrl: text('media_url'),
    sortOrder: integer('sort_order').notNull().default(0),
    aiImageContext: text('ai_image_context'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tplOrderUnique: uniqueIndex('followup_messages_tpl_order_unique').on(t.templateId, t.sortOrder),
    templateIdx: index('followup_messages_template_idx').on(t.templateId),
  }),
);

// ───────────────────────────────────────────────────────────────
// lead_followup_log — registro inmutable de follow-ups enviados (ADR-0015)
// ───────────────────────────────────────────────────────────────
export const leadFollowupLog = apiSchema.table(
  'lead_followup_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    subscriberId: uuid('subscriber_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    stageId: uuid('stage_id').references(() => funnelStages.id),
    templateId: uuid('template_id').references(() => followupTemplates.id),
    sequenceNumber: integer('sequence_number').notNull(),
    textSent: text('text_sent'),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow(),
    status: text('status').default('sent'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => ({
    subConvIdx: index('lead_followup_log_sub_conv_idx').on(
      t.subscriberId,
      t.conversationId,
      t.sentAt,
    ),
  }),
);

// ───────────────────────────────────────────────────────────────
// lead_crons — detector de inactividad y programador de follow-ups (ADR-0011)
// ───────────────────────────────────────────────────────────────
export const leadCrons = apiSchema.table(
  'lead_crons',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    subscriberId: uuid('subscriber_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    currentStageId: uuid('current_stage_id').references(() => funnelStages.id),
    nextFollowupAt: timestamp('next_followup_at', { withTimezone: true }),
    nextSequenceNumber: integer('next_sequence_number').default(1),
    isActive: boolean('is_active').default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archiveReason: text('archive_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantSubConvUnique: uniqueIndex('lead_crons_tenant_sub_conv_unique').on(
      t.tenantId,
      t.subscriberId,
      t.conversationId,
    ),
    dueIdx: index('lead_crons_due_idx').on(t.nextFollowupAt),
  }),
);

// ───────────────────────────────────────────────────────────────
// lead_content_sent — log de contenido (flow) enviado por lead (usada por n8n)
// ───────────────────────────────────────────────────────────────
export const leadContentSent = apiSchema.table(
  'lead_content_sent',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    subscriberId: uuid('subscriber_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    stageSlug: text('stage_slug').notNull(),
    slugId: text('slug_id').notNull(),
    flowNs: text('flow_ns').notNull(),
    turnId: uuid('turn_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    leadResponded: boolean('lead_responded').notNull().default(false),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => ({
    lookupIdx: index('idx_lcs_lookup').on(
      t.subscriberId,
      t.conversationId,
      t.stageSlug,
      t.sentAt.desc(),
    ),
    pendingResponseIdx: index('idx_lcs_pending_response')
      .on(t.subscriberId, t.conversationId)
      .where(sql`lead_responded = false`),
  }),
);

// ───────────────────────────────────────────────────────────────
// stage_transitions_map — mapa configurable de transiciones válidas (usada por n8n)
// ───────────────────────────────────────────────────────────────
export const stageTransitionsMap = apiSchema.table(
  'stage_transitions_map',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    fromStageSlug: text('from_stage_slug').notNull(),
    toStageSlug: text('to_stage_slug').notNull(),
    whenToUse: text('when_to_use').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantFromToUnique: uniqueIndex('stage_transitions_map_tenant_from_to_unique').on(
      t.tenantId,
      t.fromStageSlug,
      t.toStageSlug,
    ),
    lookupIdx: index('idx_stm_lookup').on(t.tenantId, t.fromStageSlug).where(sql`is_active = true`),
  }),
);

// ───────────────────────────────────────────────────────────────
// agent_resources — snippets de texto/imagen que el agente consulta on-demand (ADR-0019)
// No son secuenciados ni están atados a una etapa: el agente los consulta por categoría.
// ───────────────────────────────────────────────────────────────
export const agentResources = apiSchema.table(
  'agent_resources',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    category: text('category').notNull(), // 'cierre' | 'objecion' | 'general'
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    triggerHint: text('trigger_hint'),
    textContent: text('text_content'),
    mediaUrl: text('media_url'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantSlugUnique: uniqueIndex('agent_resources_tenant_slug_unique').on(t.tenantId, t.slug),
    tenantCategoryIdx: index('agent_resources_tenant_category_idx').on(
      t.tenantId,
      t.category,
      t.isActive,
    ),
  }),
);

// ───────────────────────────────────────────────────────────────
// notifications — escalado a humano (audio / keywords / tool del agente)
// Producidas por webhook-manychat (determinista) o por n8n vía
// /admin/leads/:id/notify-human; entregadas a Telegram por el worker 'notify'.
// ───────────────────────────────────────────────────────────────
export const notifications = apiSchema.table(
  'notifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subscriberId: uuid('subscriber_id')
      .notNull()
      .references(() => subscribers.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id'),
    turnId: uuid('turn_id'),
    kind: text('kind').notNull(), // 'audio' | 'keyword' | 'agent'
    source: text('source').notNull(), // 'code' | 'agent'
    reason: text('reason'),
    summary: text('summary'),
    status: text('status').notNull().default('pending'), // 'pending' | 'resolved'
    telegramChatId: text('telegram_chat_id'),
    telegramMessageId: text('telegram_message_id'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
  },
  (t) => ({
    tenantStatusIdx: index('notifications_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    pendingIdx: index('notifications_pending_idx')
      .on(t.tenantId, t.createdAt)
      .where(sql`status = 'pending'`),
  }),
);

// ───────────────────────────────────────────────────────────────
// Inferred types
// ───────────────────────────────────────────────────────────────
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Subscriber = typeof subscribers.$inferSelect;
export type NewSubscriber = typeof subscribers.$inferInsert;
export type MessageRaw = typeof messagesRaw.$inferSelect;
export type NewMessageRaw = typeof messagesRaw.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Turn = typeof turns.$inferSelect;
export type NewTurn = typeof turns.$inferInsert;
export type DLQItem = typeof deadLetterQueue.$inferSelect;
export type LeadStage = typeof leadStages.$inferSelect;
export type NewLeadStage = typeof leadStages.$inferInsert;
export type StageTransition = typeof stageTransitions.$inferSelect;
export type NewStageTransition = typeof stageTransitions.$inferInsert;
export type FunnelStage = typeof funnelStages.$inferSelect;
export type NewFunnelStage = typeof funnelStages.$inferInsert;
export type StageFlow = typeof stageFlows.$inferSelect;
export type NewStageFlow = typeof stageFlows.$inferInsert;
export type FollowupTemplate = typeof followupTemplates.$inferSelect;
export type NewFollowupTemplate = typeof followupTemplates.$inferInsert;
export type FollowupMessage = typeof followupMessages.$inferSelect;
export type NewFollowupMessage = typeof followupMessages.$inferInsert;
export type LeadFollowupLog = typeof leadFollowupLog.$inferSelect;
export type NewLeadFollowupLog = typeof leadFollowupLog.$inferInsert;
export type LeadCron = typeof leadCrons.$inferSelect;
export type NewLeadCron = typeof leadCrons.$inferInsert;
export type LeadContentSent = typeof leadContentSent.$inferSelect;
export type NewLeadContentSent = typeof leadContentSent.$inferInsert;
export type StageTransitionsMap = typeof stageTransitionsMap.$inferSelect;
export type NewStageTransitionsMap = typeof stageTransitionsMap.$inferInsert;
export type AgentResource = typeof agentResources.$inferSelect;
export type NewAgentResource = typeof agentResources.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// ───────────────────────────────────────────────────────────────
// ADR-0024: motor de diálogo declarativo
// ───────────────────────────────────────────────────────────────

// flow_definitions — flows declarativos versionados por tenant
export const flowDefinitions = apiSchema.table(
  'flow_definitions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    flowId: text('flow_id').notNull(),
    version: integer('version').notNull().default(1),
    definition: jsonb('definition').notNull(),
    active: boolean('active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantFlowVersionUnique: uniqueIndex('flow_definitions_tenant_flow_version_unique').on(
      t.tenantId,
      t.flowId,
      t.version,
    ),
    oneActivePerFlow: uniqueIndex('flow_definitions_one_active_unique')
      .on(t.tenantId, t.flowId)
      .where(sql`active = true`),
  }),
);

// dialogue_states — un estado de diálogo por conversación (fuente de verdad durable)
export const dialogueStates = apiSchema.table(
  'dialogue_states',
  {
    conversationId: uuid('conversation_id')
      .primaryKey()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    stack: jsonb('stack').notNull().default(sql`'[]'::jsonb`),
    slots: jsonb('slots').notNull().default(sql`'{}'::jsonb`),
    repairContext: jsonb('repair_context'),
    lastTurnId: uuid('last_turn_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('dialogue_states_tenant_idx').on(t.tenantId),
  }),
);

// domain_events — outbox mínimo para eventos de dominio (CRM, dashboard)
export const domainEvents = apiSchema.table(
  'domain_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    turnId: uuid('turn_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => ({
    typeIdx: index('domain_events_tenant_type_idx').on(t.tenantId, t.type, t.createdAt),
  }),
);

// agent_turn_traces — traza legible por turno (ADR-0025). Reemplaza a
// agent_shadow_runs: una fila por ejecución (mode: live|shadow|replay). Es el
// equivalente consultable por SQL a una "execution" de n8n. trace_level del
// tenant controla cuánto se guarda; trace_retention_days la limpieza.
export const agentTurnTraces = apiSchema.table(
  'agent_turn_traces',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    turnId: uuid('turn_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id'),
    subscriberId: uuid('subscriber_id'),
    mode: text('mode').notNull(), // 'live' | 'shadow' | 'replay'
    status: text('status').notNull(), // 'completed' | 'interrupted' | 'failed' | 'dry_run'
    input: jsonb('input'), // TurnInput (mensajes, trigger, system_commands)
    contextSnapshot: jsonb('context_snapshot'), // AssembledContext (solo trace_level=full)
    prompt: jsonb('prompt'), // { system_prompt, messages } (solo trace_level=full)
    reasoning: text('reasoning'), // LlmPlan.reasoning
    commands: jsonb('commands'),
    actionResults: jsonb('action_results'),
    flowPath: jsonb('flow_path'), // pasos del flow engine ejecutados este turno
    responseTexts: jsonb('response_texts'),
    finalStage: text('final_stage'),
    dialogueStateBefore: jsonb('dialogue_state_before'),
    dialogueStateAfter: jsonb('dialogue_state_after'),
    error: jsonb('error'), // { node, message, stack }
    metrics: jsonb('metrics'), // { model, input_tokens, output_tokens, llm_ms, total_ms }
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    turnModeUnique: uniqueIndex('agent_turn_traces_turn_mode_uniq').on(t.turnId, t.mode),
    tenantCreatedIdx: index('agent_turn_traces_tenant_created_idx').on(t.tenantId, t.createdAt),
    tenantSubIdx: index('agent_turn_traces_tenant_sub_idx').on(
      t.tenantId,
      t.subscriberId,
      t.createdAt,
    ),
    tenantStatusIdx: index('agent_turn_traces_tenant_status_idx').on(t.tenantId, t.status),
  }),
);

export type AgentTurnTrace = typeof agentTurnTraces.$inferSelect;
export type NewAgentTurnTrace = typeof agentTurnTraces.$inferInsert;

export type FlowDefinition = typeof flowDefinitions.$inferSelect;
export type NewFlowDefinition = typeof flowDefinitions.$inferInsert;
export type DialogueState = typeof dialogueStates.$inferSelect;
export type NewDialogueState = typeof dialogueStates.$inferInsert;
export type DomainEvent = typeof domainEvents.$inferSelect;
export type NewDomainEvent = typeof domainEvents.$inferInsert;
