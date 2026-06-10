# ADR-0022: Documentación OpenAPI interactiva en /docs (@fastify/swagger + swagger-ui)

- **Estado:** aceptado
- **Fecha:** 2026-06-10

## Contexto

El DM Setter API ya expone ~30 endpoints (webhooks, `/admin/*`, `/tenants/:slug/tools`,
health) consumidos por ManyChat, Telegram, n8n y el dashboard Next.js. No existía
ninguna documentación navegable: para probar un endpoint había que leer el código
fuente y armar el `curl` a mano. Queremos el equivalente al `/docs` de FastAPI:
una UI Swagger en `https://api.revolicord.com/docs` donde ver y probar cada endpoint.

Restricción clave: la validación de payloads vive en Zod **dentro** de los handlers
(patrón `safeParse` + respuesta `{ error: { code: 'INVALID_PAYLOAD' } }`). Si
añadiéramos `schema` de Fastify de forma normal, Ajv validaría antes del handler y
cambiaría el formato de error que hoy consumen n8n y el dashboard.

## Decisión

1. Añadir **@fastify/swagger** (genera el spec OpenAPI 3 desde las rutas) y
   **@fastify/swagger-ui** (sirve la UI en `/docs`). Son plugins oficiales del
   ecosistema Fastify ya usado (cors, helmet, jwt, multipart, sensible).
2. Añadir **zod-to-json-schema** para derivar los `schema.body` / `querystring`
   documentales desde los schemas Zod existentes (cero duplicación, no se
   desincronizan).
3. Cada ruta documentada usa el helper `doc()` (`lib/openapi.ts`) que adjunta el
   schema **solo como documentación**: `validatorCompiler` passthrough (la
   validación sigue siendo Zod en el handler) y `serializerCompiler` passthrough
   (las respuestas no se filtran por schema). Cero cambio de comportamiento.
4. Helmet pasa a `global: false` + hook `onRequest` que aplica el mismo CSP a todo
   excepto `/docs/*`; Swagger UI usa su propio CSP (`staticCSP: true`).

## Consecuencias

- `/docs` queda público en `api.revolicord.com` (la UI revela paths, no secretos;
  todos los endpoints mutantes siguen exigiendo bearer/JWT/x-mc-token). Si en el
  futuro se quiere ocultar, basta condicionar el registro del plugin por env.
- El spec crudo queda en `/docs/json` (importable en Postman/Insomnia).
- Toda ruta nueva debe registrarse con `doc({...})` para aparecer en la UI; las
  rutas sin schema igualmente aparecen listadas (modo dinámico) pero sin detalle.
