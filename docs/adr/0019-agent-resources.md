# ADR-0019 — Tabla `agent_resources` para Cierres y Objeciones

**Estado:** Aceptado  
**Fecha:** 2026-05-22  
**Relacionado con:** ADR-0015 (followup_templates), ADR-0018 (followup_messages + MinIO)

---

## Contexto

El dashboard de configuración de Alex necesita dos pestañas adicionales:
- **Cierres:** snippets de texto/imagen que el agente usa cuando el lead pide precio o está listo para comprar.
- **Objeciones:** respuestas preparadas para las dudas más comunes (garantía, tiempo, dinero).

Estos recursos NO son follow-ups automáticos. Son materiales que el agente consulta on-demand a través de una tool `get_agent_resources(category)` y decide cuándo enviar según el contexto de la conversación.

---

## Decisión

Se crea una tabla nueva `api.agent_resources` en lugar de reutilizar `followup_templates` o `stage_flows`.

**Por qué no `followup_templates`:**
- Los templates tienen `sequence_number` y `stage_id` — están secuenciados y atados a una etapa del funnel.
- Los recursos del agente son atemporales: no tienen orden secuencial ni pertenecen a una etapa específica.
- Mezclarlos complica el `followup-runner`, que asume que todos los templates de una etapa son follow-ups automáticos.

**Por qué no `stage_flows`:**
- Los flows son flows de ManyChat (identificados por `flow_ns`). Los recursos pueden ser texto libre o imágenes, sin necesidad de flow.

**Por qué tabla propia:**
- Modelo limpio: el agente puede listar recursos por `category` en una sola query sin filtros artificiales.
- El CRUD es independiente del runner y del routing de etapas.
- Permite añadir campos específicos (`trigger_hint`) sin contaminar el schema de followups.

---

## Consecuencias

- Nueva migración `0010_agent_resources.sql`.
- Servicio `apps/api/src/services/agent-resources.ts` con CRUD básico.
- Endpoints en `apps/api/src/routes/admin/agent-resources.ts` protegidos por Bearer/JWT.
- El dashboard expone las categorías `cierre`, `objecion` y `general` en el menú lateral.
- **Siguiente paso (fuera de este sprint):** integrar la tool `get_agent_resources(category)` en el workflow `agent-run` para que el agente pueda consultarlos durante la conversación.
