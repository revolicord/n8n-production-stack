# Tratamiento de la ventana de pausa (humano activo) — Handoff técnico

> Documento de entrega para el arquitecto del plan.
> Cubre el subsistema de **pausa por intervención humana** del appointment setter de Instagram.
> La lógica de **escalado a humano** (cómo se detecta el takeover y dónde vive el override manual) está en rediseño; aquí se documenta lo estable y valioso de la ventana de pausa para que se integre cuando ese rediseño cierre.

---

## 1. Propósito y alcance

El agente (n8n) responde a leads que entran por ManyChat. Cuando un humano interviene en una conversación, el agente debe **callarse para ese lead** (no pisar al humano) pero **seguir recordando todo lo que se dijo** (para retomar con contexto y no delatar que hay IA).

Este documento cubre:

- Cómo se **enciende** la pausa a partir de las señales del webhook de Meta.
- El diseño de la **ventana heurística** (en vez de un timer fijo).
- El uso del evento **`read`** como señal de apoyo a la ventana.
- Las **llaves de Redis** involucradas.
- **Payloads reales** del webhook para referencia de implementación.

Fuera de alcance / en rediseño:

- El mecanismo exacto del **override manual** (etiqueta por-contacto en ManyChat vs toggle en dashboard). Se documenta el contrato que debe cumplir, no la implementación final.
- La detección de "quién" envió un saliente (no es necesaria; ver §2).

---

## 2. Contexto mínimo: de dónde sale la señal que enciende la ventana

### 2.1. Split echo / no-echo

Meta entrega por el webhook **todos** los mensajes de la cuenta de IG:

- **Sin `is_echo`** → entrante del cliente. (Meta **omite** el campo en entrantes; no lo pone en `false`.)
- **`is_echo: true`** → saliente del negocio, **sin importar el canal**: respuesta del agente, app nativa, IG web, live chat, audios. El payload es **idéntico** en los tres casos externos; no hay campo de origen (ver ejemplos en §7).

> Implicación clave: **no se puede ni se necesita** saber qué app envió un saliente. Lo único que importa es si ese saliente **nació en n8n** (respuesta del agente, ya en memoria) o **no** (intervención externa = humano).

### 2.2. La huella anti-doble-conteo

El carril de memoria se llena así:

- **Entrante del cliente + respuesta del agente** se escriben en memoria en el momento en que n8n los procesa (carril ManyChat → API → n8n).
- La respuesta del agente **vuelve** después como `is_echo: true` por Meta. Para no escribirla dos veces, n8n deja una **huella efímera en Redis** al generar la respuesta; cuando llega el echo, se consulta esa huella.

```js
// al generar la respuesta del agente (n8n):
redis.set(`echo_propio:${igsid}:${hash(normalize(text))}`, 1, "EX", 120); // TTL ~2 min

// al llegar un echo por Meta:
const igsid = m.recipient.id;                 // en saliente el cliente está en recipient
const key = `echo_propio:${igsid}:${hash(normalize(m.message.text))}`;
const esRespuestaDelAgente = await redis.del(key); // del() = 1 si existía, 0 si no

if (!esRespuestaDelAgente) {
  // saliente externo (humano: app / web / live chat / audio)
  // → va a memoria  Y  → enciende la ventana de pausa (ver §3)
}
```

**El echo sin huella de n8n es el disparador de la ventana de pausa.** Ese y no otro.

> Nota: el `del()` sirve de check-y-consumo atómico; un reintento de Meta del mismo echo ya no matchea. Para los reintentos de Meta sobre mensajes que sí van a memoria, dedup adicional por `mid` con `ON CONFLICT (mid) DO NOTHING` en Postgres.

---

## 3. La ventana de pausa heurística

### 3.1. Por qué no un timer fijo

Un TTL fijo falla en los dos extremos:

- **Corto** → corta al humano en medio de una frase.
- **Largo** → el agente queda mudo varios minutos después de que el humano ya se fue.

Asume que todas las intervenciones duran lo mismo, y no es verdad. La ventana debe **adaptarse al ritmo del humano en esa conversación**, usando solo aritmética sobre señales que ya tenemos en Redis (operaciones O(1), sin IA).

### 3.2. Señal principal: ritmo del humano (EMA de intervalos)

Con cada mensaje humano (echo sin huella), se mide el intervalo desde el mensaje humano anterior y se mantiene una **media móvil exponencial (EMA)** de esos intervalos. La duración de la ventana se deriva de ese ritmo:

```text
onHumanMessage(igsid, now):
  last = redis.get("humano_last_ts:{igsid}")
  ema  = redis.get("humano_ema:{igsid}") ?? VENTANA_BASE

  if last exists:
    interval = now - last
    ema = ALPHA * interval + (1 - ALPHA) * ema      // suavizado exponencial

  ventana = clamp(ema * FACTOR, MIN, MAX)

  redis.set("humano_activo:{igsid}", 1, TTL = ventana)
  redis.set("humano_last_ts:{igsid}", now, TTL = MAX * 2)
  redis.set("humano_ema:{igsid}",     ema, TTL = MAX * 2)
```

