# Nodo: Insert n8n_chat_histories (Code)

**Tipo:** Code (JavaScript)  
**Posición en flujo:** después de Insert followup log → Insert chat history1

---

## Propósito

**Nodo nuevo en v2.** Prepara el texto de memoria (`contenidoMemoria`) que se guardará en `n8n_chat_histories` diferenciando correctamente los tres tipos de template: `text`, `flow`, `content`.

El tipo `content` incluye el contexto de imagen (`image_context`) — esto no era posible en v1 donde el texto se generaba en Build SQL sin acceso a ese campo.

---

## Código

```javascript
let textoParaMemoria;

if ($json.followup_type === 'text') {
  textoParaMemoria = ($json.text_template ?? '').replace('{{name}}', $json.display_name ?? '');
} else if ($json.followup_type === 'flow') {
  textoParaMemoria = `[flow: ${$json.followup_flow_ns}] — ${$json.followup_description ?? ''}`;
} else if ($json.followup_type === 'content') {
  const imagePart = $json.image_context
    ? `[IMAGEN ENVIADA: ${$json.image_context}] `
    : '[IMAGEN ENVIADA] ';
  const textPart = ($json.content_text ?? '').replace('{{name}}', $json.display_name ?? '');
  textoParaMemoria = `${imagePart}${textPart}`.trim();
} else {
  textoParaMemoria = $json.followup_description ?? '';
}

const contenidoMemoria = `[SEGUIMIENTO AUTOMÁTICO #${$json.next_sequence_number}] ${textoParaMemoria}`;

return { contenidoMemoria };
```

---

## Campos de entrada

| Campo | Usado para |
|-------|-----------|
| `followup_type` | Determina la rama (`text`, `flow`, `content`) |
| `text_template` | Tipo `text`: texto base |
| `display_name` | Tipos `text`, `content`: reemplaza `{{name}}` |
| `followup_flow_ns` | Tipo `flow`: namespace del flow |
| `followup_description` | Tipos `flow`, fallback |
| `image_context` | Tipo `content`: contexto AI de la imagen |
| `content_text` | Tipo `content`: texto acompañante |
| `next_sequence_number` | Prefijo del mensaje de memoria |

---

## Campos de salida

| Campo | Descripción |
|-------|-------------|
| `contenidoMemoria` | String con prefijo `[SEGUIMIENTO AUTOMÁTICO #N]` + contenido listo para insertar en `n8n_chat_histories` |

---

## Nota de referencia downstream

El nodo **Insert chat history1** (Postgres) referencia este nodo como:
```
$('Insert n8n_chat_histories').json.manychat_subscriber_id
$('Insert n8n_chat_histories').json.contenidoMemoria
```

Esto significa que el item completo del lead también está disponible via `$('Insert n8n_chat_histories').json` — el nodo Code pasa todos los campos del item más `contenidoMemoria`.

> **Aclaración:** El `return { contenidoMemoria }` retorna solo ese campo. Para que `manychat_subscriber_id` también esté disponible en el siguiente nodo, el Code debe retornar `{ ...item.json, contenidoMemoria }` o el nodo Postgres debe leerlo del contexto anterior. Verificar en la UI si el queryReplacement usa `$('Insert n8n_chat_histories')` como si tuviera todos los campos del lead o solo `contenidoMemoria`.

---

## Diferencias v1 → v2

En v1 no existía este nodo. El texto de memoria se generaba en **Build SQL** con:
```javascript
const histSql = "INSERT INTO n8n_chat_histories ... VALUES ('" + pd.manychat_subscriber_id + "', ..."
```
Esa aproximación no diferenciaba tipos y no incluía `image_context`.
