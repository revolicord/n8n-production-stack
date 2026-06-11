# Nodo: Get Handoff State

**Tipo:** Postgres
**Posición en cadena:** 0h — en paralelo con `Get Stage Config`, antes de `Combine Contexts` / `Build Context`
**ADR:** ADR-0023
**Propósito:** Leer los escalados recientes del lead desde `api.notifications` para que el agente sea **consciente de las interrupciones** (audio/medios que no pudo leer, palabras clave, su propia acción `notify_human`, y cuándo intervino un humano). Es el lado de **lectura** que faltaba: la escritura ya existía (la API determinista y la acción `notify_human` ya insertan filas), pero `Build Context` nunca leía esta tabla, así que al retomar la conversación el agente arrancaba de cero.

---

## Por qué existe

`api.notifications` es un log de eventos por-subscriber, tenant-scoped, con `kind / reason / summary / status / created_at / resolved_at / resolved_by`. Es la **única fuente** que registra:

- escalados deterministas por `content_class` (audio, imagen, video, ubicación, archivo, desconocido) detectados en `webhook-manychat.ts`;
- escalados por palabra clave del tenant (`kind='keyword'`);
- escalados que pidió el propio agente (`kind='agent'`, vía `notify_human`);
- la **resolución humana** (`status='resolved'`, `resolved_by`, `resolved_at`) y, si se reanudó al lead con una nota, el `summary` del handoff.

Este nodo expone esas filas a `Build Context`, que las colapsa en la sección `handoff_state` del `contextJson` (ver `01-build-context.md` v6).

---

## Query SQL

```sql
SELECT
  kind,
  source,
  reason,
  summary,
  status,
  created_at,
  resolved_at,
  resolved_by
FROM api.notifications
WHERE tenant_id = $1::uuid
  AND subscriber_id = $2::uuid
  AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC
LIMIT 10
```

> Ventana de 24 h y `LIMIT 10`: suficiente para que el agente entienda el estado reciente sin arrastrar historia vieja. Ajustable por volumen.

## Parámetros (queryReplacement — comma-separated)

```
={{ $('Webhook').first().json.body.tenant.id }},{{ $('Webhook').first().json.body.subscriber.id }}
```

| $N | Campo | Fuente |
|----|-------|--------|
| $1 | `tenant_id` UUID | `body.tenant.id` |
| $2 | `subscriber_id` UUID | `body.subscriber.id` |

## Conexiones

| | |
|--|--|
| **Input** | `Webhook` (rama paralela a `Get Stage Config`) |
| **Output** | → `Combine Contexts` (input 2) — ver `00g-combine-contexts.md` |

`Build Context` lo lee por nombre con `$('Get Handoff State').all()`.

## Salida esperada (lead con un audio pendiente y un escalado ya resuelto)

```json
[
  { "kind": "audio", "source": "code", "reason": "El lead envió un mensaje de audio",
    "summary": null, "status": "pending",
    "created_at": "2026-06-11T08:20:00Z", "resolved_at": null, "resolved_by": null },
  { "kind": "keyword", "source": "code", "reason": "Palabra clave: \"humano\"",
    "summary": "Lo llamé yo, ya tiene la info de precios", "status": "resolved",
    "created_at": "2026-06-11T06:00:00Z", "resolved_at": "2026-06-11T06:10:00Z", "resolved_by": "dashboard" }
]
```

## Salida cuando no hay escalados recientes

La query no retorna filas. `Build Context` omite la sección `handoff_state` por completo (degradación elegante).

---

## Notas

- **Sin migración.** La tabla y la escritura ya existían (escalado determinista por `content_class` + acción `notify_human`). Este nodo solo agrega lectura.
- Encadenar **en paralelo** con `Get Stage Config` y `Get Subscriber CRM Context` para no sumar latencia.
- El `summary` de una fila `resolved` suele ser la **nota de una línea** que dejó el humano al reanudar al lead (campo `note` del endpoint `POST /admin/notifications/:id/resolve`). El agente la usa como contexto de qué pasó durante la intervención.
