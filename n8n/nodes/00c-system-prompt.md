# Nodo: System Prompt

**Tipo:** Set (Edit Fields)
**Posición en cadena:** 0c — entre `Combine Contexts` y `Execute a SQL query1`
**ADR:** —
**Propósito:** Servir el system prompt estático del agente. Vive en el workflow para permitir iteración rápida en la UI de n8n sin tocar Postgres ni re-deploy.

---

## Por qué un Set node y no la DB

Originalmente (v1 a v4) el prompt vivía en `tenants.config.system_prompt` en Postgres. Iterar significaba: editar el `.md`, escribir un `UPDATE` SQL, esperar al siguiente turn. Durante prompt engineering eso es fricción innecesaria.

A partir de **v5 (2026-05-16)** el prompt vive en este Set node:
- Lo editas directamente en la UI de n8n.
- Lo activas y aplica en el siguiente turn (no requiere reiniciar nada).
- La fuente versionada sigue siendo `n8n/prompts/setter-v1.md` — el flujo es: editas el `.md`, lo subes a git, y luego copias el bloque al Set node desde la UI.

---

## Configuración

**Mode:** Manual Mapping
**Include Other Input Fields:** ON (passthrough — Build Context necesita los datos anteriores)

**Campos a setear:**

| Nombre | Tipo | Valor |
|--------|------|-------|
| `staticPrompt` | String | (pegar aquí el bloque del prompt desde `n8n/prompts/setter-v1.md` — de `# ROL` hasta el final del bloque) |

---

## Cómo lo lee Build Context

```javascript
const staticPrompt = $('System Prompt').first()?.json?.staticPrompt ?? '';
```

Si el Set node está vacío o falta, `Build Context` usa un fallback mínimo hardcoded.

---

## Multi-tenancy

Hoy el workflow corre solo para el tenant `revolicord` (Quantum Creators). Cuando llegue un segundo tenant con prompt distinto, añadir un **Switch** node antes de este Set, ruteando por `body.tenant.slug` a Set nodes diferentes. Mientras solo haya un tenant, este Set hardcoded es suficiente.

---

## Cleanup pendiente en DB

La columna `tenants.config.system_prompt` ya no se lee. Para limpiar:

```sql
UPDATE api.tenants
SET config = config - 'system_prompt'
WHERE config ? 'system_prompt';
```

No es urgente (el campo es `jsonb` y no rompe nada quedarse), pero conviene para no confundir a futuros lectores del schema.
