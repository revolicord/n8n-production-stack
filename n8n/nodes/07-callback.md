# Nodo: Callback

**Tipo:** HTTP Request  
**ID:** `eb647e18-f7ec-465a-ad45-537adaf291b9`  
**typeVersion:** 4.4  
**Propósito:** Notificar al API que el turno completó, liberar el lock y disparar drain si hay mensajes pendientes.

---

## Configuración

| Campo | Valor |
|-------|-------|
| Method | `POST` |
| URL | `={{ $json.callbackUrl }}` |
| Authentication | None (header manual) |

### Headers

| Name | Value |
|------|-------|
| `Authorization` | `Bearer {{ $json.callbackToken }}` |

### Body

**Specify Body:** `Using Fields Below` (Body Parameters, NO JSON raw string)  
**Content-Type:** `application/json`

| Parameter Name | Value |
|---------------|-------|
| `turn_id` | `={{ $json.turn_id }}` |
| `status` | `={{ $json.status }}` |
| `response_text` | `={{ JSON.stringify($json.response_text) }}` |

> `response_text` viene de `$('AI Agent').first().json.output` — un objeto (el plan de acciones). `JSON.stringify` lo serializa a string antes de enviarlo al API.

---

## Por qué "Using Fields Below" y no "JSON Body"

El campo `response_text` contiene texto libre del AI que puede incluir comillas dobles, apóstrofes o saltos de línea. Si se usa JSON Body como string raw con `{{ }}`, estos caracteres rompen el JSON y el nodo falla con "not valid JSON". Con Body Parameters, n8n serializa cada valor correctamente.

---

## Respuesta esperada del API

- **HTTP 204** — turno completado correctamente (sin cuerpo en la respuesta)
- **HTTP 401** — token inválido (verificar que `N8N_CALLBACK_TOKEN` en el API coincide con `callback_token` del payload)
- **HTTP 404** — `turn_id` no existe en DB
- **HTTP 400** — payload inválido (verificar que `turn_id` es un UUID válido)

---

## Comportamiento del API al recibir el callback

1. Marca el turno como completado en DB
2. Libera el lock del turno para el subscriber
3. Si llegaron mensajes nuevos mientras n8n procesaba → encola un nuevo `process-batch` automáticamente
