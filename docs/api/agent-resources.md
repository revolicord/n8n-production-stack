# API — Agent Resources

Recursos del agente: snippets de texto e imágenes organizados por categoría (`cierre`, `objecion`, `general`) que el agente IA consulta on-demand. No son follow-ups secuenciados — se usan cuando el agente detecta el contexto apropiado.

Ver [ADR-0019](../adr/0019-agent-resources.md) para la justificación del diseño.

---

## Modelo de datos

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `tenant_id` | UUID | Tenant al que pertenece |
| `category` | TEXT | `cierre` \| `objecion` \| `general` |
| `slug` | TEXT | Identificador corto único por tenant (`[a-z0-9_-]+`) |
| `display_name` | TEXT | Nombre legible para el dashboard |
| `trigger_hint` | TEXT? | Cuándo usar este recurso (guía para el agente) |
| `text_content` | TEXT? | Texto a enviar (soporta `{{name}}`) |
| `media_url` | TEXT? | URL pública de MinIO (imagen, video) |
| `sort_order` | INT | Orden de visualización en el dashboard |
| `is_active` | BOOL | Soft delete — false = eliminado |
| `created_at` | TIMESTAMPTZ | — |
| `updated_at` | TIMESTAMPTZ | — |

**Invariante:** al menos uno de `text_content` o `media_url` debe ser no nulo.

---

## Autenticación

Bearer token (mismo `N8N_CALLBACK_TOKEN` de los otros endpoints admin, o JWT de admin dashboard).

---

## Endpoints

### List Agent Resources

```
GET /admin/tenants/:tenantId/agent-resources?category=cierre
```

**Response 200:**
```json
{
  "resources": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "category": "cierre",
      "slug": "precio-incluye-todo",
      "displayName": "Precio incluye todo",
      "triggerHint": "Usar cuando el lead pregunta el precio",
      "textContent": "El precio de $997 incluye...",
      "mediaUrl": null,
      "sortOrder": 0,
      "isActive": true,
      "createdAt": "2026-05-22T15:00:00Z",
      "updatedAt": "2026-05-22T15:00:00Z"
    }
  ]
}
```

### Create Agent Resource

```
POST /admin/tenants/:tenantId/agent-resources
Content-Type: application/json

{
  "category": "cierre",
  "slug": "precio-incluye-todo",
  "display_name": "Precio incluye todo",
  "trigger_hint": "Usar cuando el lead pregunta el precio",
  "text_content": "El precio de $997 incluye..."
}
```

**Response 201:** objeto completo del recurso creado.

**Errores:**
- `400 INVALID_PAYLOAD` — validación fallida (category inválida, slug con espacios, ni text_content ni media_url)
- `409 DUPLICATE_SLUG` — slug ya existe para este tenant

### Update Agent Resource

```
PUT /admin/agent-resources/:id
Content-Type: application/json

{
  "text_content": "Precio actualizado: $1,197..."
}
```

**Response 200:** objeto actualizado. Todos los campos son opcionales (patch parcial).

**Errores:** `400`, `404 NOT_FOUND`, `409 DUPLICATE_SLUG`

### Delete Agent Resource (soft delete)

```
DELETE /admin/agent-resources/:id
```

**Response 200:**
```json
{ "id": "uuid", "isActive": false }
```

El registro permanece en BD con `is_active = false` y no aparece en los listados.
