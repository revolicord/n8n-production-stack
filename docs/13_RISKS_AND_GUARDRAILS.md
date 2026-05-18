# 13 — Risks and Guardrails
## Riesgos del Proyecto y Mecanismos de Protección

---

> **Propósito:** Identificar qué puede salir mal y qué controles tenemos para mitigarlo.

---

## 1. Matriz de Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Ban de cuenta de Instagram | Media | Crítico | Respetar políticas de Meta, delays, no enviar masivo |
| Agente alucina información del producto | Alta | Alto | System prompt restrictivo, escalación ante incertidumbre |
| Agente revela precio en DM | Media | Alto | Regla dura en prompt + filtro post-respuesta |
| Lead pregunta "¿eres IA?" y agente miente | Media | Alto | Política clara, escalación si aplica |
| Caída de ManyChat / n8n / servidor IA | Baja | Alto | Monitoreo + fallback a Alex |
| Costo de API IA se dispara | Media | Medio | Cap mensual, monitoreo, optimización de prompts |
| Datos del lead se filtran | Baja | Crítico | Encriptación, accesos restringidos, GDPR/equivalentes |
| Agente envía mensaje fuera de ventana 24h | Media | Medio | Validación previa al envío |
| Lead reporta cuenta como spam | Media | Alto | Calidad de copy, opt-out claro, no insistir |

---

## 2. Guardrails Críticos del Agente

### 2.1 Reglas duras (nunca violar)
- 🛑 Nunca revelar precio.
- 🛑 Nunca prometer resultados específicos.
- 🛑 Nunca inventar características del producto.
- 🛑 Nunca enviar más de 3 mensajes seguidos sin respuesta del lead.
- 🛑 Nunca enviar mensajes fuera de la ventana de 24h sin tag aprobado.
- 🛑 Nunca usar lenguaje hostil, presión o escasez artificial.

### 2.2 Mecanismos de enforcement

| Regla | Cómo se enforza |
|---|---|
| No revelar precio | Filtro regex post-respuesta + system prompt |
| No alucinar | Restricción en prompt + escalación si incertidumbre alta |
| Límite de follow-ups | Contador en Close CRM + lógica en n8n |
| Ventana 24h | Validación en n8n antes de llamar a ManyChat |
| Tono apropiado | Eval continuo de muestras de conversación |

---

## 3. Compliance

### 3.1 Instagram / Meta
- Política de mensajería: ventana 24h, tags específicos para casos fuera de ventana.
- No mensajes masivos no solicitados.
- Respetar opt-out.

### 3.2 Protección de Datos
- _[completar — GDPR / LFPDPPP / Ley local aplicable]_
- Datos almacenados en Close: políticas de retención _[completar]_

### 3.3 Disclosure de IA
- Política sobre revelar que es un agente IA: _[completar]_
- Jurisdicción aplicable: _[completar]_

---

## 4. Plan de Contingencia

### 4.1 Si la cuenta de Instagram es baneada
> 🚧 Pendiente

### 4.2 Si el agente comete un error grave (mensaje inapropiado enviado)
> 🚧 Pendiente

### 4.3 Si el servidor IA cae
- Modo degradado: ManyChat usa flujos pre-grabados sin IA.
- Notificación a Alex para tomar el control manual.

### 4.4 Si el costo de API se dispara
- Cap diario configurado en proveedor.
- Alerta si supera umbral.

---

## 5. Monitoreo y Alertas

> 🚧 Pendiente: definir qué se monitorea y con qué herramienta.

| Métrica monitoreada | Umbral de alerta | Canal |
|---|---|---|
| Tasa de error del agente | > 5% | _[completar]_ |
| Latencia de respuesta | > 30s | _[completar]_ |
| Costo de API diario | > $X | _[completar]_ |
| Caída de cualquier servicio | Down > 5 min | _[completar]_ |

---

## 6. Gaps y Preguntas Abiertas

- [ ] Definir política de disclosure de IA (cuándo decir y cuándo no)
- [ ] Confirmar jurisdicción y compliance aplicable
- [ ] Definir plan exacto de contingencia ante ban
- [ ] Confirmar herramienta de monitoreo
