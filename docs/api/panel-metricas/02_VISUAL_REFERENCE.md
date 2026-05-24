# 02 — Referencia visual y sistema de diseño

> Este documento es la **fuente de verdad visual**. Los mockups (`mockups/*.html`) son su materialización. Si hay un conflicto entre lo que dice este doc y lo que pinta el mockup, gana el doc — pero hay que abrir issue.

## Filosofía visual

El panel hereda la **lingua franca visual** del SPA admin existente (`apps/api/public/index.html` + `app.js`). Razón: Alex ya está acostumbrado a ese look (dark + teal). Cualquier desviación cuesta confianza el día 1.

Tres principios:

1. **Plano, no neón.** Nada de gradientes pesados, glow, drop-shadows decorativos. La única excepción es el gradiente del relleno de las barras del funnel (de teal oscuro a teal medio, horizontal).
2. **Una sola familia tipográfica** (system-ui). Sin fuentes display especiales en Sprint 1.
3. **Densidad informativa controlada.** Mejor mostrar la mitad bien que el doble apretado. Padding generoso entre secciones.

## Paleta exacta (hex, NO CSS variables custom)

Estas son las constantes que deben vivir en `tailwind.config.ts` como `theme.extend.colors.qc`:

```ts
// apps/dashboard/tailwind.config.ts
theme: {
  extend: {
    colors: {
      qc: {
        // backgrounds
        bg:          '#0d0d0d',  // app background
        surface:     '#111',     // panels, cards
        surface2:    '#0a0a0a',  // nested elements (track de barras, cells del heatmap base)
        // borders
        border:      '#1f2937',  // borders por defecto
        borderHover: '#374151',  // border on hover
        // text
        textPrimary:   '#ffffff',  // títulos
        textBody:      '#d1d5db',  // texto cuerpo
        textMuted:     '#9ca3af',  // labels secundarios
        textSubtle:    '#6b7280',  // hints, captions
        textFaint:     '#4b5563',  // separadores de sección, decorativos
        // teal (accent principal — heredado del SPA admin)
        teal50:        '#5dcaa5',  // texto teal claro (también usado en clases tailwind teal-400)
        teal500:       '#14b8a6',  // teal medio, focus rings, hover
        teal700:       '#0f6e56',  // teal oscuro, fills sólidos
        // semantic
        success:       '#5dcaa5',  // delta positivo
        danger:        '#f87171',  // delta negativo, drop %
        warning:       '#fbbf24',  // insights de alerta
        info:          '#60a5fa',  // insights informativos
        ai:            '#c084fc',  // insights de tipo "predicción IA"
      },
    },
  },
},
```

**Importante:** estos hex valores SON los del SPA admin existente. Si en algún momento alguien dice "podríamos cambiarlo a otra paleta", la respuesta es **no en este paquete**.

## Tipografía

```ts
fontFamily: {
  sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
}
```

**Sin Google Fonts, sin Inter, sin Geist en Sprint 1.** El SPA admin no las usa, así que cargarlas crearía inconsistencia.

Escala de tamaños (todos px o tailwind defaults):

| Uso | Tamaño | Weight | Color |
|---|---|---|---|
| Título de vista (h1) | 18px | 500 | `text-qc-textPrimary` |
| Sección dentro de vista | 12–13px uppercase | 500 | `text-qc-textBody` |
| KPI numérico grande | 22–24px | 500 | `text-qc-textPrimary` |
| KPI label | 10–11px uppercase | 500 | `text-qc-textSubtle` |
| Body | 11.5–12.5px | 400 | `text-qc-textBody` |
| Caption / hint | 10–10.5px | 400 | `text-qc-textSubtle` |
| Sidebar nav item | 12.5px | 400 (500 si activo) | `text-qc-textMuted` (activo: `text-qc-teal50`) |
| Sidebar section header | 10px uppercase letter-spacing 0.08em | 500 | `text-qc-textFaint` |

**Tracking (letter-spacing):**

- Títulos largos: `tracking-tight` (-0.01em).
- Labels en mayúsculas: `tracking-wider` (0.06em a 0.08em según el caso).

## Espaciado y layout

- **Sidebar fijo:** `w-50` (200px) — ligeramente más estrecho que el SPA admin (224px) porque tenemos más entradas de navegación.
- **Main:** `flex-1 overflow-y-auto p-5` (px-6 py-5).
- **Gap entre secciones verticales:** 18–20px.
- **Gap entre KPI cards:** 8–10px (cards angostas en grid de 5).
- **Padding interno de cards:** 12–16px.

## Border radius

