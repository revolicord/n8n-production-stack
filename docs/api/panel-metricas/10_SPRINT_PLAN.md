# 10 — Plan de sprints

> Cuatro sprints. Cada uno entrega valor incremental y se valida con Alex antes de pasar al siguiente. **No empezar el sprint N+1 sin haber cerrado el N.**

## Filosofía general

- **Sprint 0**: foundation. Sin UI compleja. Objetivo: la app vive, autentica, conecta a BD.
- **Sprint 1**: paridad con Excel. Alex debe poder decir *"es mi Excel pero mejor"*.
- **Sprint 2**: wow inicial. Funnel dedicado + insights + heatmap + velocity. Alex debe decir *"esto no podía hacerlo antes"*.
- **Sprint 3**: inteligencia. Cohortes + predicciones más finas + tema "Wow" opcional. Alex debe decir *"no quiero volver al Excel"*.

Entre sprints: **review con Alex obligatorio**. No es opcional. El proyecto vive o muere por esto.

---

## Sprint 0 — Foundation

**Duración estimada:** 1–2 días.
**Pre-requisitos:** doc 03 (Architecture), doc 06 (Folder structure), doc 07 (Auth & env) leídos.
**Pre-requisito de BD:** seed QC aplicado en local; verificar con los 3 checks de `04_DATA_MODEL_MAPPING.md` sección "Validación del mapeo".

### Entregables

1. **App boot-eable.** `pnpm dev` en `apps/dashboard/` arranca Next.js en puerto 3001 sin errores.
2. **Login funcional.** `/login` muestra formulario, POST a `/api/auth/login` valida contra `PANEL_PASSWORD`, setea cookie `panel_session`. Middleware protege todo lo demás.
3. **Conexión a Postgres verificada.** Hay un Server Component (puede ser `/year/[year]/page.tsx` provisional) que llama a `getActiveTenant()` y renderiza el nombre del tenant en pantalla. Si no hay tenant activo, error claro.
4. **Sidebar visible.** Con logo, tenant name, items de nav (algunos clickables a placeholders, otros marcados como "próximamente"), footer con logout.
5. **Logout funcional.** Botón en sidebar llama a `/api/auth/logout`, limpia cookie, redirige a `/login`.
6. **Configuración del workspace.** El paquete está incluido en pnpm-workspace; `tsconfig.base.json` resuelve `@revolicord/db`; `pnpm typecheck` pasa.
7. **Lint y format.** `pnpm lint` pasa sin errores en el paquete nuevo. Biome configurado vía extends del raíz.

### Tareas concretas (en orden)

