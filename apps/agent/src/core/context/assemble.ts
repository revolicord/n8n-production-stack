import type {
  FunnelStage,
  LeadContentSent,
  Notification,
  StageFlow,
  StageTransitionsMap,
  Subscriber,
  Tenant,
} from '@dm-api/db';
import type { DialogueState, FlowDefinition, TenantConfig } from '@dm-api/shared';
import type { HandoffState } from './handoff.js';
import { buildHandoffState } from './handoff.js';
import type { CollapsedVariant, SentRecord } from './weighted.js';
import { collapseVariantGroups } from './weighted.js';

export interface StageContentCatalog {
  stageSlug: string;
  variants: CollapsedVariant[];
}

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssembledContext {
  tenant: Tenant;
  tenantConfig: TenantConfig;
  subscriber: Subscriber;
  currentStage: string;
  funnelStages: FunnelStage[];
  transitions: StageTransitionsMap[];
  stageCatalog: StageContentCatalog[];
  transcript: TranscriptMessage[];
  dialogueState: DialogueState;
  handoffState: HandoffState | null;
  leadContentSent: LeadContentSent[];
  activeFlows: Map<string, { version: number; def: FlowDefinition }>;
}

export interface AssembleInput {
  tenant: Tenant;
  tenantConfig: TenantConfig;
  subscriber: Subscriber;
  currentStage: string;
  funnelStages: FunnelStage[];
  transitions: StageTransitionsMap[];
  stageFlowsByStage: Map<string, StageFlow[]>;
  notifications: Notification[];
  leadContentSent: LeadContentSent[];
  dialogueState: DialogueState;
  transcript: TranscriptMessage[];
  activeFlows: Map<string, { version: number; def: FlowDefinition }>;
  rng: () => number;
}

export function assembleContext(input: AssembleInput): AssembledContext {
  const sentMap = new Map<string, SentRecord>();
  for (const lcs of input.leadContentSent) {
    if (lcs.slugId) {
      sentMap.set(lcs.slugId, { slugId: lcs.slugId, sentAt: lcs.sentAt });
    }
  }

  const stageCatalog: StageContentCatalog[] = [];
  for (const [stageSlug, flows] of input.stageFlowsByStage.entries()) {
    const variants = flows
      .filter((f) => f.isActive)
      .map((f) => ({
        flowNs: f.flowNs,
        slugId: f.slugId,
        variantGroup: f.variantGroup,
        weight: f.weight,
      }));
    stageCatalog.push({
      stageSlug,
      variants: collapseVariantGroups(variants, sentMap, input.rng),
    });
  }

  const handoffState = buildHandoffState(input.notifications);

  return {
    tenant: input.tenant,
    tenantConfig: input.tenantConfig,
    subscriber: input.subscriber,
    currentStage: input.currentStage,
    funnelStages: input.funnelStages,
    transitions: input.transitions,
    stageCatalog,
    transcript: input.transcript,
    dialogueState: input.dialogueState,
    handoffState,
    leadContentSent: input.leadContentSent,
    activeFlows: input.activeFlows,
  };
}
