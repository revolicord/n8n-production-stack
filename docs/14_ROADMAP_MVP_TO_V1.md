# 14 — Roadmap MVP to V1
## Qué Entra en Cada Fase

---

> **Propósito:** Separar claramente qué se entrega en MVP, qué viene después, y qué queda fuera por ahora.
>
> **Principio guía del MVP:** demostrar automatización corriendo. Refinamiento posterior.

---

## 1. MVP (Fase 0)

### Objetivo
Que el flujo completo `trigger → agente → funnel → Calendly → Close` corra de punta a punta para al menos una fuente de leads.

### Scope IN
- [ ] Agente conectado a ManyChat vía n8n.
- [ ] Funnel completo: apertura → calentamiento → video → audio → VSL → Calendly.
- [ ] Round robin de los 4 videos.
- [ ] Detección de 👍 como gate de avance.
- [ ] Persistencia de estado en Close CRM.
- [ ] Follow-ups básicos por etapa.
- [ ] Escalación manual a Alex en casos predefinidos.
- [ ] Aplicación uniforme del funnel a las 3 fuentes de leads.

### Scope OUT (explícitamente)
- ❌ Ramificación del funnel por tipo de lead.
- ❌ Selección inteligente de video según perfil.
- ❌ A/B testing automatizado.
- ❌ Dashboard de métricas en tiempo real.
- ❌ Multi-idioma.

### Criterios de Done
- Funnel completo se ejecuta end-to-end sin intervención humana en al menos N conversaciones.
- Alex valida el comportamiento conversacional.
- Cero incidentes graves en período de prueba.

---

## 2. V1 (Fase 1) — Refinamiento

### Objetivo
Mejorar conversión y reducir intervención humana basándose en datos del MVP.

### Posibles iniciativas
- Ramificar funnel por fuente de lead (comentario / seguidor / inbound).
- Personalizar mensaje de apertura según contexto del comentario o post.
- Mejorar manejo de objeciones con respuestas más entrenadas.
- Dashboard de KPIs en tiempo real.
- A/B testing del copy de apertura y de petición de 👍.
- Optimización del round robin según performance de cada video.

---

## 3. V2 (Fase 2) — Escala

### Objetivo
Escalar a más volumen y/o más cuentas.

### Posibles iniciativas
- Soporte multi-cuenta de Instagram.
- Multi-idioma.
- Asistencia al closer durante la llamada.
- Re-engagement de leads archivados.
- Generación de assets multimedia con IA.

---

## 4. Backlog / Ideas Futuras

> Ideas que aún no tienen fase asignada.

- Integración con WhatsApp para continuar conversación fuera de IG.
- Bot de prospección que sugiera perfiles a Alex (no automatizar el envío, solo la sugerencia).
- Análisis de sentimiento del lead para ajustar tono.
- _[completar]_

---

## 5. Gaps y Preguntas Abiertas

- [ ] Definir cuánto dura el MVP (semanas)
- [ ] Definir criterios numéricos para "MVP done"
- [ ] Priorizar iniciativas de V1
