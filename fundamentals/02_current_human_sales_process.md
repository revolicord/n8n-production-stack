# Current Human Sales Process
## Proceso Actual del Setter Humano (Alex) — Referencia para el Agente IA

---

> **Propósito de este documento:** Describir el proceso que el setter humano sigue hoy en día para que el agente de IA lo replique con fidelidad. Este es el "ground truth" del comportamiento esperado.
>
> **Nota MVP:** Estamos en fase de MVP. El objetivo principal es demostrar automatización corriendo. Los flujos se refinan en iteraciones posteriores. Donde hay ambigüedad, se documenta la asunción tomada.

---

## 1. Visión General del Proceso

El proceso de Alex es un **funnel de micro-compromisos**: cada 👍 del lead es una validación de intención antes de recibir el siguiente contenido. Esto filtra pasivos de interesados reales sin gastar el contenido premium en todos.

```
TRIGGER
  ├── Seguidor nuevo (Alex prospectó manualmente o trigger automático)
  ├── Comentario en post / reel / historia / cualquier evento
  └── DM inbound
          │
          ▼
  [1] Apertura — Primer mensaje, romper el hielo
          │
          ▼
  [2] Calentamiento — Rapport mínimo (1–3 intercambios)
          │
          ▼
  [3] Video de 25s — Envío de uno de 4 videos (round robin)
          │
       Lead responde 👍 ?
       ├── NO → Follow-up / objeciones / archivo
       └── SÍ ▼
  [4] Audio de pre-VSL — Preámbulo que prepara al lead para la VSL
          │
          ▼
  [5] VSL — Envío del video de ventas principal
          │
       Lead responde 👍 ?
       ├── NO → Follow-up / objeciones / archivo
       └── SÍ ▼
  [6] Link de Calendly — Agendado de la llamada de ventas
          │
          ▼
  [7] Seguimiento Pre-Llamada — Recordatorios para reducir no-show
          │
          ▼
  [ESCALACIÓN] — Casos complejos, VIP, objeciones de precio, leads muy calientes
```

---

---

## 2. Paso a Paso Detallado

---

### Paso 1 — Apertura (Primer Contacto)

**Objetivo:** Romper el hielo, generar curiosidad, provocar cualquier respuesta.

**Cuándo ocurre según la fuente:**

| Fuente | Quién inicia | Comportamiento |
|---|---|---|
| **Seguidor nuevo (automático)** | Agente / ManyChat | Mensaje de bienvenida con delay configurado |
| **Seguidor nuevo (prospectado por Alex)** | Alex manualmente | Alex inicia el DM — el agente toma el relevo cuando el lead responde |
| **Comentario en post/reel/historia** | Agente / ManyChat | Mensaje que referencia el post o el comentario específico |
| **DM inbound** | El lead | Respuesta inmediata y directa a lo que dijo el lead |

> **Nota MVP:** Alex sigue prospectando perfiles manualmente porque esa acción no puede automatizarse en ManyChat. El agente debe saber tomar el control de la conversación una vez que hay una primera respuesta del lead, independientemente de quién haya abierto.

**Comportamiento general:**
- Mensaje corto (1–3 líneas), conversacional, sin vender.
- Termina con una pregunta abierta para provocar respuesta.

**Señal de avance:** El lead responde cualquier cosa.
**Señal de fracaso:** Sin respuesta → activar protocolo de follow-up (ver Sección 4).

---

### Paso 2 — Calentamiento (Rapport)

**Objetivo:** Crear conexión mínima antes de enviar el video. No es una calificación profunda — es suficiente para que el lead se sienta escuchado.

**Comportamiento:**
- 1–3 intercambios conversacionales sobre la situación del lead.
- Tono amigable, casual, humano.
- No se menciona el producto ni la llamada todavía.

**Señal de avance:** El lead ha compartido algo de su situación o ha mostrado apertura.

---

### Paso 3 — Video de 25 Segundos (Gancho)

**Objetivo:** Entregar valor rápido en formato video y obtener la primera validación de intención (👍).

**Mecánica:**
- Alex tiene **4 videos de ~25 segundos** pregrabados.
- Se selecciona uno en **round robin** (rotación equitativa) para evitar que el mismo lead reciba siempre el mismo y para distribuir la carga de contenido.
- El video es corto, directo, y diseñado para generar curiosidad / deseo de saber más.
- Después de enviarlo, Alex (o el agente) pregunta algo como: *"¿Esto resuena contigo? Mándame un 👍 si quieres que te comparta más."*

**Estados posibles:**

