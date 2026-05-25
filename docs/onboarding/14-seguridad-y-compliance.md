# 14 · Seguridad y compliance

Una agencia de marketing trabaja con datos personales reales de usuarios de Instagram. Esto importa legalmente y operativamente.

> **Estado:** buena parte de este documento es diseño aún **no implementado** (JWT admin con roles, RLS en Postgres, endpoints GDPR de export/delete). Lo activo hoy: TLS vía Traefik, `X-MC-Token` en el webhook y `N8N_CALLBACK_TOKEN` para n8n. Ver [`status.md`](../status.md).

## Capas de seguridad

### Red

- Postgres y Redis **nunca expuestos al exterior**: solo en red Docker `internal`.
- Solo Traefik tiene puertos públicos (80/443).
- Firewall de host (ufw): permitir solo SSH (clave, no password) y los dos puertos de Traefik.
- TLS automático con Traefik + Let's Encrypt.
- Considerar **Cloudflare proxy** delante para WAF y DDoS protection.

### Autenticación de webhook ManyChat

ManyChat External Request **no tiene firma HMAC nativa** (a diferencia de Stripe o Meta directo). Estrategias combinadas:

1. **Token compartido en header `X-MC-Token`**: secret de 32 bytes, rotable.
2. **IP allowlist** vía Cloudflare Firewall Rules con los rangos de salida de ManyChat (frágil, ManyChat no publica una lista oficial estable, validar y mantener).
3. **Rate limit global por IP** en Traefik/Cloudflare como defensa en profundidad.

```ts
// Verificación en Fastify
fastify.addHook('preHandler', async (req, reply) => {
  if (req.url.startsWith('/webhook/manychat')) {
    if (req.headers['x-mc-token'] !== process.env.MC_WEBHOOK_TOKEN) {
      reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }
  }
});
```

### Autenticación admin (humanos)

- **JWT con expiración corta** (1h) emitidos tras login con clave maestra.
- **Rotación de tokens**: si se compromete, basta cambiar `ADMIN_JWT_SECRET` y re-login.
- **2FA** (TOTP) si admin web entra en producción con varios usuarios.

### Autenticación n8n → API

`N8N_CALLBACK_TOKEN` distinto de `ADMIN_JWT_SECRET`. Scope limitado: solo `turn-completed`, `pause`, `unpause`, `retry`. Un token comprometido en n8n no permite acceso completo.

## Cifrado

### En tránsito

- TLS 1.3 obligatorio en Traefik (mínimo 1.2).
- HSTS habilitado (`Strict-Transport-Security`).
- Comunicación interna entre containers va por red Docker (no TLS, pero aislada). Si quieres mTLS interno, añadir certificados — overkill para un único VPS.

### En reposo

- **Disco del VPS cifrado** (LUKS) si el proveedor lo permite (Hetzner cloud no por defecto, dedicated sí).
- **Postgres**: cifrado de columnas sensibles con `pgcrypto` para `manychat_api_key_encrypted`.
- **Redis**: AOF cifrado vía sistema de archivos, no Redis nativo. Para máxima seguridad, Redis Enterprise o KeyDB con encryption-at-rest, pero usualmente no es necesario.

## PII y privacidad

### Datos sensibles que pasan por el sistema

- Nombre real del usuario de Instagram
- Username público
- ID de Instagram (no es PII grave por sí mismo)
- **Contenido de los mensajes** ← lo más sensible (puede contener teléfonos, direcciones, datos de salud, datos económicos)
- URLs firmadas de medios (caducan)

### Principios

1. **Minimización**: no almacenar más de lo necesario. Si no usas el ig_user_id, no lo guardes.
2. **Cifrado at-rest** del campo `messages_raw.payload` y `turns.batch_text` si el cliente lo exige.
3. **Redacción opcional antes de enviar al LLM**: pipeline de PII detection (regex de DNI/teléfonos/emails) y redactarlos en una copia antes de pasar al modelo. Original queda en Postgres.
4. **DPA con el proveedor LLM**: usar tier que **no entrene con los datos** (OpenAI: API tier por defecto no entrena; Anthropic: idem; Google Gemini: idem en API empresarial).
5. **Logs sin PII**: usar redact de Pino para no loggear el body completo del webhook.

### Retención

