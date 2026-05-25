---
title: "Quantum Creators — Fase B Follow-ups (lead no ve/responde VSL)"
type: playbook
client: Quantum Creators
project: instagram-dm-setter
phase: B
status: active
channel: instagram-dm
language: es
tags:
  - setter
  - followup
  - playbook
  - quantum-creators
  - vsl
  - fase-b
source: setting_config/setting_system.json
source_pdf: quantum_fase_b_followups_si_no_ve_vsl.pdf
total_touches: 8
total_duration_hours: 312  # ~13 días desde VSL hasta archive
variables:
  - nombre
  - discovery_call
  - nurture_youtube
exit_phase: C
created: 2026-05-23
---

# Fase B — Follow-ups si el lead no ve/responde a la VSL

Secuencia operativa para nutrir leads en frío después de enviar la VSL nativa. Si el lead reacciona con interés en cualquier punto → cortar secuencia y pasar a **Fase C** (envío de enlace de llamada).

## Reglas de uso

- **Pre-requisito**: la VSL nativa **debe** estar enviada. Si la fila marca `FALTA VSL`, no disparar Fase B.
- **Corte de secuencia**: cualquier respuesta del lead con interés, pregunta cualificada u objeción resoluble → frenar follow-ups y mover a Fase C.
- **Orden de envío** para `meme_plus_text` (3B–8B): primero el meme, después el texto.
- **Resolución de variables**: `{nombre}`, `{discovery_call}`, `{nurture_youtube}` se resuelven antes del envío.

## Resumen de la secuencia

| # | Timing (desde anterior) | Formato | Asset | Acumulado |
|---|---|---|---|---|
| 1B | 12–24h tras VSL | text | — | ~24h |
| 2B | 12–24h tras 1B | text | — | ~48h |
| 3B | 48h tras 2B | meme + text | Kermit "Libera los memes" | ~96h |
| 4B | 48h tras 3B | meme + text | "Por qué no contesta los mensajes" | ~144h |
| 5B | 48h tras 4B | meme + text | Quién quiere ser millonario (A/B/C/D) | ~192h |
| 6B | 48h tras 5B | meme + text | Esqueleto esperando | ~240h |
| 7B | 48h tras 6B | meme + text | Brain expanding (no abrir → agendar) | ~288h |
| 8B | 48h tras 7B | meme + text final + archive | "Preguntaré una vez más" | ~336h |

> Total ~14 días desde VSL hasta el archive.

---

## 1B — Recordatorio suave

- **Timing**: 12–24h después de la VSL / native B touch
- **Formato**: `text` (sin meme)

**Texto:**
> Buenas! Viste el video que te envié? Si lo has visto y no quieres saber nada, házmelo saber sin problema y archivo la conversación 🤝

---

## 2B — Invitación a cerrar puerta

- **Timing**: 12–24h después de 1B
- **Formato**: `text` (sin meme)

**Texto:**
> Eyy {nombre}, si no te interesa ahora, me lo puedes decir claramente y así no te envío más mensajes de seguimiento :))

---

## 3B — Primer meme (Kermit oscuro)

- **Timing**: 48h después de 2B
- **Formato**: `meme_plus_text`
- **Asset**: `setting_assets/phase_b/3B/Picsart_25-10-29_17-06-43-312.jpg`
- **Descripción del meme**: Kermit con su sombra oscura. Texto: "EL PROSPECTO NO HA CONTESTADO / LIBERA LOS MEMES"

**Texto:**
> Buenas {nombre}! Me paso por aquí para preguntarte qué te ha parecido el video que te envié

---

## 4B — Dejar en leído los memes

- **Timing**: 48h después de 3B
- **Formato**: `meme_plus_text`
- **Asset**: `setting_assets/phase_b/4B/por_que_no_contesta.png`
- **Descripción del meme**: Pareja en cama mirando al lado opuesto. Texto: "Seguro que está pensando en otra / por qué no contesta los mensajes?"

**Texto:**
> Como me dejas en leído los memes {nombre}?? 😩

---

## 5B — Multiple choice (Quién quiere ser millonario)

- **Timing**: 48h después de 4B
- **Formato**: `meme_plus_text`
- **Asset**: `setting_assets/phase_b/5B/Picsart_25-10-29_17-21-01-626.jpg`
- **Descripción del meme**: Presentador de Quién Quiere Ser Millonario. Pregunta: "¿puedo enviarte un enlace de Calendly?" / A: Sí, por favor! / B: Déjame tranquilo / C: Sí, envíalo / D: Necesito tiempo

