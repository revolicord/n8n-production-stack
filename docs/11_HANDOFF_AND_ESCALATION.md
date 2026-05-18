# 11 — Handoff and Escalation
## Cuándo y Cómo el Agente Pasa a Humano

---

> **Propósito:** Definir las condiciones que activan handoff/escalación y el mecanismo de transferencia.

---

## 1. Tipos de Handoff

### 1.1 Handoff Planificado
El agente termina su trabajo y entrega al humano según el flujo normal.

| Caso | A quién pasa | Cómo pasa |
|---|---|---|
| Llamada agendada | Closer | Agendado en Calendly + lead en estado `SCHEDULED` en Close |

### 1.2 Handoff por Excepción (Escalación)
El agente detecta una situación que no debe manejar y transfiere a humano.

---

## 2. Triggers de Escalación

| Trigger | Tipo | A quién | Urgencia |
|---|---|---|---|
| Lead pide hablar con humano explícitamente | Detección directa | Alex | Alta |
| Lead muy caliente quiere comprar ya | Detección por señales | Closer | Alta |
| Objeción de precio explícita | Detección por palabras clave | Alex | Media |
| Insulto / queja / lenguaje hostil | Detección por sentimiento | Alex | Alta |
| Lead VIP (cuenta grande, referido, etc.) | Tag en Close | Alex | Alta |
| Pregunta sobre el producto que el agente no sabe responder | Detección por incertidumbre del modelo | Alex | Media |
| El lead pregunta "¿eres una IA?" | Detección directa | _[completar política]_ | Media |
| Conversación atascada (sin avance en X días) | Timeout | Alex | Baja |

---

## 3. Mecanismo de Escalación

### 3.1 Acciones del agente al escalar
1. Marcar el lead en Close CRM con etiqueta `ESCALATED`.
2. Registrar el motivo de escalación en notas del lead.
3. Pausar respuestas automáticas en ManyChat para ese suscriptor.
4. Notificar al humano según canal definido.

### 3.2 Canal de notificación
> 🚧 Pendiente: definir cuál es el canal.

Opciones evaluadas:
- [ ] Slack (canal de escalaciones)
- [ ] Email a Alex
- [ ] SMS / WhatsApp
- [ ] Notificación en Close
- [ ] Combinación

### 3.3 Información que se transfiere
- Link directo al lead en Close.
- Historial de la conversación.
- Motivo de la escalación.
- Última acción del agente.
- Etapa del funnel en la que estaba.

---

## 4. Reanudación del Agente Post-Handoff

> ¿El agente vuelve a tomar el control después de que el humano resuelve?

| Caso | ¿Vuelve el agente? |
|---|---|
| Humano resolvió objeción y lead sigue en funnel | Sí, vuelve al estado previo |
| Humano agendó manualmente | No, va directo a `SCHEDULED` |
| Humano descalificó al lead | No, queda `ARCHIVED_NOT_FIT` |
| Humano marcó como VIP | No, queda en manejo humano permanente |

---

## 5. SLA de Respuesta Humana

> Cuánto tiempo tiene el humano para responder cuando el agente escala.

| Urgencia | SLA |
|---|---|
| Alta | _[completar — ej: 30 min en horario laboral]_ |
| Media | _[completar — ej: 4 horas]_ |
| Baja | _[completar — ej: 24 horas]_ |

> ⚠️ Si el humano no responde dentro del SLA, ¿qué hace el agente? _[completar política]_

---

## 6. Gaps y Preguntas Abiertas

- [ ] Definir canal de notificación de escalación
- [ ] Confirmar SLAs de respuesta humana
- [ ] Definir política exacta cuando el lead pregunta "¿eres IA?"
- [ ] Decidir si hay un humano de respaldo si Alex no está disponible
