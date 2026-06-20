import type { DialogueCommand } from '@dm-api/shared';
import type { AssembledContext } from '../../core/context/assemble.js';

/**
 * Circuit breaker / detector de atasco para la "cola caótica" (optimización de
 * costo, complemento del fast-path). El fast-path acota el costo del turno NORMAL
 * (el 👍 a cero tokens); este breaker acota el costo de la conversación
 * PATOLÓGICA: el lead que da vueltas 20 turnos en la misma etapa sin avanzar y le
 * sangra dinero al dueño del setter. Optimizar tokens reduce la media; el breaker
 * controla la cola (la distribución), que es donde realmente se fuga el presupuesto.
 *
 * Es un gate DETERMINISTA (cero tokens) análogo al fast-path: solo se evalúa cuando
 * el turno IBA a caer al LLM (el fast-path ya no aplicó). Cuando el lead lleva
 * `max_turns_in_stage` turnos completados en la etapa actual SIN avanzar, corta:
 *  - `handoff` (default): emite `HumanHandoff` → reusa toda la maquinaria de
 *    escalación (interrupt + notificación Telegram + pausa). No pierde el lead.
 *  - `disqualify`: avanza por la transición declarada `trigger:'deny'` desde la
 *    etapa; si no hay ninguna, cae a `handoff` (nunca descalifica a ciegas).
 *
 * Modo CONSERVADOR: no dispara en etapas terminales (is_terminal), ni si ya hay una
 * escalación abierta o un repair_context activo (un humano ya está en el caso).
 */
export interface StuckBreakerResult {
  command: DialogueCommand;
  reason: string;
}

/**
 * Por qué NO disparó el breaker (observabilidad, análogo a fast_path_skip_reason):
 *  - `disabled`         → el tenant lo apagó (`stuck_detector.enabled = false`).
 *  - `exempt_stage`     → etapa terminal o listada en `exempt_stages`.
 *  - `already_handling` → ya hay escalación abierta o repair_context (humano en el caso).
 *  - `under_threshold`  → aún no llega a `max_turns_in_stage` (caso normal).
 */
export type StuckBreakerSkipReason =
  | 'disabled'
  | 'exempt_stage'
  | 'already_handling'
  | 'under_threshold';

export type StuckBreakerDecision =
  | { kind: 'break'; result: StuckBreakerResult }
  | { kind: 'pass'; skipReason: StuckBreakerSkipReason };

/** Turnos en la misma etapa antes de cortar, por defecto. Un lead sano avanza cada 1–3. */
export const DEFAULT_MAX_TURNS_IN_STAGE = 10;

interface ResolvedStuckConfig {
  enabled: boolean;
  maxTurns: number;
  action: 'handoff' | 'disqualify';
  exemptStages: Set<string>;
}

/** Resuelve la config efectiva (defaults del sistema + override del tenant). */
function resolveStuckConfig(ctx: AssembledContext): ResolvedStuckConfig {
  const cfg = ctx.tenantConfig.stuck_detector;
  return {
    enabled: cfg?.enabled ?? true,
    maxTurns: cfg?.max_turns_in_stage ?? DEFAULT_MAX_TURNS_IN_STAGE,
    action: cfg?.action ?? 'handoff',
    exemptStages: new Set(cfg?.exempt_stages ?? []),
  };
}

/** Comando de escalación a humano (reusa el flujo de handoff con interrupt nativo). */
function handoffCommand(ctx: AssembledContext, turns: number): StuckBreakerResult {
  const reason = `stuck_detector: ${turns} turnos en la etapa "${ctx.currentStage}" sin avanzar`;
  return {
    command: {
      type: 'HumanHandoff',
      kind: 'agent',
      reason,
      summary: `El lead lleva ${turns} turnos en "${ctx.currentStage}" sin progresar. Posible confusión o caso fuera de guion — requiere intervención humana.`,
      source: 'code',
    },
    reason: `stuck-breaker (handoff): ${reason}`,
  };
}

export function tryStuckBreaker(ctx: AssembledContext): StuckBreakerDecision {
  const cfg = resolveStuckConfig(ctx);
  if (!cfg.enabled) return { kind: 'pass', skipReason: 'disabled' };

  // Etapas terminales (is_terminal) se eximen solas: un lead aparcado en
  // 'booked'/'disqualified' no debe escalarse. Más las listadas por el tenant.
  const stage = ctx.funnelStages.find((s) => s.slug === ctx.currentStage);
  if (stage?.isTerminal || cfg.exemptStages.has(ctx.currentStage)) {
    return { kind: 'pass', skipReason: 'exempt_stage' };
  }

  // Un humano ya está en el caso: no escalar dos veces ni interrumpir una reparación.
  if (ctx.dialogueState.repair_context || ctx.handoffState?.open_escalations.length) {
    return { kind: 'pass', skipReason: 'already_handling' };
  }

  if (ctx.turnsInCurrentStage < cfg.maxTurns) {
    return { kind: 'pass', skipReason: 'under_threshold' };
  }

  // Atasco confirmado → cortar de forma determinista.
  if (cfg.action === 'disqualify') {
    const denyEdge = ctx.transitions.find(
      (t) => t.fromStageSlug === ctx.currentStage && t.trigger === 'deny',
    );
    if (denyEdge) {
      const reason = `stuck_detector: ${ctx.turnsInCurrentStage} turnos en "${ctx.currentStage}" sin avanzar → descalifica`;
      return {
        kind: 'break',
        result: {
          command: {
            type: 'ChangeStage',
            to_stage: denyEdge.toStageSlug,
            reason: 'stuck_detector',
            evidence: reason,
            cascade: true,
            system_authorized: false,
          },
          reason: `stuck-breaker (disqualify): ${reason}`,
        },
      };
    }
    // Sin transición 'deny' declarada → no descalificamos a ciegas: escalamos.
  }

  return { kind: 'break', result: handoffCommand(ctx, ctx.turnsInCurrentStage) };
}