**Texto:**
> Eyy {nombre}, en qué punto estamos? A, B, C o D?

> [!tip] Por qué funciona
> Este touch convierte "no respondo" en una decisión binaria fácil. Las opciones A/C llevan al enlace de llamada, B archiva, D es objeción resoluble.

---

## 6B — Humor temporal (esqueleto)

- **Timing**: 48h después de 5B
- **Formato**: `meme_plus_text`
- **Asset**: `setting_assets/phase_b/6B/esperando_conteste_video.jpg`
- **Descripción del meme**: Esqueleto sentado en banco. Texto: "YO ESPERANDO A QUE CONTESTE AL VÍDEO"

**Texto:**
> Me estoy haciendo viejo esperando {nombre}

---

## 7B — Brain expanding

- **Timing**: 48h después de 6B
- **Formato**: `meme_plus_text`
- **Asset**: `setting_assets/phase_b/7B/no_abrir_ver_contestar_agendar.jpg`
- **Descripción del meme**: Galaxy brain en 4 niveles. NO ABRIR EL VÍDEO → VER EL VÍDEO → CONTESTAR AL VÍDEO → AGENDAR UNA LLAMADA

**Texto:**
> Ey capitán, vuelvo a pasarme por aquí. Espero una respuesta de tu parte 😉

---

## 8B — Toque final + archive

- **Timing**: 48h después de 7B
- **Formato**: `meme_plus_text_final`
- **Asset**: `setting_assets/phase_b/8B/Picsart_25-10-29_17-04-10-158.jpg`
- **Descripción del meme**: The Most Interesting Man (Dos Equis). Texto: "PREGUNTARÉ UNA VEZ MÁS / HAS VISTO EL VÍDEO?"

**Texto (con variables):**
> Qué tal capitán, espero que estés genial! Al no obtener respuesta tengo que archivar tu caso.
>
> De todas maneras te dejo por aquí un video {nurture_youtube}. Si te convence, puedes reservar un hueco gratis para que veas cómo funcionamos y lo que podemos hacer por ti: {discovery_call}

**Texto resuelto (para automatización):**
> Qué tal capitán, espero que estés genial! Al no obtener respuesta tengo que archivar tu caso.
>
> De todas maneras te dejo por aquí un video https://youtu.be/yoW6-LMURb8?si=oEgEmdnHe4MnKdCd. Si te convence, puedes reservar un hueco gratis para que veas cómo funcionamos y lo que podemos hacer por ti: https://www.quantumcreators.es/llamada-de-discovery

**Acción posterior**: si no responde tras 8B → archivar o marcar terminal según el sistema.

---

## Variables y enlaces

| Variable | Valor |
|---|---|
| `{nombre}` | Nombre del lead (resolver desde ManyChat custom field) |
| `{discovery_call}` | https://www.quantumcreators.es/llamada-de-discovery |
| `{nurture_youtube}` | https://youtu.be/yoW6-LMURb8?si=oEgEmdnHe4MnKdCd |

---

## Trigger de salida de Fase B → Fase C

**Condiciones de salida** (cualquiera de estas dispara el corte):

- Thumbs up 👍
- "me interesa" / variantes
- Pregunta cualificada sobre el servicio
- Objeción que conviene resolver en llamada (no en DM)
- Pide explícitamente siguiente paso
- En 5B responde A o C

**Template del enlace (mensaje de cierre Fase B → Fase C):**

> Perfecto. Te dejo por aquí el enlace para reservar un hueco y vemos tu caso con calma. La idea es entender qué haces ahora, dónde está el cuello de botella y si tiene sentido que podamos ayudarte: https://www.quantumcreators.es/llamada-de-discovery

---

## Notas operativas

- **Idempotencia**: el orchestrator debe garantizar que un mismo touch no se dispare dos veces si el lead responde y vuelve a quedar silente — usar contador `phase_b_touch_index` por lead en Postgres.
- **Ventana horaria**: respetar horario local del lead (no enviar entre 22:00–08:00).
- **Detección de respuesta**: cualquier `incoming_message` del lead durante la secuencia resetea el timer y reenvía al agente clasificador (setter vs salesperson).
- **Memes**: subir los assets una sola vez a ManyChat / S3 y referenciar por ID, no por path local.

## Enlaces relacionados

- [[Quantum Creators - Arquitectura setter agent]]
- [[Setter vs Salesperson - Reglas de routing]]
- [[Fase A - VSL nativa]]
- [[Fase C - Discovery call]]
- [[ManyChat custom fields - mapping]]