| Dato | Retención | Justificación |
|---|---|---|
| `messages_raw` | 90 días | Audit corto |
| `turns` (con respuesta y coste) | 12 meses | Métricas de negocio |
| `conversations` con resumen | indefinido | Memoria del agente |
| Logs | 30 días | Debugging |
| Backups Postgres | 30 días | Recovery |
| `idempotency` (Redis) | 24h | Solo deduplicación |
| `mem` chat history (Redis) | 12h | Memoria caliente |

Cron diario en `api-worker` que purga lo expirado:

```ts
// apps/api/src/jobs/purge-old-data.ts
export async function purgeOldData() {
  await db.query(`
    DELETE FROM api.messages_raw
    WHERE received_at < now() - interval '90 days';
  `);
  // ... etc
}
```

### GDPR / derechos del usuario

Endpoints obligatorios si la agencia opera en UE/UK:

- `POST /admin/subscribers/:id/export` → ZIP con todos los mensajes + turns del usuario.
- `DELETE /admin/subscribers/:id` → borrado completo: filas + Redis + memoria del agente. Mantener registro en `audit_log` de que se borró (sin contenido).

## Multi-tenancy

- `tenant_id` en cada clave Redis y cada fila Postgres.
- Row Level Security activado por defecto.
- Cada conexión a Postgres setea `app.tenant_id` al inicio de la transacción.
- API admin tiene scope cross-tenant solo para usuarios `admin` global. Usuarios de un cliente concreto verían solo su tenant.
- Backups: pg_dump completo, pero con scripts para extraer un único tenant si ese cliente se va o pide su data.

## Compliance Meta / Instagram

### Ventana de 24 horas

Meta limita los mensajes que el bot puede enviar al usuario tras la última interacción del usuario. **Dentro de las 24h posteriores al último mensaje del usuario**, libertad total. **Fuera**, solo:

- `HUMAN_AGENT` tag (válido hasta 7 días) **solo para soporte humano genuino**, no automatizado.
- Marketing Messages opt-in (requiere flow específico de ManyChat con consentimiento explícito).

**Implicación de código**:
- Trackear `last_user_msg_at` en `conversations`.
- Antes de enviar respuesta, calcular si estamos dentro de la ventana.
- Si no, marcar el turn con `status: 'window_expired'` y no enviar (o usar tag legítimo).

### Rate limits del Send API

- Texto: ~100 calls/s
- Audio/vídeo: ~10 calls/s
- Private replies: 750/h
- Business use case: 4800 × impresiones / 24h

Implementar **leaky bucket en el envío** (lado n8n o código) para no exceder.

### Anti-spam

- Detección de patrones de spam saliente (mismo mensaje a muchos usuarios).
- Listas negras de subscribers reportados.
- Alta tasa de bloqueos por usuarios → riesgo de ban de cuenta. Monitorear.

## Secretos en el repo

- **Nunca** commitear `.env`, `.env.production`, claves, tokens.
- `.gitignore` riguroso.
- Usar **git-secrets** o **gitleaks** en pre-commit hook.
- Si se filtra un secreto: rotación inmediata, revisión de logs.

## Hardening de Postgres

- Usuario de aplicación con permisos solo a su schema.
- Usuario `n8n_reader` con SELECT-only en `api`.
- `pg_hba.conf` solo accepta conexiones desde la red Docker.
- Conexiones cifradas con SSL (`sslmode=require` en DATABASE_URL).

## Hardening de Redis

- `requirepass` obligatorio.
- `rename-command FLUSHDB ""`, `rename-command FLUSHALL ""`, `rename-command CONFIG ""` para evitar comandos peligrosos.
- `protected-mode yes`.
- No exponer puerto 6379 al host.

## Auditoría

Toda acción admin pasa por `api.audit_log`:

```ts
async function pauseSubscriber(actor: string, subscriberId: string, until: Date) {
  await db.transaction(async (tx) => {
    await tx.update(subscribers).set({ status: 'paused', paused_until: until }).where(eq(subscribers.id, subscriberId));
    await tx.insert(auditLog).values({
      actor, action: 'pause_subscriber',
      target_type: 'subscriber', target_id: subscriberId,
      metadata: { until: until.toISOString() },
    });
  });
}
```

Auditable: quién hizo qué, cuándo y por qué.

## Plan de respuesta a incidentes

Documento separado con:

1. Detección (alerta llega).
2. Triage (¿es real?, ¿qué impacto?).
3. Mitigación (rollback, pausar tenant, etc.).
4. Comunicación (clientes afectados).
5. Postmortem (qué pasó, qué cambiamos).

Para una agencia con n clientes, esto evita pánico cuando algo se rompe.
