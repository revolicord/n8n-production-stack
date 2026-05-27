# Frente 1 — Links de Calendly dinámicos (UTM en los 3 puntos)

**Parte de:** `docs/n8n/calendly-feedback-plan.md` (§5.1).
**Objetivo:** que TODO link de Calendly enviado lleve `?utm_content={subscriber.id}` (UUID interno),
para poder identificar quién agendó. Además completa la interpolación de `{{call_link}}` /
`{{nurture_video}}` en el followup-runner, que hoy se envían **literales**.

> **Decisión de diseño:** la columna/config guarda el link **base** (sin parámetros). Cada punto de
> envío le añade el UTM en runtime con el mismo patrón:
> `base + (base.includes('?') ? '&' : '?') + 'utm_content=' + subscriberId`.

---

## 0. ⚠️ VERIFICACIÓN PREVIA — ¿el UTM atraviesa el dominio?

`tenant.config.calendly_url = "https://quantumcreators.es/llamada-de-discovery"` **no es calendly.com**.
Para que el UTM llegue a `payload.tracking.utm_content`, ese dominio intermedio debe propagar el
query param hasta el widget de Calendly.

**Test obligatorio antes de confiar en producción:**
1. Abrir `https://quantumcreators.es/llamada-de-discovery?utm_content=TEST123`.
2. Agendar una cita de prueba.
3. En el webhook de Calendly en n8n, verificar `body.payload.tracking.utm_content`.
   - `=== "TEST123"` → OK, seguir.
   - `null` → arreglar el dominio (redirect que preserve `$query_string`, o embed que pase UTMs)
     **antes** de que esto sirva. El código de abajo es correcto igual; lo que falla es el transporte.

---

## 1. Build Context (workflow `agent-run`) — punto 1 (etapa B→C)

**Nodo:** `Build Context` (Code, ID `fe31ef8f-...`). El agente lee el link de
`contextJson.extras.calendly_url` (el system prompt dice *"Si el contexto te muestra el link…"*).

**Cambio — reemplazar la línea actual:**
```javascript
const calendlyUrl = (body.tenant && body.tenant.config && body.tenant.config.calendly_url) || null;
```
**por:**
```javascript
const calendlyBase = (body.tenant && body.tenant.config && body.tenant.config.calendly_url) || null;
const calendlyUrl = calendlyBase
  ? calendlyBase + (calendlyBase.includes('?') ? '&' : '?') + 'utm_content=' + (sub.id || '')
  : null;
```
`sub.id` ya está en scope (`const sub = body.subscriber || {}`) y es el UUID interno. El resto del
nodo no cambia: sigue inyectando `calendlyUrl` en `contextJson.extras.calendly_url`.

> **Opcional (system prompt):** para que el LLM no "limpie" el `?utm_content=…`, añadir a la regla
> de Calendly: *"Envía el link EXACTO del contexto, sin quitar ni modificar nada después del `?`."*
> El prompt vive en `tenant.config.system_prompt` (DB) / Set node `System Prompt`. No bloqueante.

---

## 2. Get Due Leads (workflow `followup-runner`) — leer las columnas

**Nodo:** `Get Due Leads` (Postgres). Hoy NO selecciona `call_link` ni `nurture_video_url`.

**Cambio — añadir al SELECT** (junto a `fs.slug AS stage_slug,`):
```sql
    fs.call_link                       AS call_link,
    fs.nurture_video_url               AS nurture_video_url,
```
(Las columnas existen desde la migración 0013. `subscriber_id` ya se selecciona como `lc.subscriber_id`.)

---

## 3. Prepare Data (followup-runner) — punto 2/3 tipo `text`

**Nodo:** `Prepare Data` (Code, ID `bd2a127b-...`). Hoy solo reemplaza `{{name}}`.

**Reemplazar el código completo por:**
```javascript
function withUtm(base, subId) {
  if (!base) return '';
  return base + (base.includes('?') ? '&' : '?') + 'utm_content=' + subId;
}

return items.map(item => {
  const d = item.json;
  const callLink = withUtm(d.call_link, d.subscriber_id);
  const nurtureVideo = d.nurture_video_url || '';

  const interpolate = (s) => (s || '')
    .replace(/{{name}}/g, d.display_name || '')
    .replace(/{{call_link}}/g, callLink)
    .replace(/{{nurture_video}}/g, nurtureVideo);

  const textSent = d.followup_type === 'text'
    ? interpolate(d.text_template)
    : '[flow: ' + (d.followup_flow_ns || '') + '] — ' + (d.followup_description || '');
  const chatMemoryText = '[SEGUIMIENTO AUTOMÁTICO #' + d.next_sequence_number + '] ' + textSent;
  return { json: { ...d, textSent, chatMemoryText } };
});
```

---

## 4. Build Content Messages (followup-runner) — punto 2/3 tipo `content` (etapas B y C)

**Nodo:** `Build Content Messages` (Code, ID `d10737c1-...`). Hoy solo reemplaza `{{name}}`.
Aquí caen los links de **etapa B (follow-up #8)** y **etapa C**.

**Reemplazar el código completo por:**
```javascript
const item = $input.item.json;
const displayName = item.display_name ?? 'amig@';
const callLink = item.call_link
  ? item.call_link + (item.call_link.includes('?') ? '&' : '?') + 'utm_content=' + item.subscriber_id
  : '';
const nurtureVideo = item.nurture_video_url || '';
const rawMessages = Array.isArray(item.followup_messages) ? item.followup_messages : [];

const interpolate = (s) => (s ?? '')
  .replace(/\{\{name\}\}/g, displayName)
  .replace(/\{\{call_link\}\}/g, callLink)
  .replace(/\{\{nurture_video\}\}/g, nurtureVideo);

const mcMessages = rawMessages
  .sort((a, b) => a.sort_order - b.sort_order)
  .map((m) => {
    if (m.message_type === 'image') return { type: 'image', url: m.media_url };
    return { type: 'text', text: interpolate(m.text_content) };
  });

const textSent = rawMessages
  .filter(m => m.message_type === 'text')
  .map(m => interpolate(m.text_content))
  .join(' | ');

return [{ json: { ...item, mcMessages, textSent } }];
```

---

## Checklist frente 1

- [ ] **Test del dominio (§0)** — `?utm_content=TEST123` llega a `tracking.utm_content`.
- [ ] Build Context: inyectar UTM en `calendlyUrl` (§1).
- [ ] (Opcional) system prompt: "envía el link exacto del contexto".
- [ ] Get Due Leads: añadir `call_link`, `nurture_video_url` al SELECT (§2).
- [ ] Prepare Data: interpolar `{{call_link}}`(+UTM) / `{{nurture_video}}` (§3).
- [ ] Build Content Messages: ídem (§4).
- [ ] Configurar `funnel_stages.call_link` en etapas B y C (dashboard) si aún está vacío.
- [ ] Prueba: follow-up #8 de B y mensaje de C → el link enviado lleva `?utm_content=<uuid>`.

---

## Notas

- **`{{nurture_video}}`** se completa de paso (mismo lugar de interpolación). No lleva UTM — es un
  video, no el link de agendar.
- **`subscriber_id`** en el runner = `lc.subscriber_id` (UUID), mismo valor que `subscriber.id` del
  agent-run. Consistente con el UTM del punto 1.
- **Doble fuente del link** (deuda, §5.1 del plan): agent-run usa `tenant.config.calendly_url`;
  follow-ups usan `funnel_stages.call_link`. Ambos deben apuntar al mismo destino (hoy
  `quantumcreators.es/llamada-de-discovery`). Consolidar a futuro.
