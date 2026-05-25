# ADR-0018: Follow-up Messages como Assets en MinIO (Modelo B)

**Status:** Accepted  
**Date:** 2026-05-22  
**Deciders:** Equipo Revolicord

---

## Y-Statement

> _In the context of_ un sistema de follow-ups donde Alex necesita enviar memes (imagen + texto) de forma independiente,  
> _facing_ la limitación de `followup_templates` que solo soporta `type='text'` (un texto plano) o `type='flow'` (un flujo ManyChat sin control granular),  
> _we decided_ agregar un nuevo tipo `'content'` que delega la composición a la tabla hija `followup_messages`, y almacenar las imágenes en MinIO con un bucket público de solo lectura,  
> _to achieve_ autonomía total para editar imagen y texto de forma independiente, URLs estables públicamente accesibles por Meta/ManyChat, y sin requerir una UI de ManyChat para enviar multimedia,  
> _accepting_ que Alex debe subir cada imagen vía `POST /admin/assets/upload` antes de crear el mensaje, y que el bucket `assets` en MinIO es de lectura pública sin expiración de URL.

---

## Contexto

### Problema

`followup_templates` almacena una plantilla por fila: un texto con `{{name}}` o un flow de ManyChat. No hay forma de enviar imagen + texto en un solo follow-up sin usar un flow, y los flows de ManyChat son menos flexibles para editar el copy rápidamente.

Alex (operador de Quantum Creators) necesita:
1. Subir un meme JPG/PNG.
2. Escribir un texto de acompañamiento con `{{name}}`.
3. Editar uno sin tocar el otro.
4. Que el runner los envíe juntos en un solo `sendContent` de ManyChat.

### Alternativas consideradas

| Opción | Pros | Contras |
|--------|------|---------|
| **A: Campo `imageUrl` en `followup_templates`** | Simple, una tabla | Acoplado: no puedes tener 2 imágenes, orden fijo |
| **B (elegida): Tabla hija `followup_messages`** | Flexibilidad total, orden configurable, N mensajes | Una join más |
| **C: Tipo `flow` con imagen embebida** | Sin infraestructura nueva | Alex no puede editar el copy sin entrar a ManyChat |

---

## Decisión

### Nuevo tipo `'content'` en `followup_templates`

El campo `type` pasa de `enum('text', 'flow')` a `enum('text', 'flow', 'content')`.

- `type='text'` → usa `text_template` (sin cambios).
- `type='flow'` → usa `flow_ns` (sin cambios).
- `type='content'` → los mensajes viven en `followup_messages` hija; `text_template` y `flow_ns` quedan `NULL`.

### Tabla `followup_messages`

```sql
CREATE TABLE api.followup_messages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID        NOT NULL REFERENCES api.followup_templates(id) ON DELETE CASCADE,
  tenant_id     UUID        NOT NULL,
  message_type  TEXT        NOT NULL CHECK (message_type IN ('text', 'image')),
  text_content  TEXT,       -- si message_type='text'; soporta {{name}}
  media_url     TEXT,       -- si message_type='image'; URL pública MinIO
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, sort_order)
);
```

- Un template `type='content'` tiene normalmente 2 filas: `sort_order=0` (imagen) y `sort_order=1` (texto).
- El runner las ordena por `sort_order ASC` y las manda todas en `content.messages[]`.

### MinIO — bucket `assets` público de lectura

- Bucket separado de `n8n-data` para no mezclar datos operativos con assets de follow-up.
- Política `anonymous set download` (lectura pública, escritura solo con credenciales).
- El API escribe con `@aws-sdk/client-s3` usando `forcePathStyle: true` (requerido para MinIO).
- URL pública: `https://${MINIO_DOMAIN}/assets/${tenantId}/follow-ups/${uuid}.{ext}`.

### Validaciones en el upload

- Formatos permitidos: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.
- Tamaño máximo: **8 MB** (límite de ManyChat para imágenes en `sendContent`).
- El header `Content-Type` del PUT a MinIO preserva el mimetype original.

### Runner n8n — rama `content`

El nodo 02 (Get Due Leads) agrega un subquery que devuelve `followup_messages` como JSON array.
El nodo 06 (Switch por tipo) añade una rama `content` que construye el payload `sendContent` dinámicamente con imagen y texto interpolado.

---

## Consecuencias

### Positivas
- Alex puede reusar la misma imagen en distintos textos (apuntando a la misma URL MinIO).
- El texto se actualiza sin tocar la imagen y viceversa.
- Las URLs de MinIO son estables (no presignadas con expiración).
- La infra ya estaba: MinIO corría pero el API no lo usaba.

### Negativas / Riesgos
- El bucket `assets` es público de lectura; cualquiera con la URL puede ver la imagen. Aceptable para memes de marketing.
- No hay CDN frente a MinIO. Si un follow-up viral genera tráfico, MinIO lo absorbe directamente.
- La migración `0008` debe aplicarse antes de deployar la nueva versión de la API.

### Neutrales
- Las migraciones antiguas (`0002`–`0007`) siguen siendo válidas; `0008` solo agrega una tabla nueva.
- Los templates `type='text'` y `type='flow'` existentes no requieren cambios.

---

## Referencias

- ADR-0015: Sistema de Follow-ups por Etapa (tabla padre `followup_templates`)
- ADR-0003: Almacenamiento MinIO (configuración del servicio Docker)
- `docs/n8n/workflows/followup-runner/07c-send-content-messages.md` — instrucciones de implementación del nodo n8n

---

**Nota (2026-05-22):** El dashboard de configuración fue implementado en `/dashboard` del API Fastify (sin frontend separado). Alex puede editar textos de follow-ups, subir imágenes de memes y ajustar delays directamente desde el navegador en `https://<API_HOST>/dashboard`. La autenticación usa JWT firmado por `POST /admin/login` — el bearer estático de n8n sigue funcionando en paralelo (dual-auth, `lib/admin-auth.ts`).
