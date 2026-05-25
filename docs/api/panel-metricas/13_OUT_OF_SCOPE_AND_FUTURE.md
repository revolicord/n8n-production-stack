# 13 — Fuera de scope y deuda técnica futura

> Este doc existe para que Claude Code **no improvise** funcionalidades que no le pedimos. Cada item aquí está documentado como "no se hace en este paquete" y, cuando aplica, con guía de cómo se haría en el futuro.

## Filosofía

**Lo que no está aquí, no se construye.** Si durante implementación Claude Code identifica algo "que sería bueno tener", el camino correcto es abrir issue y dejar la decisión humana. Inventar features fuera de spec rompe la confianza del proyecto y consume tiempo que no estaba presupuestado.

---

## Categoría A — Fuera de scope total (no se construye en Sprint 0–3)

### A.1. Pipeline Kanban de prospectos

**Qué es:** una vista `/prospects` con tarjetas drag-and-drop entre columnas A → MS → B → C → D, mostrando cada subscriber como una card con su info, foto de IG, fecha de última actividad.

**Por qué no aquí:** es un mini-CRM completo dentro del panel. Requiere:

- Mutaciones a la BD (cambiar `lead_stages.current_stage` desde drag).
- Server Actions o endpoints POST.
- Confirmación de cambios (porque mover un subscriber atrás puede romper analítica).
- Filtros, search, paginación virtual de listas largas.
- Foto de IG (requiere fetch a Instagram Graph API o caché previo).

Es un sprint entero por sí solo. Lo hacemos cuando el panel analítico esté estable y Alex lo pida explícitamente.

**Mientras tanto:** `/prospects` muestra placeholder "Próximamente" como definido en doc 06.

### A.2. SSO entre panel y SPA admin

**Qué es:** que Alex haga login una vez y acceda tanto a `dashboard.revolicord.com` como al SPA admin en `api.revolicord.com/dashboard` sin volver a autenticarse.

**Por qué no aquí:** son dos apps independientes, con secretos distintos (`PANEL_JWT_SECRET` vs `ADMIN_JWT_SECRET`). Unificarlas implica:

- Decidir cuál es el authoritative auth (probablemente la API Fastify).
- Compartir cookies a nivel de dominio raíz (`.revolicord.com`).
- Migrar el panel para verificar JWT del SPA admin.
- O bien introducir un OAuth/SSO real (Authelia, Keycloak), lo cual es overkill para 1 usuario.

Decisión del usuario, explícita: *"después vemos cómo unificar"*. Vivir con dos passwords distintos durante un tiempo es aceptable.

**Cómo se haría en el futuro:**

- Opción 1 (más simple): cookie compartida a nivel `.revolicord.com`. El SPA admin firma el JWT, el panel lo verifica (mismo secret). Riesgo: si cambian un secret, rompen ambos.
- Opción 2 (más limpia): un servicio de auth dedicado (e.g. `auth.revolicord.com`) que emite tokens consumibles por ambos. Más infraestructura.

### A.3. Multi-tenant switcher real

**Qué es:** un selector en el sidebar que permita a un admin de Revolicord cambiar entre tenants (cuando haya más de uno).

**Por qué no aquí:** hoy solo existe QC. El `TenantSelect` se renderiza como texto plano si `tenants.length === 1` (ver doc 08). Cuando llegue el segundo tenant:

- Decidir si el panel sirve a Alex (1 tenant) o a Revolicord (N tenants).
- Si es para Revolicord: implementar selector real + cookie `tenant_id` + validar permisos.
- Si Alex de QC nunca debe ver datos de otros tenants: separar despliegues, no UI.

**Documentado para futuro:** no hardcodear el UUID de QC en ningún lado. Las queries siempre filtran por el tenantId que devuelve `getActiveTenant()`. El día que se añada un selector, solo cambia esa función.

### A.4. Mobile responsive

**Qué es:** que el panel se vea bien en iPhone/iPad y similares.

