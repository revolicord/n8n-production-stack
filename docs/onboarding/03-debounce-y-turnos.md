# 03 · Debounce y turnos

El corazón del sistema. Si esto no funciona perfecto, todo lo demás es decorado.

## Resumen del algoritmo

**Trailing debounce con timer reset, token de cancelación, max wait y lock de turno.**

- **Trailing**: solo se procesa cuando han pasado N segundos sin actividad nueva.
- **Timer reset**: cada mensaje reinicia el contador.
- **Token de cancelación**: cada mensaje genera un token único; el job programado solo se ejecuta si el token sigue siendo el último.
- **Max wait**: si el usuario lleva más de M segundos escribiendo sin parar, se despacha igualmente.
- **Lock de turno**: mientras n8n procesa, los mensajes nuevos se acumulan en el buffer pero **no** disparan otro turno hasta que el actual cierra.

## Constantes (todas configurables por tenant)

```ts
const DEFAULTS = {
  DEBOUNCE_MS: 15_000,       // ventana sin actividad para disparar (default real en config.ts)
  MAX_WAIT_MS: 30_000,       // techo absoluto
  LOCK_TTL_MS: 90_000,       // mientras n8n + LLM responden
  BUFFER_HARD_LIMIT: 20,     // si llega 21º mensaje, dispatch inmediato
  IDEMP_TTL_MS: 24 * 3600 * 1000,
  RATE_PER_MINUTE: 20,       // mensajes por suscriptor por minuto
};
```

## Recepción del mensaje

```ts
// apps/api/src/routes/webhook-manychat.ts
async function handleManyChatWebhook(req, reply) {
  // 1. Verificar token
  if (req.headers['x-mc-token'] !== process.env.MC_WEBHOOK_TOKEN) {
    return reply.code(401).send();
  }

  // 2. Parsear y validar con Zod
  const event = ManyChatWebhookSchema.parse(req.body);
  const { tenant, subscriber, text, externalMessageId, mediaUrls } = event;

  // 3. Idempotencia
  const hash = sha256(`${tenant.id}:${subscriber.id}:${externalMessageId}`);
  const fresh = await redis.set(`idemp:${hash}`, '1', 'NX', 'EX', 86400);
  if (!fresh) {
    log.info({ hash }, 'duplicate webhook, skipping');
    return reply.code(200).send();
  }

  // 4. Persist raw (antes del ACK, audit-first)
  const messageId = await db.insertMessageRaw({
    tenant_id: tenant.id,
    subscriber_id: subscriber.id,
    idempotency_hash: hash,
    direction: 'in',
    payload: req.body,
    text,
    media_urls: mediaUrls,
    external_message_id: externalMessageId,
  });

  // 5. Rate limit
  const allowed = await rateLimiter.check(tenant.id, subscriber.id);
  if (!allowed) {
    log.warn({ tenant: tenant.id, subscriber: subscriber.id }, 'rate limited');
    // No 429: respondemos 200 para que ManyChat no reintente,
    // pero no encolamos. Audit queda en messages_raw.
    return reply.code(200).send();
  }

  // 6. Debounce push (Lua atómico)
  const token = randomUUID();
  const result = await redis.eval(
    DEBOUNCE_PUSH_LUA,
    3,
    `buffer:${tenant.id}:${subscriber.id}`,
    `debounce:${tenant.id}:${subscriber.id}`,
    `firstmsg:${tenant.id}:${subscriber.id}`,
    JSON.stringify({ id: messageId, text, ts: Date.now(), media_urls: mediaUrls }),
    token,
    String(tenant.config.debounce_ms ?? DEFAULTS.DEBOUNCE_MS),
    String(tenant.config.max_wait_ms ?? DEFAULTS.MAX_WAIT_MS),
    String(Date.now()),
  );

  // 7. Programar BullMQ job
  await processBatchQueue.add(
    'process-batch',
    { tenantId: tenant.id, subscriberId: subscriber.id, token },
    {
      delay: tenant.config.debounce_ms ?? DEFAULTS.DEBOUNCE_MS,
      jobId: `dbnc:${tenant.id}:${subscriber.id}:${token}`,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail:     { age: 86400 },
    },
  );

  // 8. Verificar buffer hard limit
  const bufferLen = await redis.llen(`buffer:${tenant.id}:${subscriber.id}`);
  if (bufferLen >= DEFAULTS.BUFFER_HARD_LIMIT) {
    // Dispatch inmediato sin esperar a que expire el debounce
    await processBatchQueue.add(
      'process-batch',
      { tenantId: tenant.id, subscriberId: subscriber.id, token, reason: 'hard_limit' },
      { jobId: `dbnc:${tenant.id}:${subscriber.id}:${token}:force` },
    );
  }

  // 9. ACK rápido a ManyChat
  return reply.code(200).send();
}
```

