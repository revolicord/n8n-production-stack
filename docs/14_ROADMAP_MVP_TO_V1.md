# 14 — Roadmap MVP to V1
## Qué Entra en Cada Fase

---

> **Propósito:** Separar claramente qué se entrega en MVP, qué viene después, y qué queda fuera por ahora.
>
> **Principio guía del MVP:** demostrar automatización corriendo. Refinamiento posterior con datos reales.

---

## 1. MVP (Fase 0) — donde estamos hoy

### Objetivo
Que el flujo completo `trigger → agente → funnel A/MS/B/C/D → Calendly → handoff` corra end-to-end para Quantum Creators.

### Scope IN — qué entra en MVP

- [x] DM API + workflow `agent-run` cableado y respondiendo a DMs reales.
- [x] Funnel A/MS/B/C/D con `set_stage` validando transiciones.
- [x] Selección ponderada de flows (`pickFlowWeighted`) en `Build Context` con pesos en `stage_flows`.
- [x] Schema completo (ADR-0010..0015) — `funnel_stages`, `stage_flows`, `followup_templates`, `lead_followup_log`, `lead_crons`.
- [x] Flow Registry con naming convention `QC_...` (ADR-0016) + endpoint de sync.
- [x] Persona "Alex" + estilo seco + cero admisión de IA (prompt v3).
- [ ] **Cablear nodos del IMPLEMENTATION-REPORT en n8n UI:** `Get Stage Config`, `Get Subscriber CRM Context`, `Upsert Lead Cron`.
- [ ] **Crear workflow `followup-runner` en n8n UI.**
- [ ] **Cadencia y textos definitivos de follow-up** (pendiente con Alex).
- [ ] **Cambio arquitectónico a salida JSON estructurada del agente** — habilita aplicación determinista de acciones del LLM.
- [ ] **`tenant.config.calendly_url` configurado** (single link en MVP).

### Scope OUT — explícitamente fuera del MVP

- ❌ Integración con Close CRM (V1+).
- ❌ Webhook entrante de Calendly (P1 — el agente marca `D` por confirmación verbal mientras tanto).
- ❌ Round-robin de closers (P1 — link único en MVP).
- ❌ Tool `notify_human` + canal de escalación a Alex (P1).
- ❌ Banco de objeciones (P1) — hoy política = descalificación inmediata.
- ❌ Ramificación del funnel por fuente de lead (comentario / follower / DM).
- ❌ Selección inteligente de vídeo según perfil del lead.
- ❌ Dashboard de métricas en tiempo real.
- ❌ Multi-idioma.
- ❌ Memoria semántica (Mem0/Zep/pgvector) — hoy solo Postgres Chat Memory cronológico.

### Criterios de Done MVP
- [ ] Funnel A→MS→B→C→D ejecutándose end-to-end con leads reales sin intervención manual en el camino feliz.
- [ ] Cero incidentes graves (ban IG, alucinación grave, fuga de política).
- [ ] Alex valida el comportamiento conversacional en revisión semanal.
- [ ] Cadencia de follow-up calibrada con primeros 30 días de datos.

---

## 2. V1 (Fase 1) — Refinamiento

### Objetivo
Mejorar conversión y reducir intervención humana basándose en datos del MVP.

### Iniciativas P1

- **Webhook Calendly C→D** — endpoint dedicado con verificación de firma.
- **Tool `notify_human` + tabla `notifications` + canal de entrega** (Slack/email/SMS por confirmar).
- **Round-robin de closers** — tabla `closers` + tool `send_calendly_link` con lock atómico.
- **Inyección de presencia IG** (`last_seen`, `last_interaction`) en el payload de n8n.
- **Persistencia de señales del agente** en `lead_stages.metadata` y reinyección en Build Context.
- **Banco de objeciones** — tabla `objection_bank` + tool `get_objection_bank` (revertir la política actual de "descalifica inmediato" si los datos lo justifican).
- **Tool `archive_conversation`** + endpoint dedicado.
- **Dashboard básico de KPIs** (Open / Reply / Qualification / Show rate).

### Iniciativas opcionales

- Ramificación del funnel por fuente de lead.
- Personalización del mensaje de apertura según contexto del comentario o post.
- A/B testing del copy de petición de confirmación.
- Optimización del round-robin de flows según performance histórica.

---

## 3. V1+ — Integración con Close CRM

- Mirror de leads, etapas y mensajes a Close.
- Postgres sigue siendo la fuente de verdad — Close se nutre de Postgres, nunca al revés.
- ADR específico cuando se aborde.

---

## 4. V2 (Fase 2) — Escala

### Objetivo
Escalar a más volumen y/o más cuentas / tenants.

### Iniciativas

- Multi-cuenta de Instagram por tenant.
- Multi-tenant en producción (hoy solo Quantum Creators).
- Multi-idioma.
- Asistencia al closer durante la llamada (briefing automatizado).
- Re-engagement de leads en `lost`.
- Generación de assets multimedia asistida por IA.
- Memoria semántica (Mem0/Zep/pgvector) para reactivar leads tras semanas.
- Formato de salida estructurado más rico (post-cambio arquitectónico inicial).
- HITL por confianza: escalar cuando la incertidumbre del modelo supera umbral.
- Versionado de prompts en DB + capacidad de A/B prompts en vivo.

---

## 5. Backlog / Ideas Futuras

- Integración con WhatsApp para continuar conversación fuera de IG.
- Bot de prospección que sugiera perfiles a Alex (no automatizar el envío).
- Análisis de sentimiento del lead para ajustar tono.
- Auto-generación de variantes de vídeo de gancho.

---

## 6. Gaps y Preguntas Abiertas

- [ ] Confirmar fecha objetivo para MVP "done"
- [ ] Definir criterios numéricos para MVP done (volumen mínimo, tasa de show, etc.)
- [ ] Priorizar iniciativas de V1 con base en primeros datos de MVP
- [ ] Decidir si la integración con Close llega antes o después de las P1 críticas
