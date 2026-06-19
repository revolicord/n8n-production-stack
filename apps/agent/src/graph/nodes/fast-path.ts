import type { DialogueCommand, TurnInput } from '@dm-api/shared';
import type { AssembledContext } from '../../core/context/assemble.js';

/**
 * Fast-path determinista del "camino feliz" (optimización de tokens, modo
 * CONSERVADOR): cuando el lead da una señal positiva inequívoca en una etapa
 * `flow_only` con un único avance posible, NO llamamos al LLM — emitimos el
 * `ChangeStage(cascade)` directamente. El flow de la nueva etapa entrega el
 * contenido. Esto es "ponerlo en memoria sin pensar": cero tokens en el turno.
 *
 * Ante la MÍNIMA ambigüedad se devuelve `null` y el turno cae al LLM normal:
 *  - la etapa no es `flow_only`;
 *  - hay 0 o >1 transiciones válidas (destino ambiguo);
 *  - hay un `repair_context` o escalaciones abiertas (no es camino feliz);
 *  - hay `system_commands` inyectados (eventos de sistema → flujo normal);
 *  - algún mensaje no es texto (audio/imagen/… → posible escalado);
 *  - el texto contiene una pregunta, o no es una señal positiva exacta.
 */
export interface FastPathResult {
  commands: DialogueCommand[];
  reason: string;
}

/** Señales positivas inequívocas (texto normalizado, match EXACTO). */
const POSITIVE_PHRASES = new Set([
  'si',
  'ok',
  'oka',
  'okey',
  'okay',
  'vale',
  'listo',
  'dale',
  'va',
  'perfecto',
  'genial',
  'hecho',
  'ya',
  'ya esta',
  'ya lo vi',
  'ya la vi',
  'ya vi',
  'lo vi',
  'la vi',
  'visto',
  'confirmo',
  'confirmado',
  'correcto',
  'entendido',
  'de acuerdo',
  'sip',
  'simon',
  'claro',
]);

/** Emojis de aprobación que, solos, cuentan como señal positiva. */
const POSITIVE_EMOJI = new Set(['👍', '👌', '✅', '🙌', '🔥', '💪', '🙏', '👏', '🤝']);

/** Marcas diacríticas combinantes (U+0300–U+036F) que deja `normalize('NFD')`. */
// biome-ignore lint/suspicious/noMisleadingCharacterClass: rango de marcas combinantes, intencional
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Quita acentos, signos y espacios sobrantes para el match exacto. */
function normalizePhrase(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '') // diacríticos combinantes
    .toLowerCase()
    .replace(/[.,!¡…·]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tonos de piel (1F3FB–1F3FF), variation selector (FE0F) y ZWJ (200D). */
// biome-ignore lint/suspicious/noMisleadingCharacterClass: modificadores de emoji, intencional
const EMOJI_MODIFIERS = /[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu;

/** Quita modificadores de tono/variación para comparar emojis "pelados". */
function stripEmojiModifiers(text: string): string {
  return text.replace(EMOJI_MODIFIERS, '');
}

/** ¿Un mensaje individual es una señal positiva inequívoca? */
function isPositiveSignal(text: string): boolean {
  // Una pregunta NUNCA es señal de avance (aunque empiece por "sí").
  if (text.includes('?') || text.includes('¿')) return false;

  const normalized = normalizePhrase(text);
  if (normalized.length > 0 && POSITIVE_PHRASES.has(normalized)) return true;

  // Mensaje compuesto sólo de emojis positivos (👍, 👍👍, 👍🔥, …).
  const emojiOnly = stripEmojiModifiers(text).replace(/\s/g, '');
  if (emojiOnly.length > 0) {
    const chars = [...emojiOnly];
    if (chars.every((c) => POSITIVE_EMOJI.has(c))) return true;
  }

  return false;
}

export function tryFastPath(input: TurnInput, ctx: AssembledContext): FastPathResult | null {
  // Sólo turnos puros del lead: si hay system_commands, va por el flujo normal.
  if (input.system_commands.length > 0) return null;
  if (input.messages.length === 0) return null;

  // Todos los mensajes deben ser texto y señal positiva inequívoca.
  for (const m of input.messages) {
    if (m.content_class !== 'text') return null;
    if (!m.text || !isPositiveSignal(m.text)) return null;
  }

  // No estamos en camino feliz si hay reparación o escalación activa.
  if (ctx.dialogueState.repair_context) return null;
  if (ctx.handoffState?.open_escalations.length) return null;

  // La etapa debe ser flow_only.
  const policy =
    ctx.tenantConfig.text_policy_by_stage?.[ctx.currentStage] ??
    ctx.tenantConfig.text_policy_default ??
    'text_ok';
  if (policy !== 'flow_only') return null;

  // Destino inequívoco: exactamente UNA transición válida desde la etapa actual.
  const outgoing = ctx.transitions.filter((t) => t.fromStageSlug === ctx.currentStage);
  if (outgoing.length !== 1) return null;
  const target = outgoing[0];
  if (!target) return null;

  const command: DialogueCommand = {
    type: 'ChangeStage',
    to_stage: target.toStageSlug,
    reason: null,
    evidence: 'fast-path: señal positiva clara del lead en etapa flow_only',
    cascade: true,
    system_authorized: false,
  };

  return {
    commands: [command],
    reason: `fast-path determinista: señal positiva en etapa flow_only "${ctx.currentStage}" → ${target.toStageSlug} (sin LLM)`,
  };
}
