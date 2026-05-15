# 15 · Flow Registry — Naming Convention y Sincronización ManyChat

Este documento es la **fuente de verdad operativa** para gestionar los flows de ManyChat que usa el agente setter. Es el cuello de botella histórico del sistema: si los flows no están mapeados correctamente, el agente no puede enviar contenido y el funnel se rompe.

---

## El problema que resuelve

ManyChat genera namespaces opacos: `content20260511153207_699341`. Sin una convención, no hay forma de saber:
- Para qué etapa del funnel es ese flow
- Qué contenido tiene (video, audio, imagen, texto)
- Cuándo debe usarlo el agente
- Cuántas variantes A/B existen

El resultado: `stage_flows` en DB termina con `PENDIENTE_ns_video_hook` y el agente no funciona.

---

## Arquitectura de las 4 capas

```
ManyChat UI
  └─ flows nombrados con convención QC_*
       │
       ▼
GET /tenants/:slug/tools  (tools.ts)
  └─ llama fb/page/getFlows
  └─ filtra por prefijo QC_
  └─ parsea nombre → extrae stage, media_type, variant_group
  └─ cachea 5 min en Redis
       │
       ▼
POST /tenants/:slug/tools/sync  (tools.ts)
  └─ lee flows de ManyChat
  └─ hace UPSERT en stage_flows (pending_ns) — requiere aprobación
  └─ o upsert directo si --force (solo en desarrollo)
       │
       ▼
stage_flows (Postgres)
  └─ flow_ns real ← fuente de verdad para el agente
  └─ content_description ← qué ve/escucha el lead
  └─ usage_condition ← cuándo lo usa el agente
       │
       ▼
Get Stage Config (nodo n8n)
  └─ query: SELECT flows FROM stage_flows WHERE stage = ? AND is_active = TRUE
       │
       ▼
Build Context (nodo n8n)
  └─ inyecta en system prompt:
     "CONTENIDO DISPONIBLE:
      - flow_name: "content..." — [usage_condition]
        Contenido: [content_description]"
       │
       ▼
Agente LLM
  └─ llama trigger_manychat_flow("content...") con el ns exacto
```

---

## Naming convention en ManyChat

### Patrón
```
QC_{STAGE}_{MEDIA_TYPE}_{DESCRIPCION}_{VARIANT}
```

| Segmento | Valores válidos | Ejemplo |
|---|---|---|
| `QC` | fijo — identifica que pertenece al sistema | `QC` |
| `STAGE` | `A` \| `MS` \| `B` \| `C` \| `ALL` | `A` |
| `MEDIA_TYPE` | `video` \| `audio` \| `img` \| `txt` \| `sticker` | `video` |
| `DESCRIPCION` | snake_case, max 30 chars, sin espacios | `hook_enganche` |
| `VARIANT` | `v1` \| `v2` \| `v3`… (omitir si solo hay una versión) | `v2` |

### Ejemplos reales

```
QC_A_video_hook_v1           ← stage A, video de enganche, variante 1
QC_A_video_hook_v2           ← stage A, video de enganche, variante 2 (A/B test)
QC_A_video_hook_v3           ← stage A, video de enganche, variante 3
QC_MS_audio_vsl              ← stage MS, audio previo a la VSL
QC_MS_video_vsl              ← stage MS, VSL completa en video
QC_B_img_resultados          ← stage B, imágenes de resultados de clientes
QC_B_audio_presentacion      ← stage B, audio de presentación del sistema
QC_ALL_sticker_thanks        ← cualquier etapa, sticker de agradecimiento
```

### Reglas operativas

1. **Nunca renombrar un flow sin correr el sync después.** El `flow_ns` (namespace interno) no cambia al renombrar, pero el sistema detecta el cambio de nombre en la siguiente sincronización.
2. **Un flow = una etapa.** Si el mismo contenido sirve para A y B, duplicar el flow en ManyChat con ambos prefijos. No usar `A+B` ni multi-stage en el nombre.
3. **Las variantes A/B se agrupan por `variant_group`** en DB (campo `variant_group`). El Build Context hace selección ponderada entre ellas. El nombre en ManyChat debe ser el mismo excepto en el sufijo `_vX`.
4. **Los flows de "recepción" (Instagram Default Reply, etc.) no usan esta convención** — son flows de trigger, no de contenido. Solo los flows que el agente dispara activamente usan `QC_`.

