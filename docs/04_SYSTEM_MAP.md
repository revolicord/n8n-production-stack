# 04 — System Map
## Arquitectura Técnica Completa y Ownership

---

> **Propósito:** Mapear todos los componentes del sistema, cómo se conectan y quién es responsable de cada uno. Es la "foto técnica" del proyecto.

---

## 1. Diagrama de Alto Nivel

```
                    ┌───────────────────────┐
                    │   Instagram (Meta)    │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │      ManyChat         │  ← Captura triggers, envía mensajes
                    └───────────┬───────────┘
                                │ webhooks
                    ┌───────────▼───────────┐
                    │         n8n           │  ← Orquestador de flujos
                    └─────┬─────────────┬───┘
                          │             │
              ┌───────────▼──┐      ┌──▼────────────┐
              │ Servidor IA  │      │  Close CRM    │
              │ (Agente)     │      │ (Leads/Stage) │
              └──────────────┘      └───────────────┘
```

> 🚧 Pendiente: refinar el diagrama con los flujos exactos de datos.

---

## 2. Componentes

### 2.1 Instagram
- **Rol:** Canal de comunicación con el lead
- **Owner:** Meta (no controlable directamente)
- **Restricciones:** Política de mensajería 24h, anti-spam, riesgo de ban

### 2.2 ManyChat
- **Rol:** _[completar — captura triggers, envía mensajes, mantiene la conversación]_
- **Owner:** _[completar]_
- **Plan / cuenta:** _[completar]_
- **Ver detalle:** `05_MANYCHAT_ARCHITECTURE.md`

### 2.3 n8n
- **Rol:** Orquestador — recibe webhooks de ManyChat, llama al agente, actualiza Close
- **Owner:** _[completar]_
- **Hosting:** _[completar — self-hosted, cloud]_
- **Flujos principales:** _[completar]_

### 2.4 Servidor Propio (Agente IA)
- **Rol:** Ejecuta el modelo de IA, mantiene contexto conversacional, decide siguiente acción
- **Owner:** _[completar]_
- **Stack:** _[completar — lenguaje, framework, modelo IA usado]_
- **Endpoints expuestos:** _[completar]_

### 2.5 Close CRM
- **Rol:** Almacenamiento de leads, estados del pipeline, historial
- **Owner:** _[completar]_
- **Campos personalizados que usa el agente:** _[completar]_

### 2.6 Calendly (u otra herramienta de agendado)
- **Rol:** Agendado de llamadas con el closer
- **Owner:** _[completar]_
- **Integración con Close:** _[completar]_

---

## 3. Flujos de Datos Clave

### 3.1 Lead nuevo entra al sistema
```
IG → ManyChat → n8n → [agente decide acción] → ManyChat → IG
                  └→ Close (crear lead)
```

### 3.2 Lead da 👍 al video
> 🚧 Pendiente

### 3.3 Lead agenda llamada
> 🚧 Pendiente

---

## 4. Ownership Matrix

| Componente | Owner Técnico | Owner de Negocio |
|---|---|---|
| ManyChat | _[completar]_ | Alex |
| n8n | _[completar]_ | _[completar]_ |
| Servidor IA | _[completar]_ | _[completar]_ |
| Close CRM | _[completar]_ | Alex |
| Assets multimedia | _[completar]_ | Alex |
| Copy / prompts | _[completar]_ | Alex (validación) |

---

## 5. Gaps y Preguntas Abiertas

- [ ] Confirmar quién es owner técnico de cada pieza
- [ ] Confirmar hosting y costos de cada servicio
- [ ] Documentar credenciales y accesos (en un vault separado)
- [ ] Confirmar si hay ambientes (dev/staging/prod) o solo producción
