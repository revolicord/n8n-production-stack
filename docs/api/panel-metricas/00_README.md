# Dashboard Analytics para Alex (Quantum Creators)

> **Para:** Claude Code ejecutando trabajo en `revolicord/n8n-production-stack`.
> **Objetivo:** construir el panel analítico que reemplaza el Excel "DM Sorcery Tracker" de Alex. Es una app **Next.js separada** que vive en `apps/dashboard/`, se despliega en el subdominio `dashboard.revolicord.com`, y consulta Postgres directamente vía Drizzle reusando `packages/db`.
> **Lo que NO es esto:** este panel NO es el SPA admin que vive en `apps/api/public/`. Ese SPA es para que Alex **edite** follow-ups, suba memes y ajuste delays. Este panel es para que Alex **observe** sus métricas. Son dos productos distintos, mismo usuario, mismo dominio raíz.
> **Diseño visual de referencia:** ver mockups en `mockups/*.html`. Replicar fielmente. La paleta y la "lingua franca visual" deben coincidir exactamente con el SPA admin existente, para que Alex sienta que es la misma familia de producto.

---

## Lectura obligatoria antes de tocar código

Estos documentos están en orden de lectura. **No saltarse ninguno antes de empezar a implementar.** Si algún paso es ambiguo o contradice otro doc, parar y abrir issue antes de improvisar.

| # | Documento | Para qué |
|---|---|---|
| 01 | [`01_CONTEXT_AND_GOAL.md`](./01_CONTEXT_AND_GOAL.md) | Quién es Alex, qué necesita, qué reemplaza, restricciones psicológicas del proyecto |
| 02 | [`02_VISUAL_REFERENCE.md`](./02_VISUAL_REFERENCE.md) | Paleta exacta, tipografía, espaciados, tokens de diseño, decisiones visuales |
| 03 | [`03_ARCHITECTURE.md`](./03_ARCHITECTURE.md) | Topología técnica, decisiones de stack, conexión a Postgres, deploy, dominio |
| 04 | [`04_DATA_MODEL_MAPPING.md`](./04_DATA_MODEL_MAPPING.md) | Cómo cada métrica del Excel se calcula desde el schema actual sin migraciones nuevas |
| 05 | [`05_QUERIES_SPECIFICATION.md`](./05_QUERIES_SPECIFICATION.md) | Drizzle/SQL exacto para cada KPI, sparkline, funnel, velocity y cohort |
| 06 | [`06_FOLDER_STRUCTURE.md`](./06_FOLDER_STRUCTURE.md) | Árbol de archivos de `apps/dashboard/` con responsabilidad de cada uno |
| 07 | [`07_AUTH_AND_ENV.md`](./07_AUTH_AND_ENV.md) | Login simple, JWT cookie httpOnly, middleware, variables de entorno |
| 08 | [`08_UI_COMPONENTS_SPEC.md`](./08_UI_COMPONENTS_SPEC.md) | Cada componente React: props, estados, comportamiento, animaciones |
| 09 | [`09_VIEWS_SPECIFICATION.md`](./09_VIEWS_SPECIFICATION.md) | Las 3 vistas (Anual, Mensual, Funnel): ruta, datos, layout, navegación |
| 10 | [`10_SPRINT_PLAN.md`](./10_SPRINT_PLAN.md) | Sprints 0–3 con entregables, criterios de aceptación, validación con Alex |
| 11 | [`11_DEPLOY_RUNBOOK.md`](./11_DEPLOY_RUNBOOK.md) | Dockerfile, Traefik labels, docker-stack.yml, DNS |
| 12 | [`12_TESTING_AND_SMOKE.md`](./12_TESTING_AND_SMOKE.md) | Checklist manual end-to-end por sprint |
| 13 | [`13_OUT_OF_SCOPE_AND_FUTURE.md`](./13_OUT_OF_SCOPE_AND_FUTURE.md) | Qué NO entra en este paquete y por qué |

Mockups visuales (abrir en el navegador local):

- `mockups/vista-anual.html` — el home
- `mockups/vista-mensual.html` — detalle de un mes
- `mockups/vista-funnel.html` — el funnel dedicado con insights

---

## Reglas de oro (innegociables)

