# 01 — Contexto y objetivo del proyecto

## Quién es Alex

Alex es el operador principal de **Quantum Creators (QC)**, un cliente de Revolicord (la agencia). Es **el único tenant activo hoy** en el sistema, pero la arquitectura es multi-tenant porque vendrán más clientes con el mismo modelo.

Alex hace prospección por DM en Instagram a gran escala. Su trabajo cotidiano se mide en **un funnel de cinco etapas**:

| Etapa | Letra | Significado | Cómo ocurre hoy |
|---|---|---|---|
| Initiated | **A** | Cuentas a las que el agente IA escribe primero | n8n + ManyChat envían DM inicial |
| Media seen | **MS** | El prospecto vio el contenido enviado (story view u otro) | n8n registra en `lead_content_sent` |
| Engaged | **B** | El prospecto respondió, hay conversación | n8n promociona a etapa B en `lead_stages` |
| Calendly'd | **C** | El agente le envió el link de Calendly | transición C registrada en `stage_transitions` |
| Booked | **D** | Reservó la llamada | transición D registrada |

## El Excel que vamos a reemplazar

Durante más de un año, Alex ha trackeado este funnel **a mano en un Excel** llamado `DM_Sorcery_Tracker_Template.xlsx`. El Excel tiene 13 hojas:

- **`Dashboard`**: matriz de 12 meses × 16 métricas (conteos A, MS, B, C, D + ratios MSR, PRR, CSR, ABR, A→MS, MS→B, B→C, C→D, Requests, Accepts, CAR%).
- **`Jan` ... `Dec`**: una hoja por mes. Cada hoja contiene listas de prospectos en cada etapa con sus nombres, profile links de Instagram, fechas y hasta 8 follow-ups manuales por etapa (`1B`, `2B`, ... `8B` / `1C`, ..., `8C`).

Alex llena este Excel manualmente todos los días.

## La conversación que llevó aquí (importante para no romper la relación)

Alex **no quería un dashboard**. Estaba cómodo con su Excel. Hubo que convencerlo de que con un panel iba a tener más analítica y más control. La promesa fue:

> *"Vas a tener todo lo del Excel, pero vivo, y además vas a ver cosas que el Excel nunca te pudo dar."*

Esto crea **dos restricciones psicológicas** que cualquier decisión técnica debe respetar:

1. **Reconocimiento primero, revelación después.** Lo primero que Alex vea en el panel debe ser inmediatamente reconocible como "su tracker pero mejor". Si el día 1 ve algo que no le suena, su cerebro registra "esto no es lo que me prometieron" aunque sea técnicamente superior.
2. **El Excel no vuelve.** Cuando entreguemos el panel, Alex deja de llenar el Excel. **Reemplazo completo**, no convivencia. Esto significa: cero datos pendientes de Alex, todo se rellena automáticamente desde Instagram → ManyChat → API → Postgres.

## Por qué el panel ahora es posible (no era posible hace meses)

El stack `n8n-production-stack` ya tiene **todo** lo necesario en producción:

- Schema multi-tenant en Postgres (schema `api`).
- Detección automática de etapas (n8n promueve A → MS → B → C → D según interacciones).
- Log inmutable de transiciones en `stage_transitions`.
- Log inmutable de follow-ups enviados en `lead_followup_log`.
- Multi-tenant con `tenants` table.
- Seed de Quantum Creators ya aplicado (`seed_qc_funnel.sql`).
- ManyChat → Fastify webhook → n8n → Postgres ya está conectado y funcionando.

**Implicación:** el panel **no escribe** datos. Solo **lee** del estado que la API + n8n ya alimentan. Esto es lo que hace que sea factible en pocos sprints.

## Quién va a usar el panel (hoy y mañana)

- **Hoy:** Alex (un único usuario, un único tenant QC). El panel es **single-user, single-tenant en uso**, pero **multi-tenant en código** (todos los queries filtran por `tenant_id` aunque hoy solo haya uno).
- **Mañana:** otros operadores que la agencia onboardee. La cuenta de Alex no debe asumir que es el único.

## Quién va a configurar el sistema (no entra aquí)

El SPA admin de `apps/api/public/` ya cubre la **configuración** que Alex necesita:

- Editar textos de follow-ups.
- Subir/cambiar imágenes (memes) de cada follow-up.
- Ajustar `delay_minutes` entre follow-ups.
- Gestionar "Cierres" y "Objeciones" (agent_resources).

**Este panel analítico NO duplica nada de esto.** Solo lee y muestra. La navegación entre los dos paneles se resuelve más adelante (ver doc 13).

## Qué entrega "wow" frente al Excel (la promesa que hay que cumplir)

Lo que el Excel nunca le pudo dar y este panel sí:

1. **Datos en tiempo real** (no rellenar a mano).
2. **Sparklines** de 12 meses al lado de cada KPI mostrando tendencia.
3. **Heatmap calendario** de actividad por día.
4. **Velocidad del funnel:** A → D promedio en días.
5. **Predicción simple:** "a este ritmo cerrarás ~X bookings este mes".
6. **Detección de cuellos de botella:** "B→C cayó 12% vs el promedio".
7. **Insights generados:** "los iniciados en martes convierten 1.4x más a B".
8. **Cohortes:** "los iniciados en la semana N, cómo convirtieron a lo largo de los días siguientes".
9. **Navegación instantánea entre meses, año, funnel** sin abrir hojas distintas.

## Decisiones de producto ya tomadas (no se discuten en implementación)

| Decisión | Valor | Por qué |
|---|---|---|
| **Subdominio** | `dashboard.revolicord.com` | Confirmado por usuario |
| **Stack frontend** | Next.js 15 + React 19 + TypeScript | Server Components encajan con queries Drizzle directas |
| **Acceso a Postgres** | Drizzle directo desde Next.js (reusa `packages/db`) | Menos código, menos endpoints, menos round-trips |
| **Auth** | Independiente del SPA admin (cookie httpOnly) | Decisión del usuario: "el SPA admin tiene login propio; el panel puede tener su propia auth más simple" |
| **Tema visual base** | Idéntico al SPA admin (dark + teal) | Continuidad visual gana frente a réplica del Excel |
| **Tema "Wow"** | Diferido a Sprint 3 (toggle opcional) | No es necesario para que Alex valide |
| **Migraciones nuevas de BD** | Ninguna | Schema actual ya tiene todo |
| **Pipeline Kanban de prospectos** | Fuera de scope | Sprint posterior, documento aparte |
| **SSO entre panel y SPA admin** | Fuera de scope | "Después vemos cómo unificar" (decisión del usuario) |

## Definición de éxito del proyecto

Al cierre del Sprint 1, Alex debe poder decir:
> *"Es el Excel que siempre quise."*

Al cierre del Sprint 2, Alex debe decir:
> *"No puedo creer que esto antes me costaba dos horas al día."*

Al cierre del Sprint 3, Alex no debería poder volver al Excel aunque pudiera.

Fin del documento 01.
