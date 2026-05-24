# Nodo: After Send

**Tipo:** Merge  
**ID:** `1489e94c-0e0d-431e-96ac-e56b913ff947`  
**Posición en flujo:** converge sendContent (input 0), sendFlow (input 1) y sendContentMessages (input 2) → Build SQL

---

## Propósito

Punto de convergencia después del envío a ManyChat. Reúne las tres ramas (text, flow, content) en un único flujo para ejecutar el logging y actualización.

---

## Configuración

```json
{
  "numberInputs": 3
}
```

Modo por defecto: **Append** — pasa todos los items de las tres entradas.

---

## Nota importante

Después del Merge, los datos del item provienen de la respuesta de ManyChat (no del lead original). Por eso los nodos posteriores (**Build SQL**, **Insert n8n_chat_histories**) usan `$('Loop Over Leads').first().json` para recuperar los datos originales del lead.