Lectura intuitiva: humano metralleta (intervalos cortos) → ventana corta-pero-renovada-seguido = sigue activo. Humano que soltó un comentario y se fue → la última ventana expira sola y rápido. El comportamiento "respira" con la conversación.

### 3.3. Clamp: piso y techo

El `clamp(MIN, MAX)` es la red de seguridad:

- **MIN** evita cortar a alguien que escribe lento pero sigue ahí.
- **MAX** evita quedar mudo una eternidad si el humano desapareció sin avisar.

Entre esos límites, la EMA manda. Valores a calibrar en §8.

### 3.4. Reactividad en dos sentidos

La ventana **no** es solo un TTL que cuenta hacia abajo:

- **La actividad del humano la estira** (cada mensaje humano la renueva vía §3.2).
- **Un cliente esperando frente a un humano mudo la acorta / libera.** Si el cliente escribió *después* del último mensaje humano y el humano lleva callado más de un umbral, el humano se fue y dejó al cliente colgado → el agente debe poder retomar **aunque el TTL no haya vencido**.

```text
// en el chequeo previo a responder, si "humano_activo:{igsid}" existe:
human_last  = redis.get("humano_last_ts:{igsid}")
client_last = redis.get("cliente_last_ts:{igsid}")

if client_last > human_last AND (now - human_last) > UMBRAL_LIBERACION:
    redis.del("humano_activo:{igsid}")   // liberar
    → responder
else:
    → no responder (humano sigue activo)
```

> El silencio del humano frente a un cliente que sí escribe es la mejor señal de "ya puedes volver". Vale más que cualquier TTL.

---

## 4. Uso del evento `read` con la ventana

El webhook emite eventos `read` cuando el cliente **ve** un mensaje nuestro (payload en §7.2). No es un turno de conversación: **no va a memoria**. Pero es señal útil:

- **`read` = "calma", no "actividad".** Si el cliente leyó pero no respondió y el humano tampoco escribe, nadie está esperando algo urgente → **no extender** la ventana por un `read`. Dejarla expirar en paz.
- **Guardar `cliente_seen_ts`** por contacto. Sirve para distinguir, en la regla de liberación (§3.4) y en follow-ups, entre "vio y no contestó" vs "ni lo abrió".
- **Bonus para follow-ups (fuera del alcance de la pausa, pero valioso):** con `last_seen_at` se pueden cronometrar seguimientos que no parezcan robot — "vio hace 2 h y no contestó" pega distinto a "ni lo ha abierto".

Regla práctica: el `read` **afina** la decisión de liberar (confirma que el cliente está pendiente), pero **nunca prolonga** la pausa.

---

## 5. Cascada de decisión (antes de cada respuesta del agente)

n8n evalúa, **por suscriptor**, de más autoritario a más blando:

```text
lead entra por ManyChat → API → n8n

  ¿pausa_manual:{igsid}?     → NO responder   (override humano explícito, este lead)
  ¿humano_activo:{igsid}?    → NO responder   (ventana heurística viva, §3)
     └ excepto regla de liberación (§3.4): cliente esperando + humano mudo → responder
  en otro caso               → responder normal
```

> **Importante (rediseño en curso):** todo el control es **por `igsid`**, nunca global. El diseño previo apagaba ManyChat a nivel cuenta (todos los leads quedaban sin automatización mientras un humano atendía a uno solo) — eso queda **descartado**. ManyChat debe disparar **siempre** que entra un lead; quien decide callar es n8n, contacto por contacto.

> Mientras `pausa_manual:{igsid}` esté activo, la heurística **no se consulta** (no debe "liberar" por su cuenta un contacto que un humano pidió silenciar explícitamente).

---

## 6. Llaves de Redis

| Llave | Valor | TTL | Set por | Propósito |
|---|---|---|---|---|
| `echo_propio:{igsid}:{hash}` | `1` | ~120 s | n8n al responder | Huella anti-doble-conteo del saliente del agente (§2.2) |
| `humano_activo:{igsid}` | `1` | = ventana (dinámico) | carril Meta (echo sin huella) | Pausa heurística viva (§3) |
| `humano_last_ts:{igsid}` | timestamp | MAX×2 | carril Meta | Último mensaje humano (EMA + liberación) |
| `humano_ema:{igsid}` | ms | MAX×2 | carril Meta | Media móvil del ritmo humano |
| `cliente_last_ts:{igsid}` | timestamp | MAX×2 | carril Meta (entrante) | Último mensaje del cliente (regla de liberación) |
| `cliente_seen_ts:{igsid}` | timestamp | razonable | carril Meta (`read`) | Última lectura del cliente (calma / follow-ups) |
| `pausa_manual:{igsid}` | `1` | 12–24 h, renovable | override manual | Apagado duro por-suscriptor (§5) |