---

## Schema de `stage_flows` (completo)

```sql
-- Columnas actuales
id             uuid PK
stage_id       uuid FK → funnel_stages
tenant_id      uuid
flow_ns        text NOT NULL    -- ns real de ManyChat: content20260511...
description    text             -- DEPRECATED: usar content_description + usage_condition
weight         int DEFAULT 1    -- peso para selección A/B ponderada
is_active      bool DEFAULT true
created_at     timestamp

-- Columnas nuevas (migración 0003)
human_name         text,        -- nombre en ManyChat: QC_A_video_hook_v1
media_type         text,        -- video | audio | img | txt | sticker
content_description text,       -- qué ve/escucha el lead: "Video de 25s sobre..."
usage_condition    text,        -- cuándo usarlo: "Enviar en primer contacto, pedir 👍"
variant_group      text,        -- agrupa variantes A/B: 'hook' agrupa v1/v2/v3
pending_ns         text,        -- ns recibido del sync, pendiente de aprobación
synced_at          timestamp    -- última vez que se sincronizó desde ManyChat
```

### Qué ve el agente en el prompt

El Build Context construye una línea por flow activo en la etapa:

```
CONTENIDO DISPONIBLE para esta etapa (usa trigger_manychat_flow con el flow_name exacto):
- flow_name: "content20260511152354_558165" — Enviar en el primer contacto antes de preguntar si vio el video. Pide 👍 al final.
  Contenido: Video de 25 segundos explicando qué es Quantum Creators y cómo triplicamos facturación.
```

Si `usage_condition` y `content_description` están en DB, el agente tiene contexto completo para decidir cuándo y cómo usarlo.

---

## Catálogo de flows actuales — Quantum Creators

Renombrar estos flows en ManyChat UI antes de correr el primer sync:

| Nombre actual en ManyChat | Nuevo nombre (convención) | ns ManyChat | Stage | Media | content_description | usage_condition |
|---|---|---|---|---|---|---|
| `video_inicial_v1` (o similar) | `QC_A_video_hook_v1` | `content20260511152354_558165` | A | video | Vídeo de 25s que presenta el sistema de crecimiento en YouTube — pide pulgar arriba al final | Primer contacto. Enviar siempre antes de hacer preguntas. |
| `video_inicial_v2` (o similar) | `QC_A_video_hook_v2` | `content20260511155655_840313` | A | video | Vídeo de 25s variante 2 — misma presentación, enfoque diferente | Variante A/B de QC_A_video_hook_v1 |
| `video_inicial_v3` (o similar) | `QC_A_video_hook_v3` | `content20260511160051_518775` | A | video | Vídeo de 25s variante 3 — intro desde canal de YouTube | Variante A/B de QC_A_video_hook_v1 |
| `video_cpchel` (o similar) | `QC_A_video_hook_v4` | `content20260511160458_294557` | A | video | Vídeo de 25s — versión para leads que vienen del canal | Variante A/B para tráfico de YouTube |
| `audio_vsl` (o similar) | `QC_MS_audio_vsl` | `content20260511153207_699341` | MS | audio | Audio de introducción previo a la VSL — calienta antes de enviar el video largo | Enviar cuando el lead confirme que vio el Vídeo 1 (etapa MS) |
| `audio_presentacion` (o similar) | `QC_B_audio_presentacion` | `content20260506163913_313256` | B | audio | Audio de presentación del sistema completo | Enviar cuando el lead reacciona positivo a la VSL y pide más info antes del Calendly |
| `imagenes` (o similar) | `QC_B_img_resultados` | `content20260507013255_914847` | B | img | Imágenes de resultados reales de clientes — casos de éxito | Enviar cuando el lead pide pruebas o muestra escepticismo en etapa B |
| `mensajes` (o similar) | `QC_B_txt_prueba_social` | `content20260506035030_031926` | B | txt | Mensajes de texto con testimonios de clientes | Alternativa a imágenes para leads que prefieren leer |

> **IMPORTANTE:** Las columnas `content_description` y `usage_condition` son las que Alex debe completar/corregir — solo él sabe el contenido exacto de cada flow. Los valores de arriba son inferidos.

---

## Cómo añadir un flow nuevo (runbook)