1. **No tocar `apps/api/public/`.** Ese es el SPA admin. Aparte. Distinto producto. No se mezcla, no se reemplaza, no se "evoluciona".
2. **No crear migraciones de BD nuevas en este paquete.** Todo el panel analítico se construye con el schema actual (`packages/db/src/schema.ts`). Si crees que necesitas una tabla nueva, parar y revisar `04_DATA_MODEL_MAPPING.md` antes — probablemente la columna ya existe.
3. **Conexión a Postgres = Drizzle directo desde Server Components / Route Handlers de Next.js**, reusando el package `@revolicord/db`. NO crear endpoints REST nuevos en Fastify para esto.
4. **Auth del panel = independiente del SPA admin.** Una contraseña simple + cookie httpOnly. NO usar `ADMIN_JWT_SECRET` del SPA admin. NO usar NextAuth.
5. **Paleta y tipografía = idénticas al SPA admin** (`apps/api/public/index.html` + `app.js`). Dark `#0d0d0d`, paneles `#111`, borders `#1f2937`, teal accent `#14b8a6` / `#5dcaa5` / `#0f6e56`. Esto NO se discute en Sprint 1; el "tema Wow" llega en Sprint 3.
6. **Multi-tenant desde día 1.** Aunque hoy solo exista el tenant `quantum-creators`, cada query debe filtrar por `tenant_id`. NO hardcodear UUIDs.
7. **Idioma:** UI en español neutro. Código en inglés (variables, funciones, comentarios técnicos). Logs en inglés. Igual que el resto del repo.
8. **Convenciones del repo existente:**
   - TypeScript estricto, Node 20 LTS, pnpm.
   - Tests con vitest al lado de cada fichero (`*.test.ts`).
   - Lint con Biome (`pnpm lint`).
   - Commits en imperativo con prefijo `feat:` / `fix:` / `chore:` / `docs:`.
   - Un commit por entregable del sprint.
9. **No improvisar UX.** Si una sección no está mockup-ada, abrir issue antes de pintarla.
10. **No instalar dependencias "por si acaso".** Cada `pnpm add` requiere justificación documentada. El stack ya está cerrado en `03_ARCHITECTURE.md`.

---

## Orden de ejecución estricto

1. **Paso 0 — Lectura completa.** Antes de cualquier commit, leer del 01 al 13. Esto cuesta 30 minutos y ahorra semanas.
2. **Sprint 0 — Foundation.** Ver `10_SPRINT_PLAN.md` sección "Sprint 0". Entregable: app boot-eable con login, sidebar vacío, conexión a BD verificada. Commit único: `feat(dashboard): bootstrap next.js app with auth and db connection`.
3. **Sprint 1 — Excel evolucionado.** Vistas Anual + Mensual con datos reales. Replicar lo que Alex ya conoce.
4. **Sprint 2 — Wow inicial.** Vista Funnel + insights + heatmap + velocity.
5. **Sprint 3 — Inteligencia.** Cohortes + tema Wow opcional + predicciones avanzadas. (Kanban de prospectos: fuera de scope de este paquete, ver doc 13.)

Cada sprint cierra con su checklist de validación en `12_TESTING_AND_SMOKE.md`.

---

## Si algo se cae o no aparece

- **Schema no coincide:** revisar `packages/db/src/schema.ts` real vs `04_DATA_MODEL_MAPPING.md`. El doc se escribió con la versión del schema que existe al cierre de este paquete. Si hay nuevas migraciones aplicadas después, ajustar mappings y abrir issue.
- **No hay datos en BD:** correr el seed `packages/db/drizzle/seed_qc_funnel.sql` con el tenant QC. Ver `07_AUTH_AND_ENV.md` para setup local.
- **Traefik no enruta el subdominio:** verificar DNS y labels en `11_DEPLOY_RUNBOOK.md`.

---

## Glosario rápido (para no confundir conceptos)

| Término | Significado |
|---|---|
| **Panel** / **Dashboard analítico** | La app Next.js nueva que construye este paquete |
| **SPA admin** | La app vanilla JS que ya existe en `apps/api/public/`. NO se toca. |
| **Funnel** | A → MS → B → C → D (Initiated → Media Seen → Engaged → Calendly → Booked) |
| **MSR / PRR / CSR / ABR** | Ratios overall: MS/A, B/A, C/A, D/A |
| **A→MS, MS→B, B→C, C→D** | Ratios etapa-a-etapa |
| **QC** | Quantum Creators, el único tenant que existe hoy |
| **Tenant** | Cliente de la agencia (Alex es uno) |
| **Subscriber** | Usuario de Instagram en el ecosistema de un tenant |
| **Stage transition** | Cambio de etapa de un subscriber, registrado en `api.stage_transitions` |
| **Lead followup log** | Log inmutable de follow-ups enviados (`api.lead_followup_log`) |

Fin del README.
