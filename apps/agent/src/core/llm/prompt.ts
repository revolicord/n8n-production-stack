import { DEFAULT_PLATFORM_SKELETON } from '@dm-api/shared';
import type { AssembledContext } from '../context/assemble.js';

export function composePrompt(ctx: AssembledContext, personaBlock: string): string {
  const validTransitions =
    ctx.transitions
      .filter((t) => t.fromStageSlug === ctx.currentStage)
      .map((t) => `- ${t.fromStageSlug} → ${t.toStageSlug}: ${t.whenToUse}`)
      .join('\n') || '  (ninguna disponible desde la etapa actual)';

  const currentStageCatalog = ctx.stageCatalog.find((s) => s.stageSlug === ctx.currentStage);
  const contentOptions =
    currentStageCatalog?.variants
      .filter((v) => v.slugId != null)
      .map((v) => `- slug_id: "${v.slugId}" (enviado ${v.timesSent} veces)`)
      .join('\n') || '  (ninguna disponible)';

  const dialogueInfo = buildDialogueContextBlock(ctx);

  const skeletonTemplate = ctx.tenantConfig.skeleton_prompt ?? DEFAULT_PLATFORM_SKELETON;
  const skeleton = skeletonTemplate
    .replace('{VALID_TRANSITIONS}', validTransitions)
    .replace('{CONTENT_OPTIONS}', contentOptions);

  return [skeleton, '', '## Persona del agente', '', personaBlock, '', dialogueInfo].join('\n');
}

function buildDialogueContextBlock(ctx: AssembledContext): string {
  const lines: string[] = ['## Contexto del diálogo'];

  lines.push(`\nLead: ${ctx.subscriber.displayName ?? ctx.subscriber.igUsername ?? 'desconocido'}`);
  lines.push(`Etapa actual: ${ctx.currentStage}`);

  if (ctx.dialogueState.stack.length > 0) {
    const top = ctx.dialogueState.stack[ctx.dialogueState.stack.length - 1];
    if (top) {
      lines.push(`Flow activo: ${top.flow_id} (paso: ${top.step_id})`);
    }
  }

  if (ctx.dialogueState.repair_context) {
    const rc = ctx.dialogueState.repair_context;
    lines.push(`\nPatrón de reparación activo: ${rc.pattern}`);
    if (rc.pattern === 'human_handoff') {
      lines.push('→ Hay una escalación humana activa. NO re-escales. Espera texto del lead.');
    } else if (rc.pattern === 'continue_interrupted') {
      const note = (rc.payload as { note?: string }).note;
      if (note) lines.push(`→ Nota del agente humano: "${note}"`);
      lines.push('→ Retoma el flow interrumpido.');
    }
  }

  if (ctx.handoffState?.open_escalations.length) {
    lines.push('\nEscalaciones abiertas:');
    for (const e of ctx.handoffState.open_escalations) {
      lines.push(`  - [${e.kind}] ${e.reason ?? ''} (desde ${e.since})`);
    }
  }

  if (Object.keys(ctx.dialogueState.slots).length > 0) {
    lines.push('\nSlots de la conversación:');
    lines.push(JSON.stringify(ctx.dialogueState.slots, null, 2));
  }

  return lines.join('\n');
}
