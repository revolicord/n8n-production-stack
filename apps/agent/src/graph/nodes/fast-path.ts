import type { DialogueCommand, TurnInput } from '@dm-api/shared';
import type { AssembledContext } from '../../core/context/assemble.js';

/**
 * Fast-path determinista del "camino feliz" (optimización de tokens, modo
 * CONSERVADOR): cuando el lead da una señal positiva inequívoca en una etapa
 * `flow_only` con un único avance posible, NO llamamos al LLM — emitimos el
 * `ChangeStage(cascade)` directamente. El flow de la nueva etapa entrega el
 * contenido. Esto es "ponerlo en memoria sin pensar": cero tokens en el turno.
 *
 * El destino se DECLARA, no se infiere de la topología: el motor toma la
 * transición marcada `trigger: 'affirm'` (camino feliz). No cuenta aristas ni
 * depende de `is_terminal` — robusto ante bifurcaciones (B→C 'affirm' + B→nurture
 * 'deny' conviven sin ambigüedad).
 *
 * Ante la MÍNIMA ambigüedad devuelve `{ kind: 'llm', skipReason }` (el turno cae
 * al LLM) y `skipReason` deja por escrito CUÁL compuerta lo rechazó:
 *  - la etapa no es `flow_only`;
 *  - no hay ninguna transición `trigger: 'affirm'` desde la etapa (sin avance feliz);
 *  - hay >1 transición `trigger: 'affirm'` (destino ambiguo, mal configurado);
 *  - hay un `repair_context` o escalaciones abiertas (no es camino feliz);
 *  - hay `system_commands` inyectados (eventos de sistema → flujo normal);
 *  - algún mensaje no es texto (audio/imagen/… → posible escalado);
 *  - el texto contiene una pregunta, o no es una señal positiva exacta.
 */
export interface FastPathResult {
  commands: DialogueCommand[];
  reason: string;
}

/**
 * Por qué el turno NO tomó el fast-path y cayó al LLM. Cada valor corresponde a
 * exactamente una compuerta de `tryFastPath`, en orden. Se persiste en la traza
 * (`fast_path_skip_reason`) para diagnosticar sin leer código:
 *  - `has_system_commands`  → llegó un evento de sistema (webhook) → flujo normal.
 *  - `no_messages`          → turno sin mensajes del lead.
 *  - `non_text_message`     → audio/imagen/etc. → posible escalado, no es feliz.
 *  - `not_positive_signal`  → el texto no es señal positiva exacta (o es pregunta).
 *  - `repair_context_active`→ hay reparación/handoff en curso.
 *  - `open_escalation`      → hay una escalación a humano abierta.
 *  - `stage_not_flow_only`  → la etapa NO está en política `flow_only`.
 *  - `no_affirm_transition` → ninguna transición con `trigger:'affirm'` (sin avance feliz).
 *  - `ambiguous_target`     → >1 transición `trigger:'affirm'` (mal configurado).
 */
export type FastPathSkipReason =
  | 'has_system_commands'
  | 'no_messages'
  | 'non_text_message'
  | 'not_positive_signal'
  | 'repair_context_active'
  | 'open_escalation'
  | 'stage_not_flow_only'
  | 'no_affirm_transition'
  | 'ambiguous_target';

/** Resultado explícito de evaluar el fast-path: o avanza sin LLM, o dice por qué no. */
export type FastPathDecision =
  | { kind: 'fast_path'; result: FastPathResult }
  | { kind: 'llm'; skipReason: FastPathSkipReason };

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

export function tryFastPath(input: TurnInput, ctx: AssembledContext): FastPathDecision {
  // Sólo turnos puros del lead: si hay system_commands, va por el flujo normal.
  if (input.system_commands.length > 0) return { kind: 'llm', skipReason: 'has_system_commands' };
  if (input.messages.length === 0) return { kind: 'llm', skipReason: 'no_messages' };

  // Todos los mensajes deben ser texto y señal positiva inequívoca.
  for (const m of input.messages) {
    if (m.content_class !== 'text') return { kind: 'llm', skipReason: 'non_text_message' };
    if (!m.text || !isPositiveSignal(m.text))
      return { kind: 'llm', skipReason: 'not_positive_signal' };
  }

  // No estamos en camino feliz si hay reparación o escalación activa.
  if (ctx.dialogueState.repair_context) return { kind: 'llm', skipReason: 'repair_context_active' };
  if (ctx.handoffState?.open_escalations.length)
    return { kind: 'llm', skipReason: 'open_escalation' };

  // La etapa debe ser flow_only.
  const policy =
    ctx.tenantConfig.text_policy_by_stage?.[ctx.currentStage] ??
    ctx.tenantConfig.text_policy_default ??
    'text_ok';
  if (policy !== 'flow_only') return { kind: 'llm', skipReason: 'stage_not_flow_only' };

  // Destino DECLARADO: la transición marcada `trigger: 'affirm'` es el avance del
  // camino feliz. Se lee del dato, no se infiere contando aristas ni mirando
  // is_terminal — así una bifurcación legítima (B→C 'affirm' + B→nurture 'deny')
  // no rompe el determinismo. 0 'affirm' ⟹ etapa sin avance feliz; >1 ⟹ mal config.
  const affirmEdges = ctx.transitions.filter(
    (t) => t.fromStageSlug === ctx.currentStage && t.trigger === 'affirm',
  );
  if (affirmEdges.length === 0) return { kind: 'llm', skipReason: 'no_affirm_transition' };
  if (affirmEdges.length > 1) return { kind: 'llm', skipReason: 'ambiguous_target' };
  const target = affirmEdges[0];
  if (!target) return { kind: 'llm', skipReason: 'no_affirm_transition' };

  const command: DialogueCommand = {
    type: 'ChangeStage',
    to_stage: target.toStageSlug,
    reason: null,
    evidence: 'fast-path: señal positiva clara del lead en etapa flow_only',
    cascade: true,
    system_authorized: false,
  };

  return {
    kind: 'fast_path',
    result: {
      commands: [command],
      reason: `fast-path determinista: señal positiva en etapa flow_only "${ctx.currentStage}" → ${target.toStageSlug} (sin LLM)`,
    },
  };
}