1. Crear estructura de carpetas según doc 06.
2. Crear `package.json` con dependencias mínimas (Next, React, drizzle, postgres, jose, @tabler/icons-react, tailwind, postcss, autoprefixer, vitest, zod).
3. Crear `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `biome.json`.
4. Crear `src/app/globals.css` con Tailwind directives y reset mínimo.
5. Crear `src/lib/db.ts` (cliente Drizzle separado, ver doc 03).
6. Crear `src/lib/tenant.ts` (`getActiveTenant`), `src/lib/stages.ts` (`getStagesForTenant`).
7. Crear `src/lib/auth.ts` con `jose` (doc 07).
8. Crear `src/middleware.ts` (doc 07).
9. Crear `src/app/api/auth/login/route.ts` y `logout/route.ts`.
10. Crear `src/app/login/page.tsx` (formulario simple).
11. Crear `src/app/layout.tsx` (root html/body).
12. Crear `src/app/(dashboard)/layout.tsx` (sidebar + main shell).
13. Crear `src/app/page.tsx` (redirect a `/year/<año>`).
14. Crear `src/app/(dashboard)/year/[year]/page.tsx` con un `<div>` "Hola, {tenant.name}" provisional.
15. Crear placeholders en `month/`, `funnel/`, `prospects/`, `velocity/`, `cohorts/` (todos con "Próximamente").
16. Crear `Sidebar.tsx`, `SidebarItem.tsx`, `TenantSelect.tsx` (versión funcional mínima).
17. Crear `Card.tsx`, `SectionTitle.tsx`, `Pill.tsx` (primitives).
18. Crear `src/lib/format.ts` (helpers).
19. Test mínimo: `format.test.ts` con 3-4 tests de fmtPct, fmtNumber, fmtDays.
20. Verificar `.env.example` correcto, generar `.env` local con valores válidos.

### Criterios de aceptación (DoD)

- [ ] `pnpm install` desde raíz instala todo sin warnings importantes.
- [ ] `pnpm --filter @revolicord/dashboard typecheck` pasa.
- [ ] `pnpm --filter @revolicord/dashboard lint` pasa.
- [ ] `pnpm --filter @revolicord/dashboard test` pasa (al menos los tests de format).
- [ ] `pnpm --filter @revolicord/dashboard dev` arranca en `:3001`.
- [ ] Visitar `http://localhost:3001` redirige a `/login`.
- [ ] Password incorrecta muestra mensaje "Contraseña incorrecta".
- [ ] Password correcta redirige a `/year/<año-actual>` y se ve "Hola, Quantum Creators".
- [ ] El sidebar aparece, los enlaces existen, click en uno cambia el active state.
- [ ] Logout limpia la cookie y vuelve a `/login`.
- [ ] Recargar tras logout no muestra contenido protegido.
- [ ] La cookie no aparece en JS del navegador (verificar httpOnly en devtools).

### Validación con Alex

No aplica. Sprint 0 es solo plomería. Alex no ve nada.

### Commits sugeridos

- `feat(dashboard): scaffold next.js app structure`
- `feat(dashboard): add panel auth with jwt and middleware`
- `feat(dashboard): wire drizzle client and tenant resolution`
- `feat(dashboard): add shell components (sidebar, layout)`

---

## Sprint 1 — Excel evolucionado

**Duración estimada:** 3–5 días.
**Pre-requisito:** Sprint 0 cerrado. BD con datos reales o seed extendido.

### Objetivo de producto

Alex abre el panel y reconoce inmediatamente su tracker. Ve **todo lo que tenía en el Excel** y además entiende que está vivo. Promesa cumplida del **lado izquierdo** de la conversación inicial: "vas a tener todo lo del Excel".

### Entregables

1. **Vista Anual** funcional con datos reales:
   - 5 KPI cards con totales del año + delta vs año anterior + sparkline.
   - Matriz mensual 9 filas × 13 cols (12 meses + total).
   - Funnel del año con 5 barras y 4 drop lines.
   - 3 insights básicos (subset de los 5 totales).
2. **Vista Mensual** funcional con datos reales:
   - 5 KPI cards del mes con hint "X por día".
   - Ratio ribbon de 8 ratios (MSR/PRR/CSR/ABR + 4 conversiones etapa-a-etapa).
   - Funnel del mes (mismo componente que en anual).
   - Velocity card simple (A→MS, MS→B, B→C, C→D y total A→D).
   - Predicción de cierre del mes.
3. **Navegación funcional:**
   - Click en celda de matriz → mes correspondiente.
   - Breadcrumb del mes vuelve al año.
   - Botones < Mes anterior / Mes siguiente >.
   - Year switcher (3 años visibles: actual, anterior, siguiente).
4. **PeriodSwitcher reutilizable** para año y para mes.
5. **Componentes del Sprint 1 según tabla en doc 08:**
   - `KpiCard`, `LetterBadge`, `DeltaPill`, `Sparkline`.
   - `MonthlyMatrix`, `MatrixCell`.
   - `FunnelBars`, `FunnelStageRow`, `FunnelDropLine`.
   - `VelocityCard`.
   - `PredictionCard`.
   - `InsightList`, `InsightCard` (con reglas 1, 2 y 4 de las 5 totales).
