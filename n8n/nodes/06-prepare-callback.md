# Nodo: Prepare Callback

**Tipo:** Code (JavaScript)  
**ID:** `8a1276a9-442c-4a9f-8ab5-f546199fe0c1`  
**Posición en cadena:** Después de `Mark Followups Responded` (rama con contenido) o `If` rama TRUE (sin contenido), antes de `Callback`  
**Propósito:** Aplanar todos los valores necesarios en `$json` para que el nodo Callback no necesite referencias cruzadas `$('Node Name')` dentro del JSON body.

---

## Por qué es necesario

n8n no evalúa correctamente las expresiones `{{ $('Build Context').first().json.X }}` dentro del campo **JSON Body** del nodo HTTP Request cuando el texto contiene caracteres especiales (comillas, saltos de línea del AI). Esto produce errores "Invalid uuid" o "not valid JSON".

La solución es aplanar todo en un Code node y dejar que Callback use solo `$json.*`.

---

## Código completo (copy-paste)

```javascript
return [{
  json: {
    turn_id: $('Build Context').first().json.turnId,
    status: 'completed',
    response_text: $('AI Agent').first().json.output,
    callbackUrl: $('Build Context').first().json.callbackUrl,
    callbackToken: $('Build Context').first().json.callbackToken
  }
}];
```

---

## Notas

- `$('AI Agent').first().json.output` captura la respuesta del agente incluso después de que `enviar texto` haya corrido (en ese punto `$json` ya es la respuesta de ManyChat).
- Si el turno falla (AI Agent error), `output` puede ser `undefined`. El API acepta `response_text` como campo opcional.
