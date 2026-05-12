# ADR 0008: Inyección Dinámica de Herramientas y Gestión de Estado Multi-Tenant

## 1. Contexto y Problema

El agente de Inteligencia Artificial gestionado en n8n necesita enviar múltiples recursos nativos (audios, vídeos, stickers) al usuario final a través de ManyChat. Dado que la API de ManyChat requiere disparar flujos (flows) preconfigurados para enviar este tipo de multimedia de forma nativa, el agente terminó con una lista de entre 19 y 30 herramientas individuales (tools) como `enviar_video_1`, `enviar_audio_2`, etc.

**Problemas detectados con esta aproximación:**
1. **Sobrecarga de Tokens (Costo y Latencia):** Enviar la definición de 30+ tools al LLM en cada turno consume una cantidad masiva de *Input Tokens*, aumentando drásticamente los costos de la API y ralentizando el *Time to First Token* (TTFT).
2. **Parálisis por Análisis (Alucinaciones):** Los modelos LLM disminuyen su precisión al manejar un volumen alto de herramientas simultáneas, lo que puede provocar el envío de un recurso incorrecto (ej. enviar un meme de seguimiento a un lead recién iniciado).
3. **Acoplamiento Fuerte y Ruptura del Modelo Multi-Tenant:** Si la API de Fastify decide qué tools inyectar basándose en reglas de negocio estáticas (ej. `if stage == 'A'`), se rompe el principio de que Fastify es una capa de infraestructura agnóstica. Si entra un nuevo Tenant con un embudo distinto (ej. inmobiliaria), habría que modificar el código duro de Fastify y redesplegar.

## 2. Decisión Arquitectónica

Se decide cambiar el paradigma de "Herramientas de Negocio" a **"Herramientas Primitivas + Inyección Dinámica de Contexto"**. La lógica de negocio se delega por completo a la base de datos (configuración) y n8n (orquestación).

La solución se sostiene en 3 pilares:

### Pilar 1: Herramientas Primitivas
En lugar de registrar múltiples tools para cada recurso multimedia, se exponen únicamente **herramientas maestras abstractas** al LLM:
* `trigger_manychat_flow(flow_name)`: Para enviar cualquier recurso multimedia o disparar acciones.
* `set_stage(new_stage, reason, evidence)`: Para avanzar o descalificar al lead.

### Pilar 2: Inyección Dinámica por Etapa (Multi-Tenant)
La estructura del embudo (qué flujos de ManyChat aplican a qué etapa) vive exclusivamente en la base de datos dentro del campo JSON `tenants.config.flows_by_stage`.
1. Fastify recibe el webhook de ManyChat, consulta la etapa actual del usuario en `api.lead_stages`, y le pasa a n8n el payload que incluye: `mensajes`, `current_stage`, y `tenant.config`.
2. Dentro de n8n, un nodo de código extrae **únicamente** los flujos permitidos para la etapa actual.
3. n8n inyecta esta lista filtrada dinámicamente como texto dentro del **System Prompt** del LLM.
*Al LLM solo se le instruye: "Actualmente estás en la etapa [X]. Los flujos válidos que puedes usar con la herramienta `trigger_manychat_flow` son: [Lista filtrada]".*

### Pilar 3: Cambio de Estado y Trazabilidad en n8n
El agente (LLM) es el único responsable de decidir si un lead cambia de etapa, basándose en el historial de la conversación y las reglas definidas en su System Prompt dinámico.
1. Cuando se cumple una condición, el LLM ejecuta la tool `set_stage`.
2. n8n envía esta orden a Fastify mediante una petición HTTP (ej. `POST /api/leads/:id/stage`).
3. Fastify (actuando como capa de persistencia) actualiza `api.lead_stages.current_stage` y guarda un registro inmutable en `api.stage_transitions` con la justificación literal que dio la IA (`agent_evidence`).

## 3. Consecuencias

### Positivas:
* **Ahorro Radical de Tokens:** El LLM pasa de leer 30 descripciones de herramientas a leer 2 herramientas primitivas y una pequeña lista de texto dinámico.
* **Aislamiento de la Infraestructura:** Fastify no conoce las etapas lógicas ("A", "B", "C"). Solo es un intermediario que mueve payloads y actualiza registros en base de datos.
* **Escalabilidad Multi-Tenant:** Cualquier nuevo cliente puede tener 10 etapas o 100 flujos distintos, y todo se controla actualizando su JSON de configuración en PostgreSQL, sin tocar código ni nodos en n8n.
* **Trazabilidad Absoluta:** La tabla `api.stage_transitions` permite auditar y depurar por qué el LLM tomó una decisión, facilitando la mejora iterativa del System Prompt.

### Negativas / Consideraciones:
* **Complejidad Inicial en n8n:** Obliga a crear un nodo de pre-procesamiento JavaScript en n8n antes de llamar al nodo del Agente LLM para construir la sección dinámica del System Prompt.
* **Dependencia del System Prompt:** La seguridad del funnel recae fuertemente en las instrucciones del prompt. Será necesario manejar reintentos si la IA intenta usar un `flow_name` que no le fue proporcionado en la lista permitida.

## 4. Referencias y Estado
* **Estado:** Aceptado
* **Autores:** Equipo de Arquitectura
* **Componentes Afectados:** Base de Datos (Drizzle schema), Payload de Webhooks Fastify, Lienzo (Canvas) de n8n, System Prompt del Agente.