6. **Queries del Sprint 1 según doc 05:**
   - `getFunnelCounts`, `ratiosFromCounts`.
   - `getMonthlySeries`.
   - `getFunnelView`.
   - `getVelocity`.
   - `getMonthPrediction`.
   - `buildInsights` (reglas 1, 2, 4).
7. **Test coverage mínimo:**
   - `_helpers.test.ts` (safeDivide, getPeriodRange).
   - `funnel.test.ts` (ratiosFromCounts con valores normales y edge cases — denominador 0).
   - `prediction.test.ts` (proyección lineal correcta, edge cases enero).

### Criterios de aceptación

- [ ] `/year/<año-actual>` carga en <2s con datos reales de QC.
- [ ] Cualquier mes con datos muestra >0 en cells; meses futuros o vacíos muestran `—`.
- [ ] Ratios muestran `—` cuando el denominador es 0 (no `0%`, no `NaN`, no `Infinity`).
- [ ] Click en celda de Marzo en la matriz → carga `/month/<año>/03` con datos de marzo.
- [ ] El delta vs año anterior es correcto: si A=2847 este año, A=2543 el anterior → muestra "+12%".
- [ ] Sparklines tienen 12 puntos.
- [ ] Funnel widths son proporcionales a A (etapa A siempre 100%).
- [ ] Drop lines muestran porcentaje en rojo y cantidad perdida.
- [ ] Velocity card muestra 4 transiciones + total A→D.
- [ ] Predicción muestra "~X bookings" con X razonable (no negativo, no 0 si hay datos).
- [ ] Navegar de diciembre → enero del siguiente año funciona.
- [ ] Navegar de enero → diciembre del año anterior funciona.

### Validación con Alex (mandatoria antes de Sprint 2)

Reunión de 30 minutos. Mostrar pantalla compartida:

1. Abrir `/year/<año actual>`. Preguntar: *"¿Reconoces esto?"*. Si dice no, parar todo.
2. Pedirle que haga click en un mes activo. Preguntar: *"¿Es el detalle del mes que esperabas?"*.
3. Mostrar la matriz. Preguntar: *"¿Falta alguna métrica de tu Excel? ¿Sobra alguna?"* — apuntar todo.
4. Mostrar el funnel. Preguntar: *"¿Esto te dice algo nuevo?"*.
5. Mostrar la predicción del mes. Preguntar: *"¿El número te parece razonable?"*.
6. **Pregunta final**: *"Si cerrara el Excel ahora, ¿estarías cómodo trabajando solo con esto?"*.

Si responde sí a la final → cerrar Sprint 1. Si no → iterar antes de Sprint 2.

### Commits sugeridos

- `feat(dashboard): implement annual view with kpis, matrix and funnel`
- `feat(dashboard): add monthly view with ratios, velocity and prediction`
- `feat(dashboard): wire interstitial navigation between year and month`
- `test(dashboard): cover format helpers and metrics helpers`

---

## Sprint 2 — Wow inicial

**Duración estimada:** 4–6 días.
**Pre-requisito:** Sprint 1 cerrado. Alex confirmó que reemplazaría el Excel.

### Objetivo de producto

Alex empieza a usar el panel diariamente. Descubre cosas del funnel que el Excel jamás le mostró. Se siente más en control. Promesa cumplida del **lado derecho** de la conversación inicial: "vas a ver cosas que el Excel nunca te pudo dar".

### Entregables

1. **Vista Funnel dedicada** (`/funnel`):
   - Sección "Prospectos activos ahora" con 5 cards de conteos por etapa actual.
   - Funnel grande con 5 etapas, 4 drops, conversiones etapa-a-etapa visibles.
   - PredictionCard si el periodo es "este mes".
   - Insights list con las 5 reglas completas activas (incluida la 3 "prospectos estancados" y la 5 "mejor día").
   - PeriodSwitcher con 4 opciones (7d / 30d / mes / año).