```
Video enviado
     │
     ├── Lead envía 👍  → Avanzar al Paso 4
     ├── Lead responde con texto/pregunta → Manejar respuesta, luego avanzar
     └── Lead no responde → Protocolo de follow-up (ver Sección 4)
```

> **Para el agente:** Debe trackear cuál video se envió a cada lead para no repetir en futuros contactos. El estado de qué video corresponde por round robin debe persistir en Close CRM o en el servidor.

---

### Paso 4 — Audio de Pre-VSL (Preámbulo)

**Objetivo:** Preparar mentalmente al lead para la VSL. Crear expectativa y contexto antes de enviar el video largo.

**Mecánica:**
- Es un audio (mensaje de voz) grabado por Alex — suena personal y cercano.
- Explica brevemente qué van a ver en la VSL y por qué vale la pena verla completa.
- Dura aproximadamente [X segundos — completar con Alex].
- Se envía **inmediatamente** después de recibir el 👍 del video.

**Señal de avance:** El audio se entrega. No se espera confirmación de lectura — se procede directamente al Paso 5.

---

### Paso 5 — VSL (Video de Ventas Principal)

**Objetivo:** Presentar la oferta completa, generar deseo, y obtener la segunda validación de intención (👍) para agendar.

**Mecánica:**
- Se envía el link o el video de la VSL después del audio.
- La VSL hace el trabajo de venta: problema, solución, prueba social, oferta.
- Después de enviarla, se pregunta: *"¿La viste? Si te interesa dar el siguiente paso, mándame un 👍."*

**Estados posibles:**

```
VSL enviada
     │
     ├── Lead envía 👍  → Avanzar al Paso 6 (Calendly)
     ├── Lead responde con objeción → Manejar objeción (ver Sección 3)
     ├── Lead pide más info → Responder y redirigir hacia el 👍
     └── Lead no responde → Protocolo de follow-up (ver Sección 4)
```

---

### Paso 6 — Link de Calendly (Agendado)

**Objetivo:** El lead agenda su llamada de ventas con el closer.

**Mecánica:**
- Al recibir el segundo 👍, se envía el link de Calendly directamente.
- Mensaje corto: *"Perfecto, aquí el link para que elijas el horario que mejor te acomode: [link]"*
- No se piden más datos en este momento — Calendly captura lo necesario.
- Una vez agendado, el lead se registra en **Close CRM** con estado: `Llamada agendada`.

**Información que se captura en Close:**
- Nombre del lead
- Fuente (comentario / seguidor / inbound)
- Fecha y hora de la llamada
- Video de 25s que se usó (para análisis de conversión por video)

---

### Paso 7 — Seguimiento Pre-Llamada

**Objetivo:** Reducir el no-show. Mantener al lead comprometido.

**Comportamiento:**
- Recordatorio **24 horas antes** de la llamada.
- Recordatorio **1–2 horas antes** de la llamada.
- Si cancela → intentar reagendar inmediatamente.
- Si hace ghosting → protocolo de reactivación (ver Sección 4).

---

---

## 3. Manejo de Objeciones

> Este es uno de los puntos donde el agente agrega más valor vs. el proceso manual. El agente debe tener respuestas entrenadas para cada objeción común en cada etapa del funnel.

| Etapa | Objeción | Respuesta típica |
|---|---|---|
| **Post-video** | "¿De qué trata esto?" | Dar contexto breve sin revelar todo, redirigir al audio |
| **Post-video** | "No tengo tiempo ahora" | "El audio dura menos de un minuto, te lo dejo aquí para cuando puedas" |
| **Post-VSL** | "¿Cuánto cuesta?" | "Eso depende de tu caso, por eso la llamada es el siguiente paso" |
| **Post-VSL** | "Mándame más info" | "Todo está en la llamada porque se personaliza a tu situación" |
| **Post-VSL** | "Ya trabajo con alguien" | Preguntar qué tal va, encontrar gap, no presionar |
| **Agendado** | "¿Para qué es la llamada?" | "Es una sesión de diagnóstico sin compromiso para ver si podemos ayudarte" |
| **Cualquier etapa** | No responde | Ver protocolo de follow-up (Sección 4) |

> **Nota MVP:** Los scripts exactos de objeciones deben ser provistos por Alex. La tabla anterior es un marco inicial a completar.

---

## 4. Protocolo de Follow-Up (Sin Respuesta)

> El agente mejora significativamente este proceso vs. el setter humano, que no siempre tiene capacidad de hacer seguimiento sistemático.

### 4.1 Follow-Up por Etapa