```css
border-radius: 8px;   /* defecto */
border-radius: 6px;   /* elementos pequeños (KPI cells del heatmap, pills) */
border-radius: 999px; /* badges tipo "en vivo" */
```

Cards: **8px** todas. Coherente con SPA admin.

## Borders

Todas son **1px solid** del color `qc.border` (`#1f2937`). No usar 0.5px porque visualmente desaparece en pantallas no-Retina y el SPA admin usa 1px.

Hover en navegación: cambio de color de fondo (`hover:bg-white/3`), NO borders animados.

## Iconografía

Usar **Tabler Icons** vía CDN o instalación local (`@tabler/icons-react`).

**Outline only** — nunca filled. Tamaño:

- Inline en texto: 14–15px.
- En cards medianas (insights, KPIs): 14px.
- Decorativos grandes: 18–20px máximo.

Iconos usados en los mockups (referencia rápida):

| Sección | Icon name |
|---|---|
| Logo del sidebar | `IconChartBar` |
| Vista anual | `IconLayoutDashboard` |
| Vista mensual | `IconCalendarMonth` |
| Funnel | `IconFilter` |
| Prospectos | `IconUsers` |
| Velocidad | `IconClockHour4` |
| Cohortes | `IconChartArcs` |
| Settings | `IconSettings` |
| Heatmap section | `IconFlame` |
| Matriz | `IconTable` |
| KPI delta positivo | `IconTrendingUp` |
| KPI delta negativo | `IconTrendingDown` |
| Insight warning | `IconAlertTriangle` |
| Insight ok | `IconCircleCheck` |
| Insight info | `IconBulb` |
| Insight target | `IconTarget` |
| Insight tiempo | `IconClockHour4` |
| Predicción IA | `IconSparkles` |
| Calendario stats | `IconCalendarStats` |

## Componentes visuales clave

### KPI Card

```
┌──────────────────────┐
│ INITIATED        [A] │  ← label uppercase + letter pill teal
│ 2,847                │  ← número grande
│ ▲ +12% vs 2025       │  ← delta con color semántico
│ ━━━━━━━━━━━━━━━━━━━  │  ← sparkline 12 puntos
└──────────────────────┘
```

- Background: `qc.surface`
- Border: `qc.border`
- Padding: 12px 14px
- El "letter pill" (A, MS, B, C, D) es un badge pequeño:
  - Background: `rgba(13,148,136,0.12)`
  - Color: `qc.teal500`
  - Padding: 2px 6px
  - Border-radius: 4px
  - Font-size: 9.5px

### Sparkline

SVG inline, 140×22 viewBox, `preserveAspectRatio="none"`.

- Línea: stroke `#14b8a6`, stroke-width 1.5px, no fill en la línea misma.
- Opcional fill debajo con gradiente vertical teal→transparente al 30% opacity.
- 12 puntos por sparkline (uno por mes del año en curso).

### Funnel bar

```
A · Initiated     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 2,847    100%
                  ↓ −57% drop · 1,634 perdidos
MS · Media seen   ▓▓▓▓▓▓▓ 1,213                  43%
                  ↓ −60% drop · 726 perdidos
...
```

- Track height: 28px (vista anual) o 36px (vista funnel dedicada)
- Track background: `qc.surface2`
- Fill: `linear-gradient(90deg, #0f6e56 0%, #14b8a6 100%)`
- Width del fill: porcentaje sobre la etapa A (= 100%)
- Texto dentro del fill: blanco 500
- Drop line debajo: 10.5px, color `qc.textSubtle`, el porcentaje en color `qc.danger`

### Heatmap calendario (5 semanas × 7 días = 35 celdas)

```
   L M X J V S D
W1 ▢ ▢ ▢ ▢ ▢ ▢ ▢
W2 ▢ ▢ ▢ ▢ ▢ ▢ ▢
W3 ▢ ▢ ▢ ▢ ▢ ▢ ▢
W4 ▢ ▢ ▢ ▢ ▢ ▢ ▢
W5 ▢ ▢ ▢ ▢ ▢ ▢ ▢
```

5 niveles de intensidad:

| Nivel | Background |
|---|---|
| 0 (sin actividad) | `#1a1a1a` |
| 1 | `rgba(13,148,136,0.20)` |
| 2 | `rgba(13,148,136,0.40)` |
| 3 | `rgba(13,148,136,0.65)` |
| 4 (máxima) | `#14b8a6` |

Cell border-radius: 2px. `aspect-ratio: 1`. Hover: `transform: scale(1.15)`.

### Insight card

