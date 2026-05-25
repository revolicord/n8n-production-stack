# Business Operating Context
## AI Instagram DM Setter — Documentación para Arquitectura de Agente

---

## 1. Descripción del Negocio

El negocio es una **Aceleradora de crecimiento y escalamiento para coaches, consultores e infoproductores.** que comercializa sus programas principalmente a través de Instagram. El modelo de negocio depende de un flujo conversacional: el cliente potencial pasa de descubrir el perfil en Instagram → interactuar con contenido → entrar en conversación por DM → agendar una llamada de ventas → cerrar con el closer.

El agente de IA reemplaza y escala la función del **setter humano**, que es el eslabón responsable de ese tramo DM → llamada agendada.

---

## 2. Producto / Servicio

| Campo | Detalle |
|---|---|
| Tipo | Coaching / Mentoría / Consultor / Advisor / Growht Partner |
| Objetivo de venta | Agendar llamada de ventas (discovery/strategy call) |
| Canal principal | Instagram DMs |
| Cierre final | Lo realiza un closer humano en la llamada |

> El agente **no cierra la venta**. Su única métrica de éxito es **llamada agendada y calificada**.

---

## 3. Fuentes de Leads (Entradas del Agente)

El agente debe ser capaz de procesar leads provenientes de tres orígenes distintos, cada uno con un contexto de intención diferente:

### 3.1 Comentarios en Posts / Reels / Publicación
- El lead demostró interés público en el contenido.
- Contexto de intención: **media-alta** (interactuó activamente).
- Trigger típico: comentario con palabra clave, emoji, o pregunta.
- El agente inicia la conversación vía DM en respuesta al comentario.

### 3.2 Seguidores Nuevos
- El lead siguió la cuenta recientemente.
- Contexto de intención: **baja-media** (señal débil, puede ser curiosidad).
- El agente envía un mensaje de bienvenida/apertura después de un delay configurado.
- Requiere mayor calificación antes de intentar agendar.

### 3.3 DMs Entrantes (Inbound)
- El lead inicia la conversación por su propia cuenta.
- Contexto de intención: **alta** (máxima señal de interés).
- El agente responde y guía la conversación hacia calificación y agendado.

### 3.4 Usuario comparte tu pulcicacion o reel como historia

### 3.5 Usuario responde a tu historia

---

## 4. Stack Tecnológico Actual

```
ManyChat
   │
   ├── Automatizaciones de triggers (comentarios, seguidores, palabras clave)
   │
   └── Webhooks / integraciones
          │
          └── n8n (orquestador de flujos y lógica de negocio)
                 │
                 ├── Servidor propio (código custom — lógica del agente IA)
                 │
                 └── Close CRM (registro de leads, seguimiento, agendado)
```

| Herramienta | Rol |
|---|---|
| **ManyChat** | Capa de captura de triggers en Instagram y envío/recepción de mensajes |
| **Debounce message api** | Recibe los mensajes de emanychat y los encola permitiendo recibir mensajes en rafaga |
| **n8n** | Orquestador: recibe eventos del api, aplica lógica, llama al agente, actualiza postgres |
| **Close CRM** | Almacena el lead, historial de conversación, estado del pipeline y citas agendadas |

---

## 5. Equipo Humano Involucrado

| Rol | Función |
|---|---|
| **Setter humano (actual)** | Proceso que el agente reemplazará. Su flujo conversacional es la referencia de diseño. |
| **Closer humano** | Realiza la llamada de ventas una vez que el setter (agente) agenda. |
| **Operador / Admin** | Supervisa el agente, revisa conversaciones escaladas, ajusta configuraciones. |

> **Importante:** El setter humano actual sigue activo durante la fase de transición cumplira funcion de **Human in the middle**. El agente debe documentar su proceso exacto para poder replicarlo fielmente.

---

## 6. Restricciones y Consideraciones Críticas

### 6.1 Límites del Agente
- El agente **no debe intentar cerrar la venta** en el DM.
- El agente **no debe revelar** que es una IA a menos que sea preguntado directamente (definir política con el negocio).
- El agente debe **escalar a humano** ante: objeciones complejas, leads muy calientes que piden hablar ya, situaciones de conflicto o sensibilidad.

### 6.2 Compliance de Instagram
- Instagram penaliza los mensajes masivos no solicitados.
- ManyChat opera dentro de la política de mensajería de Meta (ventana de 24h para mensajes libres tras interacción).
- El agente debe respetar delays y frecuencias configuradas para evitar ban de cuenta.

### 6.3 Calidad sobre Cantidad
- Un lead mal calificado que llega a la llamada desperdicia el tiempo del closer.
- El agente debe calificar antes de agendar: identificar fit, intención y disponibilidad mínima.

---

## 7. KPIs del Agente

| Métrica | Descripción |
|---|---|
| **Tasa de respuesta** | % de leads contactados que responden al primer mensaje |
| **Tasa de calificación** | % de conversaciones que superan el proceso de calificación |
| **Tasa de agendado** | % de leads calificados que agendan llamada |
| **Tasa de show** | % de llamadas agendadas en las que el lead realmente aparece |
| **Escalaciones a humano** | Número y motivo de conversaciones transferidas al setter humano |

---

## 8. Glosario

| Término | Definición |
|---|---|
| **Setter** | Vendedor responsable de calificar leads y agendar llamadas de ventas |
| **Closer** | Vendedor responsable de cerrar la venta en la llamada |
| **Lead** | Prospecto potencial que ha mostrado alguna señal de interés |
| **Trigger** | Evento que activa el inicio de una conversación por parte del agente |
| **Calificación** | Proceso de validar que el lead tiene el perfil, la necesidad y la intención adecuada |
| **Show rate** | Porcentaje de llamadas agendadas a las que el prospecto realmente asiste |
