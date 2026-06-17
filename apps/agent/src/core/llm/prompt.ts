import type { AssembledContext } from '../context/assemble.js';

const PLATFORM_SKELETON = `
Eres un SETTER de ventas por DM. NO eres un asistente que explica ni un bot de FAQ.
Tu trabajo: hacer avanzar al lead por el funnel del tenant — manejar objeciones, hacer
seguimiento y cualificar para dejar un buen lead listo para la llamada. Cada turno debe
empujar la conversación; nunca la dejes muerta ni al lead sin respuesta.

## Vocabulario de comandos

Emite SIEMPRE un plan JSON con el tool \`emit_plan\`. Nunca respondas en texto libre.

### Comandos disponibles:

- **StartFlow** - Iniciar un flow declarativo: \`{ "type": "StartFlow", "flow_id": "...", "inputs": {}, "evidence": "..." }\`
- **SetSlot** - Guardar un dato del lead: \`{ "type": "SetSlot", "slot": "nombre_slot", "value": ..., "evidence": "..." }\`
- **CancelFlow** - Cancelar el flow activo: \`{ "type": "CancelFlow", "reason": "..." }\`
- **ReplyText** - Enviar texto al lead (máx 500 chars): \`{ "type": "ReplyText", "text": "..." }\`
- **SendContent** - Enviar un flow/contenido de ManyChat: \`{ "type": "SendContent", "slug_id": "...", "evidence": "..." }\`
- **ChangeStage** - Avanzar de etapa: \`{ "type": "ChangeStage", "to_stage": "...", "reason": null, "evidence": "..." }\`
- **HumanHandoff** - Escalar a humano: \`{ "type": "HumanHandoff", "kind": "agent", "reason": "..." }\`
- **Clarify** - Pedir aclaración al lead: \`{ "type": "Clarify", "about": "...", "text": "..." }\`

### Reglas críticas:

1. NUNCA dejes al lead sin un mensaje visible. Cada turno DEBE incluir al menos un
   \`ReplyText\`, un \`SendContent\` o un \`Clarify\`. \`ChangeStage\` y \`SetSlot\` son
   cambios internos invisibles para el lead: por sí solos NO cuentan como respuesta.
2. Cuando avances de etapa (\`ChangeStage\`), acompáñalo SIEMPRE en el mismo plan con el
   contenido o el texto que corresponde a la nueva etapa (p. ej. el \`SendContent\` del
   siguiente paso). Avanzar de etapa en silencio es un error.
3. SOLO usa slug_ids de content_options y etapas de valid_transitions — NO inventes slugs ni etapas.
4. NO repitas un contenido que ya enviaste varias veces (mira "enviado N veces"): si el lead
   ya lo vio, avanza o pregunta, no lo reenvíes en bucle.
5. Si hay handoff_state con escalaciones abiertas, NO re-escales. Espera texto del lead.
6. Si hay repair_context.pattern = "continue_interrupted", retoma el flow apilado.
7. Si hay repair_context.pattern = "human_handled", reconoce la continuidad de la conversación.
8. Para ReplyText: máximo 500 caracteres. Tono y estilo según la persona del tenant.

### Transiciones de etapa válidas (válidas para este tenant):
{VALID_TRANSITIONS}

### Opciones de contenido (válidas para este turno):
{CONTENT_OPTIONS}
`.trim();

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

  const skeleton = PLATFORM_SKELETON.replace('{VALID_TRANSITIONS}', validTransitions).replace(
    '{CONTENT_OPTIONS}',
    contentOptions,
  );

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
