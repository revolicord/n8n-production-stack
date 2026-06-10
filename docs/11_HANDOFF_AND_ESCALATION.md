# 11 — Handoff and Escalation
## Cuándo y Cómo el Agente Pasa a Humano (Quantum Creators)

---

> **Propósito:** Definir las condiciones que activan handoff/escalación y el mecanismo de transferencia en el funnel A/MS/B/C/D.

---

## 1. Tipos de Handoff

### 1.1 Handoff Planificado — el flujo normal

El agente termina su trabajo y entrega al humano según el funnel:

| Caso | A quién pasa | Cómo pasa |
|---|---|---|
| Lead llega a `D` (Booked) | Closer humano | Cita en Calendly + lead en estado `D` en `api.lead_stages`. Cuando exista el webhook (P1), también marca `D` automáticamente. |

### 1.2 Handoff por Excepción — escalación

El agente detecta una situación que no debe manejar y transfiere a humano (Alex).

---

## 2. Triggers de Escalación

| Trigger | Mecanismo actual | Estado |
|---|------------------|--------|
| Lead pide hablar con humano explícitamente | Acción `notify_human(reason, summary)` del agente → `POST /admin/leads/:id/notify-human` → alerta Telegram (regla 7 del prompt v8). Complementado por keywords deterministas (`tenant.config.notification_keywords`) en `webhook-manychat.ts`. | ✅ Implementado 2026-06 (falta cablear la acción en el Router de n8n — ver `n8n/nodes/11-notify-human.md`) |
| Lead manda audio | Detección determinista en `webhook-manychat.ts` (`media.type==='audio'`) → notificación kind=`audio` → Telegram + dashboard. Throttle Redis 10 min por tipo. | ✅ Implementado 2026-06 |
| Lead muy caliente (quiere comprar ya) | El agente pasa a `C` con Calendly; si pide canal humano aplica `notify_human`. | ✅ Cubierto vía notify_human |
| Insulto / queja agresiva | Regla 7 del prompt v8 → `notify_human`. | ✅ Implementado (pendiente Router n8n) |
| Lead VIP / referido | No hay flag en la DB. | ❌ NO modelado |
| Follow-up #5 sin respuesta | Marcar `escalated_human_call` → notificación a Alex para llamada manual por IG | ⏳ Spec en `followup-runner` y prompt v3; cron pendiente de cablear |
| Pregunta sobre producto que el agente no sabe | Regla 7 del prompt v8 (incertidumbre alta) → `notify_human`. | ✅ Implementado (pendiente Router n8n) |
| "¿Eres una IA?" | Prompt prohíbe admitirlo y mantiene la persona; las keywords (`eres un bot`, `robot`…) además disparan notificación kind=`keyword` para que un humano lo vigile. | ✅ Cubierto |
| Objeción dura (no_money, etc.) | `set_stage("disqualified", reason, evidence)` — descalificación inmediata, no escalación | ✅ Cubierto |

---

## 3. Mecanismo de Escalación (implementado 2026-06)

### 3.1 Arquitectura

```
PRODUCTORES ──► services/notifications.ts ──► (1) INSERT api.notifications
                                              (2) job BullMQ 'notify'
  A. webhook-manychat.ts (determinista):
       media.type==='audio'                          → kind='audio'
       texto ~ tenant.config.notification_keywords   → kind='keyword'
       (throttle Redis 10 min por tipo; fire-and-forget, no bloquea el ACK)
  B. agente n8n → acción notify_human → POST /admin/leads/:id/notify-human → kind='agent'

CONSUMIDORES:
  (1) worker 'notify' → Telegram sendMessage (deep-link + botones [⏸ Pausar][✅ Resuelto])
  (2) dashboard → página /escalaciones + badge en sidebar; leads pausados en rojo en /prospects
  (3) POST /webhook/telegram → callbacks de botones → pausa/reanuda/resuelve + edita el mensaje

PAUSA (manual): status='paused' + pausedUntil=null → isSubscriberActive() bloquea el dispatch.
RECORDATORIO: job repetible 'pause-reminder' (PAUSE_REMINDER_HOURS, default 6h) re-notifica leads pausados.
```

### 3.2 Piezas
- Tabla `api.notifications` (migración `0014_notifications`).
- `POST /admin/leads/:id/notify-human` (Bearer n8n / JWT admin) — productor del agente.
- `GET /admin/notifications`, `POST /admin/notifications/:id/resolve` — gestión (dashboard).
- `POST /admin/leads/:id/pause` / `/resume` — pausa manual (indefinida o con `duration_minutes`).
- `POST /webhook/telegram` — callbacks de los botones (header `X-Telegram-Bot-Api-Secret-Token`); registrar con `scripts/telegram-set-webhook.sh`.
- Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `PAUSE_REMINDER_HOURS`; por tenant: `telegram_chat_id`, `notification_keywords`.
- Pendiente n8n (UI): acción `notify_human` en el Router + prompt v8 — ver `n8n/nodes/11-notify-human.md`.

### 3.3 Información transferida en la alerta de Telegram
- Nombre, @username y etapa del funnel del lead.
- Motivo (`reason`) y resumen (`summary`) — del agente o del trigger determinista.
- Link al perfil de IG y deep-link al panel (`/prospects?q=<username>`).

---

## 4. Reanudación del Agente Post-Handoff

> Política por definir formalmente. Comportamiento esperado:

| Caso | ¿Vuelve el agente? |
|---|---|
| Humano resolvió objeción y lead sigue en el funnel | Sí — el agente continúa en la etapa actual. La conversación en `subscribers.paused_until` debe expirar. |
| Humano agendó manualmente | No — pasar a `D` con `set_stage` manual. |
| Humano descalificó | No — pasar a `disqualified`. |
| Humano marcó como VIP (futuro) | No — queda en manejo humano permanente. |

---

## 5. SLA de Respuesta Humana

> ⚠️ Pendiente de definir con el founder.

| Urgencia | SLA propuesto | A confirmar |
|---|---|---|
| Alta (lead caliente / insulto) | 30 min en horario laboral | [ ] |
| Media (objeción compleja) | 4 horas | [ ] |
| Baja (lead atascado) | 24 horas | [ ] |

---

## 6. Gaps y Preguntas Abiertas

- [x] Diseñar e implementar la tool `notify_human` y la tabla `notifications` (2026-06)
- [x] Elegir canal de notificación → Telegram (worker BullMQ + botones inline) + dashboard
- [x] Definir política cuando el lead pide humano → `notify_human` + pausa manual por el humano (no automática)
- [x] Flag de pausa por suscriptor → `status='paused'` + `paused_until` (endpoints pause/resume, botón Telegram, dashboard); recordatorio repetible `pause-reminder`
- [ ] Cablear la acción `notify_human` en el Router de n8n + copiar prompt v8 (UI) — ver `n8n/nodes/11-notify-human.md`
- [ ] Configurar en producción: `TELEGRAM_*` en `.env`, `notification_keywords` en tenant.config, `scripts/telegram-set-webhook.sh`
- [ ] Confirmar SLAs de respuesta humana
- [ ] Definir si hay un humano de respaldo si Alex no está disponible