**Por qué no aquí:** el panel está pensado para sesiones de análisis en desktop. Alex consulta el Excel desde su PC. Densidad informativa requerida (matriz 9×13, KPIs en grid de 5) no funciona en 375px de ancho.

Mínimo soportado: **1280px de ancho**. En anchos menores, render se rompe esperablemente.

**Cómo se haría:** redesign por vista. Probablemente acordeones para la matriz, cards apiladas para KPIs, navegación inferior fija. Es un sprint dedicado.

### A.5. Light mode / temas custom

**Qué es:** alternar a tema claro o permitir temas personalizados.

**Por qué no aquí:** todo el SPA admin existente es dark, Alex es dark, los mockups son dark. Light mode es esfuerzo significativo y nadie lo pidió.

El "tema Wow" del Sprint 3 es una variación cosmética del dark, NO un light mode.

### A.6. Exportar datos a CSV/Excel

**Qué es:** botón "Exportar" que descarga la matriz, el funnel, los followups, etc.

**Por qué no aquí:** una de las restricciones psicológicas del proyecto era *"el Excel no vuelve"*. Si añadimos export a Excel desde el día 1, le damos a Alex una salida de emergencia que vuelve al Excel cuando algo le incomode. Esto contradice la promesa.

**Cuándo añadirlo:** cuando Alex lleve 2+ meses usando el panel a diario sin abrir el Excel. Entonces el riesgo desaparece y el export es solo conveniencia.

### A.7. Notificaciones push o por email

**Qué es:** alertas tipo *"hoy llevas 0 booked, te falta 1 para tu meta"*.

**Por qué no aquí:** requiere:

- Definir thresholds (qué dispara una alerta).
- Canales (email vía SES/Postmark/Resend; push vía web push API).
- Preferencias por usuario.
- Lógica de scheduling (cron en n8n o worker dedicado).

Es un mini-producto. No entra.

### A.8. Audit log de quién hizo qué

**Qué es:** log persistente de accesos al panel, qué vistas se consultaron, etc.

**Por qué no aquí:** Alex es el único usuario. Audit log para una persona es over-engineering. Logs a stdout en producción son suficientes para debug.

### A.9. Rate limiting de auth

**Qué es:** bloquear `/api/auth/login` tras N intentos fallidos en una ventana.

**Por qué no aquí:** el endpoint vive detrás de Cloudflare/Traefik. Si llega a ser problema, Cloudflare rate limiting cubre el caso. Implementarlo en Node añade dependencias (Redis, ioredis, etc.) sin justificación actual.

**Cómo se haría en el futuro:** middleware con `@upstash/ratelimit` o equivalente. Ventana de 5 intentos / 5 minutos por IP. Lockout temporal.

### A.10. MFA / 2FA

**Qué es:** además del password, un código TOTP o SMS.

**Por qué no aquí:** ratio coste-beneficio. 1 usuario, datos no sensibles (analytics, no PII de clientes finales). Si Alex pierde acceso, reset manual del password.

---

## Categoría B — Aplazado a sprints posteriores (sí se construye, pero después)

### B.1. WebSockets / actualizaciones en vivo

**Sprint 1–3 usan polling implícito** vía `revalidate: 30` de Next.js. Datos refrescan cada 30 segundos en background.

**Cuándo migrar a WebSockets:** si Alex pide "ver los bookings entrar en tiempo real durante una campaña". Implementación:

- Servicio `socket.io` en la API Fastify (probablemente ya hay infraestructura).
- Cliente en el panel suscrito a eventos del tenant.
- Updates incrementales sin re-render completo.

### B.2. Cohort retention curves

**Sprint 3 implementa cohort table semanal.** Una evolución natural es:

- Gráfico de curvas: cada semana es una línea, eje X = días desde inicio, eje Y = % activos.
- Comparación de cohortes (¿la cohorte de marzo retiene mejor que la de febrero?).

