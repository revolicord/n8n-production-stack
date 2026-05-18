# 99 — Repo Audit

> **Documento vivo y operativo.** Mapea el estado real del repo antes y después de la consolidación de docs del 2026-05-18.
> Cuando todos los gaps críticos estén resueltos y el contenido migrado, este doc se puede borrar.

---

## Estado Post-Consolidación (2026-05-18)

### Qué se hizo

- Se crearon 16 documentos canónicos (`00`–`14` + `99`) en `docs/`
- Se archivó `docs-dm-settings/` (18 archivos) → `docs/_archive/docs-dm-settings/`
- Se archivaron docs viejos de `docs/` → `docs/_archive/old-docs/`
- Se actualizaron todas las referencias en código y docs

---

## 1. Inventario de Archivos

### Documentos canónicos (fuente de verdad)

| # | Archivo | Estado | Contenido |
|---|---|---|---|
| 1 | `docs/00_README.md` | ✅ Creado | Índice de la doc |
| 2 | `docs/01_BUSINESS_OPERATING_CONTEXT.md` | ✅ Creado | Contexto de negocio y objetivos del agente |
| 3 | `docs/02_CURRENT_HUMAN_SALES_PROCESS.md` | ✅ Creado | Proceso actual del setter humano (Alex) |
| 4 | `docs/03_MULTIMEDIA_ASSETS.md` | ✅ Creado | Videos, audios y VSL — pendiente de llenar con assets reales |
| 5 | `docs/04_SYSTEM_MAP.md` | ✅ Creado | Arquitectura técnica y ownership |
| 6 | `docs/05_MANYCHAT_ARCHITECTURE.md` | ✅ Creado | ManyChat: flows, tags, variables, webhooks |
| 7 | `docs/06_STATE_AND_ASSUMPTIONS.md` | ✅ Creado | Estado actual del sistema y supuestos abiertos |
| 8 | `docs/07_AGENT_SPECIFICATION.md` | ✅ Creado | Rol, objetivos y scope del agente IA |
| 9 | `docs/08_AGENT_BEHAVIOR_AND_PROMPTS.md` | ✅ Creado | Tono, personalidad, system prompt |
| 10 | `docs/09_AGENT_TOOLS_AND_INTEGRATIONS.md` | ✅ Creado | Tools del agente (ManyChat, Close, etc.) |
| 11 | `docs/10_CONVERSATION_STATE_MACHINE.md` | ✅ Creado | Máquina de estados del lead y transiciones |
| 12 | `docs/11_HANDOFF_AND_ESCALATION.md` | ✅ Creado | Criterios de escalada a setter humano |
| 13 | `docs/12_SUCCESS_METRICS_AND_EVAL.md` | ✅ Creado | KPIs y plan de evaluación del agente |
| 14 | `docs/13_RISKS_AND_GUARDRAILS.md` | ✅ Creado | Riesgos y mecanismos de protección |
| 15 | `docs/14_ROADMAP_MVP_TO_V1.md` | ✅ Creado | Roadmap por fases |
| 16 | `docs/99_REPO_AUDIT.md` | ✅ Este doc | Auditoría en curso |

### ADRs (vigentes, permanecen en docs/adr/)

| Archivo | Contenido |
|---|---|
| `docs/adr/0001` → `0016` | Decisiones de arquitectura técnica — vigentes |
| `docs/adr/IMPLEMENTATION-REPORT.md` | Reporte de implementación ADRs 010-015 |

### Archivados → `docs/_archive/docs-dm-settings/`

Toda la carpeta `docs-dm-settings/` original (18 archivos). Primera versión de la documentación técnica del stack.