## Ejecución del batch (worker BullMQ)

```ts
// apps/api/src/workers/process-batch.worker.ts
processBatchWorker.process(async (job) => {
  const { tenantId, subscriberId, token, reason } = job.data;
  const log = baseLog.child({ tenantId, subscriberId, token, jobId: job.id });

  // 1. ¿El token sigue vigente?
  const currentToken = await redis.get(`debounce:${tenantId}:${subscriberId}`);
  const firstMsgTs = await redis.get(`firstmsg:${tenantId}:${subscriberId}`);

  const isLatest = currentToken === token;
  const exceededMaxWait = firstMsgTs &&
    (Date.now() - parseInt(firstMsgTs, 10)) >= MAX_WAIT_MS;
  const isForced = reason === 'hard_limit';

  if (!isLatest && !exceededMaxWait && !isForced) {
    log.debug('stale token, abort');
    return { skipped: 'stale' };
  }

  // 2. Adquirir lock de turno
  const turnId = randomUUID();
  const acquired = await redis.set(
    `lock:turn:${tenantId}:${subscriberId}`,
    turnId,
    'NX', 'PX', LOCK_TTL_MS,
  );
  if (!acquired) {
    // Ya hay un turno en curso. El callback de turn-completed
    // se encargará de relanzar si quedan mensajes.
    log.debug('turn locked, will be picked up after current turn completes');
    return { skipped: 'locked' };
  }

  // 3. Drenar buffer atómicamente (Lua: LRANGE + DEL)
  const messages = await redis.eval(
    DRAIN_BUFFER_LUA, 1,
    `buffer:${tenantId}:${subscriberId}`,
  );
  await redis.del(`firstmsg:${tenantId}:${subscriberId}`);

  if (!messages.length) {
    await redis.del(`lock:turn:${tenantId}:${subscriberId}`);
    return { skipped: 'empty' };
  }

  // 4. Crear turn pending
  const conversation = await db.getOrCreateOpenConversation(tenantId, subscriberId);
  const turn = await db.insertTurn({
    id: turnId,
    tenant_id: tenantId,
    conversation_id: conversation.id,
    subscriber_id: subscriberId,
    batch_size: messages.length,
    batch_text: messages.map(m => m.text).join('\n'),
    batch_message_ids: messages.map(m => m.id),
    status: 'pending',
  });

  // 5. Fan-out a n8n
  try {
    await dispatchToN8n({
      turn,
      conversation,
      messages,
      callbackUrl: `${process.env.PUBLIC_API_URL}/admin/turn-completed`,
      callbackToken: process.env.N8N_CALLBACK_TOKEN,
    });
    await db.updateTurn(turnId, { status: 'dispatched', dispatched_at: new Date() });
  } catch (err) {
    await releaseLockAndDLQ(turnId, err);
    throw err; // BullMQ reintenta
  }

  return { turnId, batchSize: messages.length };
}, { concurrency: 10 });
```

## Callback desde n8n (turn-completed)

