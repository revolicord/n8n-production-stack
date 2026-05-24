# Sync Followup Workflow Docs

Sincroniza la documentación de nodos en `n8n/nodes/followup/` con el JSON del workflow n8n en `$ARGUMENTS`.

## Instrucciones exactas

### 1. Leer el JSON del workflow

Lee el archivo JSON en la ruta `$ARGUMENTS`. Extrae:
- `nodes[]` — array de todos los nodos
- `connections{}` — mapa de conexiones entre nodos

Para cada nodo extrae:
- `id` — UUID del nodo
- `name` — nombre del nodo en n8n
- `type` — tipo n8n (ej. `n8n-nodes-base.postgres`, `n8n-nodes-base.code`, `n8n-nodes-base.if`, etc.)
- `parameters` — parámetros del nodo (código JS, SQL query, condiciones, etc.)
- `position` — coordenadas `[x, y]` para inferir orden visual

### 2. Leer documentación existente

Lee TODOS los archivos `.md` en `n8n/nodes/followup/`. Para cada uno, extrae:
- El `**ID:**` del frontmatter si existe (línea que empieza con `**ID:**`)
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
- Línea `**Tipo:**` — tipo n8n del nodo (ej. `Postgres — Execute Query`, `Code (JavaScript)`, `IF`)
- Línea `**ID:**` — UUID del nodo (agrégala si no existe, actualiza si cambió)
- Línea `**Posición en flujo:**` — número ordinal basado en posición visual + conexiones
- Sección `## Código` (nodos tipo `code`) — el código JS exacto del campo `parameters.jsCode`
- Sección `## SQL` (nodos tipo `postgres` con Execute Query) — el SQL exacto del campo `parameters.query`
- Sección `## Conexión posterior` / `## Conexiones` — destinos de las conexiones salientes del nodo

**Secciones que NUNCA SE TOCAN (preservar intactas):**
- `## Propósito` — descripción manual
- `## Campos de entrada` y `## Campos de salida` — tablas con descripciones manuales
- `## Tablas involucradas` — lista manual
- `## Diferencias v1 → v2` (o cualquier sección de diferencias/cambios) — historial manual
- Cualquier sección con `> **Nota:**` — notas manuales
- Cualquier sección no mencionada arriba

Si una sección actualizable no existe todavía en el doc, agrégala después del encabezado principal.

### 5. Para nodos NUEVOS — crear archivo con estructura completa

Nombre del archivo: `XX-nombre-del-nodo.md` donde `XX` es el siguiente número disponible en el directorio (con padding de 2 dígitos). Si hay variantes (`06b`, `07c`), usa esa convención si el nodo es una rama paralela.

Estructura del archivo nuevo (usa el mismo formato que los existentes):

```markdown
# Nodo: <nombre exacto en n8n>

**Tipo:** <tipo legible>  
**ID:** `<uuid>`  
**Posición en flujo:** <número> de <total> (<descripción de vecinos si se puede inferir>)

---

## Propósito

> ⚠️ *Pendiente documentar — nodo nuevo.*

---

## <sección relevante según tipo: Código / SQL / Condición>

```<lenguaje>
<contenido exacto del JSON>
```

---

## Campos de entrada

> ⚠️ *Pendiente documentar.*

---

## Conexión posterior

→ **<nombre del nodo destino>**
```

### 6. Entregar reporte final

Al terminar, imprime un reporte en este formato exacto:

```
## Reporte sync followup docs

**Workflow:** <nombre del workflow del JSON>  
**Nodos en JSON:** <total>  
**Docs en directorio:** <total antes>

### Modificados
- `XX-nombre.md` — <qué cambió: "SQL actualizado", "ID añadido", "código JS actualizado", etc.>

### Sin cambios
- `XX-nombre.md`
- ...

### Nuevos (creados)
- `XX-nombre.md` — nodo "<nombre>" tipo <tipo>

### Docs sin match (doc existe pero el nodo ya no está en el JSON)
- `XX-nombre.md` — ⚠️ nodo no encontrado en el workflow actual
```

No hagas cambios fuera de `n8n/nodes/followup/`. No modifiques el JSON del workflow.
