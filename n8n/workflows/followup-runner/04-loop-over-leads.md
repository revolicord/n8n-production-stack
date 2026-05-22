# Nodo 04: Loop Over Leads

**Tipo:** Split in Batches (`n8n-nodes-base.splitInBatches`)  
**ID:** `09414258-96c2-4e45-ba1b-780b95da20e6`  
**Posición en cadena:** recibe todos los leads de `Prepare Data`; cada iteración procesa 1 lead  
**Propósito:** Iterar sobre los leads uno a uno para que cada envío ManyChat, log y UPDATE sea atómico e independiente.

---

## Configuración

| Parámetro | Valor |
|-----------|-------|
| Batch size | 1 (por defecto del nodo) |

## Conexiones

| Salida | Destino | Cuándo |
|--------|---------|--------|
| Output 0 (loop done) | *(sin conexión)* | Cuando ya no hay más ítems — el workflow termina |
| Output 1 (has items) | **Has Template?** | Mientras haya leads sin procesar |

## Retorno al Loop

Cuatro nodos distintos devuelven el control al Loop para continuar con el siguiente lead:

- **Archive lead_crons** (rama "sin template") → Output 0 del Loop
- **Update lead_crons** (rama "envío OK") → Output 0 del Loop

## Notas

- Procesar de a 1 garantiza que un error en un lead no bloquee al resto.
- El orden de procesamiento respeta el `ORDER BY lc.next_followup_at ASC` de **Get Due Leads** (los más vencidos primero).
