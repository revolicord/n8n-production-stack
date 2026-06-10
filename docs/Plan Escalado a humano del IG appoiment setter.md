Plan — Escalado a humano (Telegram) + Notificaciones (audio/keywords) + Dashboard

 Contexto

 El cliente pidió tres capacidades sobre la plataforma n8n + DM Setter API:

 1. Escalado a humano vía Telegram — alertar a un humano (Alex) cuando una conversación lo requiere.
 2. Notificar si llegan audios o "palabras clave de bot" — avisos automáticos cuando el lead manda
 audio o escribe frases que sugieren que sospecha que es un bot / pide humano.
 3. Notificar también en el dashboard — que el panel muestre las escalaciones/notificaciones.

 Esta feature ya está especificada como P1 en docs/11_HANDOFF_AND_ESCALATION.md (tabla notifications,
 tool notify_human, canal a elegir, pausa por suscriptor) pero nunca se implementó. El diseño reusa
 infraestructura existente para no sobrecargar:

 - El pausado ya existe: subscribers.pausedUntil + isSubscriberActive() (apps/api/src/services/subscribers.ts:72)
 ya bloquea el dispatch. status='paused' + pausedUntil=null = pausa indefinida hasta reanudar manual.
 - El dashboard ya existe (apps/dashboard, Next.js, lee Postgres con Drizzle + proxy a /admin/*).
 - system-event.ts es el patrón exacto para endpoints admin que invoca n8n.
 - El webhook ya ve event.message.media[].type==='audio' y event.message.text antes del debounce.

 Decisiones tomadas con el usuario

 - Entrega Telegram: worker BullMQ que hace POST directo a la API de Telegram (desacoplado, con reintentos).
 - Pausa: no automática. El humano pausa/reanuda manualmente (botón Telegram o dashboard). Los leads
 pausados se muestran en rojo en el dashboard y un recordatorio periódico insiste en quitar la pausa.
 - Detección: ambas — determinista en código (audio + keywords por tenant) y tool semántico notify_human del agente n8n.
 - Telegram interactivo: botones inline [⏸ Pausar] [✅ Resuelto] → requiere webhook de callbacks de Telegram.

 ---
 Arquitectura (cómo convive con lo existente)

 PRODUCTORES de notificación ──► notifications service ──► (1) INSERT fila DB
                                                           (2) encolar job 'notify'
   A. webhook-manychat.ts (código):
        media.type==='audio'  → kind='audio'
        text ~ tenant.config.notification_keywords → kind='keyword'
        (con throttle Redis; NO bloquea el flujo de debounce)
   B. agente n8n → tool notify_human → POST /admin/leads/:id/notify-human → kind='agent'

 CONSUMIDORES:
   (1) Worker BullMQ 'notify' → POST api.telegram.org sendMessage (deep-link + botones) → guarda message_id
   (2) Dashboard → lee tabla notifications (página + badge); leads pausados en rojo
   (3) Webhook Telegram /webhook/telegram → botón Pausar/Resolver → muta DB → answerCallbackQuery + edita mensaje

 PAUSA (manual): status='paused' + pausedUntil → isSubscriberActive() ya lo respeta antes del dispatch.
 RECORDATORIO: job repetible 'pause-reminder' → re-notifica Telegram leads aún pausados.

 La frontera código-vs-n8n se respeta: el código posee auth, persistencia, colas y la alerta de ops
 (Telegram interno); n8n sigue poseyendo el razonamiento del agente (decide cuándo llamar notify_human).

 ---
 Cambios por capa

 1. Config / env (apps/api/src/config.ts, .env.example)

 Añadir al ConfigSchema (Zod, usar siempre getConfig()):
 - TELEGRAM_BOT_TOKEN (string)
 - TELEGRAM_DEFAULT_CHAT_ID (string) — fallback global
 - TELEGRAM_WEBHOOK_SECRET (string min 16) — valida el header X-Telegram-Bot-Api-Secret-Token

 Por-tenant en tenant.config (ya parseado por parseTenantConfig, sin redeploy):
 - telegram_chat_id? — override del chat por tenant (multi-tenant)
 - notification_keywords?: string[] — ej. ["humano","persona real","eres un bot","robot","operador"]

 2. Base de datos (packages/db/src/schema.ts + nueva migración drizzle/00XX_notifications.sql)

 Nueva tabla api.notifications (sigue el patrón multi-tenant con tenant_id):
 - id uuid pk, tenantId (FK tenants, cascade), subscriberId (FK subscribers), conversationId?, turnId?
 - kind text — audio | keyword | agent (semántico del agente)
 - source text — code | agent
 - reason text?, summary text? — motivo y resumen (del agente o del trigger)
 - status text default 'pending' — pending | resolved
 - telegramChatId text?, telegramMessageId text? — para editar el mensaje al resolver
 - metadata jsonb default '{}'
 - createdAt, resolvedAt?, resolvedBy text?
 - Índices: (tenantId, status, createdAt) y parcial where status='pending'.

 ▎ Migración nueva (numerada), nunca editar una ya aplicada. Aplicar con make migrate.

 3. Servicio de notificaciones (apps/api/src/services/notifications.ts — nuevo)

 - createNotification(db, {...}) → INSERT fila + getNotifyQueue().add('notify', { notificationId }).
 - resolveNotification(db, {id, resolvedBy}) → set status='resolved', resolvedAt.
 - listPendingNotifications(db, {tenantId}).
 - Throttle/dedup con Redis: añadir a lib/redis-keys.ts →
 notif: (tenantId, subscriberId, kind) => \notif:${tenantId}:${subscriberId}:${kind}``.
 SET NX con TTL (ej. 600s) antes de crear, para no spamear en ráfagas de audio.

 4. Cliente Telegram + cola (apps/api/src/lib/queue.ts, nuevo lib/telegram.ts, nuevo worker)

 - lib/queue.ts: añadir NOTIFY_QUEUE='notify', NotifyJobData={notificationId} y getNotifyQueue()
 (mismo patrón cacheado que getProcessBatchQueue).
 - lib/telegram.ts: helpers sendMessage, editMessageReplyMarkup, answerCallbackQuery (POST a api.telegram.org).
 - workers/notify.ts (nuevo): carga la notificación + subscriber, resuelve chat_id
 (tenant.config → fallback env), arma el texto (nombre, @username, stage, motivo, deep-link al lead en
 el dashboard) + botones inline [⏸ Pausar][✅ Resuelto], envía y guarda telegramMessageId.
 - worker.ts: registrar un segundo Worker(NOTIFY_QUEUE, notifyJob, ...) junto al de process-batch.

 5. Productor A — detección determinista (apps/api/src/routes/webhook-manychat.ts)

 Tras persistir el mensaje (después de la línea ~100, sin alterar el flujo de debounce/return 200):
 - Si event.message.media contiene type==='audio' → createNotification(kind='audio') (con throttle).
 - Si event.message.text matchea tenantConfig.notification_keywords (case-insensitive) → kind='keyword'.
 - Fire-and-forget: errores se logean con req.log, nunca rompen el ACK a ManyChat.

 6. Productor B — tool del agente n8n (nuevo routes/admin/notify-human.ts)

 - POST /admin/leads/:subscriberId/notify-human, calcado de system-event.ts: verifyAdminAuth,
 getSubscriberByUuid, Zod body { reason, summary }. Llama createNotification(kind='agent', source='agent').
 - Registrar en routes/index.ts.
 - n8n: añadir tool notify_human(reason, summary) al AI Agent + regla en el system prompt
 (docs/n8n/prompts/) para casos: lead pide humano explícito, agresividad, incertidumbre alta.
 Documentar en docs/n8n/nodes/ (router) siguiendo el patrón de los demás tools/acciones.

 7. Endpoints admin de gestión (nuevos routes/admin/notifications.ts, routes/admin/pause.ts)

 - GET /admin/notifications?status=pending — listar (para el dashboard).
 - POST /admin/notifications/:id/resolve — resolver (opcionalmente reanuda).
 - POST /admin/leads/:subscriberId/pause — status='paused', pausedUntil (null = indefinido, o duración).
 - POST /admin/leads/:subscriberId/resume — status='active', pausedUntil=null.
 - Todos con verifyAdminAuth; registrar en routes/index.ts.

 8. Webhook de callbacks de Telegram (nuevo routes/webhook-telegram.ts)

 - POST /webhook/telegram — público; valida header X-Telegram-Bot-Api-Secret-Token === TELEGRAM_WEBHOOK_SECRET.
 - Parsea callback_query.data (ej. pause:<notificationId> / resolve:<notificationId>), ejecuta la mutación
 reusando los servicios (pause/resume, resolveNotification), llama answerCallbackQuery y edita el mensaje
 (botones → estado "⏸ Pausado por " / "✅ Resuelto").
 - Registrar el webhook en Telegram una vez vía setWebhook (script o nota en README).

 9. Dashboard (apps/dashboard)

 - Nueva página (dashboard)/escalaciones/page.tsx — lista de notifications (server component lee DB con
 Drizzle, o vía proxy GET /admin/notifications); acciones Resolver / Pausar / Reanudar vía el proxy /api/admin/*.
 - Badge en components/shell/Sidebar.tsx con el conteo de pending + nuevo SidebarItem "Escalaciones".
 - Leads pausados en rojo: en prospects (tabla/kanban) marcar filas con status==='paused' y mostrar
 un recordatorio "pausado hace X — reanudar".

 10. Recordatorio de pausa (job repetible)

 - Job BullMQ repetible pause-reminder (cada N horas) que busca subscribers status='paused' y re-notifica
 por Telegram + alimenta el resaltado rojo del dashboard. Alternativa de menor esfuerzo: solo el resaltado
 rojo + banner del dashboard como recordatorio pasivo (decidir en implementación según apetito de ruido).

 ---
 Archivos críticos

 ┌───────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │        Acción         │                                                      Archivo                                                       │
 ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Env nuevas vars       │ apps/api/src/config.ts, .env.example                                                                               │
 ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Tabla notifications   │ packages/db/src/schema.ts, packages/db/drizzle/00XX_notifications.sql                                              │
 ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Servicio              │ apps/api/src/services/notifications.ts (nuevo)                                                                     │
 ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Throttle keys         │ apps/api/src/lib/redis-keys.ts                                                                                     │
 ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Cola + cliente        │ apps/api/src/lib/queue.ts, apps/api/src/lib/telegram.ts (nuevo), apps/api/src/workers/notify.ts (nuevo),           │
 │ Telegram              │ apps/api/src/worker.ts                                                                                             │
 ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Detección             │ apps/api/src/routes/webhook-manychat.ts                                                                            │
 │ audio/keywords        │                                                                                                                    │
 ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Tool del agente       │ apps/api/src/routes/admin/notify-human.ts (nuevo, copia de system-event.ts), apps/api/src/routes/index.ts          │
 ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Gestión + pausa       │ apps/api/src/routes/admin/notifications.ts, apps/api/src/routes/admin/pause.ts (nuevos)                            │
 ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Callbacks Telegram    │ apps/api/src/routes/webhook-telegram.ts (nuevo)                                                                    │
 ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Dashboard             │ apps/dashboard/src/app/(dashboard)/escalaciones/page.tsx (nuevo), apps/dashboard/src/components/shell/Sidebar.tsx, │
 │                       │  vistas de prospects                                                                                               │
 ├───────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ n8n docs              │ docs/n8n/prompts/, docs/n8n/nodes/, docs/11_HANDOFF_AND_ESCALATION.md (marcar implementado)                        │
 └───────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

 Patrones existentes a reusar

 - apps/api/src/routes/admin/system-event.ts — plantilla de endpoint admin que llama n8n.
 - apps/api/src/lib/queue.ts getProcessBatchQueue() — patrón de cola cacheada.
 - apps/api/src/lib/admin-auth.ts verifyAdminAuth — auth de endpoints admin.
 - apps/api/src/services/subscribers.ts isSubscriberActive() + pausedUntil — pausa ya soportada.
 - apps/dashboard/src/app/api/admin/[...path]/route.ts — proxy autenticado a /admin/*.

 Sugerencias adicionales (sin sobrecargar)

 - Deep-link al lead dentro del mensaje de Telegram (alto valor, costo mínimo).
 - Throttle por kind para no spamear en ráfagas de audio (incluido arriba).
 - Chat de Telegram por tenant (tenant.config.telegram_chat_id) con fallback global — necesario por multi-tenancy.
 - (Opcional, fuera de alcance inicial) severidad/SLA por tipo, y reabrir notificación si el lead vuelve a escribir tras resolver.

 ---
 Verificación (end-to-end)

 1. Local: pnpm dev:api + pnpm dev:worker. Setear TELEGRAM_* apuntando a un bot de pruebas y un chat propio.
 2. Migración: pnpm db:generate + pnpm db:migrate (o make migrate); confirmar tabla notifications.
 3. Audio/keyword: curl a POST /webhook/manychat (header x-mc-token) con media:[{type:'audio',url}] y con
 un texto que matchee un keyword → llega mensaje a Telegram y aparece fila pending + en /escalaciones.
 4. Throttle: repetir el audio en <10 min → no duplica notificación.
 5. Tool agente: curl a POST /admin/leads/:id/notify-human (Bearer admin) → notificación kind='agent'.
 6. Botones Telegram: pulsar ⏸ Pausar → subscribers.status='paused'; enviar nuevo webhook del lead →
 worker hace skip por isSubscriberActive=false (verificar en logs). Pulsar ✅ Resuelto → fila resolved y mensaje editado.
 7. Dashboard: lead pausado se ve en rojo en /prospects; badge de pendientes en el sidebar; Reanudar lo reactiva.
 8. Calidad: pnpm lint && pnpm typecheck && pnpm test && pnpm build en verde (CI obliga).

