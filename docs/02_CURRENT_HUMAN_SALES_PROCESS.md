# Current Human Sales Process
## Proceso de Setter de Quantum Creators (referencia para el agente)

---

> **Propósito:** Describir el proceso que el setter humano sigue para que el agente lo replique con fidelidad.
>
> **Funnel canónico:** Quantum Creators — etapas `A / MS / B / C / D` + terminales (`disqualified`, `lost`, `escalated_human_call`). Ver `docs/10_CONVERSATION_STATE_MACHINE.md` para la máquina de estados formal.
>
> **Nota MVP:** El agente ya está cableado y responde a DMs reales. La arquitectura está en evolución (ver doc 06 sobre el cambio a salida JSON estructurada planificado).

---

## 1. Visión General

El proceso es un **funnel de micro-compromisos**: cada confirmación del lead (👍, "ya lo vi", "interesante") es una validación de intención antes de recibir el siguiente contenido. Filtra pasivos sin gastar el contenido premium en todos.

```
TRIGGER (DM inbound, comentario, follower, etc.)
   │
   ▼
ETAPA A — Initiated
   • Agente envía Vídeo 1 (enganche 25s) + 1 frase binaria pidiendo confirmación
   │   "Mírate esto y dame un pulgar arriba si resuena"
   │
   ├── Lead confirma haber visto (verbal o 👍 tras la pregunta) ▼
   │
ETAPA MS — Media Seen
   • Agente envía Audio + VSL (`QC_MS_audio_vsl`) + frase binaria
   │
   ├── Lead reacciona positivo a la VSL ▼
   │
ETAPA B — Engaged
   • Si el lead pide pruebas / más info, agente dispara audio presentación,
   │   imágenes de resultados o testimonios de texto.
   • Cuando hay señal positiva clara, agente envía link de Calendly ▼
   │
ETAPA C — Calendly'd
   • Agente esperó respuesta. No envía contenido automático aquí.
   │
   ├── Lead reserva (webhook Calendly) o confirma verbalmente ▼
   │
ETAPA D — Booked
   • Handoff a closer humano. Bot deja de operar este lead.

Salidas terminales en cualquier etapa:
─ disqualified  (no_money / not_interested / geographic / no_quality / fake_account)
─ escalated_human_call  (cron tras follow-up #5)
─ lost  (cron tras follow-up #8)
```

---

## 2. Paso a Paso por Etapa

### Etapa A — Initiated (primer contacto)

**Trigger:** lead entra al DM (inbound, comentario, follower nuevo, palabra clave).

**Acción del agente:**
- Dispara `trigger_manychat_flow` con uno de los 4 vídeos de enganche (`QC_A_video_hook_v1..v4`). La selección es **ponderada** (no round-robin secuencial) en `Build Context` según `stage_flows.weight`.
- Acompaña con UNA frase binaria que pide confirmación: *"Mírate esto y dame un pulgar arriba si resuena"* / *"Dime si o no y avanzamos"*.
- No explica el producto en texto. El vídeo hace el trabajo.

**Señal de avance a MS:** lead confirma verbal o con emoji **tras la pregunta del agente** (no antes).
**Señal de descalificación:** "no me interesa", "es caro", "no tengo dinero", etc → `set_stage("disqualified", reason, evidence)`.
**Sin respuesta:** `followup-runner` toma el caso según cadencia configurada en `followup_templates` (etapa A — 3 follow-ups).

### Etapa MS — Media Seen (audio + VSL)

**Trigger:** `set_stage("MS", ...)` con evidence = la frase del lead.

**Acción del agente:**
- Dispara `QC_MS_audio_vsl` — audio corto + VSL.
- Frase binaria: *"Dime si te encaja y seguimos"*.

**Señal de avance a B:** reacción positiva clara a la VSL — 👍 explícito, "me encanta", "quiero saber más", "cómo funciona".
**Sin respuesta:** `followup-runner` con cadencia MS.

### Etapa B — Engaged (contenido de prueba social opcional)

**Trigger:** `set_stage("B", ...)` con evidence.

**Acción del agente:** depende de la conversación:
- Si el lead pide pruebas / muestra escepticismo → `QC_B_img_resultados` o `QC_B_txt_prueba_social`.
- Si pide más detalle del sistema → `QC_B_audio_presentacion`.
- Si la señal es clara (quiere agendar) → envía link de Calendly por `send_text` con `tenant.config.calendly_url` y llama `set_stage("C", ...)`.

