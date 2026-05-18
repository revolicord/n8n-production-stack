# ADR-0016 — Flow Registry y Naming Convention para Flows de ManyChat

**Estado:** Aceptado  
**Fecha:** 2026-05-15  
**Autores:** founder + Claude Code

---

## Contexto

El agente setter necesita enviar contenido multimedia (videos, audios, imágenes) a los leads en Instagram via flows de ManyChat. El mecanismo técnico es `trigger_manychat_flow(flow_ns)` donde `flow_ns` es un namespace opaco generado por ManyChat (ej: `content20260511153207_699341`).

Sin una convención, el sistema tiene estos problemas:
1. Los namespaces son imposibles de asociar manualmente a su contenido o etapa
2. Al crecer el número de flows (>5), nadie sabe qué flujo va en qué etapa
3. El agente no puede generar descripciones ricas en el prompt sin metadata adicional
4. No hay mecanismo para sincronizar ManyChat → DB de forma segura y auditable
5. El A/B testing entre variantes no está controlado

El `flows-catalog.md` original intentó resolver esto con una tabla manual — no escalable.

---

## Decisión

### 1. Naming convention obligatoria en ManyChat

Todo flow que el agente puede disparar se nombra con este patrón en ManyChat UI:

```
QC_{STAGE}_{MEDIA_TYPE}_{DESCRIPCION}_{VARIANT}
```

El prefijo `QC` (iniciales del tenant actual, Quantum Creators) actúa como filtro. El endpoint `GET /tenants/:slug/tools` filtra flows que comiencen con el prefijo configurado en `tenants.config.flow_prefix` (default: `QC_`).

### 2. `stage_flows` como única fuente de verdad para el agente

El nodo `Get Stage Config` en n8n lee exclusivamente de la tabla `stage_flows` en Postgres. El agente **nunca** llama a la API de ManyChat directamente para obtener la lista de flows disponibles.

### 3. Dos campos separados en `stage_flows`

- `content_description`: qué ve o escucha el lead (texto descriptivo del contenido)
- `usage_condition`: cuándo y por qué el agente debe enviarlo (instrucción para el LLM)

Mezclarlos en un solo `description` es deuda técnica — cambiar la estrategia de uso no debería requerir cambiar la descripción del contenido.

### 4. Gate de aprobación para el sync automático

El endpoint `POST /tenants/:slug/tools/sync` escribe en `pending_ns`, no en `flow_ns` directamente. Un humano ejecuta el SQL de aprobación para activar el flow. Excepción: flag `?force=true` para entornos de desarrollo (bloqueado en producción).

### 5. `variant_group` para A/B testing controlado

Las variantes de un mismo tipo de contenido (ej: 3 versiones del video hook) comparten `variant_group = 'hook'`. `Build Context` hace selección ponderada dentro del grupo, no entre todos los flows de la etapa.

---

## Alternativas rechazadas

### A. Continuar con nombres libres en ManyChat + tabla manual de mapeo
Rechazado porque no escala y requiere mantenimiento manual constante. Cada nuevo flow o renombrado rompe el sistema hasta que alguien edita el catálogo.

### B. El agente llama a la API de ManyChat en cada turno para obtener la lista de flows
Rechazado: añade latencia (HTTP externo en el hot path), crea acoplamiento entre el agente y ManyChat, y el agente recibiría todos los flows sin filtrar por etapa.

### C. Guardar todas las descripciones en el system prompt estático
Rechazado: con >10 flows, el prompt se infla. Cambiar un flow requeriría modificar el workflow de n8n. En DB, el operador puede actualizar sin tocar código.

### D. `description` como único campo (estado actual)
Rechazado por el advisor técnico: mezclar "qué es" con "cuándo usarlo" crea deuda que se paga cuando se itera la estrategia de funnel sin cambiar el contenido.

---

## Consecuencias

**Positivas:**
- Un operador no-técnico puede añadir flows en ManyChat siguiendo la convención y el sistema los detecta
- El agente recibe context rico (qué es + cuándo usarlo) sin inflar el prompt estático
- Los A/B tests son controlados y ponderados, no aleatorios
- El sync tiene un gate de seguridad que previene activar flows con names corruptos

**Negativas/Compromisos:**
- Requiere disciplina operativa: renombrar flows en ManyChat sin seguir la convención los deja fuera del sistema
- La migración 0003 añade 6 columnas a `stage_flows` — migración no destructiva
- El gate de aprobación añade un paso manual; en el futuro se puede automatizar con validaciones más robustas

---

## Referencias

- Implementación: `apps/api/src/routes/tools.ts`
- Schema DB: `packages/db/src/schema.ts` → `stageFlows`
- Migración: `packages/db/drizzle/0003_flow_registry.sql`
- Documento operativo: `docs/_archive/docs-dm-settings/15-flow-registry-manychat.md`
- Nodo n8n afectado: `n8n/nodes/00-get-stage-config.md`, `n8n/nodes/01-build-context.md`
