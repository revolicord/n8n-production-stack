# 10 — Conversation State Machine
## Estados del Lead, Transiciones y Persistencia

---

> **Propósito:** Definir formalmente la máquina de estados del lead. El agente decide qué hacer en función del estado actual + el último input del lead.

---

## 1. Diagrama de Estados

```
                       ┌──────────────┐
                       │     NEW      │
                       └──────┬───────┘
                              │ trigger (comentario / seguidor / DM)
                              ▼
                       ┌──────────────┐
                       │ OPENED       │  ← Mensaje de apertura enviado
                       └──────┬───────┘
                              │ lead responde
                              ▼
                       ┌──────────────┐
                       │ WARMING      │  ← Rapport en curso
                       └──────┬───────┘
                              │ rapport suficiente
                              ▼
                       ┌──────────────┐
                       │ VIDEO_SENT   │  ← Video de 25s enviado
                       └──┬─────────┬─┘
                          │ 👍      │ texto / objeción / silencio
                          ▼         ▼
                  ┌──────────┐   ┌──────────────┐
                  │AUDIO_SENT│   │  OBJECTION   │ ─→ resuelta → vuelve
                  └────┬─────┘   └──────────────┘
                       ▼
                  ┌──────────┐
                  │VSL_SENT  │
                  └──┬─────┬─┘
                     │ 👍  │ texto / objeción / silencio
                     ▼     ▼
              ┌─────────┐  ┌──────────────┐
              │SCHEDULED│  │  OBJECTION   │
              └────┬────┘  └──────────────┘
                   │
                   ▼
              ┌─────────────┐
              │ CALL_HELD   │ (capturado por integración Calendly + Close)
              └─────────────┘

Estados terminales:
- ARCHIVED_NO_RESPONSE  (después de N follow-ups sin respuesta)
- ARCHIVED_NOT_FIT      (lead descalificado o sin interés)
- ESCALATED             (transferido a humano)
- WON / LOST            (estado post-llamada, lo maneja el closer)
```

---

## 2. Estados (Definición Detallada)

### `NEW`
- **Significado:** Lead recién entró al sistema, aún no se le ha enviado nada.
- **Acción del agente:** enviar mensaje de apertura.
- **Próximo estado:** `OPENED`.

### `OPENED`
- **Significado:** Mensaje de apertura enviado, esperando respuesta.
- **Acción del agente:** esperar respuesta o ejecutar follow-up programado.
- **Próximo estado:** `WARMING` (si responde) o `ARCHIVED_NO_RESPONSE` (tras N intentos).

### `WARMING`
- **Significado:** Conversación en curso, generando rapport.
- **Acción del agente:** 1–3 intercambios, luego enviar video.
- **Próximo estado:** `VIDEO_SENT`.

### `VIDEO_SENT`
- **Significado:** Video de 25s enviado, esperando 👍.
- **Acción del agente:** esperar respuesta.
- **Próximo estado:** `AUDIO_SENT` (si 👍), `OBJECTION` (si objeción), follow-up (si silencio).

### `AUDIO_SENT`
- **Significado:** Audio pre-VSL enviado, transición a VSL.
- **Acción del agente:** enviar VSL inmediatamente (no espera respuesta).
- **Próximo estado:** `VSL_SENT`.

### `VSL_SENT`
- **Significado:** VSL enviada, esperando 👍.
- **Acción del agente:** esperar respuesta.
- **Próximo estado:** `SCHEDULED` (si 👍), `OBJECTION` (si objeción), follow-up (si silencio).

### `OBJECTION`
- **Significado:** Lead expresó una objeción manejable.
- **Acción del agente:** responder según tabla de objeciones, volver al estado previo.
- **Próximo estado:** estado del que vino, o `ESCALATED` si no se puede manejar.

### `SCHEDULED`
- **Significado:** Link de Calendly enviado y llamada agendada.
- **Acción del agente:** programar recordatorios pre-llamada.

### `CALL_HELD`, `WON`, `LOST`
- **Significado:** Estados post-llamada, fuera del scope del agente IA.
- **Owner:** closer humano + Close CRM.

### `ARCHIVED_NO_RESPONSE`, `ARCHIVED_NOT_FIT`, `ESCALATED`
- Estados terminales. Ver `11_HANDOFF_AND_ESCALATION.md`.

---

## 3. Tabla de Transiciones

| Desde | Evento | Hacia |
|---|---|---|
| `NEW` | Apertura enviada | `OPENED` |
| `OPENED` | Lead responde | `WARMING` |
| `OPENED` | Sin respuesta tras 3 intentos | `ARCHIVED_NO_RESPONSE` |
| `WARMING` | Rapport suficiente | `VIDEO_SENT` |
| `VIDEO_SENT` | 👍 recibido | `AUDIO_SENT` |
| `VIDEO_SENT` | Objeción | `OBJECTION` |
| `VIDEO_SENT` | Sin respuesta tras 2 intentos | `ARCHIVED_NO_RESPONSE` |
| `AUDIO_SENT` | VSL enviada | `VSL_SENT` |
| `VSL_SENT` | 👍 recibido | `SCHEDULED` |
| `VSL_SENT` | Objeción | `OBJECTION` |
| `VSL_SENT` | Sin respuesta tras 2 intentos | `ARCHIVED_NO_RESPONSE` |
| `OBJECTION` | Objeción resuelta | Estado previo |
| `OBJECTION` | Objeción no manejable | `ESCALATED` |
| Cualquiera | Lead pide hablar con humano | `ESCALATED` |
| Cualquiera | Insulto / queja | `ESCALATED` |

---

## 4. Persistencia del Estado

### 4.1 Dónde se guarda
- **Estado actual:** campo en Close CRM (`lead.stage`).
- **Última transición:** timestamp + evento (campo personalizado en Close).
- **Video enviado (round robin):** campo personalizado en Close (`lead.video_sent_id`).
- **Contador de follow-ups:** campo personalizado en Close (`lead.followup_count`).

> 🚧 Pendiente: confirmar nombres exactos de campos en Close.

### 4.2 Cómo se recupera
- Al inicio de cada turno, el agente llama a `get_lead_state` y carga el estado.
- El historial conversacional se carga desde _[completar — ManyChat o Close]_.

---

## 5. Casos Edge

| Caso | Comportamiento |
|---|---|
| Lead responde 👍 antes de tiempo (ej: tras apertura) | Avanzar al siguiente estado lógico, no esperar a la etapa "correcta" |
| Lead retrocede (ej: en VSL_SENT vuelve a preguntar algo de la apertura) | Responder en contexto pero mantener el estado de avance |
| Lead pide la VSL directamente sin haber visto el video | _[completar política]_ |
| Lead ya agendó y vuelve a escribir | Manejar como nueva conversación de soporte, no reiniciar funnel |

---

## 6. Gaps y Preguntas Abiertas

- [ ] Confirmar nombres exactos de campos en Close CRM
- [ ] Decidir política para leads que saltan etapas
- [ ] Definir cuántos follow-ups por etapa (actualmente: 2-3)
- [ ] Decidir si OBJECTION es un estado real o un flag temporal
