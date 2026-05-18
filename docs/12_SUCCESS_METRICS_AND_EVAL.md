# 12 — Success Metrics and Eval
## KPIs y Plan de Evaluación del Agente

---

> **Propósito:** Definir cómo se mide el éxito del agente y cómo se evalúa antes y después de pasarlo a producción.

---

## 1. KPIs del Agente

### 1.1 Métricas de Conversión (Funnel)

| Métrica | Definición | Baseline (Alex) | Meta MVP |
|---|---|---|---|
| Tasa de respuesta apertura | % leads que responden al 1er mensaje | _[completar]_ | _[completar]_ |
| Tasa de avance video → audio | % que dan 👍 al video | _[completar]_ | _[completar]_ |
| Tasa de avance VSL → Calendly | % que dan 👍 a la VSL | _[completar]_ | _[completar]_ |
| Tasa de agendado global | % de leads totales que agendan | _[completar]_ | _[completar]_ |
| Show rate | % de agendados que asisten | _[completar]_ | _[completar]_ |

### 1.2 Métricas de Calidad

| Métrica | Definición |
|---|---|
| Tasa de escalación correcta | % de escalaciones que el humano confirma como necesarias |
| Tasa de escalación perdida | % de casos que debieron escalar y no lo hicieron |
| Errores graves | Mensajes inapropiados, alucinaciones, fugas de política |
| NPS de leads agendados | Feedback del lead sobre la conversación previa |

### 1.3 Métricas de Operación

| Métrica | Definición |
|---|---|
| Tiempo de primera respuesta | Latencia entre trigger y primer mensaje del agente |
| Costo por lead procesado | Costo de API IA + infra ÷ leads |
| Costo por llamada agendada | Costo total ÷ agendados |
| Volumen de leads procesados | Leads totales que pasaron por el agente |

---

## 2. Plan de Evaluación Pre-Producción

### 2.1 Eval offline (con datos históricos)
> 🚧 Pendiente

- Tomar N conversaciones reales de Alex.
- Reproducir el lado del lead con el agente.
- Comparar decisiones del agente vs. decisiones de Alex.
- Métricas: % de coincidencia, divergencias críticas.

### 2.2 Shadow mode
> 🚧 Pendiente

- El agente "responde" pero sus mensajes no se envían.
- Alex revisa y aprueba antes de enviar.
- Duración: _[completar]_

### 2.3 Piloto controlado
> 🚧 Pendiente

- El agente toma X% del tráfico real (ej: 20%).
- Alex toma el resto.
- Comparar conversión, calidad, escalaciones.

### 2.4 Rollout
- Aumentar % gradualmente.
- Criterio para 100%: _[completar]_

---

## 3. Evaluación Continua (Post-Producción)

### 3.1 Dashboard
> 🚧 Pendiente: definir herramienta (Close reports, Grafana, hoja de cálculo).

KPIs a mostrar en tiempo real:
- _[completar]_

### 3.2 Revisión de Conversaciones
- Frecuencia: _[completar — diaria? semanal?]_
- Quién revisa: _[completar — Alex? un QA?]_
- Muestreo: _[completar — % aleatorio + 100% de escalaciones]_

### 3.3 Detección de Drift
> El comportamiento del agente puede degradarse con cambios en el modelo, en el copy o en los leads.

- Alertas si KPI cae > X% semana a semana.
- Revisión mensual del system prompt y reglas.

---

## 4. Criterios de "Éxito" del MVP

> Cuándo se considera que el MVP cumplió su objetivo.

- [ ] Agendar al menos N llamadas/semana de forma autónoma.
- [ ] Tasa de show ≥ X% (no peor que Alex).
- [ ] Tasa de escalación < Y%.
- [ ] Cero incidentes graves (ban de cuenta, queja pública).
- [ ] Alex aprueba el comportamiento conversacional en revisión semanal.

> 🚧 Pendiente: completar N, X, Y con valores acordados.

---

## 5. Gaps y Preguntas Abiertas

- [ ] Obtener baseline de Alex (conversión histórica)
- [ ] Definir umbrales mínimos aceptables para cada KPI
- [ ] Confirmar herramienta de dashboard
- [ ] Definir tamaño y duración del piloto