2. **Heatmap calendario** en vista mensual.
3. **Followup grid** en vista mensual.
4. **Insights ampliados:** las 5 reglas hardcodeadas funcionando con datos reales.
5. **getBestDayOfWeek** query y su insight asociado.
6. **Animaciones (`framer-motion`):**
   - Fade-up en cascada de KPI cards al cargar (50ms stagger).
   - Llenado horizontal de barras del funnel al entrar a vista funnel (600ms ease-out).
   - Sparklines: stroke-dasharray animado.
   - **No animar transiciones de ruta todavía** (Sprint 3 si Alex lo pide).
7. **getMonthlyHeatmap, getFollowupGrid, buildInsights completo, getBestDayOfWeek** según doc 05.
8. **Componentes Sprint 2:** `ActiveByStageGrid`, `MonthHeatmap`, `FollowupGrid`.
9. **Tests:**
   - `heatmap.test.ts` (levelFor con percentiles correctos).
   - `insights.test.ts` (cada regla dispara cuando debe y NO dispara cuando no debe).
   - `velocity.test.ts` (aToD = suma cuando todas las partes son no-null).

### Criterios de aceptación

- [ ] `/funnel?period=month` carga datos del mes en curso.
- [ ] Cambiar período en el switcher recarga la URL y los datos.
- [ ] "Prospectos activos ahora" muestra conteos del estado ACTUAL, no del período.
- [ ] El heatmap del mes muestra hasta 5 niveles de intensidad.
- [ ] Hover en celda del heatmap muestra tooltip nativo con fecha y count.
- [ ] El insight "cuello de botella en B→C" SOLO aparece si la conversión actual está <90% del histórico.
- [ ] El insight "prospectos B estancados" SOLO aparece si hay 10+ subscribers en B con `updated_at < NOW() - 48h`.
- [ ] El insight "mejor día" SOLO aparece si el día top tiene multiplier ≥ 1.2.
- [ ] La animación de KPI cards es suave, sin parpadeos, sin layout shifts.
- [ ] El llenado de las barras del funnel ocurre solo en la primera carga, no en re-renders por revalidation.

### Validación con Alex

Reunión de 45 min:

1. Abrir vista Funnel. Preguntar *"¿qué te dice este pipeline ahora mismo?"*.
2. Cambiar a 7 días. Pedirle que interprete.
3. Mostrar los insights. Preguntar para cada uno *"¿es accionable para ti?"*.
4. Pedirle que vaya a Vista Mensual y mire el heatmap. Preguntar *"¿reconoces tus días más fuertes?"*.
5. Mostrar la grilla de follow-ups. Preguntar *"¿el conteo coincide con lo que ves en ManyChat?"*.
6. **Pregunta final**: *"¿Hay algún insight que querrías que el panel te diera y todavía no te da?"* — apuntar todo para Sprint 3.

### Commits sugeridos

- `feat(dashboard): add dedicated funnel view with active by stage`
- `feat(dashboard): add monthly heatmap and followup grid`
- `feat(dashboard): generate insights from rules`
- `feat(dashboard): add subtle entry animations with framer-motion`

---

## Sprint 3 — Inteligencia

**Duración estimada:** 5–7 días.
**Pre-requisito:** Sprint 2 cerrado. Insights de Alex sobre qué le falta recolectados.

### Objetivo de producto

El panel se siente "inteligente". Alex empieza a tomar decisiones basadas en cohortes y tendencias, no en feelings. Opcionalmente activa el tema Wow para una experiencia más estética. La sensación es: *"no quiero volver al Excel"*.

### Entregables

1. **Vista Cohortes (`/cohorts`):**
   - Tabla de cohortes semanales: cada fila = semana de inicio (A), columnas = % que llegó a MS, B, C, D **a los 1d, 3d, 7d, 14d, 30d** del inicio.
   - Color heatmap en las celdas (más claro = peor, más oscuro teal = mejor).
   - PeriodSwitcher para elegir trimestre o año.
