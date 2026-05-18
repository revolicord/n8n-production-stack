# 06 — State and Assumptions
## Estado Actual del Sistema + Supuestos Abiertos

---

> **Propósito:** Separar **lo que sabemos como hecho** de **lo que estamos asumiendo**. Cada asunción aquí es un riesgo si resulta falsa.

---

## 1. Estado Actual del Sistema (Hechos Verificados)

> Solo entran cosas que están confirmadas y verificables.

### 1.1 Lo que ya funciona
- _[completar — ej: "ManyChat captura comentarios en posts y envía DM automático"]_
- _[completar]_

### 1.2 Lo que existe pero no está conectado
- _[completar — ej: "El agente IA tiene endpoint funcionando pero n8n no lo está llamando aún"]_
- _[completar]_

### 1.3 Lo que está documentado en código pero sin probar
- _[completar]_

---

## 2. Asunciones Activas

> ⚠️ Cada una de estas afirmaciones es una **asunción**, no un hecho. Si alguna resulta falsa, hay que ajustar arquitectura.

### 2.1 Sobre el negocio
- ⚠️ **Asunción:** El flujo video → audio → VSL → Calendly aplica a todas las fuentes de leads (comentarios, seguidores, DMs inbound).
  - **Cómo validarlo:** confirmar con Alex.
  - **Impacto si es falsa:** hay que ramificar el funnel por fuente.

- ⚠️ **Asunción:** El 👍 es el único gate de transición entre etapas (no hay otros emojis o palabras clave aceptadas).
  - **Cómo validarlo:** revisar conversaciones reales de Alex.
  - **Impacto si es falsa:** el agente perderá leads que confirman con palabras o emojis distintos.

- ⚠️ **Asunción:** La VSL hace el trabajo de calificación — no hay preguntas explícitas de calificación antes del Calendly.
  - **Cómo validarlo:** confirmar con Alex.
  - **Impacto si es falsa:** hay que insertar un paso de calificación antes del agendado.

### 2.2 Sobre el sistema técnico
- ⚠️ **Asunción:** _[completar]_

### 2.3 Sobre el agente IA
- ⚠️ **Asunción:** _[completar]_

---

## 3. Decisiones Tomadas (Trade-offs Aceptados)

> Decisiones donde elegimos un camino sobre otro y queremos dejar constancia.

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Aplicar el funnel a todas las fuentes en MVP | Ramificar por fuente | Mantener MVP simple, refinar después |
| Mantener prospección manual por Alex | Automatizar prospección | ManyChat no puede hacerlo, fuera de scope MVP |
| _[completar]_ | _[completar]_ | _[completar]_ |

---

## 4. Riesgos de Asunciones Críticas

> Asunciones cuyo fallo tendría impacto mayor en el proyecto.

| Asunción | Probabilidad de ser falsa | Impacto si falla | Mitigación |
|---|---|---|---|
| _[completar]_ | _[Alta/Media/Baja]_ | _[completar]_ | _[completar]_ |

---

## 5. Cómo Mantener Este Documento

- Cuando una asunción se valida → mover a Sección 1 (hechos).
- Cuando una asunción se invalida → mover a "Decisiones Tomadas" con la nueva decisión.
- Nuevas asunciones se agregan a Sección 2 conforme surjan.
