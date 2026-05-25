# Nodo: Loop Over Leads

**Tipo:** Split in Batches  
**ID:** `587835cb-d91d-4444-b562-08ef71887e63`  
**Posición en flujo:** 4 de 17 (después de Prepare Data)

---

## Propósito

Itera de a 1 lead por vez para procesar cada follow-up de forma secuencial. Garantiza que el flujo de envío → log → update sea atómico por lead.

---

## Configuración

```json
{
  "options": {}
}
```

Batch size: **1** (default del nodo).

---

## Conexiones

- **Output 0 (done):** vacío — cuando se agotan los items, el flujo termina
- **Output 1 (loop):** → **Has Template?** — procesa cada item

---

## Referencia en nodos downstream

Los nodos posteriores usan `$('Loop Over Leads').first().json` para acceder a los datos originales del lead antes de que los nodos intermedios (After Send, Merge) sobreescriban el contexto.
