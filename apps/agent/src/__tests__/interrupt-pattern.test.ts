import {
  Annotation,
  Command,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';

/**
 * Valida la semántica de interrupt()/Command de LangGraph 1.x sobre la que se
 * construye el handoff nativo (ADR-0025 Fase B):
 *  1. El primer invoke que alcanza interrupt() suspende y expone __interrupt__.
 *  2. El Command({resume}) reanuda y el nodo se RE-EJECUTA desde el inicio
 *     (el código previo a interrupt() corre dos veces) → de ahí el guard.
 *  3. Con el guard, el efecto secundario de suspensión ocurre UNA sola vez.
 */
describe('LangGraph interrupt/resume semantics (handoff Fase B)', () => {
  const State = Annotation.Root({
    handoffPersisted: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
    resolvedBy: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  });

  it('suspends, re-runs the node on resume, and guards the side-effect to once', async () => {
    // "dialogue_states" simulado: el guard de re-ejecución.
    let persisted = false;
    let sideEffectCount = 0;

    const node = (_state: typeof State.State) => {
      if (!persisted) {
        // Bloque de SUSPENSIÓN (debe correr una sola vez gracias al guard).
        sideEffectCount += 1;
        persisted = true;
      }
      const resume = interrupt<{ reason: string }, { resolved_by: string }>({ reason: 'test' });
      // Sólo se llega aquí en la pasada de RESUME.
      return { handoffPersisted: true, resolvedBy: resume.resolved_by };
    };

    const graph = new StateGraph(State)
      .addNode('handoff', node)
      .addEdge(START, 'handoff')
      .compile({ checkpointer: new MemorySaver() });

    const cfg = { configurable: { thread_id: 't1' } };

    // 1. Primer invoke → suspende.
    const first = (await graph.invoke({}, cfg)) as Record<string, unknown> & {
      __interrupt__?: unknown[];
    };
    expect(first.__interrupt__).toBeDefined();
    expect(Array.isArray(first.__interrupt__)).toBe(true);
    expect(sideEffectCount).toBe(1);

    // El thread quedó suspendido (hay nodo pendiente).
    const snap = await graph.getState(cfg);
    expect(snap.next.length).toBeGreaterThan(0);

    // 2. Resume con Command → reanuda y completa.
    const second = await graph.invoke(new Command({ resume: { resolved_by: 'ana' } }), cfg);
    expect(second.handoffPersisted).toBe(true);
    expect(second.resolvedBy).toBe('ana');

    // 3. El guard evitó duplicar el efecto pese a re-ejecutarse el nodo.
    expect(sideEffectCount).toBe(1);

    // Ya no quedan nodos pendientes.
    const snap2 = await graph.getState(cfg);
    expect(snap2.next.length).toBe(0);
  });
});
