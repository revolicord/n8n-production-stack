# Reporte de Implementación — Modelo B: MinIO Assets + followup_messages

**Fecha:** 2026-05-22  
**ADR de referencia:** ADR-0018  
**Estado:** Código implementado — pendiente deploy y cambios en n8n UI

---

## Qué se construyó

Soporte completo para follow-ups con imagen + texto (Modelo B): un operador sube un JPG al API, este lo guarda en MinIO y devuelve una URL pública, y la UI asocia dos `followup_messages` al template (uno `image`, uno `text`). El runner de n8n los manda juntos en un único `sendContent` de ManyChat.

---

## Archivos creados

| Archivo | Propósito |
|---------|-----------|
| `packages/db/drizzle/0008_followup_messages.sql` | Migración SQL — crea tabla `api.followup_messages` + índices |
| `apps/api/src/lib/minio.ts` | Cliente S3/MinIO: `uploadAsset()` + `isAllowedMimetype()` |
| `apps/api/src/services/followup-messages.ts` | CRUD sobre `followup_messages` (list, get, create, update, delete) |
| `apps/api/src/routes/admin/assets.ts` | `POST /admin/assets/upload` — multipart, max 8 MB |
| `apps/api/src/routes/admin/followup-messages.ts` | 4 endpoints CRUD de mensajes hijos de un template |
| `docs/n8n/workflows/followup-runner/07c-send-content-messages.md` | Instrucciones para el nuevo nodo en el runner de n8n |
| `docs/adr/0018-followup-messages-minio-assets.md` | ADR de la decisión arquitectónica |

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/schema.ts` | + tabla `followupMessages` + tipos `FollowupMessage` / `NewFollowupMessage` |
| `apps/api/src/config.ts` | + 5 vars MinIO: `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET_ASSETS`, `MINIO_PUBLIC_URL` |
| `.env.example` | + sección `MinIO API (dm-api asset upload)` con las 5 vars |
| `apps/api/package.json` | + `@aws-sdk/client-s3@^3.1052.0`, `@fastify/multipart@^10.0.0` |
| `apps/api/src/server.ts` | Registro de `@fastify/multipart` con `limits.fileSize: 8 MB` |
| `apps/api/src/routes/index.ts` | Registro de `assetsRoutes` y `followupMessagesRoutes` |
| `apps/api/src/routes/admin/followups.ts` | `FollowupTypeEnum` extendido a `['text', 'flow', 'content']`; `isTypeConsistent` permite `content` sin campos extra |
| `docker-stack.yml` | `minio-init` crea bucket `assets` con `mc anonymous set download` |

---

## Base de datos

### Tabla nueva: `api.followup_messages`

```sql
CREATE TABLE api.followup_messages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID        NOT NULL REFERENCES api.followup_templates(id) ON DELETE CASCADE,
  tenant_id     UUID        NOT NULL,
  message_type  TEXT        NOT NULL CHECK (message_type IN ('text', 'image')),
  text_content  TEXT,
  media_url     TEXT,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX followup_messages_tpl_order_unique ON api.followup_messages (template_id, sort_order);
CREATE INDEX followup_messages_template_idx ON api.followup_messages (template_id);
```

**Relaciones:**
- `template_id` → `api.followup_templates(id)` ON DELETE CASCADE (los mensajes mueren con el template)
- `tenant_id` denormalizado para filtros futuros sin join adicional

---

## API — Nuevos endpoints

Todos requieren `Authorization: Bearer <N8N_CALLBACK_TOKEN>`.

### Upload de assets

```
POST /admin/assets/upload?tenant_id=<uuid>
Content-Type: multipart/form-data
Campo: file (JPG / PNG / WebP / GIF, máx 8 MB)

→ 201 { "url": "https://minio.domain/assets/{tenantId}/follow-ups/{uuid}.jpg" }
→ 400 INVALID_MIMETYPE | FILE_TOO_LARGE | BAD_REQUEST
→ 401 UNAUTHORIZED
```

### Mensajes de un template

```
GET    /admin/followup-templates/:templateId/messages
→ 200 FollowupMessage[]   (ordenados por sort_order ASC)

POST   /admin/followup-templates/:templateId/messages
Body: { message_type: 'text'|'image', text_content?: string, media_url?: string, sort_order?: number }
→ 201 FollowupMessage
→ 400 si message_type='text' y falta text_content, o message_type='image' y falta media_url
→ 404 si el template no existe

PUT    /admin/followup-messages/:id
Body: { message_type?, text_content?, media_url?, sort_order? }  (todos opcionales)
→ 200 FollowupMessage actualizado
→ 404 si no existe

