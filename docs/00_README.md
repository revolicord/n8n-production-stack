# 00 — README
## Documentación del Proyecto: AI Instagram DM Setter

---

## Propósito

Esta carpeta contiene la documentación canónica del proyecto. Está diseñada para que cualquier humano o agente de IA pueda entender:

1. **Qué hace el negocio** y por qué necesita un agente IA.
2. **Cómo vende hoy** el setter humano (Alex).
3. **Qué assets, sistemas y restricciones** existen.
4. **Qué debe hacer el agente IA** que vamos a construir.
5. **Cómo se mide el éxito** y qué riesgos hay que gestionar.

---

## Cómo Leer Esta Documentación

### Si nunca has visto el proyecto, lee en orden:

```
01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14
```

### Si vas a sugerir arquitectura, lee al menos:

```
01, 02, 03, 04, 05, 07, 10, 13
```

### Si vas a escribir prompts del agente, lee al menos:

```
02, 03, 07, 08, 10, 11
```

---

## Índice de Documentos

| # | Documento | Propósito |
|---|---|---|
| 01 | `BUSINESS_OPERATING_CONTEXT.md` | Qué hace el negocio, producto, fuentes de leads, stack |
| 02 | `CURRENT_HUMAN_SALES_PROCESS.md` | Proceso paso a paso del setter humano (Alex) |
| 03 | `MULTIMEDIA_ASSETS.md` | Videos, audios, VSL y su objetivo psicológico |
| 04 | `SYSTEM_MAP.md` | Arquitectura técnica completa y ownership por pieza |
| 05 | `MANYCHAT_ARCHITECTURE.md` | Cómo funciona ManyChat hoy y sus límites |
| 06 | `STATE_AND_ASSUMPTIONS.md` | Estado actual del sistema + supuestos abiertos |
| 07 | `AGENT_SPECIFICATION.md` | Rol, objetivos y scope del agente IA |
| 08 | `AGENT_BEHAVIOR_AND_PROMPTS.md` | Tono, personalidad, system prompt, manejo de objeciones |
| 09 | `AGENT_TOOLS_AND_INTEGRATIONS.md` | Qué tools usa el agente (ManyChat, Close, Calendly, n8n) |
| 10 | `CONVERSATION_STATE_MACHINE.md` | Estados del lead, transiciones, persistencia |
| 11 | `HANDOFF_AND_ESCALATION.md` | Cuándo y cómo pasa a Alex / closer humano |
| 12 | `SUCCESS_METRICS_AND_EVAL.md` | KPIs y plan de evaluación del agente |
| 13 | `RISKS_AND_GUARDRAILS.md` | Riesgos (ban IG, alucinaciones), guardrails, compliance |
| 14 | `ROADMAP_MVP_TO_V1.md` | Qué entra en MVP vs. fases posteriores |
| 99 | `REPO_AUDIT.md` | **(Vivo)** Mapeo de lo caótico en el repo → destino final |

---

## Convenciones

- Todos los documentos están en **Markdown**.
- Las **secciones en construcción** se marcan con `> 🚧 Pendiente`.
- Las **asunciones** que aún no son hechos se marcan con `> ⚠️ Asunción:`.
- Las **preguntas abiertas para Alex/negocio** se marcan con `> ❓ Por validar con Alex:`.
- Los **gaps críticos** que bloquean avance se marcan con `> 🔴 Bloqueante:`.

---

## Estado del Proyecto

**Fase actual:** MVP — el objetivo es demostrar automatización corriendo. Refinamiento posterior.

**Última actualización del índice:** _[completar]_
