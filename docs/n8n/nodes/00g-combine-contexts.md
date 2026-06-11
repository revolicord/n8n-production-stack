# Nodo: Combine Contexts

**Tipo:** Merge  
**ID:** `2b318080-00d5-4a7b-b86a-5406b6be8abd`  
**Versión:** v1  
**Posición en cadena:** Entre `Get Stage Config` / `Get Content History` y `System Prompt`  
**ADR:** ⚠️ *Pendiente asignar*

---

## Propósito

Sincroniza las dos ramas paralelas de lectura de contexto antes de que el workflow continúe hacia el agente. Sin este nodo, `System Prompt` arrancaría antes de que `Get Content History` haya terminado.

---

## Configuración

| Campo | Valor |
|-------|-------|
| Tipo | `n8n-nodes-base.merge` |
| typeVersion | `3.2` |
| Parámetros | (ninguno — configuración por defecto) |

El modo por defecto de Merge v3.2 es **Combine** con append, esperando a que lleguen datos por ambos inputs antes de emitir.

---

## Conexiones

| Input | Fuente |
|-------|--------|
| `main[0]` (input 0) | `Get Stage Config` |
| `main[1]` (input 1) | `Get Content History` |
| `main[2]` (input 2) | `Get Handoff State` *(v6 / ADR-0023)* |

**Output:** → `System Prompt`

> **v6:** subir `numberInputs` del Merge a **3** y conectar `Get Handoff State`
> al input 2. Así `Build Context` no arranca hasta que la lectura de
> `api.notifications` haya terminado. Si prefieres no tocar el Merge, también
> funciona conectar `Get Handoff State` en paralelo y dejar que `Build Context`
> lo lea por nombre (`$('Get Handoff State')`), pero entonces pierdes la barrera
> de sincronización y arriesgas leerlo antes de tiempo.

---

## Notas

- Este nodo actúa como barrera de sincronización. El workflow tiene dos ramas paralelas desde `Webhook`: una va por `Get Stage Config` → `Combine Contexts`, y otra va por `Get Subscriber CRM Context` → `Get Content History` → `Combine Contexts`.
- Build Context lee directamente de `$('Get Stage Config')` y `$('Get Subscriber CRM Context')` por nombre — el merge no modifica los datos, solo controla el flujo de ejecución.
