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
| Lead pide hablar con humano explícitamente | El agente NO tiene tool `notify_human` hoy. Política pendiente: el prompt v3 no contempla este caso. | ❌ NO implementado |
| Lead muy caliente (quiere comprar ya) | El agente debería pasar a `C` con Calendly. Si pide canal humano, hoy no hay mecanismo. | ❌ NO implementado |
| Insulto / queja agresiva | Sin tool — el prompt v3 no actúa específicamente. | ❌ NO implementado |
| Lead VIP / referido | No hay flag en la DB. | ❌ NO modelado |
| Follow-up #5 sin respuesta | Marcar `escalated_human_call` → notificación a Alex para llamada manual por IG | ⏳ Spec en `followup-runner` y prompt v3; cron pendiente de cablear |
| Pregunta sobre producto que el agente no sabe | Sin detección de incertidumbre; hoy el prompt v3 evita explicar y se apoya en el contenido multimedia | ❌ NO implementado |
| "¿Eres una IA?" | Prompt v3 prohíbe admitirlo y mantiene la persona | ✅ Cubierto por prompt |
| Objeción dura (no_money, etc.) | `set_stage("disqualified", reason, evidence)` — descalificación inmediata, no escalación | ✅ Cubierto |

---

## 3. Mecanismo de Escalación (estado actual)

### 3.1 Lo que existe hoy
- **`escalated_human_call`** como estado terminal del lead — gestionado por el `followup-runner` cuando agota cierto número de follow-ups (cadencia por definir).
- **`disqualified`** como salida limpia — manejado por el agente con `set_stage`.

### 3.2 Lo que falta (P1)
- Tabla `notifications` para registrar notificaciones a humanos.
- Tool `notify_human(reason, summary)` que el agente pueda invocar.
- Canal de entrega: pendiente de elegir entre Slack / email / SMS / "etiqueta en ManyChat" / notificación push.
- Endpoint Fastify para crear notificaciones.
- Pausa automática del agente para ese suscriber (campo en `subscribers.status` o `paused_until`).

### 3.3 Información que se transferirá cuando exista
- Link directo al lead en el panel admin (cuando exista).
- Resumen del turno actual + últimos N mensajes.
- Motivo declarado por el agente (si se invocó vía `notify_human`).
- Etapa del funnel y `evidence` del último `set_stage`.

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

- [ ] Diseñar e implementar la tool `notify_human` y la tabla `notifications` (P1)
- [ ] Elegir canal de notificación
- [ ] Definir política exacta cuando el lead pide humano explícitamente (`set_stage` no aplica — no hay etapa "pidió humano")
- [ ] Confirmar SLAs de respuesta humana
- [ ] Definir si hay un humano de respaldo si Alex no está disponible
- [ ] Diseñar el flag de pausa por suscriptor cuando se escala (`subscribers.paused_until` ya existe en schema; falta la lógica que lo respete antes del dispatch)
