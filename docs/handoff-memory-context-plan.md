# Plan — Conciencia de escalado y handoff en la memoria del agente

> **Propósito:** Que el agente sea consciente de los escalados (audio, keyword, `notify_human`)
> y de las intervenciones humanas, para que al retomar una conversación no esté perdido.
>
> **Decisiones fijadas:**
> - **Mecanismo: Decisión B** (inyectar vía `<context>`, no escribir en la memoria de LangChain).
> - **Audio = escalar** por ahora. Transcripción (Whisper/Groq) y visión de imágenes quedan como **fase futura**.
>
> **Estado:** plan aprobado, pendiente de implementar.

---

## El diagnóstico de raíz: hay dos memorias que no se hablan

El agente solo "recuerda" dos cosas:

1. **`n8n_chat_histories`** — la memoria conversacional de LangChain (Postgres Memory node), keyed por `subscriberDbId`, ventana de 20 turnos. Es lo único que el LLM ve como "lo que pasó antes".
2. **El bloque `<context>`** que Build Context arma en cada turno leyendo varios SQL (stage, CRM, content history, followups…).

Todo el escalado —audio, keyword y la acción `notify_human` del agente— se escribe en `api.notifications`. Y aquí está el problema central:

> **Build Context nunca lee `api.notifications`.** El agente jamás se entera de sus propios escalados ni de los deterministas. La detección de audio/keyword vive en `webhook-manychat.ts` (líneas 49-82) y es fire-and-forget: notifica a Telegram pero el agente sigue corriendo ese turno **ciego**, viendo `[contenido multimedia recibido — no se puede leer]`.

Por eso "si retoma está perdido": cuando un humano pausa, atiende, y reactiva, la memoria del agente tiene un **hueco total** —no sabe que hubo audio, ni que un humano intervino, ni cuánto tiempo pasó.

**La buena noticia:** los dos primeros pedidos (que el agente "meta en memoria" que escaló, y que tenga contexto de audios/keywords) son **el mismo problema y la misma solución**. No hace falta tabla nueva: `notifications` ya es un log de eventos por-subscriber, tenant-scoped, con `kind/reason/summary/status/created_at/resolved_at`. Lo que falta es el lado de **lectura**.

---

## Decisión arquitectónica clave: ¿dónde "mete en memoria"?

Dos puntos de inyección posibles. **Decisión tomada: B.**

|        | A — Escribir turno sintético en `n8n_chat_histories` | **B — Inyectar vía `<context>` (elegida)** |
|--------|------------------------------------------------------|--------------------------------------------|
| Cómo   | Insertar un mensaje "[SISTEMA: …]" en la tabla de LangChain | Nueva query de `notifications` → sección `handoff_state` en `contextJson` |
| Pro    | Sobrevive aunque cambie Build Context | Estructurado, idempotente, no pelea con el formato interno de LangChain, Build Context ya agrega N inputs |
| Contra | Frágil (formato JSON propio de LangChain), consume la ventana de 20, riesgo de duplicar en ráfagas | Hay que recordar inyectarlo cada turno (pero ya es el patrón) |

Con **B**: una sección nueva en `contextJson` que el agente vea **en todos los turnos**, p.ej.:

```json
"handoff_state": {
  "open_escalations": [{ "kind": "audio", "reason": "...", "age": "hace 5 min", "status": "pending" }],
  "human_took_over": { "from": "...", "to": "...", "note": "..." },
  "last_resume": "hace 2h"
}
```

Con esto, el caso #1 (agente escala) casi no necesita nada nuevo del lado de escritura —`notify_human` ya crea la fila—; solo agregamos la lectura, y de paso el agente queda "consciente" de los tres tipos (audio/keyword/agente) de un solo golpe.

---

## El caos de Instagram: taxonomía + matriz de política

Hoy el detector solo conoce `audio` y keywords de texto (`matchEscalationTrigger`, líneas 27-42). El schema de ManyChat solo modela `image | video | audio | file` (manychat.ts:4). Todo lo demás —sticker, GIF, ubicación, share de reel/post, story reply, reacciones, vCard, lo desconocido— es **invisible** y el agente ve el placeholder genérico, que es una **mentira permanente en su memoria**.

