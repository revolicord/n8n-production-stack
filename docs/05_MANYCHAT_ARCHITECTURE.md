# 05 — ManyChat Architecture
## Cómo Funciona ManyChat en Este Sistema

---

> **Propósito:** Documentar el rol específico de ManyChat, sus flujos, triggers, límites y cómo se comunica con el resto del sistema (especialmente n8n y el agente).

---

## 1. Rol de ManyChat en el Sistema

ManyChat es la **capa de captura y entrega de mensajes** en Instagram. Es lo que está más pegado al canal porque:

- Está oficialmente integrado con la API de mensajería de Meta.
- Permite capturar triggers (comentarios, palabras clave, nuevos seguidores) que la API directa no facilita.
- Maneja las restricciones de la ventana de 24h de Meta.

**Lo que ManyChat NO hace en este sistema:**
- No decide qué responder (eso lo decide el agente).
- No mantiene la lógica de negocio (eso vive en n8n + servidor).
- No prospecta perfiles (eso lo sigue haciendo Alex manualmente).

---

## 2. Triggers Configurados

| Trigger | Origen | Acción |
|---|---|---|
| Nuevo seguidor | Instagram | _[completar]_ |
| Comentario en post/reel | Instagram | _[completar]_ |
| Comentario en historia | Instagram | _[completar]_ |
| DM inbound | Instagram | _[completar]_ |
| Palabra clave específica | DM | _[completar]_ |

> ❓ Por validar con Alex: ¿Cuáles son las palabras clave exactas configuradas?

---

## 3. Flujos Activos en ManyChat

> 🚧 Pendiente: listar los flujos automatizados que ya existen.

| Flow | Trigger | Qué hace | Estado |
|---|---|---|---|
| _[completar]_ | _[completar]_ | _[completar]_ | _[activo / paused]_ |

---

## 4. Comunicación con n8n

### 4.1 Webhooks que ManyChat envía a n8n
> 🚧 Pendiente: documentar cada webhook con su payload.

| Evento | Endpoint n8n | Payload |
|---|---|---|
| _[completar]_ | _[completar]_ | _[completar]_ |

### 4.2 Llamadas que n8n hace a ManyChat
> 🚧 Pendiente: documentar las APIs de ManyChat que se usan.

| Acción | API ManyChat | Cuándo se llama |
|---|---|---|
| Enviar mensaje | _[completar]_ | _[completar]_ |
| Enviar media | _[completar]_ | _[completar]_ |
| Actualizar campo de usuario | _[completar]_ | _[completar]_ |

---

## 5. Custom User Fields en ManyChat

> ManyChat permite guardar datos por suscriptor. Documentar qué campos se usan.

| Campo | Tipo | Para qué se usa |
|---|---|---|
| _[completar]_ | _[completar]_ | _[completar]_ |

---

## 6. Limitaciones de ManyChat

- ❌ No puede iniciar conversaciones con perfiles que no han interactuado primero (limitación de Meta).
- ❌ No puede prospectar (buscar perfiles a contactar) — eso lo hace Alex manualmente.
- ❌ Ventana de 24h: después de 24h sin respuesta del lead, no se pueden enviar mensajes promocionales libres.
- _[completar otros límites identificados]_

---

## 7. Gaps y Preguntas Abiertas

- [ ] Listar todos los flujos actualmente activos
- [ ] Documentar cada webhook saliente con payload exacto
- [ ] Confirmar plan/cuenta de ManyChat (Pro, límites)
- [ ] Confirmar cómo se autentican las llamadas n8n → ManyChat