2. **Vista Velocidad expandida (`/velocity`):**
   - Gráfico de líneas (SVG inline) mostrando A→D promedio mes a mes.
   - Breakdown por etapa: 4 líneas (A→MS, MS→B, B→C, C→D) en chart pequeño.
   - Top 5 subscribers más rápidos del último mes (lista pequeña).
3. **Tema "Wow" opcional (toggle en settings o en sidebar):**
   - Glassmorphism en KPI cards (`backdrop-filter: blur(8px)` + bg semitransparente).
   - Gradientes teal→cyan en los números grandes.
   - Micro-bounce en delta al cargar.
   - Toggle persiste en `localStorage`.
4. **Predicciones mejoradas:**
   - Predicción del año (no solo del mes).
   - Predicción con intervalo de confianza simple (rango bajo–alto).
5. **Drawer lateral de subscriber** (opcional si tiempo):
   - Click en una métrica que represente subscribers → drawer con lista.
   - Click en un subscriber → drawer con histórico de transiciones, follow-ups enviados, conversación última.

### Lo que NO entra en Sprint 3

- Kanban de prospectos (`/prospects` Sprint 3 sigue siendo placeholder).
- SSO con SPA admin.
- Multi-tenant switcher real (mientras solo haya QC).
- Mobile responsive.
- Exportar a CSV/Excel.

Todo eso queda documentado en doc 13.

### Criterios de aceptación

- [ ] Tabla de cohortes muestra al menos 12 semanas si hay datos.
- [ ] Celdas vacías o sin datos: `—`, nunca 0%.
- [ ] El toggle de tema Wow alterna estilos sin recargar.
- [ ] Predicción anual muestra valor + rango (e.g. "~85–105 bookings").
- [ ] `/velocity` carga sin errores aunque algunas etapas no tengan datos.

### Validación con Alex

Reunión de 1 hora:

1. Vista cohortes: explicar el concepto. Preguntar *"¿esto te ayuda a saber cuándo se enfrían tus leads?"*.
2. Vista velocidad: mostrar la tendencia mes a mes. *"¿ves alguna correlación con cambios que has hecho en tu prospección?"*.
3. Activar el tema Wow. Preguntar *"¿prefieres este look o el original?"*.
4. **Pregunta final**: *"Si te pidiera que vuelvas al Excel ahora, ¿qué te molestaría más?"* — la respuesta a esta pregunta es la métrica de éxito del proyecto.

### Commits sugeridos

- `feat(dashboard): add weekly cohort retention view`
- `feat(dashboard): expand velocity analytics with trend chart`
- `feat(dashboard): add optional wow theme with glassmorphism`
- `feat(dashboard): improve predictions with confidence interval`

---

## Tabla resumen de entregables por sprint

| Área | S0 | S1 | S2 | S3 |
|---|:---:|:---:|:---:|:---:|
| App boot, auth, sidebar | ✅ | | | |
| Conexión BD verificada | ✅ | | | |
| Vista anual (matriz + KPIs + funnel) | | ✅ | | |
| Vista mensual (KPIs + ratios + velocity + prediction) | | ✅ | | |
| Vista funnel (active + funnel + insights básicos) | | | ✅ | |
| Heatmap mensual | | | ✅ | |
| Follow-up grid mensual | | | ✅ | |
| Insights completos (5 reglas) | | | ✅ | |
| Animaciones suaves | | | ✅ | |
| Vista cohortes | | | | ✅ |
| Vista velocidad expandida | | | | ✅ |
| Tema Wow opcional | | | | ✅ |
| Predicción anual con rango | | | | ✅ |

## Cómo medir si un sprint está realmente cerrado

Tres criterios obligatorios:

1. **Técnico:** todos los DoD del sprint marcados, tests pasan, lint pasa, typecheck pasa.
2. **Operacional:** desplegado en `dashboard.revolicord.com` y accesible para Alex.
3. **Producto:** validación con Alex completada según el guion de cada sprint.

Si los 3 no se cumplen, el sprint NO está cerrado, aunque el código esté mergeado.

Fin del documento 10.
