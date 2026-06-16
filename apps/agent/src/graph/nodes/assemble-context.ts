import type { TenantConfig, TurnInput } from '@dm-api/shared';
import type { AssembledContext } from '../../core/context/assemble.js';
import { assembleContext } from '../../core/context/assemble.js';
import { buildTranscript } from '../../core/memory/transcript.js';
import type { Deps } from '../../deps.js';
import {
  loadCurrentStage,
  loadFunnelStages,
  loadLeadContentSent,
  loadNotifications,
  loadRecentTurns,
  loadStageFlowsByStage,
  loadSubscriber,
  loadTenant,
  loadTransitions,
} from '../../services/context-queries.js';
import { loadDialogueState } from '../../services/dialogue-states.js';
import { loadActiveFlows } from '../../services/flow-definitions.js';

export async function assembleContextNode(input: TurnInput, deps: Deps): Promise<AssembledContext> {
  const { tenant_id, subscriber_id, conversation_id } = input;
  const db = deps.db;
  const log = deps.logger.child({ turn_id: input.turn_id, node: 'assemble' });

  const tenant = await loadTenant(db, tenant_id);
  if (!tenant) throw new Error(`tenant ${tenant_id} not found`);

  const subscriber = await loadSubscriber(db, { tenantId: tenant_id, subscriberId: subscriber_id });
  if (!subscriber) throw new Error(`subscriber ${subscriber_id} not found`);

  const tenantConfig = (() => {
    const raw = tenant.config as unknown;
    // Using shared TenantConfigSchema via passthrough — just cast
    return raw as TenantConfig;
  })();

  const [
    currentStage,
    funnelStagesList,
    transitions,
    stageFlowsByStage,
    notifications,
    lcs,
    recentTurns,
    dialogueState,
    activeFlows,
  ] = await Promise.all([
    loadCurrentStage(db, { tenantId: tenant_id, subscriberId: subscriber_id }),
    loadFunnelStages(db, tenant_id),
    loadTransitions(db, tenant_id),
    loadStageFlowsByStage(db, tenant_id),
    loadNotifications(db, { tenantId: tenant_id, subscriberId: subscriber_id, limit: 5 }),
    loadLeadContentSent(db, {
      tenantId: tenant_id,
      subscriberId: subscriber_id,
      conversationId: conversation_id,
    }),
    loadRecentTurns(db, { tenantId: tenant_id, subscriberId: subscriber_id, limit: 20 }),
    loadDialogueState(db, { conversationId: conversation_id }),
    loadActiveFlows(db, tenant_id),
  ]);

  log.info(
    {
      stage: currentStage,
      transcript_len: recentTurns.length,
      stack_depth: dialogueState?.stack?.length ?? 0,
      active_flows: activeFlows.size,
    },
    'context loaded',
  );

  const transcript = await buildTranscript(db, {
    tenantId: tenant_id,
    subscriberId: subscriber_id,
    maxTurns: 20,
    recentTurns,
  });

  return assembleContext({
    tenant,
    tenantConfig,
    subscriber,
    currentStage,
    funnelStages: funnelStagesList,
    transitions,
    stageFlowsByStage,
    notifications,
    leadContentSent: lcs,
    dialogueState,
    transcript,
    activeFlows,
    rng: deps.rng,
  });
}
