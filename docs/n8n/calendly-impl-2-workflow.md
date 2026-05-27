# Frente 2 — Workflow `calendly-feedback` (core: identificar → marcar D → persistir)

**Parte de:** `docs/n8n/calendly-feedback-plan.md` (§4.2).
**Alcance de este frente:** recibir el webhook, validar, resolver el subscriber por `utm_content`,
marcar `C→D` vía `set-stage`, y persistir la reserva en `subscribers.metadata`. **El feedback
humanizado (disparar al agente) es el frente 3** — este workflow se extiende allí.

> **Asunción:** el UTM funciona (la cuenta de prueba usa `calendly.com` directo). El test del
> dominio `quantumcreators.es` (frente 1 §0) queda como pendiente de producción.

---

## Datos fijos (del payload real)

| Dato | Valor |
|------|-------|
| Webhook path | `/webhook/calendly-feedback` (ya montado) |
| API base | `https://api.revolicord.com` |
| set-stage | `POST {API}/admin/leads/{subscriber_id}/stage` |
| Auth | `Authorization: Bearer {N8N_CALLBACK_TOKEN}` (mismo de turn-completed) |
| Identidad | `body.payload.tracking.utm_content` = `subscriber.id` (UUID interno) |

---

## Diagrama de nodos

```
Webhook (Respond Immediately 200)
   └─ IF Guard            event==="invitee.created" && utm_content no vacío
        └─(true)─ Get Subscriber (Postgres)
              └─ IF Subscriber Found   subscriber_id no vacío
                   └─(true)─ Set Stage D (HTTP, Continue On Fail)
                        └─ Build Booking JSON (Code)
                             └─ Persist Booking (Postgres UPDATE)
                                  └─ [FRENTE 3: Format datetime → Trigger agent-run]
```

---

## Nodo 1 — Webhook (ya existe)

| Campo | Valor |
|-------|-------|
| HTTP Method | `POST` |
| Path | `calendly-feedback` |
| **Respond** | **Immediately** → responde `200` al recibir (Calendly reintenta en no-2xx; no lo hagas esperar al set-stage). |

Output en `$json.body` (igual que agent-run).

---

## Nodo 2 — IF Guard

**Tipo:** IF. Continuar solo si es un agendamiento identificable.

| Condición | Valor 1 | Operador | Valor 2 |
|-----------|---------|----------|---------|
| 1 (AND) | `={{ $json.body.event }}` | equals | `invitee.created` |
| 2 (AND) | `={{ $json.body.payload.tracking.utm_content }}` | is not empty | — |

- **true** → Get Subscriber.
- **false** → fin (ya respondimos 200). Opcional: nodo NoOp para log.

---

## Nodo 3 — Get Subscriber (Postgres · Execute Query)

Resuelve el UUID del `utm_content` a los datos que necesitamos.

```sql
SELECT
  s.id                              AS subscriber_id,
  s.manychat_subscriber_id,
  s.tenant_id,
  s.display_name,
  ls.current_stage,
  t.config->>'manychat_api_key'     AS mc_api_key
FROM api.subscribers s
JOIN api.tenants t ON t.id = s.tenant_id
LEFT JOIN api.lead_stages ls
  ON ls.subscriber_id = s.id AND ls.tenant_id = s.tenant_id
WHERE s.id = $1::uuid
```

**Query Replacement (parámetros):**
```
={{ $('Webhook').first().json.body.payload.tracking.utm_content }}
```

> Si `utm_content` no es un UUID válido, el `::uuid` lanza error → poner el nodo con
> **Continue On Fail** y dejar que el IF siguiente lo filtre (no habrá `subscriber_id`).

---

## Nodo 4 — IF Subscriber Found

**Tipo:** IF. Evita llamar a set-stage con un lead inexistente (daría 404).

| Condición | Valor 1 | Operador |
|-----------|---------|----------|
| 1 | `={{ $json.subscriber_id }}` | is not empty |

- **true** → Set Stage D.
- **false** → fin + log "calendly booking de subscriber desconocido" (UTM corrupto / de otro origen).

---

## Nodo 5 — Set Stage D (HTTP Request)

Reusa el endpoint existente. **No reimplementamos la lógica** — set-stage valida `C→D`, registra
`stage_transitions` y cancela los `lead_crons` activos.

| Campo | Valor |
|-------|-------|
| Method | `POST` |
| URL | `=https://api.revolicord.com/admin/leads/{{ $json.subscriber_id }}/stage` |
| Authentication | Header Auth (credencial) **o** header manual `Authorization: Bearer {N8N_CALLBACK_TOKEN}` |
| Send Body | `JSON` |
| **On Error** | **Continue (regular output)** — ver nota |

