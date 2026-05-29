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

**Camino 2 — JWT de admin** (panel `/settings` del dashboard Next.js):
El proxy admin del dashboard (`apps/dashboard/.../api/admin/[...path]`) valida la cookie de sesión
del panel (`panel_session`) y **re-firma** un JWT corto (TTL 5 min, `role:'admin'`) con
`ADMIN_JWT_SECRET` —el mismo secreto que usa este API— y lo reenvía como `Authorization: Bearer <jwt>`.
El API solo verifica el JWT (`req.jwtVerify`, `role === 'admin'`); no hay endpoint de login en el API.

> El antiguo `POST /admin/login` (password → JWT 12 h) y el SPA servido en `/dashboard` fueron
> retirados al consolidar el panel en `dashboard.revolicord.com/settings` (ADR-0021).

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

- [Follow-up Templates](./followup-templates.md) — ADR-0015 CRUD completo (incluye `type='content'` y `followup_messages`)
- [Agent Resources](./agent-resources.md) — ADR-0019 recursos de cierre/objeción para el agente
- [Consolidación del panel `/settings`](../adr/0021-consolidate-admin-panel-settings.md) — ADR-0021: migración del SPA legacy a rutas nativas del dashboard Next.js + proxy admin
- [Dashboard SPA](./dashboard-spa.md) — ⚠️ LEGACY (retirado en ADR-0021): arquitectura del antiguo SPA servido por Fastify en `/dashboard`
- [Dashboard Smoke Checklist](./dashboard-smoke.md) — ⚠️ parcialmente obsoleto: el panel admin vive ahora en `dashboard.revolicord.com/settings`
