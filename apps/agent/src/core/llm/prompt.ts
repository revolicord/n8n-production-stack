import { DEFAULT_PLATFORM_SKELETON } from '@dm-api/shared';
import type { AssembledContext } from '../context/assemble.js';

/**
 * System prompt dividido en dos bloques para aprovechar prompt caching de
 * Anthropic (ADR-0025 / optimización de tokens):
 *
 *  - `stable`:  vocabulario de comandos + reglas + persona del tenant. NO cambia
 *    turno a turno → se marca con `cache_control` y se cobra al ~10% en cache hits
 *    (reaprovechable entre turnos y entre leads del mismo tenant durante 5 min).
 *  - `volatile`: transiciones válidas, opciones de contenido, política de respuesta
 *    y contexto de diálogo. Dependen de la etapa/estado → fuera del breakpoint.
 *
 * El orden importa: TODO lo estable va primero para que el prefijo cacheado sea
 * el más largo posible.
 */
export interface ComposedPrompt {
  stable: string;
  volatile: string;
}

/** Placeholders dinámicos que rompen el cache si quedan en el prefijo estable. */
const DYNAMIC_PLACEHOLDERS = ['{VALID_TRANSITIONS}', '{CONTENT_OPTIONS}', '{REPLY_POLICY}'];

export function composePrompt(ctx: AssembledContext, personaBlock: string): ComposedPrompt {
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

  // Punto de corte: la primera aparición de cualquier placeholder dinámico. Todo
  // lo anterior es estático (vocabulario + reglas); lo posterior es volátil.
  const cutIdx = DYNAMIC_PLACEHOLDERS.map((p) => skeletonTemplate.indexOf(p))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];

  const staticHead = cutIdx === undefined ? skeletonTemplate : skeletonTemplate.slice(0, cutIdx);
  const dynamicTail = cutIdx === undefined ? '' : skeletonTemplate.slice(cutIdx);

  const renderedTail = dynamicTail
    .replace('{VALID_TRANSITIONS}', validTransitions)
    .replace('{CONTENT_OPTIONS}', contentOptions)
    .replace('{REPLY_POLICY}', buildReplyPolicyBlock(ctx));

  const stable = [staticHead.trimEnd(), '', '## Persona del agente', '', personaBlock].join('\n');
  const volatile = [renderedTail.trim(), '', dialogueInfo].join('\n');

  return { stable, volatile };
}

/**
 * Bloque de política de texto para la etapa actual (regla "camino feliz sin texto
 * del LLM"). En etapas `flow_only` el agente NO debe improvisar texto en el camino
 * feliz: solo avanza con ChangeStage (cascade) y deja que el flow envíe el contenido.
 * El texto improvisado solo se permite ante un desvío del lead.
 */
function buildReplyPolicyBlock(ctx: AssembledContext): string {
  const policy =
    ctx.tenantConfig.text_policy_by_stage?.[ctx.currentStage] ??
    ctx.tenantConfig.text_policy_default ??
    'text_ok';

  if (policy !== 'flow_only') {
    return [
      `### Política de respuesta (etapa ${ctx.currentStage}: texto libre permitido)`,
      'Puedes acompañar las acciones con un `ReplyText` breve si aporta. Sigue la persona del tenant.',
    ].join('\n');
  }

  return [
    `### Política de respuesta (etapa ${ctx.currentStage}: SOLO FLUJO, sin texto del agente)`,
    'Esta etapa va por el "camino feliz" guionizado. El contenido (audios, vídeos, link de',
    'Calendly) lo envía automáticamente el flow al avanzar de etapa. Por tanto:',
    '',
    '- Si el lead da la señal esperada (👍, "ya lo vi", confirmación, etc.): emite SOLO',
    '  `ChangeStage` (con `cascade: true`). NO emitas `ReplyText` ni `Clarify`: el texto',
    '  improvisado se DESCARTA en esta etapa y solo ensuciaría el flujo.',
    '- Emite `ReplyText`/`Clarify` ÚNICAMENTE si el lead se DESVÍA del guion: pregunta algo,',
    '  pone una objeción, no da una señal clara, o se va por las ramas. Ahí sí responde para',
    '  no dejarlo en visto (este texto SÍ sobrevive porque el turno no avanzó por flujo).',
    '- Nunca avances de etapa "porque sí": solo con evidencia real de la señal del lead.',
  ].join('\n');
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