**Body (JSON):**
```json
{
  "new_stage": "D",
  "reason": "calendly_booked",
  "evidence": "Calendly invitee.created @ {{ $('Webhook').first().json.body.payload.scheduled_event.start_time }} — {{ $('Webhook').first().json.body.payload.scheduled_event.uri }}"
}
```

**Por qué Continue On Fail:**
- `400 INVALID_TRANSITION` → el lead no estaba en `C` (agendó sin pasar por el flujo). Igual
  queremos persistir el booking y, en frente 3, darle feedback. Logueamos el caso, no abortamos.
- `200 {changed:false}` → ya estaba en `D` (doble webhook / re-booking). Idempotente, sigue normal.
- `404` → no debería ocurrir (el IF anterior ya filtró), pero si pasa, no rompe el flujo.

---

## Nodo 6 — Build Booking JSON (Code)

Arma el objeto de reserva para persistir. Lee del Webhook (no del set-stage).

```javascript
const p = $('Webhook').first().json.body.payload;
const ev = p.scheduled_event || {};
const booking = {
  event_uri: ev.uri || p.event || null,
  invitee_uri: p.uri || null,
  start_time: ev.start_time || null,
  end_time: ev.end_time || null,
  join_url: (ev.location && ev.location.join_url) || null,
  timezone: p.timezone || null,
  reschedule_url: p.reschedule_url || null,
  cancel_url: p.cancel_url || null,
  invitee_email: p.email || null,
  booked_at: new Date().toISOString(),
};
return [{ json: { ...$json, bookingJson: JSON.stringify({ booking }) } }];
```

---

## Nodo 7 — Persist Booking (Postgres · Execute Query)

Guarda la reserva en `subscribers.metadata.booking` (jsonb merge, sin migración).

```sql
UPDATE api.subscribers
SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
WHERE id = $1::uuid
```

**Query Replacement:**
```
={{ $('Get Subscriber').first().json.subscriber_id }},{{ $json.bookingJson }}
```

> `$2` se pasa como parámetro (no interpolación de string), así el JSON no necesita escaping
> manual. El `||` hace merge: si ya había `metadata.booking`, lo reemplaza con el nuevo.

**→ Continúa en FRENTE 3:** `Format datetime` → construir `system_event` → `POST /webhook/agent-run`
para que el agente confirme con su voz.

---

## Credenciales / variables n8n necesarias

| Nombre | Uso | Nota |
|--------|-----|------|
| `N8N_CALLBACK_TOKEN` | Bearer para `set-stage` | Mismo token que ya usa turn-completed. Guardarlo como credencial *HTTP Header Auth* (`Authorization: Bearer <token>`) o variable n8n — el workflow calendly-feedback NO lo recibe en el payload (a diferencia de agent-run, que lo trae como `callback_token`). |
| API base | URL de `set-stage` | `https://api.revolicord.com`. Hardcodear o variable. |
| Postgres | Get Subscriber / Persist | La misma credencial Postgres que usan agent-run / followup-runner. |

---

## Checklist frente 2

- [ ] Webhook `calendly-feedback`: Respond **Immediately** (200).
- [ ] IF Guard: `event === invitee.created` && `utm_content` no vacío.
- [ ] Get Subscriber (Postgres) con el SELECT por `utm_content::uuid` + Continue On Fail.
- [ ] IF Subscriber Found.
- [ ] Set Stage D (HTTP) con Bearer + **Continue On Fail**.
- [ ] Build Booking JSON (Code).
- [ ] Persist Booking (Postgres UPDATE merge en metadata).
- [ ] Guardar `N8N_CALLBACK_TOKEN` como credencial/variable en n8n.
- [ ] Prueba: lead en C → agenda (link de prueba calendly.com con `?utm_content=<su uuid>`) →
      stage pasa a D → `lead_crons` cancelados → `subscribers.metadata.booking` poblado.
- [ ] Prueba edge: agendar con un lead en B (no C) → set-stage da 400 pero el booking se persiste
      y el flujo no se rompe (revisar log).

---

## Notas

- **No mandamos mensaje IG en este frente.** El feedback lo genera el agente (frente 3). Si quieres
  un MVP intermedio sin esperar el frente 3, se puede añadir aquí un nodo ManyChat sendContent con
  texto fijo — pero el plan acordado es que humanice el agente.
- **`current_stage`** del Get Subscriber sirve para loguear desde qué etapa agendó (útil para medir
  cuántos agendan sin pasar por C).
- **Reschedule/cancel** (`invitee.canceled`) → 2ª iteración (§10 del plan). El Guard ya los descarta
  hoy (solo deja pasar `invitee.created`).