### Etapa C — Calendly'd (link enviado)

**Trigger:** `set_stage("C", ...)` con evidence.

**Acción del agente:** mensaje seco *"Aquí tienes, elige horario: [link]"*. No persigue activamente — espera.

**Señal de avance a D:**
- Webhook de Calendly cuando el lead reserva (P1 — pendiente de implementar).
- Mientras tanto: confirmación verbal del lead ("listo, ya agendé", "reservé para el martes") → agente llama `set_stage("D", ...)`.

### Etapa D — Booked (handoff)

El bot deja de operar este lead. El closer toma desde Calendly + notificación.

---

## 3. Personalidad del Agente

Definido en `n8n/prompts/setter-v1.md` (v3+):

- **Persona:** Alex, de Quantum Creators. Tiempo limitado, cientos de mensajes que responder.
- **Estilo:** seco, rápido, como un humano ocupado desde el móvil.
- **Cero emojis.** Cero explicaciones en texto. El contenido multimedia explica.
- **Una acción por turno:** disparar flow + 1 frase binaria.
- **Disqualified inmediato** ante dudas, objeciones de dinero o ambigüedad sostenida — sin rebatir.
- **Nunca:** decir el precio, rogar, mencionar que es IA, hablar de las herramientas.

---

## 4. Manejo de Objeciones

La política actual es **descalificación inmediata**, no rebatir. Esto es deliberado (ver prompt v3):

| Situación | Respuesta |
|---|---|
| "¿Cuánto cuesta?" | No responde precio. Avanza el funnel — el precio sale en la llamada. |
| "Es muy caro" / "no tengo dinero" | `set_stage("disqualified", "no_money", evidence)` + frase de cierre seca: *"Vale, no es tu momento. Éxitos."* |
| "No me interesa" / "déjame en paz" | `set_stage("disqualified", "not_interested", evidence)` |
| "¿Eres una IA?" / "¿es un bot?" | El prompt prohíbe admitirlo. Mantiene la persona. |
| Insulto / queja agresiva | Política pendiente — hoy el prompt no maneja escalación a humano de forma activa (P1 — falta tool `notify_human`). |

---

## 5. Protocolo de Follow-Up (`followup-runner`)

> Workflow separado en n8n. Schedule Trigger cada 5 min. Ver `n8n/workflows/followup-runner.md`.

**Reglas:**
- Cada etapa tiene templates en `api.followup_templates` con `sequence_number` y `delay_hours`.
- Al recibir un mensaje del lead, `Upsert Lead Cron` (post-respuesta del agente) **resetea** `next_sequence_number = 1` y reprograma — la secuencia vuelve a empezar.
- Tras follow-up #5 sin respuesta → `escalated_human_call` (notificación a Alex para que llame manualmente por IG — P1, falta cablear la notificación).
- Tras follow-up #8 sin respuesta → `lost` (terminal).

**Cadencia inicial (seed):**

| Etapa | # Templates | Cadencia (horas) |
|-------|-------------|------------------|
| A | 3 | 24 / 48 / 72 |
| MS | 3 | 24 / 48 / 72 |
| B | 2 | 24 / 48 |
| C | 1 | 24 |

> ❓ Cadencia y textos exactos pendientes de confirmar con Alex (ver `n8n/SETTER-MVP-TRACKING.md` decisión #5).

---

## 6. Lo que el agente NO hace

- ❌ No revela el precio.
- ❌ No salta etapas — `set_stage` rechaza saltos (`A → C`, `MS → D`).
- ❌ No envía contenido de B antes de tener `B` confirmado.
- ❌ No agenda sin haber transitado por `B` con evidencia positiva.
- ❌ No insiste contra una objeción — descalifica.
- ❌ No usa emojis, escasez, urgencia artificial.

---

## 7. Gaps y Preguntas Abiertas

- [ ] Cadencia exacta de follow-ups por etapa (los seed son provisional)
- [ ] Textos reales de los follow-ups (hoy templates con placeholders)
- [ ] Cuenta de Instagram conectada (handle exacto)
- [ ] Política exacta de escalación a humano vivo (insulto, lead VIP, lead caliente)
- [ ] Webhook Calendly C→D (hoy se cubre por confirmación verbal)
- [ ] Cambio arquitectónico a salida JSON estructurada (ver doc 06)