> **Higiene — fantasmas de pausa:** `pausa_manual` necesita TTL de seguridad (12–24 h, renovable mientras el humano siga activo). Con el control por-suscriptor, un olvido de "apagar" condenaría a ese contacto para siempre si la llave fuera eterna. La pausa manual debe ser firme, no inmortal.

---

## 7. Payloads reales del webhook de Meta (referencia)

Cuenta de IG (negocio): `17841445785073992`. Suscriptor de prueba: `1623552688727379`.

### 7.1. Saliente con echo — **idéntico** en app nativa, ManyChat y web

Los tres llegan con la misma forma. El único campo dentro de `message` es `mid`, `text`, `is_echo`. **No hay campo de origen.** (Las diferencias de `x-forwarded-for` entre payloads son balanceo de carga de Meta, no señal de origen.)

```json
{
  "object": "instagram",
  "entry": [
    {
      "time": 1780190101375,
      "id": "17841445785073992",
      "messaging": [
        {
          "sender": { "id": "17841445785073992" },
          "recipient": { "id": "1623552688727379" },
          "timestamp": 1780190100689,
          "message": {
            "mid": "aWdfZAG1faXRlbToxOklHTWVz...MzI4Mzg3MTExODk5NjU0MDgxMzk5MzI4MTQ3MzE2NDA4MzIZD",
            "text": "Por que no sale en manychat?",
            "is_echo": true
          }
        }
      ]
    }
  ]
}
```

Mismo shape para el saliente de ManyChat (`"text": "por aqui es por donde te escribo cuando soy humano"`) y para el de la web (`"text": "te escribo desde la web para ver el payload que sale en el webhook"`). Cambian `mid`, `text`, `timestamp`; la estructura no.

> En salientes, el cliente está en `recipient.id` (no en `sender.id`). El normalizador debe resolver el `igsid` según dirección:
> ```js
> const isOutbound = m.message.is_echo === true;
> const igsid = isOutbound ? m.recipient.id : m.sender.id;
> ```

### 7.2. Evento `read` — NO es turno, no va a memoria

Trae `read` (no `message`). El `mid` de adentro es el ID del mensaje **nuestro** que el cliente leyó. `sender.id` es el cliente; `recipient.id` es el negocio.

```json
{
  "object": "instagram",
  "entry": [
    {
      "time": 1780190196880,
      "id": "17841445785073992",
      "messaging": [
        {
          "sender": { "id": "1623552688727379" },
          "recipient": { "id": "17841445785073992" },
          "timestamp": 1780190196513,
          "read": {
            "mid": "aWdfZAG1faXRlbToxOklHTWVz...MzI4Mzg3MTI0Mjc2Nzc1MDEwMDg3OTQyNjA3MDE0NDYxNDQZD"
          }
        }
      ]
    }
  ]
}
```

### 7.3. Ramificación obligatoria por tipo de evento

El normalizador **no** debe asumir que siempre hay `message.text`. Ramificar primero:

```js
const m = entry.messaging[0];

if (m.message) {
  // único caso que es turno de conversación
  const isOutbound = m.message.is_echo === true;
  const igsid = isOutbound ? m.recipient.id : m.sender.id;
  // entrante → memoria ; saliente → §2.2 (huella) decide memoria + ventana
} else if (m.read) {
  // §4: actualizar cliente_seen_ts ; NO memoria ; NO extender ventana
} else if (m.reaction) {
  // metadata, no turno
} else {
  // postback / referral / delivery / typing → log y descartar
}
```

---

## 8. Decisiones pendientes / a calibrar

- **Valores de la ventana (§3):** `ALPHA` (~0.3), `FACTOR` (~3), `MIN` (~2 min), `MAX` (~20 min), `VENTANA_BASE` (~5 min), `UMBRAL_LIBERACION` (~2× base o fijo ~4 min). Calibrar con tráfico real.
- **Ubicación del override manual (§5):** etiqueta **por-contacto** en ManyChat que dispara un External Request → prende `pausa_manual:{igsid}` (respeta el flujo de trabajo si el humano vive en ManyChat) **vs** toggle en el dashboard que pega directo a la API (más limpio si el humano vive en el dashboard). Elegir **uno** según dónde trabaje el humano; no mezclar al inicio.
- **TTL de `pausa_manual`:** confirmar 12 h vs 24 h y la política de renovación.
- **Ordenamiento de memoria:** ordenar por `timestamp` del evento, **no** por orden de llegada (los dos streams —ManyChat y echo de Meta— tienen latencias distintas).
