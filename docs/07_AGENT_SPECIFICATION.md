# 07 — Agent Specification
## Rol, Objetivos y Scope del Agente IA

---

> **Propósito:** Definir **qué es** el agente, **qué hace** y **qué NO hace**. Este es el "contrato" del agente.

---

## 1. Identidad del Agente

| Campo | Valor |
|---|---|
| **Nombre interno** | _[completar]_ |
| **Persona pública** | _[completar — ¿se hace pasar por Alex? ¿asistente? ¿se identifica como IA?]_ |
| **Idioma principal** | _[completar]_ |

---

## 2. Misión

> Una frase que define la razón de existir del agente.

**El agente existe para:** _[completar — ej: "guiar a leads de Instagram a través del funnel video → audio → VSL → Calendly, replicando el proceso de Alex y manejando follow-ups de forma sistemática"]_

---

## 3. Objetivos

### 3.1 Objetivo Primario
Agendar llamadas calificadas en el calendario del closer.

### 3.2 Objetivos Secundarios
- Mejorar la tasa de follow-up vs. lo que Alex puede hacer manualmente.
- Manejar objeciones comunes sin escalar a humano.
- Capturar y mantener contexto del lead en Close CRM.
- Trackear qué assets se enviaron a cada lead (para round robin y análisis).

### 3.3 Anti-Objetivos (lo que el agente NO persigue)
- ❌ Cerrar ventas en el DM.
- ❌ Revelar precio.
- ❌ Calificar de forma profunda (la VSL lo hace).
- ❌ Maximizar volumen a costa de calidad.

---

## 4. Scope del Agente

### 4.1 In Scope (MVP)
- Recibir eventos de ManyChat vía n8n.
- Decidir siguiente acción según etapa del lead.
- Enviar mensajes, videos, audios y VSL.
- Detectar 👍 como gate de transición.
- Manejar respuestas con texto libre (no solo 👍).
- Ejecutar follow-ups programados.
- Actualizar estado del lead en Close CRM.
- Escalar a humano cuando aplique.

### 4.2 Out of Scope (MVP)
- Prospectar perfiles nuevos.
- Llamadas de voz / video.
- Cerrar venta o cobrar.
- Soporte post-venta.
- Multi-idioma (solo idioma principal en MVP).

### 4.3 Futuro (V1+)
- Personalización del funnel por fuente de lead.
- Selección inteligente de video según perfil del lead.
- A/B testing automatizado de copy.
- _[completar]_

---

## 5. Inputs del Agente

| Input | Origen | Cuándo |
|---|---|---|
| Mensaje del lead | ManyChat → n8n | Cada vez que el lead responde |
| Estado actual del lead | Close CRM | Al inicio de cada turno |
| Historial conversacional | _[completar]_ | Al inicio de cada turno |
| Trigger event | ManyChat → n8n | Cuando se inicia conversación |

---

## 6. Outputs del Agente

| Output | Destino | Forma |
|---|---|---|
| Mensaje a enviar | ManyChat (via n8n) | Texto / referencia a media |
| Acción de envío de asset | ManyChat (via n8n) | ID del asset a enviar |
| Actualización de estado | Close CRM | Cambio de etapa del lead |
| Señal de escalación | _[completar — Slack, email, etiqueta en Close]_ | _[completar]_ |
| Programar follow-up | n8n scheduler | Timestamp + acción |

---

## 7. Restricciones de Comportamiento

- 🛑 Nunca revelar precio en el DM.
- 🛑 Nunca saltar etapas del funnel.
- 🛑 Nunca enviar más de 3 follow-ups sin respuesta.
- 🛑 Nunca inventar información del producto / coaching.
- 🛑 Nunca prometer resultados específicos.
- _[completar otras]_

---

## 8. Gaps y Preguntas Abiertas

- [ ] Definir si el agente se presenta como humano, IA o asistente
- [ ] Confirmar nombre / persona pública del agente
- [ ] Definir qué hace el agente si el lead pregunta directamente "¿eres una IA?"
