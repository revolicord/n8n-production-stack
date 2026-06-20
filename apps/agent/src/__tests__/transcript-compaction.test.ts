import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '../core/context/assemble.js';
import { collapseTrivialRuns, trimToTokenBudget } from '../core/memory/transcript.js';

describe('collapseTrivialRuns (compresión lossless)', () => {
  it('colapsa 3 pulgares seguidos del lead en uno anotado (×3)', () => {
    const msgs: TranscriptMessage[] = [
      { role: 'user', content: '👍' },
      { role: 'user', content: '👍' },
      { role: 'user', content: '👍' },
    ];
    const out = collapseTrivialRuns(msgs);
    expect(out).toHaveLength(1);
    expect(out[0]?.content).toBe('👍 (×3)');
  });

  it('NO colapsa mensajes distintos ni de roles distintos', () => {
    const msgs: TranscriptMessage[] = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'hola' },
      { role: 'user', content: 'ok' },
    ];
    expect(collapseTrivialRuns(msgs)).toHaveLength(3);
  });

  it('normaliza para colapsar ("OK" / "ok " son el mismo)', () => {
    const msgs: TranscriptMessage[] = [
      { role: 'user', content: 'OK' },
      { role: 'user', content: 'ok ' },
    ];
    const out = collapseTrivialRuns(msgs);
    expect(out).toHaveLength(1);
    expect(out[0]?.content).toBe('OK (×2)');
  });
});

describe('trimToTokenBudget (recorte por presupuesto)', () => {
  it('conserva los mensajes más recientes dentro del presupuesto', () => {
    const msgs: TranscriptMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `mensaje de ejemplo número ${i} con bastante texto para sumar tokens`,
    }));
    const out = trimToTokenBudget(msgs, 200);
    expect(out.length).toBeLessThan(msgs.length);
    // Se conserva la cola (lo más reciente), no la cabeza.
    expect(out[out.length - 1]?.content).toContain('29');
  });

  it('siempre conserva al menos los últimos 4 aunque excedan el presupuesto', () => {
    const msgs: TranscriptMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      content: `texto largo repetido para superar el presupuesto pequeño ${i}`,
    }));
    const out = trimToTokenBudget(msgs, 1);
    expect(out).toHaveLength(4);
  });

  it('no toca un transcript que cabe en el presupuesto', () => {
    const msgs: TranscriptMessage[] = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'qué tal' },
    ];
    expect(trimToTokenBudget(msgs, 1000)).toHaveLength(2);
  });
});