DELETE /admin/followup-messages/:id
→ 204
→ 404 si no existe
```

### Templates — tipo `'content'` ahora permitido

```
POST /admin/funnel-stages/:stageId/followups
Body: { sequence_number, delay_hours, type: 'content', description? }
→ 201  (sin text_template ni flow_ns — los mensajes se crean aparte)
```

---

## Variables de entorno nuevas

Agregar al `.env` en producción antes del próximo deploy:

```bash
# MinIO API (dm-api asset upload)
MINIO_ENDPOINT=https://minio.tudominio.com
MINIO_ACCESS_KEY=minio_admin        # mismo usuario que MINIO_ROOT_USER
MINIO_SECRET_KEY=<password>         # mismo valor que MINIO_ROOT_PASSWORD
MINIO_BUCKET_ASSETS=assets
MINIO_PUBLIC_URL=https://minio.tudominio.com
```

---

## Flujo completo de uso

```
1. Alex sube imagen:
   POST /admin/assets/upload?tenant_id=<uuid>
   → { url: "https://minio.domain/assets/.../meme.jpg" }

2. Alex crea template tipo 'content':
   POST /admin/funnel-stages/<stageId>/followups
   { sequence_number: 2, delay_hours: 48, type: 'content', description: 'Meme semana 2' }
   → { id: "<templateId>", type: "content", ... }

3. Alex agrega mensaje imagen:
   POST /admin/followup-templates/<templateId>/messages
   { message_type: 'image', media_url: 'https://minio.domain/assets/.../meme.jpg', sort_order: 0 }

4. Alex agrega mensaje texto:
   POST /admin/followup-templates/<templateId>/messages
   { message_type: 'text', text_content: 'Oye {{name}}, ¿ya lo viste? 👀', sort_order: 1 }

5. Runner n8n (cada 5 min) detecta el lead con este template vencido:
   → Obtiene los mensajes (imagen + texto) del subquery
   → Construye sendContent con messages: [{ type:'image', url:'...' }, { type:'text', text:'Oye Luis...' }]
   → POST https://api.manychat.com/fb/sending/sendContent
   → Registra en lead_followup_log + avanza next_sequence_number
```

---

## Infraestructura Docker

El servicio `minio-init` en `docker-stack.yml` ahora crea dos buckets en cada deploy:

```sh
# Bucket existente (n8n binarios):
mc mb --ignore-existing local/n8n-data
mc anonymous set none local/n8n-data

# Bucket nuevo (assets de follow-up):
mc mb --ignore-existing local/assets
mc anonymous set download local/assets   # GET público, PUT/DELETE requieren credenciales
```

---

## Cambios pendientes en n8n UI (usuario aplica)

Ver instrucciones detalladas en `docs/n8n/workflows/followup-runner/07c-send-content-messages.md`.

### Resumen de 3 cambios:

**1. Nodo 02 — Get Due Leads (SQL)**  
Agregar subquery al SELECT:
```sql
COALESCE(
  (SELECT json_agg(
    json_build_object('message_type', fm.message_type, 'text_content', fm.text_content,
                      'media_url', fm.media_url, 'sort_order', fm.sort_order)
    ORDER BY fm.sort_order ASC
  ) FROM api.followup_messages fm WHERE fm.template_id = ft.id),
  '[]'::json
) AS followup_messages
```

**2. Nodo 06 — If/Switch por tipo**  
Convertir de nodo **If** a nodo **Switch** con 3 ramas:
- `followup_type == 'text'` → 07a
- `followup_type == 'flow'` → 07b
- `followup_type == 'content'` → Code node + 07c

**3. Nodo 07c — Send Content Messages (nuevo)**  
Code node que mapea `followup_messages` a formato ManyChat + HTTP Request a `sendContent`.

---

## Pasos de deploy

```bash
# 1. Agregar las 5 vars MinIO al .env del servidor
# 2. Aplicar migración
make migrate

# 3. Rebuild y redeploy del API
make rebuild-api

# 4. Verificar que el bucket 'assets' existe en MinIO
# Abrir https://minio-console.tudominio.com → Buckets → assets → Access: public

# 5. Aplicar cambios en n8n UI (ver 07c-send-content-messages.md)
```

---

## Verificación post-deploy

```bash
# 1. Upload de imagen (requiere token real)
curl -X POST "https://api.tudominio.com/admin/assets/upload?tenant_id=<uuid>" \
  -H "Authorization: Bearer <N8N_CALLBACK_TOKEN>" \
  -F "file=@/tmp/test.jpg"
# Esperado: 201 { "url": "https://minio.tudominio.com/assets/.../test.jpg" }

# 2. La URL es accesible públicamente
curl -I "https://minio.tudominio.com/assets/<tenantId>/follow-ups/<uuid>.jpg"
# Esperado: HTTP 200

# 3. Crear template content + mensajes y verificar con GET
# 4. Ejecutar el runner manualmente en n8n con un lead activo y verificar
#    que ManyChat recibe imagen + texto
```
