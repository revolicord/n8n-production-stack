# Definición de Etapas del Funnel — Quantum Creators

Define las 5 etapas del lead, las transiciones válidas, los criterios de avance y los flows por etapa.

> **Modelo canónico:** este es el funnel de `docs/onboarding/07-funnel-y-agente.md`.
> El modelo de datos completo (`lead_stages`, `stage_transitions`, `closers`, `follow_up_templates`,
> `notifications`) vive en doc 13. Aquí solo van las definiciones de etapa y la config de flows.
> La versión anterior con etapas `nuevo/interesado/prospecto/cliente` queda **obsoleta**.

---

## Etapas

| Sigla | Nombre | Quién maneja | Qué significa |
|-------|--------|--------------|---------------|
| `A` | Initiated | bot | Lead recibió el primer mensaje + Vídeo 1 (enganche, 25 s) |
| `MS` | Media Seen | bot | Lead confirmó (verbal o emoji, tras pregunta del agente) que vio el Vídeo 1 |
| `B` | Engaged | bot | Lead recibió el Vídeo 2 (VSL) y reaccionó positivo |
| `C` | Calendly'd | bot | Lead recibió el link de agendamiento |
| `D` | Booked | handoff a closer | Lead reservó en Calendly — el closer toma desde aquí |

Etapas terminales (no avanzan):

| Etapa | Significado |
|-------|-------------|
| `disqualified` | Descalificado por el agente. Motivo en `reason`: `no_money`, `no_quality`, `not_interested`, `geographic`, `fake_account`. |
| `lost` | 8 follow-ups agotados sin respuesta. |
| `escalated_human_call` | Tras follow-up #5, el agente notifica a Alex para una llamada por IG. |

---

## Transiciones válidas

El agente avanza **una etapa por vez**. El endpoint `set_stage` debe rechazar saltos (ej. `A → C`) con `400`.

```
A  → MS | disqualified
MS → B  | disqualified
B  → C  | disqualified
C  → D  (solo vía webhook de Calendly, NO el agente)
cualquiera → escalated_human_call | lost  (solo vía cron de follow-ups)
```

### Criterios de avance

- **A → MS**: el lead confirma haber visto el Vídeo 1 — verbal ("ya lo vi", "interesante", "vale" tras la pregunta del agente) o emoji 👍/✅ **después** de que el agente preguntó.
- **MS → B**: tras enviar el Vídeo 2 (VSL), el lead reacciona positivo (👍 explícito a la VSL, "me encanta", "quiero saber más", "cómo funciona").
- **B → C**: tras un mensaje positivo claro, el agente envía el link de Calendly.
- **C → D**: lo dispara el webhook de Calendly, no el agente.

### Criterios de descalificación

- `no_money` — "no tengo dinero", "no me lo puedo permitir", "estoy sin trabajo" (tras un intento de reencuadre).
- `not_interested` — "no me interesa", "no quiero", "déjame en paz".
- `geographic` — fuera de países hispanohablantes / zona horaria inviable.
- `fake_account` / `no_quality` — cuenta sin foto, casi sin seguidores, claramente inactiva o falsa.

---

## Config de flows por etapa (legacy `flows_by_stage`)

> **El mecanismo vivo es el registro `stage_flows` en Postgres** (vía `Get Stage Config`; ver [`../docs/onboarding/09-flow-registry-manychat.md`](../docs/onboarding/09-flow-registry-manychat.md)). El bloque `flows_by_stage` de abajo es el enfoque anterior basado en `tenants.config`; se conserva como referencia. Los `ns` reales de QC están pendientes de confirmar (ver [`../docs/status.md`](../docs/status.md) y `flows-catalog.md`).

```json
{
  "flows_by_stage": {
    "A": [
      {
        "name": "video_hook",
        "ns": "PENDIENTE_ns_video_hook",
        "description": "Vídeo de enganche de 25 s — primer contacto, pide pulgar arriba"
      }
    ],
    "MS": [
      {
        "name": "video_vsl",
        "ns": "PENDIENTE_ns_video_vsl",
        "description": "VSL de 1:58 que explica el sistema completo — enviar cuando el lead confirmó ver el Vídeo 1"
      }
    ],
    "B": [],
    "C": [],
    "D": []
  }
}
```

> En etapa B el agente no dispara un flow: envía el link de Calendly (`tenant.config.calendly_url`)
> con `send_text`. En C/D no hay contenido automático del agente.

---

## Valores que acepta `set_stage`

El endpoint `POST /admin/leads/:subscriberId/stage` debe aceptar en `new_stage`:

```
A | MS | B | C | disqualified
```

`D`, `lost` y `escalated_human_call` **no** los marca el agente: los marca el sistema
(webhook de Calendly y cron de follow-ups respectivamente).

Body de ejemplo:

```json
{
  "new_stage": "MS",
  "reason": "El lead confirmó haber visto el Vídeo 1",
  "evidence": "ya lo vi, interesante"
}
```