```ts
// apps/api/src/routes/admin/turn-completed.ts
async function handleTurnCompleted(req, reply) {
  if (req.headers['authorization'] !== `Bearer ${process.env.N8N_CALLBACK_TOKEN}`) {
    return reply.code(401).send();
  }

  const { turnId, status, responseText, inputTokens, outputTokens,
          costUsd, n8nExecutionId, error } = TurnCompletedSchema.parse(req.body);

  const turn = await db.updateTurn(turnId, {
    status, response_text: responseText,
    input_tokens: inputTokens, output_tokens: outputTokens,
    cost_usd: costUsd, n8n_execution_id: n8nExecutionId,
    error, completed_at: new Date(),
  });

  // Actualizar conversation
  await db.updateConversation(turn.conversation_id, {
    last_bot_msg_at: new Date(),
  });

  // Liberar lock
  await redis.del(`lock:turn:${turn.tenant_id}:${turn.subscriber_id}`);

  // ¿Quedan mensajes en el buffer? (llegaron mientras n8n procesaba)
  const pending = await redis.llen(`buffer:${turn.tenant_id}:${turn.subscriber_id}`);
  if (pending > 0) {
    // Disparar nuevo turno inmediatamente
    const newToken = randomUUID();
    await redis.set(
      `debounce:${turn.tenant_id}:${turn.subscriber_id}`,
      newToken,
      'PX', DEBOUNCE_MS,
    );
    await processBatchQueue.add(
      'process-batch',
      { tenantId: turn.tenant_id, subscriberId: turn.subscriber_id,
        token: newToken, reason: 'post_lock_drain' },
      { delay: 100, jobId: `dbnc:${turn.tenant_id}:${turn.subscriber_id}:${newToken}` },
    );
  }

  return reply.code(204).send();
}
```

## Casos edge cubiertos

| Caso | Comportamiento |
|---|---|
| Mensaje duplicado por reintento de ManyChat | Idempotencia Redis lo descarta, `messages_raw` no se duplica (UNIQUE) |
| Usuario manda 50 mensajes en 5s | Hard limit a los 20, dispatch forzado, resto entra en próximo turno |
| Usuario sigue escribiendo más allá de max_wait | Dispatch al alcanzar max_wait, no espera infinito |
| n8n cae justo al despachar | BullMQ reintenta con backoff exponencial; tras N fallos → DLQ |
| n8n procesa pero el callback se pierde | Lock con TTL 90s expira solo, próximo mensaje genera nuevo turno |
| Mensaje llega durante el lock | Se acumula en buffer; al recibir callback, se dispara nuevo turno |
| Worker api-worker reinicia con jobs en vuelo | BullMQ recupera desde Redis (`stalled jobs`) |
| Redis se cae | API responde 503 al webhook; ManyChat reintenta. **Persistencia AOF** mitiga la pérdida |
| Postgres se cae | API responde 503 (no podemos auditar → no podemos garantizar idempotencia) |
| Token de Redis 7 con `EXPIRE LT/GT` keyspace notifications | **No se usa**: BullMQ con delay es más fiable |
| Dos workers procesan el mismo job (BullMQ stalled) | El check de `currentToken === token` los hace idempotentes |
| Reloj del servidor desincronizado | TTLs en Redis se calculan relativos al server, no afecta |

## Métricas a emitir desde aquí

- `debounce_messages_received_total{tenant}` (counter)
- `debounce_messages_duplicated_total{tenant}` (idempotencia)
- `debounce_messages_rate_limited_total{tenant}`
- `debounce_batch_size{tenant}` (histogram)
- `debounce_wait_duration_ms{tenant}` (histogram, desde primer msg hasta dispatch)
- `turn_dispatched_total{tenant, status}`
- `turn_duration_ms{tenant}` (desde dispatched_at hasta completed_at)
- `turn_failed_total{tenant, reason}`
- `dlq_size{tenant}` (gauge)

## Tests obligatorios

- Unit: el script Lua de debounce (con `ioredis-mock` o redis real en CI).
- Unit: el lock con dos workers concurrentes simulando race.
- Integration: webhook → batch → callback → conversación cerrada (con docker-compose en CI).
- Property test: el batch resultante = orden cronológico de mensajes recibidos, sin duplicados ni huecos.
- Chaos: matar Redis durante una ráfaga; verificar que tras recovery no se procesan duplicados.
