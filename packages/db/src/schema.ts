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
