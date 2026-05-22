# API Reference — DM Setter API

La API está implementada con Fastify en `apps/api/`. Todos los endpoints viven bajo el mismo proceso HTTP (puerto 3000 en local, enrutado por Traefik en producción).

## Endpoints implementados

| Método | Ruta | Quién la llama | Descripción |
|---|---|---|---|
| GET | `/healthz` | Traefik, Docker Swarm | Liveness probe |
| GET | `/readyz` | Docker Swarm | Readiness (DB + Redis) |
| POST | `/webhook/manychat` | ManyChat External Request | Inbound DMs |
| GET | `/tenants/:slug/tools` | n8n Build Context | Flows y config del tenant |
| POST | `/tenants/:slug/tools/sync` | n8n / script | Sincroniza flows desde ManyChat |
| POST | `/admin/turn-completed` | n8n (al final del agente) | Cierra turno, libera lock |
| POST | `/admin/leads/:id/stage` | n8n (Router) | Avanza etapa del lead |
| POST | `/admin/login` | Dashboard | Obtiene JWT de admin (password → token) |
| GET | `/admin/tenants` | Dashboard | Lista tenants activos |
| GET | `/admin/tenants/:id/funnel-stages` | Dashboard | Lista etapas del embudo de un tenant |
| GET | `/admin/funnel-stages/:id/followups` | Dashboard / UI | Lista plantillas de follow-up de una etapa |
| POST | `/admin/funnel-stages/:id/followups` | Dashboard / UI | Crea una plantilla de follow-up |
| PUT | `/admin/followup-templates/:id` | Dashboard / UI | Edita una plantilla |
| DELETE | `/admin/followup-templates/:id` | Dashboard / UI | Soft delete de una plantilla |
| GET | `/admin/followup-templates/:id/messages` | Dashboard | Lista mensajes de una plantilla tipo content |
| POST | `/admin/followup-templates/:id/messages` | Dashboard | Crea un mensaje en una plantilla content |
| PUT | `/admin/followup-messages/:id` | Dashboard | Edita un mensaje |
| DELETE | `/admin/followup-messages/:id` | Dashboard | Elimina un mensaje |
| POST | `/admin/assets/upload` | Dashboard | Sube imagen a MinIO, devuelve URL pública |
| GET | `/admin/tenants/:id/agent-resources` | Dashboard | Lista recursos del agente por categoría |
| POST | `/admin/tenants/:id/agent-resources` | Dashboard | Crea un recurso del agente |
| PUT | `/admin/agent-resources/:id` | Dashboard | Edita un recurso del agente |
| DELETE | `/admin/agent-resources/:id` | Dashboard | Soft delete de un recurso |
| GET | `/admin/leads/:id/followup-history` | Dashboard / UI | Historial de follow-ups enviados a un lead |

---

## Autenticación

Los endpoints `/admin/*` admiten **dos caminos** (dual-auth, `lib/admin-auth.ts`):

**Camino 1 — Bearer estático** (n8n, scripts internos, backwards-compatible):
```
Authorization: Bearer <N8N_CALLBACK_TOKEN>
```

**Camino 2 — JWT de admin** (dashboard):
1. `POST /admin/login` con `{ "password": "<ADMIN_PASSWORD>" }` → recibe `{ token, expires_in: 43200 }`
2. Usar el token: `Authorization: Bearer <token>`

El JWT expira a las 12 h. El login overlay del dashboard detecta la expiración y muestra el formulario.

Los endpoints de liveness/readiness no requieren auth.  
`/webhook/manychat` usa su propio token de ManyChat (cabecera `X-MC-Token`).

---

## Formato de error estándar

Todos los errores usan la misma estructura:

```json
{
  "error": {
    "code": "INVALID_PAYLOAD",
    "details": [
      { "path": ["sequence_number"], "message": "Number must be greater than 0" }
    ]
  }
}
```

| HTTP | Código en body | Cuándo |
|---|---|---|
| 400 | `INVALID_PAYLOAD` | Validación Zod fallida, UUID inválido, invariante de negocio rota |
| 401 | `UNAUTHORIZED` | Token ausente o incorrecto |
| 404 | `NOT_FOUND` | Entidad padre o recurso no encontrado |
| 409 | `DUPLICATE_SEQUENCE` | `sequence_number` ya existe para esa etapa |

---

## Convenciones generales

- **Request body**: `snake_case` (estilo de la casa: `sequence_number`, `delay_hours`).
- **Response**: filas Drizzle en `camelCase` sin mapeo manual (lo infiere TypeScript del schema).
- **UUIDs**: todos los parámetros de ruta son UUID v4; un valor inválido devuelve `400`, no `404`.
- **Multi-tenancy**: el `tenant_id` nunca va en el body de las rutas admin — se resuelve desde la entidad padre (stage, subscriber) para evitar escalada de privilegios.
- **Logs**: cada handler termina con `req.log.info({ ... }, '<acción>')`. Nunca `console.log`.

---

## Documentación por módulo

- [Follow-up Templates](./followup-templates.md) — ADR-0015 CRUD completo
- [Agent Resources](./agent-resources.md) — ADR-0019 recursos de cierre/objeción para el agente
- [Dashboard Smoke Checklist](./dashboard-smoke.md) — 11 pasos de smoke e2e tras cada deploy
