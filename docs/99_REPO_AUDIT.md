# 99 — Repo Audit
## Lo Caótico en el Repo → Destino Final en la Documentación

---

> **Propósito:** Este es un **documento vivo y temporal**. Mapea lo que existe hoy en el repo de forma desorganizada y le asigna un destino dentro de los 14 documentos canónicos. Se va vaciando a medida que el contenido se migra.
>
> **Este documento NO es parte de la documentación canónica.** Es operativo. Cuando esté vacío, se borra.

---

## Cómo Usar Este Documento

1. **Inventariar** todo lo que está en el repo: archivos, carpetas, notas, scripts, screenshots, conversaciones, etc.
2. **Clasificar** cada item según su tipo y estado.
3. **Asignar destino** dentro de los 14 documentos definitivos.
4. **Migrar** el contenido al documento canónico correspondiente.
5. **Marcar como migrado** y eliminar de este audit.

---

## 1. Inventario del Repo (estado caótico)

> Listar todo lo que se encuentra en el repo, sin filtrar. Más es mejor en esta etapa.

| # | Item (archivo / carpeta / nota) | Tipo | Estado | Destino propuesto | Migrado |
|---|---|---|---|---|---|
| 1 | _[ej: `README.md` antiguo]_ | Doc | Obsoleto | Borrar / `00_README` | [ ] |
| 2 | _[ej: `flows.json` de ManyChat]_ | Config | Vigente | `05_MANYCHAT_ARCHITECTURE` | [ ] |
| 3 | _[ej: carpeta `videos/`]_ | Assets | Vigente | `03_MULTIMEDIA_ASSETS` | [ ] |
| 4 | _[ej: `notes.txt` con scripts]_ | Notas | Por revisar | `02` o `08` | [ ] |
| 5 | _[completar]_ | | | | [ ] |

---

## 2. Conocimiento Tribal No Documentado

> Cosas que solo Alex (o alguien más) sabe. Hay que extraerlo y documentarlo.

| Conocimiento | Owner | Destino propuesto | Capturado |
|---|---|---|---|
| Copy exacto de apertura por fuente | Alex | `08_AGENT_BEHAVIOR_AND_PROMPTS` | [ ] |
| Criterios reales de calificación | Alex | `02_CURRENT_HUMAN_SALES_PROCESS` + `07_AGENT_SPECIFICATION` | [ ] |
| Cuánto espera entre follow-ups | Alex | `02` + `10_CONVERSATION_STATE_MACHINE` | [ ] |
| Cómo prospecta perfiles manualmente | Alex | `02` (referencia) | [ ] |
| Política sobre revelar IA | Alex / negocio | `07` + `13_RISKS_AND_GUARDRAILS` | [ ] |
| _[completar]_ | | | [ ] |

---

## 3. Gaps Críticos por Resolver

> Cosas que faltan y bloquean avance del proyecto.

| Gap | Bloquea a | Owner para resolverlo | Estado |
|---|---|---|---|
| Obtener los 4 videos físicos | `03_MULTIMEDIA_ASSETS` | Alex | [ ] |
| Obtener el audio pre-VSL | `03` | Alex | [ ] |
| Obtener la VSL | `03` | Alex | [ ] |
| Acceso al CRM Close | `04`, `09`, `10` | _[completar]_ | [ ] |
| Acceso a ManyChat | `05` | _[completar]_ | [ ] |
| Decisión sobre disclosure de IA | `07`, `13` | Alex / negocio | [ ] |
| _[completar]_ | | | [ ] |

---

## 4. Conflictos / Contradicciones Detectadas

> Lugares donde el repo o la información actual se contradice consigo misma.

| Conflicto | Resolución propuesta | Resuelto |
|---|---|---|
| _[completar]_ | _[completar]_ | [ ] |

---

## 5. Decisiones Pendientes

> Cosas que requieren una decisión del negocio antes de continuar.

- [ ] ¿El funnel aplica igual a las 3 fuentes en MVP o se ramifica?
- [ ] ¿El agente se identifica como IA si se le pregunta?
- [ ] ¿Cuál es el SLA de respuesta humana a escalaciones?
- [ ] ¿Qué herramienta de monitoreo se usa?
- [ ] _[completar]_

---

## 6. Progreso de Migración

> Snapshot del avance. Actualizar periódicamente.

| Métrica | Valor |
|---|---|
| Items totales en repo | _[X]_ |
| Items migrados | _[Y]_ |
| % completado | _[Y/X]_ |
| Gaps críticos abiertos | _[Z]_ |
| Última actualización | _[fecha]_ |

---

## 7. Cuándo Borrar Este Documento

Este documento se puede borrar cuando:
- [ ] Todos los items del inventario están migrados o descartados.
- [ ] Todo el conocimiento tribal crítico está capturado.
- [ ] No quedan gaps críticos abiertos.
- [ ] Las decisiones pendientes están tomadas.

Hasta entonces, este es el **mapa de navegación entre el caos y el orden**.