```
┌───────────────────────────────────────────┐
│ [icon]  Cuello de botella en B→C           │
│         Tu conversión a Calendly cayó 12%  │
│         Ver follow-ups de Fase B →         │
└───────────────────────────────────────────┘
```

- Container: `qc.surface2`, border `qc.border`, radius 7px, padding 11px 12px.
- Icon container: 24×24 cuadrado redondeado (`rounded-md`), background semitransparente del color del tipo (warn/ok/info/ai).
- Tipos:
  - **Warning** (`qc.warning` / `#fbbf24` + bg `rgba(251,191,36,0.12)`)
  - **OK** (`qc.success` / `#5dcaa5` + bg `rgba(93,202,165,0.12)`)
  - **Info** (`qc.info` / `#60a5fa` + bg `rgba(96,165,250,0.12)`)
  - **AI prediction** (`qc.ai` / `#c084fc` + bg `rgba(192,132,252,0.12)`)
- Título: `qc.textPrimary`, 11.5px, weight 500.
- Body: `qc.textMuted`, 11.5px, line-height 1.5.
- Action link: `qc.teal500`, 10.5px, cursor pointer.

### Prediction card (la "estrella")

Es la única card con tratamiento especial: gradiente sutil teal en el background.

```css
background: linear-gradient(135deg, rgba(13,148,136,0.15) 0%, rgba(13,148,136,0.05) 100%);
border: 1px solid rgba(20,184,166,0.3);
border-radius: 8px;
padding: 16px;
```

Estructura:

- Label uppercase teal con icono `IconSparkles`.
- Número grande (28px, weight 500, blanco).
- Sub-label en `qc.textMuted`.

## Animaciones (Sprint 2+)

**Sprint 1 = sin animaciones.** Solo transitions CSS suaves en hover (150ms).

**Sprint 2 añade:**

- **Fade-up en cascada de las KPI cards al cargar:** delay 0/50/100/150/200 ms con `framer-motion`.
- **Llenado horizontal de las barras del funnel:** `width: 0 → width: X` con `transition: 600ms ease-out`.
- **Sparklines:** draw del path con `stroke-dasharray` animado (de 1000 → 0 en 800ms).
- **Hover en celda de matriz:** además de fondo, ilumina la fila y la columna (cross-highlight).

**Sprint 3 añade (tema "Wow" opcional):**

- Glassmorphism sutil en KPI cards (`backdrop-filter: blur(8px)` + bg semitransparente).
- Gradientes teal→cyan en los números grandes.
- Micro-bounce en el delta del KPI al cargar.

## Estados específicos

### Loading
- KPI cards: shimmer skeleton (gris animado) con `bg: qc.surface`, sin números visibles, height fijo.
- Matriz: filas con celdas vacías color `qc.surface2`.
- Funnel: barras con width 0 + opacidad 0.3.

### Empty (no data for period)
- Texto centrado `qc.textMuted`: "Sin datos para este período."
- NO mostrar números a cero; mostrar guion `—`.

### Error
- Toast rojo abajo derecha (estilo SPA admin): `bg-red-700 text-white`, 14px, 4 segundos.

## Responsive

**Mínimo soportado: 1280px de ancho.** El panel está pensado para desktop. Tablet portrait y móvil están fuera de scope de Sprint 1–3 y se documentan en doc 13.

En ventanas más anchas que 1440px: el grid de KPIs y los grids internos pueden permanecer con su tamaño base; el extra de espacio queda como padding lateral en `main`.

## Decisiones de UX micro-importantes

1. **El sidebar resalta el item activo con border-left de 2px teal**, NO con bg fuerte. Coherente con SPA admin.
2. **El tenant selector está en el sidebar (top)** aunque hoy solo haya 1 tenant. Si solo hay 1, ocultar el `<select>` pero dejar el label "Quantum Creators" visible.
3. **Hover en cells de matriz**: highlight cross (fila + columna en `rgba(20,184,166,0.05)`).
4. **Click en cell de matriz**: navega a `/month/[year]/[monthSlug]` con transición suave (`next/link` + `view-transitions` si está disponible).
5. **Toast de feedback**: idéntico al del SPA admin. Importar la utilidad o reescribirla 1:1.
6. **Cursor pointer** en cualquier elemento clickable. No-clickable mantiene cursor default.

## Lo que NO se hace en Sprint 1

- Dark/light mode toggle. Solo dark.
- Más de 1 idioma. Solo español.
- Mobile responsive.
- Tema Wow (opcional opt-in en Sprint 3).
- Tablas exportables (CSV/Excel). El "paracaídas Excel" se documenta en doc 13.
- Notificaciones push o in-app.

Fin del documento 02.
