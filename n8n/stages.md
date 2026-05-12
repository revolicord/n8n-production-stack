# Definición de Etapas del Embudo

Define las etapas del lead, las condiciones de avance y los flows permitidos por etapa.

---

## Etapas

| Etapa | Descripción | Condición de entrada | Condición de avance |
|-------|-------------|---------------------|---------------------|
| `nuevo` | Lead recién captado, primer contacto | Primer mensaje recibido | Responde al video / muestra interés explícito |
| `interesado` | Ha interactuado positivamente | Pulgar arriba o respuesta positiva al video | Pide más información o precio |
| `prospecto` | Está evaluando comprar | Pregunta por detalles del producto | Solicita proceso de compra / pago |
| `cliente` | Ha comprado | Confirmación de pago recibida | — |
| `descalificado` | No es el perfil adecuado | El agente detecta que no hay fit | — |

> **Nota:** Estas etapas son una propuesta inicial. Ajustar según el embudo real de ventas de Revolicord.

---

## Config `flows_by_stage` para la DB

Pegar en `tenants.config` del tenant `revolicord`. Ajustar etapas y flows según el catálogo en `flows-catalog.md`.

```json
{
  "flows_by_stage": {
    "nuevo": [
      {
        "name": "video_inicial_v1",
        "ns": "content20260511152354_558165",
        "description": "Video de presentación inicial que solicita pulgar arriba — usar como primer contacto"
      },
      {
        "name": "video_inicial_v2",
        "ns": "content20260511155655_840313",
        "description": "Video de presentación versión 2 — alternar con v1 para A/B testing"
      },
      {
        "name": "video_cpchel",
        "ns": "content20260511160458_294557",
        "description": "Video variante cpchel con pulgar arriba — usar si el usuario ya vio v1 o v2"
      }
    ],
    "interesado": [
      {
        "name": "audio_vsl",
        "ns": "content20260511153207_699341",
        "description": "Audio introducción antes de la VSL — enviar cuando el lead muestra interés real"
      }
    ],
    "prospecto": [
      {
        "name": "audio_presentacion",
        "ns": "content20260506163913_313256",
        "description": "Audio de presentación completa del producto"
      },
      {
        "name": "imagenes",
        "ns": "content20260507013255_914847",
        "description": "Galería de imágenes del producto o resultados"
      },
      {
        "name": "mensajes",
        "ns": "content20260506035030_031926",
        "description": "Secuencia de mensajes de seguimiento"
      }
    ],
    "cliente": [],
    "descalificado": []
  }
}
```

---

## Tabla `lead_stages` (pendiente de implementar)

```sql
CREATE TABLE lead_stages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id),
  current_stage TEXT NOT NULL DEFAULT 'nuevo',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subscriber_id)
);
```

## Tabla `stage_transitions` (pendiente de implementar)

```sql
CREATE TABLE stage_transitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id),
  turn_id       UUID REFERENCES turns(id),
  from_stage    TEXT NOT NULL,
  to_stage      TEXT NOT NULL,
  reason        TEXT,
  agent_evidence TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Endpoint API requerido (pendiente de implementar)

`POST /leads/:subscriberId/stage`

Body:
```json
{
  "new_stage": "interesado",
  "reason": "El lead respondió positivamente al video y preguntó por el precio",
  "evidence": "¿Cuánto cuesta?"
}
```

Respuesta: `200 OK` con el registro de `stage_transitions` creado.
