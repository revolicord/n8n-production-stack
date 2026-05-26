# Material crudo de Calendly — staging para diseño de integración

Esta carpeta es **input para el plan**, no documentación final. Suelta aquí:

## Payloads (los 2 que ya tienes)
- `webhook-invitee-created.json` — el payload del webhook cuando se agenda la llamada
  (evento `invitee.created`).
- `scheduled-event.json` — la respuesta del GET al `event` URI / `invitee` URI con todos
  los datos completos.

> Renómbralos así al soltarlos, o déjalos con el nombre que traigan y yo los mapeo.

## Docs de Calendly (los 5 MD)
- Suéltalos tal cual (cualquier nombre). Idealmente prefíjalos `doc-01-...md` ... `doc-05-...md`
  o usa el título original — los leo igual.

---

Cuando estén aquí, avísame y los estudio para devolverte:
1. Qué dato del payload usamos como **clave de identidad** (matching Calendly ↔ subscriber IG).
2. Si falta info (campos, scopes, o decisiones de producto).
3. Plan + arquitectura, revisando lo existente (`webhook-manychat.ts`, `set-stage`,
   `lead-stages`, funnel `C→D`) para no romper nada, y si hace falta migración de DB.
