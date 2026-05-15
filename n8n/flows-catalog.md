# Catálogo de Flows de ManyChat — Quantum Creators

Fuente de verdad del mapeo entre flows de ManyChat y el sistema del agente.

> **El sistema vivo está en `stage_flows` (Postgres), no aquí.** Este documento es referencia humana.
> Para cambios operativos, ver `docs-dm-settings/15-flow-registry-manychat.md`.
> Para la decisión arquitectónica, ver `docs/adr/0016-flow-registry-naming.md`.

---

## Naming convention

```
QC_{STAGE}_{MEDIA_TYPE}_{DESCRIPCION}_{VARIANT}
```

Prefijo `QC_` filtra los flows que el agente puede disparar del resto de flows de ManyChat.
Ver doc 15 para la especificación completa.

---

## Flows actuales (tenant: revolicord)

| Nombre en ManyChat (nuevo) | ns ManyChat | Stage | Media | content_description | usage_condition | variant_group | weight |
|---|---|---|---|---|---|---|---|
| `QC_A_video_hook_v1` | `content20260511152354_558165` | A | video | Vídeo 25s que presenta el sistema de crecimiento en YouTube — pide pulgar arriba al final | Primer contacto. Enviar siempre antes de hacer preguntas. | hook | 1 |
| `QC_A_video_hook_v2` | `content20260511155655_840313` | A | video | Vídeo 25s variante 2 — misma presentación, enfoque diferente | Variante A/B del hook inicial | hook | 1 |
| `QC_A_video_hook_v3` | `content20260511160051_518775` | A | video | Vídeo 25s variante 3 — intro desde canal de YouTube | Variante A/B del hook inicial | hook | 1 |
| `QC_A_video_hook_v4` | `content20260511160458_294557` | A | video | Vídeo 25s versión canal (cpchel) — para leads que vienen de YouTube | Variante A/B para tráfico de YouTube | hook | 1 |
| `QC_MS_audio_vsl` | `content20260511153207_699341` | MS | audio | Audio de introducción previo a la VSL — calienta antes del video largo | Enviar cuando el lead confirme que vio el Vídeo 1 (transición A→MS) | vsl | 1 |
| `QC_B_audio_presentacion` | `content20260506163913_313256` | B | audio | Audio de presentación del sistema completo | Enviar cuando el lead reacciona positivo a la VSL y pide más info antes del Calendly | presentacion | 1 |
| `QC_B_img_resultados` | `content20260507013255_914847` | B | img | Imágenes de resultados reales de clientes — casos de éxito | Enviar cuando el lead pide pruebas o muestra escepticismo ("¿funciona de verdad?") | social_proof | 1 |
| `QC_B_txt_prueba_social` | `content20260506035030_031926` | B | txt | Mensajes de texto con testimonios de clientes | Alternativa a las imágenes para leads que prefieren leer | social_proof | 1 |

> **PENDIENTE — Alex confirmar:** `content_description` y `usage_condition` son inferidos. Alex conoce el contenido exacto de cada flow y debe corregirlos en DB.

---

## Estado en DB (`stage_flows`)

```sql
-- Ver estado actual de todos los flows del tenant
SELECT
  sf.human_name,
  sf.flow_ns,
  fs.slug AS stage,
  sf.media_type,
  sf.is_active,
  sf.weight,
  sf.variant_group,
  sf.pending_ns
FROM api.stage_flows sf
JOIN api.funnel_stages fs ON sf.stage_id = fs.id
WHERE sf.tenant_id = '9d338f06-59c6-47bd-b3d7-4e3631ff4e75'
ORDER BY fs.position, sf.variant_group, sf.weight;
```

---

## SQL para cargar catálogo inicial (migración manual post-0003)

Ejecutar después de aplicar la migración 0003 y de que Alex renombre los flows en ManyChat:

```sql
-- Etapa A — hook videos (4 variantes)
UPDATE api.stage_flows SET
  human_name          = 'QC_A_video_hook_v1',
  media_type          = 'video',
  content_description = 'Vídeo 25s que presenta el sistema de crecimiento en YouTube — pide pulgar arriba al final',
  usage_condition     = 'Primer contacto. Enviar siempre antes de hacer preguntas.',
  variant_group       = 'hook',
  flow_ns             = 'content20260511152354_558165',
  is_active           = true
WHERE tenant_id = '9d338f06-59c6-47bd-b3d7-4e3631ff4e75'
  AND flow_ns IN ('PENDIENTE_ns_video_hook', 'content20260511152354_558165');

-- Para las variantes v2/v3/v4 necesitas insertar nuevas filas:
-- Ver docs-dm-settings/15-flow-registry-manychat.md → Cómo añadir un flow nuevo

-- Etapa MS — audio VSL
UPDATE api.stage_flows SET
  human_name          = 'QC_MS_audio_vsl',
  media_type          = 'audio',
  content_description = 'Audio de introducción previo a la VSL',
  usage_condition     = 'Enviar cuando el lead confirme que vio el Vídeo 1',
  variant_group       = 'vsl',
  flow_ns             = 'content20260511153207_699341',
  is_active           = true
WHERE tenant_id = '9d338f06-59c6-47bd-b3d7-4e3631ff4e75'
  AND flow_ns IN ('PENDIENTE_ns_video_vsl', 'content20260511153207_699341');
```