Cada etapa del funnel tiene su propio protocolo cuando el lead no responde:

```
Sin respuesta después de mensaje de apertura:
  → Intento 1: +24h — mensaje diferente, misma energía
  → Intento 2: +48h — ángulo distinto (pregunta, dato, curiosidad)
  → Intento 3: +72h — último intento ("no quiero molestarte, ¿sigue siendo relevante?")
  → Sin respuesta → Archivar como "no respondió", marcar en Close

Sin respuesta después de video de 25s:
  → Intento 1: +24h — recordatorio suave del video
  → Intento 2: +48h — nuevo ángulo ("¿pudiste verlo?")
  → Sin respuesta → Archivar

Sin respuesta después de VSL:
  → Intento 1: +24h — "¿tuviste oportunidad de verlo?"
  → Intento 2: +48h — objeción anticipada ("sé que puede surgir la duda de X...")
  → Sin respuesta → Archivar
```

### 4.2 Follow-Up Post-Agendado (No-Show)

```
No aparece a la llamada:
  → Inmediato: "Oye, ¿todo bien? Te esperamos en la llamada"
  → +2h: intento de reagendado
  → +24h: segundo intento de reagendado
  → Sin respuesta → Marcar como no-show en Close, nurture a largo plazo
```

### 4.3 Reglas Generales de Follow-Up
- Máximo **3 intentos por etapa** antes de archivar o mover a nurture.
- Cada follow-up debe tener un **ángulo diferente** (no repetir el mismo mensaje).
- Nunca mensajes agresivos ni de presión.
- Siempre dejar una "puerta abierta" al archivar.

---

## 5. Reglas de Escalación a Humano

El setter humano (Alex) interviene manualmente en los siguientes casos:

| Situación | Acción |
|---|---|
| Lead muy caliente que quiere comprar ya | Pasar directamente al closer, no pasar por el funnel completo |
| Objeción de precio explícita | Escalar a Alex o al closer |
| Lead enojado o con queja | Intervención humana inmediata |
| Lead VIP / cuenta grande / referido importante | Alex toma el hilo para tratamiento personalizado |
| Conversación sin avance después de todos los intentos | Marcar como "nurture" o archivar |
| El lead pregunta directamente si es IA | Decisión de política pendiente — por ahora escalar a Alex |

---

## 6. Métricas Clave del Proceso

| Métrica | Qué mide |
|---|---|
| **Tasa de respuesta al primer mensaje** | Efectividad de la apertura |
| **Tasa de 👍 al video de 25s** | Efectividad del gancho / calidad del video |
| **Tasa de 👍 post-VSL** | Efectividad de la VSL |
| **Tasa de agendado** | Conversión final del setter |
| **Show rate** | Calidad del lead y efectividad del seguimiento pre-llamada |
| **Conversiones por video** | Cuál de los 4 videos de 25s convierte mejor |

---

## 7. Lo que el Setter (y el Agente) NO Hace

- ❌ No revela el precio en el DM
- ❌ No salta etapas — el funnel es secuencial (video → audio → VSL → Calendly)
- ❌ No envía la VSL sin antes haber recibido el 👍 del video
- ❌ No insiste más de 3 veces por etapa sin respuesta
- ❌ No usa lenguaje de presión ni escasez artificial
- ❌ No agenda si el lead no ha mostrado intención mínima (👍 post-VSL)

---

## 8. Gaps y Preguntas Abiertas

> Puntos a validar con Alex antes de construir el agente:

- [ ] ¿Cuáles son los 4 videos de 25s? ¿Tienen temáticas distintas o son variaciones del mismo gancho?
- [ ] ¿El round robin es puramente secuencial (1→2→3→4→1…) o tiene lógica por tipo de lead?
- [ ] ¿Cuánto dura el audio de pre-VSL? ¿Hay más de uno o es siempre el mismo?
- [ ] ¿Cuál es el copy exacto que Alex usa al pedir el 👍 post-video y post-VSL?
- [ ] ¿Cuáles son las palabras clave exactas que disparan ManyChat?
- [ ] ¿Cuánto tiempo espera antes del primer follow-up en cada etapa?
- [ ] ¿Cuáles son los criterios de calificación del programa de coaching? (¿la VSL califica o hay preguntas antes?)
- [ ] ¿Cómo se integra Calendly con Close CRM actualmente?
- [ ] ¿Cuál es la política sobre revelar que hay IA detrás del setter?
- [ ] ¿Qué hace Alex con los leads que prospecta manualmente — los pasa a alguna lista o los maneja en paralelo?
