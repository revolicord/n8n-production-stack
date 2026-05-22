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
| GET | `/admin/funnel-stages/:id/followups` | UI Revolicord | Lista plantillas de follow-up de una etapa |
| POST | `/admin/funnel-stages/:id/followups` | UI Revolicord | Crea una plantilla de follow-up |
| PUT | `/admin/followup-templates/:id` | UI Revolicord | Edita una plantilla |
| DELETE | `/admin/followup-templates/:id` | UI Revolicord | Soft delete de una plantilla |
| GET | `/admin/leads/:id/followup-history` | UI Revolicord | Historial de follow-ups enviados a un lead |

---

## Autenticación

Todos los endpoints `/admin/*` y `/tenants/*` requieren:

```
Authorization: Bearer <N8N_CALLBACK_TOKEN>
```

El token se valida con `verifyBearerToken()` de `lib/auth.ts`. Sin token o token incorrecto → `401`.

Los endpoints de liveness/readiness no requieren auth.  
`/webhook/manychat` usa su propio token de ManyChat (cabecera distinta).

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