El cambio de mentalidad: el detector debe ser **allowlist, no "audio OR keyword"**. La pregunta correcta es *"¿esto es algo sobre lo que el agente literalmente NO puede actuar?"* → entonces escala + lo anota. Así, manejo de medios y escalado pasan a ser **la misma decisión**. Se clasifica cada inbound en un `content_class` y una matriz:

| content_class | Política | Placeholder en memoria |
|---------------|----------|------------------------|
| `text` | Agente maneja | el texto |
| `audio` / voice note | **Escalar** (hoy) → futuro: transcribir | `[audio sin transcribir]` |
| `image` / `video` | **Escalar** (hoy) → futuro: visión | `[el lead envió una imagen]` |
| `location` | **Escalar** | `[el lead compartió una ubicación]` |
| `file` / vCard | **Escalar** | `[el lead envió un archivo]` |
| `share` (reel/post/story reply) | Anotar (agente sigue) | `[el lead compartió/respondió a una historia]` |
| `sticker` / GIF / reacción | Anotar, no escalar | `[el lead reaccionó / envió un sticker]` |
| `unknown` | **Escalar** (fail-safe) | `[contenido no soportado]` |

Dos consecuencias de diseño: (a) hay que **extender el enum de media** en `manychat.ts` para no perder tipos en el Zod parse, y (b) **`buildMessagesText` debe rendir placeholders fieles por clase** en vez del genérico, para que la memoria refleje la realidad.

---

## El hueco de la pausa (lo más sutil)

Cuando el humano pausa, el inbound se descarta en el **paso 5** (`isSubscriberActive` → 200 silencioso, *antes* de persistir en el paso 7). O sea: ni siquiera queda en el audit trail. Para que el agente "no esté perdido" al reactivar, tres niveles:

- **Mínimo (alto valor / bajo esfuerzo):** en resume, inyectar al `<context>` un aviso: *"esta conversación fue atendida por un humano hace N horas y reactivada; no repitas pasos, pregunta con tacto."* Solo eso ya evita que el agente arranque de cero.
- **Mejor:** cambiar el paso 5 a **persistir-pero-no-despachar** cuando está pausado, para que al reactivar Build Context muestre "mensajes recibidos durante la pausa: …".
- **Ideal (opcional):** que el botón de resume en Telegram / dashboard permita una nota de una línea → se vuelve el `summary` del handoff.

---

## Dónde se cambian las keywords

Viven en **`tenant.config.notification_keywords`** (JSONB en la fila del tenant; lo lee `webhook-manychat.ts:187`). Hoy **solo se editan tocando el JSON del tenant** (DB o seed) — no hay UI. El hogar correcto es el panel **`/settings`**: agregar un campo editable para `notification_keywords` y, idealmente, para la matriz de política de medios. Eso lo deja autoservicio por tenant.

---

## Plan propuesto (por fases)

### Fase 1 — Conciencia del agente (resuelve #1 y #2)
- `Get Escalation/Handoff State`: nueva query SQL en el workflow agent-run que lee `notifications` recientes del subscriber.
- Build Context: agregar sección `handoff_state` al `contextJson`.
- System prompt: regla nueva — *"si `handoff_state` tiene escalados abiertos o un handoff reciente, no repitas, reconoce el contexto."*
- **Sin migración. La escritura ya existe.**

### Fase 2 — Taxonomía de medios (resuelve #4)
- Extender enum de media en `manychat.ts` + clasificador `content_class`.
- Volver `matchEscalationTrigger` allowlist-based con la matriz.
- `buildMessagesText` con placeholders fieles por clase.
- **Audio = escalar.** Transcripción (Whisper/Groq) y visión de imágenes **fuera de alcance** (fase futura).

### Fase 3 — Hueco de pausa
- Persistir-pero-no-despachar en pausa (paso 5).
- Aviso de resume en `<context>`; opcional nota de handoff en el botón de Telegram.

### Fase 4 — Autoservicio
- Campo `notification_keywords` (+ matriz) editable en `/settings`.

---

## Fuera de alcance (fase futura)

- **Transcripción de audio** (Whisper/Groq) — hoy el audio escala a humano.
- **Visión de imágenes/video** — hoy escalan a humano.

Cuando entren, solo cambian la **política** de las filas `audio` / `image` / `video` de la matriz (de "Escalar" a "Agente maneja con transcripción/visión") y el placeholder pasa a contenido real. El resto del andamiaje (handoff_state, allowlist, placeholders) no cambia.