Queda fuera de Sprint 3 si el tiempo aprieta. Se documenta como nice-to-have post Sprint 3.

### B.3. A/B testing de follow-ups

**Qué sería:** ver la conversión por plantilla de follow-up. *"La plantilla 2B-v3 convierte 23%; la 2B-v2 convierte 14%."*

**Pre-requisito:** que el modelo de datos guarde la `template_id` exacta que se envió (ya lo hace `lead_followup_log.template_id`). Por tanto **es posible**, solo no está priorizado.

**Cuándo:** cuando Alex haya iterado al menos 5 versiones de follow-ups y quiera saber cuáles van mejor. Probablemente Sprint 4 o un proyecto pequeño aparte.

### B.4. Búsqueda global de subscribers

**Qué sería:** una caja de search arriba del sidebar que permita buscar un subscriber por `@username` y abrir su detalle.

**Pre-requisito:** drawer de subscriber detail (planificado para Sprint 3 si tiempo).

**Cuándo:** cuando exista el drawer y haya 1000+ subscribers (volumen donde search agrega valor).

### B.5. Exports y reports PDF programados

**Qué sería:** generación automática de un PDF mensual con resumen del funnel y enviarlo por email al inicio de cada mes.

**Cuándo:** después de Sprint 3, si Alex lo pide. Stack típico: Puppeteer en n8n, plantilla HTML específica, n8n cron schedule.

---

## Categoría C — Deuda técnica reconocida (a saldar cuando duela)

### C.1. Queries naive con N round-trips

**`getMonthlySeries`** ejecuta 48 queries (12 meses × 4 etapas) en secuencia o paralelo limitado. En BD local con seed pequeño esto es <200ms. En producción con datos crecientes puede subir a 1-2s.

**Saldar cuando:** la vista anual tarda >2s consistentemente.

**Cómo:** una sola query SQL agregada:

```sql
SELECT
  EXTRACT(MONTH FROM first_seen_at)::int AS month,
  COUNT(*) AS a_count,
  -- joins/subqueries para ms, b, c, d
FROM api.subscribers
WHERE tenant_id = $1 AND first_seen_at >= $2 AND first_seen_at < $3
GROUP BY month;
```

Refactorizar `timeseries.ts` para usar la query agregada manteniendo la misma firma pública.

### C.2. Cliente Drizzle separado del de la API

**Hoy:** `apps/dashboard/src/lib/db.ts` crea su propio pool de Postgres. Esto duplica conexiones (pool de la API + pool del dashboard).

**Saldar cuando:** Postgres alcance >70% de utilización de conexiones máximas.

**Cómo:** introducir un PgBouncer entre ambas apps y Postgres, ambas apuntan a PgBouncer. Cambio transparente para el código.

### C.3. Sin métricas/observability del propio panel

**Hoy:** logs a stdout, sin Prometheus, sin Sentry, sin Grafana.

**Saldar cuando:** algo falle en producción y no podamos depurar sin SSH al servidor.

**Cómo:** integrar Sentry para errores (DSN como env var). Métricas Prometheus si la API ya las tiene; si no, dejar para luego.

### C.4. Sin tests e2e automatizados

**Hoy:** tests son unitarios + smoke manual.

**Saldar cuando:** el panel tenga 5+ vistas y cada PR rompa algo en una vista distinta.

**Cómo:** Playwright headless en CI. Empezar por el smoke flow (login → vista anual → click mes → vista mes). 1 hora de inversión inicial; 10 minutos por PR.

### C.5. Variables de entorno sin validación en boot

**Hoy:** si falta `PANEL_JWT_SECRET`, el panel arranca y el primer login falla.

**Saldar cuando:** suceda un deploy con env mal configurada.

**Cómo:** un `src/lib/env.ts` con zod que valide al boot:

```ts
const Env = z.object({
  DATABASE_URL: z.string().url(),
  PANEL_PASSWORD: z.string().min(8),
  PANEL_JWT_SECRET: z.string().length(64),
});
export const env = Env.parse(process.env);
```

