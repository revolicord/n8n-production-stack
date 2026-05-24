# Nodo: Insert n8n_chat_histories (Code)

**Tipo:** Code (JavaScript)  
**ID:** `f4399c4d-de61-4c82-a5f4-9dcfa1ef1232`  
**Posición en flujo:** después de Insert followup log → Insert chat history1

---

## Propósito

**Nodo nuevo en v2.** Prepara el texto de memoria (`contenidoMemoria`) que se guardará en `n8n_chat_histories` diferenciando correctamente los tres tipos de template: `text`, `flow`, `content`.

El tipo `content` incluye el contexto de imagen (`image_context`) — esto no era posible en v1 donde el texto se generaba en Build SQL sin acceso a ese campo.

---

## Código

```javascript
const lead = $('Loop Over Leads').first().json;
const buildSqlOutput = $('Build SQL').first().json;
let textoParaMemoria;

if (lead.followup_type === 'text') {
  textoParaMemoria = (lead.text_template ?? '').replace(/\{\{name\}\}/g, lead.display_name ?? '');
} else if (lead.followup_type === 'flow') {
  textoParaMemoria = '[flow: ' + (lead.followup_flow_ns ?? '') + '] — ' + (lead.followup_description ?? '');
} else if (lead.followup_type === 'content') {
  const imagePart = lead.image_context
    ? '[IMAGEN ENVIADA: ' + lead.image_context + '] '
    : '[IMAGEN ENVIADA] ';
  const textPart = (lead.content_text ?? '').replace(/\{\{name\}\}/g, lead.display_name ?? '');
  textoParaMemoria = (imagePart + textPart).trim();
} else {
  textoParaMemoria = lead.followup_description ?? '';
}

const contenidoMemoria = '[SEGUIMIENTO AUTOMÁTICO #' + lead.next_sequence_number + '] ' + textoParaMemoria;

return [{ json: {
  manychat_subscriber_id: lead.manychat_subscriber_id,
  contenidoMemoria,
  updateSql: buildSqlOutput.updateSql
} }];
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
| `manychat_subscriber_id` | ID del suscriptor (tomado de `Loop Over Leads`) para el INSERT en `n8n_chat_histories` |
| `contenidoMemoria` | String con prefijo `[SEGUIMIENTO AUTOMÁTICO #N]` + contenido listo para insertar |
| `updateSql` | SQL de UPDATE para `lead_crons` (tomado de `Build SQL`), propagado al nodo `Update lead_crons` |

---

## Diferencias v1 → v2

En v1 no existía este nodo. El texto de memoria se generaba en **Build SQL** con:
```javascript
const histSql = "INSERT INTO n8n_chat_histories ... VALUES ('" + pd.manychat_subscriber_id + "', ..."
```
Esa aproximación no diferenciaba tipos y no incluía `image_context`.
