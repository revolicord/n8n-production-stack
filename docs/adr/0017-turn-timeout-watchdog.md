# ADR-0017: Turn Timeout Watchdog (Deuda Técnica)

**Status:** Proposed — pendiente de implementación  
**Date:** 2026-05-22  
**Deciders:** Equipo Revolicord

---

## Y-Statement

> _In the context of_ un sistema donde el API despacha turns a n8n y espera que n8n llame back a `/admin/turn-completed` para liberar el lock,  
> _facing_ el escenario en que n8n se cuelga, crashea o excede el TTL del lock sin llamar back, dejando al usuario sin respuesta y el turn en estado `dispatched` indefinidamente,  
> _we decided_ implementar un watchdog periódico que detecta turns huérfanos usando la existencia del lock en Redis como señal (no el tiempo transcurrido),  
> _to achieve_ recuperación automática cuando n8n falla silenciosamente, sin afectar turns que legítimamente tardan varios minutos,  
> _accepting_ una latencia de detección igual al intervalo del watchdog (propuesto: 30s).

---

## Contexto

### Flujo actual

```
processBatchJob
  → tryAcquireTurnLock(ttl = LOCK_TTL_MS)   # default 90s
  → dispatchToN8n()
  → markTurnDispatched()
  ← (n8n procesa...)
  ← POST /admin/turn-completed
      → completeTurn()
      → releaseTurnLock()
      → post-lock drain si hay mensajes pendientes
```

### El gap

Si n8n no llama back (cuelgue, crash, stack overflow como el observado en `observable-object.ts`):

| Condición | Comportamiento actual |
|---|---|
| Lock Redis | Expira automáticamente al cumplir `LOCK_TTL_MS` |
| Turn en DB | Queda en estado `dispatched` **para siempre** |
| Usuario que envía mensaje nuevo | El nuevo mensaje pasa (lock expiró) — se crea un turno nuevo ✓ |
| Usuario que NO envía nada más | Silencio total, nunca recibe respuesta ✗ |
| n8n termina tardísimo y llama back | `completeTurn` + intento de `releaseTurnLock` (Lua no-op seguro) |

No existe ningún proceso que detecte "el lock expiró pero el turn sigue `dispatched`" y actúe.

### Por qué el tiempo no es la señal correcta

Un watchdog que compare `dispatched_at < now() - umbral_fijo` tiene falsos positivos: n8n puede legítimamente tardar 60-90s en flows con tool calls encadenados, contexto CRM, etc. La señal correcta es **la existencia del lock en Redis**:

- Lock presente y `== turnId` → n8n todavía dentro de su ventana, no tocar
- Lock ausente (expiró por TTL) → n8n no llamó back a tiempo → turn huérfano
- Lock con valor distinto → un turn posterior tomó el lock → este turn es huérfano

---

## Decisión

### Componentes a implementar

**1. `apps/api/src/workers/watchdog.ts`**

```typescript
// Scan de turns dispatched cuyo lock ya no existe en Redis
async function watchdogJob(): Promise<void> {
  const stuckTurns = await findStuckDispatched(getDb(), {
    olderThanMs: LOCK_TTL_MS + 5000,  // margen de seguridad
  });

  for (const turn of stuckTurns) {
    const lockKey = redisKeys.lock(turn.tenantId, turn.subscriberId);
    const lockVal = await getRedis().get(lockKey);

    const isOrphaned = lockVal === null || lockVal !== turn.id;
    if (!isOrphaned) continue;

    await markTurnFailed(getDb(), { turnId: turn.id, error: 'turn_timeout' });
    await forceReleaseTurnLock(getRedis(), {
      tenantId: turn.tenantId,
      subscriberId: turn.subscriberId,
    }); // no-op seguro si ya expiró

    const pending = await getBufferLength(getRedis(), {
      tenantId: turn.tenantId,
      subscriberId: turn.subscriberId,
    });
    if (pending > 0) {
      // enqueue post_lock_drain
    }

    logger().warn({ turn_id: turn.id }, 'turn_timeout: watchdog recovered');
  }
}
```

**2. `apps/api/src/services/turns.ts`** — añadir `findStuckDispatched`:

```typescript
// SELECT * FROM turns WHERE status = 'dispatched' AND dispatched_at < now() - interval
// El filtro de tiempo es solo para limitar el scan, la verificación real es el lock en Redis
```

**3. `apps/api/src/lib/queue.ts`** — nueva queue `WATCHDOG_QUEUE` con repeatable job cada 30s.

**4. `apps/api/src/worker.ts`** — registrar el repeatable job al arrancar.

**5. `.env.example`** — documentar que `LOCK_TTL_MS` debe ser el timeout máximo real de n8n. Recomendación: `300000` (5 min) para flows con agente + herramientas.

### Invariantes a preservar

- El watchdog nunca toca un turn cuyo lock sigue activo y es del mismo `turnId`.
- `forceReleaseTurnLock` es idempotente — si el lock ya expiró, es un no-op.
- Si n8n finalmente llama back sobre un turn ya marcado `failed`, `completeTurn` debe tolerar esa condición (ignorar o loguear sin error).

---

## Consecuencias

**Positivas:**
- El usuario siempre es "desbloqueado" — si n8n falla, el próximo mensaje fluye normalmente.
- Turns huérfanos son visibles en DB como `failed` con `error = 'turn_timeout'`, no como `dispatched` eternos.
- No requiere cambios en n8n ni en el protocolo de callback.

**Negativas / trade-offs:**
- Latencia de recuperación: hasta `30s (ciclo watchdog) + tiempo hasta el próximo mensaje del usuario`.
- Si n8n tarda más de `LOCK_TTL_MS` (legítimamente), el turn se marca `failed` aunque n8n sí completó. Mitigación: subir `LOCK_TTL_MS` a 5 min.
- Añade un worker adicional (leve overhead).

---

## Alternativas descartadas

| Alternativa | Motivo de descarte |
|---|---|
| Watchdog por tiempo fijo (`dispatched_at + umbral`) | Falsos positivos en flows legítimamente lentos |
| Redis keyspace notifications (`__keyevent:expired`) | Más reactivo pero complejo de operar; requiere `notify-keyspace-events = Ex` en Redis config |
| Heartbeat desde n8n (renovar TTL) | Requiere cambios en todos los workflows n8n; más frágil |
| Timeout en BullMQ job (`timeout` option) | Solo aplica al dispatch HTTP, no al tiempo de procesamiento de n8n |
