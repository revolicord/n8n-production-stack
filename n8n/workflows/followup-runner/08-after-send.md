# Nodo 08: After Send

**Tipo:** Merge (`n8n-nodes-base.merge`)  
**ID:** `b6c1937d-09c7-4e16-9d58-514f6d6f9d91`  
**Posición en cadena:** recibe output de `sendContent` (input 0) y `sendFlow` (input 1), antes de `Build SQL`  
**Propósito:** Reunir las dos ramas de envío (texto y flow) en un único camino para el registro y actualización del cron.

---

## Configuración

```json
{ "parameters": {} }
```

Sin parámetros adicionales — modo `Append` por defecto (espera al primer ítem disponible).

## Conexiones entrantes

| Input | Origen |
|-------|--------|
| Input 0 | **sendContent** (texto) |
| Input 1 | **sendFlow** (flow) |

## Salida

Pasa el ítem recibido (con los campos originales del lead + la respuesta HTTP de ManyChat) a **Build SQL**.

## Notas

- Solo llega un ítem por ejecución de este nodo (el lead se procesa de a uno en el Loop).
- La respuesta de ManyChat (status, etc.) está disponible como `$json` pero **Build SQL** no la utiliza — solo usa los campos del lead original via `$('Loop Over Leads').first().json`.
