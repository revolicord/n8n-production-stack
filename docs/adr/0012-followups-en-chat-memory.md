# ADR-0012: `followup-runner` Escribe en `n8n_chat_histories`

**Status:** Accepted  
**Date:** 2026-05-15  
**Deciders:** Equipo Revolicord

---

## Y-Statement

> _In the context of_ un agente IA que solo se activa con mensajes entrantes del lead,  
> _facing_ el hecho de que los follow-ups automáticos se envían fuera de su contexto (workflow separado),  
> _we decided_ que `followup-runner` inserte cada follow-up enviado como mensaje `"type": "ai"` en la tabla `n8n_chat_histories` usando el mismo `session_id` que usa el agente,  
> _to achieve_ que el agente vea la conversación completa — incluyendo mensajes automáticos — cuando el lead finalmente responde,  
> _accepting_ acoplamiento entre `followup-runner` y el esquema interno de memoria de n8n.

---

## Contexto

El nodo `Postgres Chat Memory` de n8n usa la tabla `n8n_chat_histories` para persistir el historial de conversación por `session_id`. La `session_id` es el `manychat_subscriber_id` del lead (ver ADR-0009).

Cuando `followup-runner` envía un mensaje automático, ese mensaje **no existe** en la memoria del agente. Cuando el lead responde días después, el agente ve:

```
[AI]    Hola, aquí tienes el video 👇        ← turno 1 del agente
[Human] 👍
[Human] perdona estaba muy ocupado           ← lead responde 3 días después
```

El agente no sabe que mandó 2 follow-ups sin respuesta. No tiene contexto para decidir:
- ¿Es un lead frío que vuelve? ¿Cuánta urgencia usar?
- ¿Cuántos intentos quedan antes de archivar?
- ¿Qué tono usar — cálido y paciente, o más directo?

---

## Decisión

Después de enviar cada follow-up, `followup-runner` inserta un registro en `n8n_chat_histories`:

```sql
INSERT INTO n8n_chat_histories (session_id, message)
VALUES (
  $1,   -- manychat_subscriber_id (idéntico al session_id del agente)
  jsonb_build_object(
    'type', 'ai',
    'data', jsonb_build_object(
      'content',           $2,   -- '[SEGUIMIENTO AUTOMÁTICO #N] texto enviado'
      'additional_kwargs', '{}'::jsonb
    )
  )
);
-- $1 = manychat_subscriber_id
-- $2 = '[SEGUIMIENTO AUTOMÁTICO #' || sequence_number || '] ' || texto_enviado
```

### Formato del prefijo

El prefijo `[SEGUIMIENTO AUTOMÁTICO #N]` sirve para que el agente distinga mensajes automáticos de sus propias respuestas. El system prompt debe incluir la instrucción:

> *"Si ves en tu historial mensajes con el prefijo `[SEGUIMIENTO AUTOMÁTICO #N]`, significa que el sistema envió esos mensajes de forma automática mientras el lead no respondía. No los menciones explícitamente; úsalos como contexto para calibrar tu tono."*

### Resultado visible por el agente

```
[AI]    Hola, aquí tienes el video 👇
[Human] 👍
[AI]    [SEGUIMIENTO AUTOMÁTICO #1] Oye, ¿pudiste verlo? 👀
[AI]    [SEGUIMIENTO AUTOMÁTICO #2] No quiero molestarte, pero me gustaría saber qué te pareció
[Human] perdona estaba muy ocupado          ← agente ahora tiene contexto completo
```

### Campos requeridos en `followup-runner`

Para poder insertar correctamente, el nodo de `followup-runner` que envía el follow-up de tipo `text` debe guardar en `$json` tanto `manychat_subscriber_id` como el texto interpolado (con `{{name}}` ya reemplazado). Para flows, el texto es la descripción del flow.

```javascript
// Construcción del texto para la memoria
const textoParaMemoria = item.followup_type === 'text'
  ? item.text_template.replace('{{name}}', item.display_name)
  : `[flow: ${item.followup_flow_ns}] — ${item.followup_description ?? ''}`;

const contenidoMemoria = `[SEGUIMIENTO AUTOMÁTICO #${item.next_sequence_number}] ${textoParaMemoria}`;
```

---

## Tabla `lead_followup_log` — columna `text_sent`

Para poder reconstruir el mensaje exacto en futuras consultas (el template puede cambiar), `lead_followup_log` incluye la columna `text_sent` con el texto ya interpolado:

```sql
ALTER TABLE lead_followup_log ADD COLUMN text_sent TEXT;
```

---

## Consecuencias

**Positivas:**
- El agente ve la conversación completa sin ningún cambio en su arquitectura.
- Cero latencia adicional en el turno del agente (la inserción ocurre en el runner, no en `agent-run`).
- El historial es coherente: mismo `session_id`, misma tabla, mismo formato.

**Negativas:**
- Acoplamiento con el esquema interno de n8n (`n8n_chat_histories`). Si n8n cambia el formato de la tabla en una actualización mayor, hay que adaptar el INSERT.
- Los mensajes automáticos aparecen en el historial del LLM y consumen tokens de contexto. Con secuencias largas y muchos leads, el contexto puede crecer. Mitigación: n8n trunca el historial al límite de `windowSize` configurado en el nodo de memoria.
- No se puede deshacer: una vez insertado en el historial, el mensaje permanece (es el comportamiento correcto para auditoría).

---

## ADRs relacionados

- ADR-0009: Configuración del workflow `agent-run` (define `session_id = manychat_subscriber_id`)
- ADR-0011: `lead_crons` como detector de inactividad
- ADR-0013: Contexto dual del agente (memoria + bloque CRM)
