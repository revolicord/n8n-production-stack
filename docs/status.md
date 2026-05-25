# Estado del MVP — Instagram DM Setter

> Documento vivo. Actualizado el **2026-05-24**. Reemplaza el antiguo `n8n/SETTER-MVP-TRACKING.md`.

## En una frase

El agente conversa con los leads, los organiza por etapas del funnel, les envía follow-ups automáticos cuando se quedan en silencio (y es consciente de ellos vía su memoria), y dispara contenido pregrabado de ManyChat por etapa. **Lo que falta es el panel de métricas.**

- **Modelo del agente:** Claude **Sonnet 4.6** (en el nodo AI Agent de n8n).
- **Tenant en producción:** Quantum Creators (`QC`). La agencia/repo es *revolicord*.
- **Funnel canónico:** `A` (Initiated) → `MS` (Media Seen) → `B` (Engaged) → `C` (Calendly'd) → `D` (Booked), más terminales `disqualified` / `lost` / `escalated_human_call`.

## Lo que YA funciona

- **Conversación end-to-end**: ManyChat → DM Setter API (debounce + turnos) → n8n (`agent-run`) → respuesta al lead. Workflow cableado: `Webhook → Get Stage Config → Get CRM Context → Build Context → AI Agent → enviar texto → Upsert Lead Cron → Prepare Callback → Callback`.
- **Organización por etapas**: el agente decide transiciones con la tool `set_stage`; se persisten en `lead_stages` (`current_stage` + `current_stage_id` FK) y se registran en `stage_transitions` con `reason` y `evidence`.
- **Follow-ups automáticos**: el workflow `followup-runner` (Schedule cada 5 min) lee `lead_crons`, envía el follow-up que toca según los `followup_templates` de la etapa, lo registra en `lead_followup_log` y avanza/archiva la secuencia.
- **El agente es consciente de los follow-ups**: cada follow-up se escribe en la memoria (`n8n_chat_histories`) como `[SEGUIMIENTO AUTOMÁTICO #N]`, y el bloque CRM de `Build Context` le dice cuántos se enviaron. Cuando el lead responde, el timer de `lead_crons` se resetea y los pendientes se marcan `responded`.
- **Flow registry de ManyChat**: flows nombrados con la convención `QC_{STAGE}_{MEDIA}_{DESC}_{vN}`, sincronizables desde la API (`/tenants/:slug/tools` + `/sync`) hacia `stage_flows`. El agente recibe los flows disponibles por etapa en el prompt y los dispara con la tool `trigger_manychat_flow`. Ver [`onboarding/09-flow-registry-manychat.md`](onboarding/09-flow-registry-manychat.md).

## Lo que FALTA

### El panel de métricas (la pieza principal pendiente)
Un dashboard que muestre **cómo van todos los leads** y **las estadísticas de los follow-ups**:

- Conteo de leads en cada etapa del funnel (A/MS/B/C/D + terminales) y tasas MSR/PRR/CSR/ABR.
- Estadísticas de follow-ups: enviados por etapa, tasa de respuesta, leads archivados por agotar la secuencia.
- Lista accionable de leads por etapa, con última actividad y próximo follow-up.

El **diseño** del panel (vistas, queries SQL, endpoints) está en [`onboarding/13-dashboard-y-metricas.md`](onboarding/13-dashboard-y-metricas.md). La implementación (endpoints `/admin/stats/*`, `/admin/leads`, y la SPA admin) **no existe todavía**.

### Otros huecos del funnel completo
- **Webhook de Calendly (C→D)**: hoy nada mueve un lead a `D` automáticamente. Falta el endpoint Fastify que verifica la firma de Calendly y marca la etapa.
- **Escalado a humano**: tabla `notifications` + tool `notify_human` + lógica tras el follow-up #5 (`escalated_human_call`). Aún no existe.
- **Round-robin de closers**: tabla `closers` + endpoint con lock atómico + tool `send_calendly_link`. De momento, link único de discovery en `tenants.config.calendly_url`.
- **Memoria semántica/episódica**: hoy solo memoria cronológica (Postgres Chat Memory). Sin recall profundo para leads que vuelven tras semanas.

## Decisiones de negocio abiertas (las necesita el founder)

1. **Persona del agente**: ¿el agente *es* "Alex" (se hace pasar por el founder) o es "del equipo de Alex"? La segunda es más sostenible. El prompt actual sigue la primera.
2. **Copy del producto**: one-liner de Quantum Creators, qué incluye, para quién es y para quién no. El prompt tiene placeholders sin esto.
3. **Timing de la primera respuesta**: los informes de `fundamentals/` se contradicen (5–20 min de retraso deliberado vs. 0–1 min convierte 21×). Es política de la capa de debounce, no del prompt.
4. **Criterios finos de descalificación**: umbral de "cuenta de baja calidad", lista de países válidos.
5. **Cadencia y textos de follow-up**: confirmar la cadencia y redactar los textos reales por etapa.

## Notas de desfase conocidas

- **`schema.ts` vs. BD**: la migración `0003_flow_registry.sql` añadió columnas a `stage_flows` (`human_name`, `media_type`, `content_description`, `usage_condition`, `variant_group`, `pending_ns`, `synced_at`) por SQL directo, pero `packages/db/src/schema.ts` aún **no** las declara. La BD es correcta; el schema de Drizzle está desfasado. (Issue de código, no de docs.)
- **Groq vs. Sonnet 4.6**: el modelo en producción es Sonnet 4.6, pero `n8n/nodes/03-groq-chat-model.md` (fuera del alcance de este refactor) y alguna referencia histórica siguen mencionando Groq/llama. El lado n8n no migró del todo en su documentación de nodos.
