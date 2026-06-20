import type { DbClient, Turn } from '@dm-api/db';
import { messagesRaw } from '@dm-api/db';
import { mediaPlaceholder } from '@dm-api/shared';
import type { ContentClass } from '@dm-api/shared';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { TranscriptMessage } from '../context/assemble.js';

/** Presupuesto de tokens por defecto del transcript (ver `transcript_max_tokens`). */
export const DEFAULT_TRANSCRIPT_MAX_TOKENS = 1200;

/** Mensajes recientes que SIEMPRE se conservan aunque excedan el presupuesto. */
const MIN_KEPT_MESSAGES = 4;

export async function buildTranscript(
  db: DbClient,
  args: {
    tenantId: string;
    subscriberId: string;
    maxTurns: number;
    /** Presupuesto de tokens; tras la compresión se conservan los mensajes recientes
     *  que entren. Default `DEFAULT_TRANSCRIPT_MAX_TOKENS`. */
    maxTokens?: number;
    recentTurns: Pick<Turn, 'responseText' | 'startedAt' | 'completedAt'>[];
  },
): Promise<TranscriptMessage[]> {
  // Determine cutoff: go back far enough to cover maxTurns
  const cutoffTurn = args.recentTurns[args.recentTurns.length - 1];
  const cutoff = cutoffTurn?.startedAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(messagesRaw)
    .where(
      and(
        eq(messagesRaw.tenantId, args.tenantId),
        eq(messagesRaw.subscriberId, args.subscriberId),
        gte(messagesRaw.receivedAt, cutoff),
      ),
    )
    .orderBy(desc(messagesRaw.receivedAt))
    .limit(args.maxTurns * 5);

  const sorted = rows.reverse();
  const messages: TranscriptMessage[] = [];

  for (const row of sorted) {
    if (row.direction === 'in') {
      const text =
        row.text ??
        mediaPlaceholder(
          ((row.payload as { content_class?: string }).content_class as ContentClass) ?? 'unknown',
        );
      messages.push({ role: 'user', content: text });
    } else if (row.direction === 'out') {
      const text = row.text ?? '[contenido enviado]';
      messages.push({ role: 'assistant', content: text });
    }
  }

  // Compresión lossless + recorte por presupuesto. Resumir por LLM costaría más de lo
  // que ahorra en conversaciones triviales (3 👍 = 0 info nueva); el estado estructurado
  // (etapa + slots) ya resume lo que se "consumió", así que descartar lo viejo es seguro.
  const compressed = collapseTrivialRuns(messages);
  return trimToTokenBudget(compressed, args.maxTokens ?? DEFAULT_TRANSCRIPT_MAX_TOKENS);
}

/** Normaliza para comparar duplicados consecutivos (👍 / 👍 / 👍 → uno solo). */
function normalizeForCollapse(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Compresión LOSSLESS: colapsa runs consecutivos del MISMO rol con contenido idéntico
 * (típico de la cola caótica: tres pulgares seguidos, "ok ok ok"). Se conserva UN
 * representante anotado con `(×N)` para no perder la señal de repetición. No invoca al
 * LLM ni descarta información: solo elimina redundancia exacta y barata.
 */
export function collapseTrivialRuns(messages: TranscriptMessage[]): TranscriptMessage[] {
  const out: Array<TranscriptMessage & { count: number }> = [];
  for (const msg of messages) {
    const last = out[out.length - 1];
    if (
      last &&
      last.role === msg.role &&
      normalizeForCollapse(last.content) === normalizeForCollapse(msg.content)
    ) {
      last.count += 1;
      continue;
    }
    out.push({ ...msg, count: 1 });
  }
  return out.map(({ role, content, count }) => ({
    role,
    content: count > 1 ? `${content} (×${count})` : content,
  }));
}

/** Estimación de tokens (español ≈ 3.5 chars/token) + overhead por mensaje. */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 3.5) + 4;
}

/**
 * Conserva los mensajes MÁS RECIENTES que entren en el presupuesto de tokens. Siempre
 * mantiene los últimos `MIN_KEPT_MESSAGES` (coherencia local mínima) aunque excedan.
 * Lo viejo se descarta sin resumir: el estado estructurado ya lleva lo consumido.
 */
export function trimToTokenBudget(
  messages: TranscriptMessage[],
  maxTokens: number,
): TranscriptMessage[] {
  let budget = maxTokens;
  const kept: TranscriptMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    const cost = estimateTokens(msg.content);
    const mustKeep = messages.length - i <= MIN_KEPT_MESSAGES;
    if (!mustKeep && cost > budget) break;
    budget -= cost;
    kept.push(msg);
  }
  return kept.reverse();
}
