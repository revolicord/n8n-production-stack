export { runTurn } from './run-turn.js';
export { resumeConversation } from './resume.js';
export type { Deps } from './deps.js';
export type { AgentConfig } from './config.js';
// Adaptador de canal ManyChat — reutilizado por el follow-up runner (apps/api).
export { createManyChatAdapter, createDryRunAdapter } from './channel/manychat.js';
export type {
  ChannelAdapter,
  ContentMessage,
  SendContentResult,
  SendFlowResult,
  SendTextResult,
} from './channel/types.js';