| Archivo archivado | Contenía | Cubierto por canónico |
|---|---|---|
| `00 readme.md` | Índice y arranque de sesión | `docs/00_README.md` |
| `01-arquitectura.md` | Stack técnico general | `docs/04_SYSTEM_MAP.md` |
| `02-frontera-codigo-vs-n8n.md` | Boundary código/n8n | `docs/04_SYSTEM_MAP.md` + `CLAUDE.md` |
| `03-modelo-de-datos.md` | Schema Postgres + Redis | `docs/04_SYSTEM_MAP.md` (parcial) |
| `04-debounce-y-turnos.md` | Debounce + lock | `docs/04_SYSTEM_MAP.md` (parcial) |
| `05-fastify-endpoints.md` | Endpoints API | `docs/04_SYSTEM_MAP.md` |
| `06-n8n-integracion.md` | n8n integration | `docs/04_SYSTEM_MAP.md` |
| `07-docker-swarm-y-deploy.md` | Deploy infra | `docs/04_SYSTEM_MAP.md` |
| `08-observabilidad-y-dashboard.md` | Métricas | `docs/12_SUCCESS_METRICS_AND_EVAL.md` |
| `09-seguridad-y-compliance.md` | Seguridad | `docs/13_RISKS_AND_GUARDRAILS.md` |
| `10-roadmap-de-implementacion.md` | Roadmap técnico | `docs/14_ROADMAP_MVP_TO_V1.md` |
| `11-glosario-y-decisiones.md` | Glosario | Distribuido en canónicos |
| `12-manychat-setup-y-canales.md` | ManyChat setup | `docs/05_MANYCHAT_ARCHITECTURE.md` |
| `13-funnel-y-agente.md` | Funnel + agente | `docs/10_CONVERSATION_STATE_MACHINE.md` + `07` + `08` |
| `14-dashboard-y-metricas.md` | KPIs | `docs/12_SUCCESS_METRICS_AND_EVAL.md` |
| `15-flow-registry-manychat.md` | Flow registry | `docs/09_AGENT_TOOLS_AND_INTEGRATIONS.md` |
| `16-mapa-etapas-y-transiciones.md` | State machine | `docs/10_CONVERSATION_STATE_MACHINE.md` |
| `CLAUDE.md` | Instrucciones de sesión para Claude | Absorbido por `/CLAUDE.md` raíz |

### Archivados → `docs/_archive/old-docs/`

| Archivo | Contenía | Motivo |
|---|---|---|
| `funnel-engine.md` | Diseño del funnel engine | Supersedido por `10_CONVERSATION_STATE_MACHINE.md` |
| `mcp-n8n-setup.md` | Setup MCP n8n | Operativo, no documental |
| `session-2026-05-15-adr010-015-y-followup-runner.md` | Notas de sesión | Ephemeral |
| `session-2026-05-15-mvp-activation.md` | Notas de sesión | Ephemeral |

---

## 2. Gaps Críticos por Resolver

| Gap | Bloquea a | Owner | Estado |
|---|---|---|---|
| Obtener los 4 videos físicos | `03_MULTIMEDIA_ASSETS` | Alex | ⏳ Pendiente |
| Obtener audio pre-VSL | `03_MULTIMEDIA_ASSETS` | Alex | ⏳ Pendiente |
| Obtener la VSL | `03_MULTIMEDIA_ASSETS` | Alex | ⏳ Pendiente |
| Acceso/config Close CRM | `09_AGENT_TOOLS_AND_INTEGRATIONS` | — | ⏳ Pendiente |
| Acceso real a ManyChat | `05_MANYCHAT_ARCHITECTURE` | — | ⏳ Pendiente |
| Decisión disclosure de IA | `07_AGENT_SPECIFICATION` + `13_RISKS` | Alex / negocio | ⏳ Pendiente |
| Llenar knowledge tribal de Alex | `02_CURRENT_HUMAN_SALES_PROCESS` + `08` | Alex | ⏳ Pendiente |

---

## 3. Decisiones Pendientes

- [ ] ¿El funnel aplica igual a las 3 fuentes en MVP o se ramifica?
- [ ] ¿El agente se identifica como IA si se le pregunta?
- [ ] ¿Cuál es el SLA de respuesta humana a escalaciones?
- [ ] ¿Qué herramienta de monitoreo usa el negocio?

---

## 4. Progreso de Migración

| Métrica | Valor |
|---|---|
| Docs canónicos creados | 16 / 16 |
| Archivos archivados | 22 (18 docs-dm-settings + 4 old-docs) |
| Referencias actualizadas | CLAUDE.md, README.md, n8n/*.md, ADR-0016, código |
| Gaps críticos abiertos | 7 |
| Última actualización | 2026-05-18 |

---

## 5. Cuándo Borrar Este Documento

- [ ] Todos los gaps críticos resueltos
- [ ] Knowledge tribal de Alex capturado en `02` y `08`
- [ ] Multimedia assets inventariados en `03`
- [ ] Decisiones pendientes tomadas