```
1. Crear el flow en ManyChat con contenido (video/audio/imagen)
2. Nombrarlo con la convención: QC_{STAGE}_{MEDIA}_{DESC}_{vX}
3. Publicarlo (LIVE) en ManyChat
4. Llamar: POST /tenants/revolicord/tools/sync
   → el sistema leerá ManyChat API y detectará el nuevo flow
   → creará una fila en stage_flows con pending_ns = ns_real, is_active = false
5. Ejecutar SQL de aprobación:
   UPDATE api.stage_flows
   SET flow_ns = pending_ns, pending_ns = NULL, is_active = true
   WHERE tenant_id = '<uuid>' AND human_name = 'QC_A_video_hook_v5';
6. Completar content_description y usage_condition:
   UPDATE api.stage_flows
   SET content_description = 'Descripción de lo que ve el lead...',
       usage_condition = 'Cuándo debe enviarlo el agente...'
   WHERE tenant_id = '<uuid>' AND human_name = 'QC_A_video_hook_v5';
7. Probar en n8n: el próximo turno de un lead en stage A debe ver el nuevo flow
   en "CONTENIDO DISPONIBLE"
```

---

## Cómo actualizar el ns de un flow existente

Ocurre cuando se recrea un flow en ManyChat (nuevo ns, mismo contenido):

```sql
UPDATE api.stage_flows
SET flow_ns    = 'content_nuevo_ns_aqui',
    synced_at  = NOW()
WHERE tenant_id  = '9d338f06-59c6-47bd-b3d7-4e3631ff4e75'
  AND human_name = 'QC_A_video_hook_v1';
```

---

## Cómo activar/desactivar un flow (A/B testing)

```sql
-- Desactivar variante 1, activar variante 2
UPDATE api.stage_flows SET is_active = false
WHERE tenant_id = '...' AND human_name = 'QC_A_video_hook_v1';

UPDATE api.stage_flows SET is_active = true
WHERE tenant_id = '...' AND human_name = 'QC_A_video_hook_v2';

-- O cambiar pesos para distribución A/B (v1: 70%, v2: 30%)
UPDATE api.stage_flows SET weight = 7 WHERE human_name = 'QC_A_video_hook_v1' AND tenant_id = '...';
UPDATE api.stage_flows SET weight = 3 WHERE human_name = 'QC_A_video_hook_v2' AND tenant_id = '...';
```

---

## Endpoint GET /tenants/:slug/tools

Llamado por n8n para obtener la lista de tools disponibles (también usable desde el explorador de admin).

```
GET /tenants/revolicord/tools
Authorization: Bearer <N8N_CALLBACK_TOKEN>

Response:
{
  "tools": [
    {
      "name": "QC_A_video_hook_v1",
      "description": "Enviar en primer contacto. Contenido: Vídeo 25s sistema YouTube",
      "flow_id": "content20260511152354_558165",
      "stage": "A",
      "media_type": "video",
      "variant_group": "hook"
    }
  ]
}
```

Cache: 5 minutos en Redis (clave `mc:tools:{tenant_id}`). Invalidar con `DEL mc:tools:{tenant_id}` tras un sync.

---

## Preguntas frecuentes

**¿Qué pasa si renombro un flow en ManyChat sin correr el sync?**
El agente sigue usando el `flow_ns` (namespace interno) que ya está en DB — no cambia. El nombre es solo metadata. Pero el sync de los tools devolverá el nombre nuevo y marcará el flow como "nombre cambiado", lo que puede confundir el parsing. Por eso: renombrar → sync → verificar.

**¿El agente puede inventarse un flow_name?**
No. El prompt tiene hardcoded: "Nunca inventes un flow_name. Solo usas los que aparecen en CONTENIDO DISPONIBLE". El agente recibe el ns exacto en el prompt y lo repite como argumento de tool.

**¿Puedo tener más de 3 variantes A/B?**
Sí. El campo `weight` distribuye el tráfico. Con 4 variantes y pesos 1/1/1/1, cada una recibe 25%. Recomendado: máximo 3 variantes activas simultáneamente para que el volumen por variante sea estadísticamente significativo.

**¿Qué pasa si un flow está en LIVE pero is_active = false en DB?**
El agente no lo usa. El flow existe en ManyChat pero el sistema lo ignora. Útil para preparar flows sin activarlos aún.
