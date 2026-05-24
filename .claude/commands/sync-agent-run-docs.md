# Sync Agent-Run Workflow Docs

Sincroniza la documentación de nodos en `n8n/nodes/` (raíz, no en followup/) con el JSON del workflow n8n en `$ARGUMENTS`.

## Instrucciones exactas

### 1. Leer el JSON del workflow

Lee el archivo JSON en la ruta `$ARGUMENTS`. Extrae:
- `nodes[]` — array de todos los nodos
- `connections{}` — mapa de conexiones entre nodos

Para cada nodo extrae:
- `id` — UUID del nodo
- `name` — nombre del nodo en n8n
- `type` — tipo n8n (ej. `n8n-nodes-base.postgres`, `n8n-nodes-base.code`, `n8n-nodes-base.webhook`, etc.)
- `parameters` — parámetros del nodo (código JS, SQL query, configuraciones HTTP, etc.)
- `position` — coordenadas `[x, y]` para inferir orden visual

### 2. Leer documentación existente

Lee TODOS los archivos `.md` en `n8n/nodes/` (solo el directorio raíz, no en `n8n/nodes/followup/`). Para cada uno, extrae:
- El `**ID:**` si existe (línea que empieza con `**ID:**`)
- El nombre del nodo del encabezado `# Nodo: <nombre>`
- El contenido completo para comparación

### 3. Emparejar nodos con docs existentes

Para emparejar un nodo del JSON con un archivo `.md`:
1. Primero intenta por `**ID:**` exacto en el doc
2. Si no hay ID, intenta por nombre normalizado (lowercase, sin espacios especiales)
3. Si no hay match → el nodo es NUEVO, crear doc nuevo

### 4. Para cada nodo con doc existente — actualizar solo lo que cambió

Lee el doc actual. Actualiza ÚNICAMENTE estas secciones si su contenido difiere del JSON:

**Secciones que SE ACTUALIZAN desde el JSON:**
- Línea `**Tipo:**` — tipo n8n del nodo legible (ej. `Code (JavaScript)`, `Postgres — Execute Query`, `Webhook`, `HTTP Request`, `IF`, `Switch`, `Set`)
- Línea `**ID:**` — UUID del nodo (agrégala si no existe, actualiza si cambió)
- Línea `**Posición en cadena:**` — descripción de vecinos inferida de las conexiones (solo si cambian los vecinos reales)
- Sección `## Código completo` o `## Código` (nodos tipo `code`) — el código JS exacto del campo `parameters.jsCode`
- Sección `## SQL` (nodos tipo `postgres` con Execute Query) — el SQL exacto del campo `parameters.query`
- Sección `## Configuración` (nodos HTTP, IF, Switch, Set) — el JSON de parámetros

**Secciones que NUNCA SE TOCAN (preservar intactas):**
- `**Versión:**` — número de versión manual del doc
- `**ADR:**` — referencias a ADRs, decididas manualmente
- `## Propósito` — descripción funcional manual
- `## Diferencias clave vX → vY` — historial de versiones manual
- `## Decisión de diseño` — razonamiento arquitectónico manual
- `## Output que produce` / `## Campos de salida` — tablas con descripciones manuales
- `## Estructura de` — ejemplos y diagramas manuales
- `## Notas` — notas técnicas manuales
- `## Ramificación` / `## Conexiones` — tablas descriptivas manuales
- Cualquier sección con `> **Nota:**` o `> **Importante:**`
- Cualquier sección no mencionada arriba como actualizable

Si el doc tiene una sección `## Código completo` con un bloque `js` y el JSON tiene `parameters.jsCode`, actualiza el contenido del bloque pero **no toques** ningún comentario en prosa fuera del bloque de código (antes o después de él).

### 5. Para nodos NUEVOS — crear archivo con estructura completa

Nombre del archivo: `XX-nombre-del-nodo.md` donde `XX` es el siguiente número disponible en `n8n/nodes/` (con padding de 2 dígitos). Usa letras (`00b`, `00c`) si el nodo es paralelo a otro.

Estructura del archivo nuevo (respeta el mismo formato que los existentes en `n8n/nodes/`):

```markdown
# Nodo: <nombre exacto en n8n>

**Tipo:** <tipo legible>  
**ID:** `<uuid>`  
**Versión:** v1  
**Posición en cadena:** <descripción de vecinos inferida de conexiones>  
**ADR:** ⚠️ *Pendiente asignar*

---

## Propósito

> ⚠️ *Pendiente documentar — nodo nuevo.*

---

## <sección según tipo: Código completo / SQL / Configuración>

```<lenguaje>
<contenido exacto del JSON>
```

---

## Output que produce

> ⚠️ *Pendiente documentar.*

---

## Notas

> ⚠️ *Pendiente documentar.*
```

### 6. Entregar reporte final

Al terminar, imprime un reporte en este formato exacto:

```
## Reporte sync agent-run docs

**Workflow:** <nombre del workflow del JSON>  
**Nodos en JSON:** <total>  
**Docs en n8n/nodes/ (raíz):** <total antes>

### Modificados
- `XX-nombre.md` — <qué cambió: "código actualizado", "ID añadido", "SQL actualizado", etc.>

### Sin cambios
- `XX-nombre.md`
- ...

### Nuevos (creados)
- `XX-nombre.md` — nodo "<nombre>" tipo <tipo>

### Docs sin match (doc existe pero el nodo ya no está en el JSON)
- `XX-nombre.md` — ⚠️ nodo no encontrado en el workflow actual
```

No hagas cambios fuera de `n8n/nodes/` (raíz). No toques `n8n/nodes/followup/`. No modifiques el JSON del workflow.