Y crashear loud si falta algo.

### C.6. No hay CI dedicado para `apps/dashboard/`

**Hoy:** deploy manual con SSH y `docker service update`.

**Saldar cuando:** haya 2+ desarrolladores tocando el panel.

**Cómo:** el workflow descrito en doc 11 sección "Paso 10".

### C.7. Tema Wow vive como variant CSS, no como theming real

**Hoy (Sprint 3):** un toggle que aplica clases adicionales. Si se quiere un tercer tema, hay que duplicar CSS.

**Saldar cuando:** se quieran 3+ temas.

**Cómo:** sistema de tokens semánticos en CSS variables (`--surface-primary`, `--accent`, etc.) y temas que solo reasignan los tokens base.

---

## Categoría D — Decisiones revisitables

Estas son decisiones tomadas para Sprint 0–3 que pueden necesitar revisión más adelante.

| Decisión | Cuándo revisar | Trigger para cambiar |
|---|---|---|
| Drizzle directo desde Next.js (sin API REST intermedia) | Sprint 5+ | Si el panel necesita actions de escritura complejas (e.g. el Kanban) → entonces probablemente vale endpoints REST en Fastify. |
| Subdominio separado vs path en `api.revolicord.com` | Cuando se haga SSO | Si SSO es vía cookies de dominio raíz, mantener subdominio. Si es vía path-based routing, considerar mover. |
| Auth simple sin usuarios | Cuando haya 2+ usuarios reales | Migrar a tabla `users` con roles + sesiones por usuario. |
| Sin caching agresivo (revalidate 30s) | Si la latencia se vuelve perceptible | Considerar materialized views Postgres o Redis cache delante. |
| Sin Sentry/observability | Tras primer outage | Añadir Sentry + healthcheck endpoint. |

---

## Cosas que NO son ni serán parte del panel (definitivo)

- ❌ Edición de follow-up templates. **Vive en el SPA admin.**
- ❌ Subida de memes / cambiar imágenes de templates. **Vive en el SPA admin.**
- ❌ Configuración de delays entre follow-ups. **Vive en el SPA admin.**
- ❌ Gestión de Cierres y Objeciones (agent_resources). **Vive en el SPA admin.**
- ❌ Onboarding de nuevos tenants. **Es operación manual de Revolicord (no UI).**
- ❌ Pagos / facturación. **Negocio de Revolicord, fuera del producto.**

---

## Navegación entre paneles (UX que SÍ implementa Sprint 1)

Hoy hay dos URLs:

- **Panel analítico** (este): `https://dashboard.revolicord.com`
- **SPA admin** (existente): `https://api.revolicord.com/dashboard`

El sidebar del panel tiene un item "Settings" que abre el SPA admin **en pestaña nueva**:

```tsx
<SidebarItem
  href="https://api.revolicord.com/dashboard"
  external
  icon={IconSettings}
  label="Settings"
/>
```

Esto es **suficiente** mientras la auth no esté unificada. Alex sabe que "para ver analítica" usa uno; "para cambiar follow-ups" usa el otro. Si lo encuentra molesto, eso justifica priorizar SSO (Categoría A.2).

---

## Resumen para Claude Code

Si durante la implementación aparece la tentación de añadir algo, este es el árbol de decisión:

```
¿Está pedido en algún sprint (10_SPRINT_PLAN.md)?
├─ Sí → hacer
└─ No
   ├─ ¿Está en este doc (13) como Categoría A o B?
   │  ├─ Sí → NO hacer, está fuera de scope
   │  └─ No
   │     └─ ¿Está en este doc como Categoría C (deuda) o D (revisitable)?
   │        ├─ Sí → NO hacer, anotar como follow-up
   │        └─ No → abrir issue antes de actuar, NO improvisar
```

Fin del documento 13. Fin del paquete de documentación.
