import { type DbClient, subscribers } from '@dm-api/db';
import { eq } from 'drizzle-orm';

/**
 * Pausa al lead al escalar a humano (ADR-0025 Fase B). Mientras está pausado,
 * `isSubscriberActive()` bloquea el dispatch de nuevos turnos, así que el thread
 * LangGraph suspendido en `interrupt()` no recibe `invoke` frescos hasta que un
 * humano lo reanuda vía `Command`.
 */
export async function pauseSubscriberForHandoff(db: DbClient, subscriberId: string): Promise<void> {
  await db
    .update(subscribers)
    .set({ status: 'paused', pausedUntil: null })
    .where(eq(subscribers.id, subscriberId));
}
