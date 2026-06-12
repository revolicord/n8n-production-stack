# Taxonomía Fundacional de la Conversación Humano–IA
## Modelo de dominio para un AI Setter en Instagram DM

**Versión:** 1.0.0 (borrador para revisión)
**Estado:** Documento conceptual vivo — diseñado para evolucionar
**Propietario:** RevolicoRD

---

## 0. Propósito y principios de diseño

Este documento define el **universo completo de lo que puede ocurrir** en una conversación entre un humano y una IA, especializado para el caso de un setter de citas por Instagram DM. No es un prompt ni un schema técnico: es el **mapa del territorio** sobre el cual luego se construyen el schema de datos, los intents del agente, la lógica de decisión y las métricas.

### 0.1 Principios

1. **MECE aspiracional.** Las categorías buscan ser Mutuamente Excluyentes y Colectivamente Exhaustivas *dentro de cada dimensión*. La exhaustividad total es imposible a priori; por eso existe el principio 4.
2. **Dimensiones ortogonales, no jerarquía única.** Un mensaje no "pertenece" a una sola categoría. Cada evento conversacional se anota **simultáneamente en las 13 dimensiones** (D1–D13). Ejemplo: un mismo mensaje tiene un contexto, una intención, un acto de habla, entidades, media, señales emocionales, etc. El error clásico es mezclar dimensiones (ej: tratar "objeción de precio" y "voice note" como categorías hermanas — no lo son, viven en ejes distintos).
3. **Evento ≠ Estado ≠ Perfil.** Tres niveles de persistencia:
   - **Evento:** un mensaje o acción puntual (vive en el hilo).
   - **Estado:** la situación actual de la conversación (etapa, hilos abiertos, ánimo).
   - **Perfil:** lo que sabemos del lead de forma duradera (slots, historial, ICP fit).
4. **Open-world + categoría residual obligatoria.** Toda dimensión incluye `_UNCLASSIFIED`. Si un evento real no cabe limpiamente en ninguna categoría, **eso es evidencia de que al modelo le falta algo**, no de que el evento es raro. El protocolo de evolución (§14) convierte esos residuos en mejoras del modelo.
5. **Manifiesto vs latente.** Casi toda dimensión tiene dos lecturas: lo que el lead *dice* (manifiesto) y lo que *significa/busca* (latente). "¿Cuánto cuesta?" puede ser interés genuino, una objeción anticipada, o un filtro descalificante del propio lead. La taxonomía anota ambas capas cuando difieren.

### 0.2 Las 13 dimensiones (vista de pájaro)

| # | Dimensión | Pregunta que responde |
|---|-----------|----------------------|
| D1 | Contexto | ¿En qué circunstancias ocurre esto? |
| D2 | Participantes | ¿Quiénes están (o se invocan) en la conversación? |
| D3 | Intención | ¿Qué busca el emisor con este mensaje? |
| D4 | Acto de habla | ¿Qué *forma* pragmática tiene el mensaje? |
| D5 | Entidades y atributos | ¿Qué información extraíble contiene? |
| D6 | Objetos y media | ¿Qué artefactos transporta? |
| D7 | Señales paralingüísticas | ¿Cómo lo dice (más allá del qué)? |
| D8 | Estado y dinámica | ¿Dónde está la conversación como proceso? |
| D9 | Emoción y rapport | ¿Cuál es el clima relacional? |
| D10 | Acciones del agente | ¿Qué puede hacer la IA en respuesta? |
| D11 | Restricciones | ¿Qué límites aplican? |
| D12 | Memoria y conocimiento | ¿Qué sabe el sistema y desde cuándo? |
| D13 | Outcomes y métricas | ¿En qué terminó y cómo lo medimos? |

---

## D1. CONTEXTO

El contexto es todo lo que es verdad *antes* de leer el contenido del mensaje. Se descompone en siete sub-contextos:

### D1.1 Contexto de origen (adquisición)
Cómo llegó este lead/conversación a existir:
- `D1.1.1` Respuesta a story (story reply)
- `D1.1.2` Comment-to-DM (automatización tipo ManyChat: comentó keyword en post/reel)
- `D1.1.3` Click en ad (CTD — click-to-DM ads)
- `D1.1.4` DM orgánico entrante (el lead escribió primero, sin trigger)
- `D1.1.5` DM saliente en frío (outbound del setter)
- `D1.1.6` Referido / mención de tercero
- `D1.1.7` Reacción a story (emoji a la story, sin texto)
- `D1.1.8` Follow-back / nuevo seguidor contactado
- `D1.1.9` Mención o tag en contenido del lead
- `D1.1.10` Continuación de canal externo (vino de WhatsApp, email, llamada)
- `D1.1._UNCLASSIFIED`

> El origen determina: qué sabe ya el lead, qué consentimiento implícito existe, qué tan caliente está, y qué plantilla de apertura aplica.

### D1.2 Contexto histórico (relación previa)
- `D1.2.1` Primer contacto absoluto
- `D1.2.2` Conversación activa en curso
- `D1.2.3` Lead reactivado (hubo silencio, alguien retoma)
- `D1.2.4` Lead reciclado (descalificado/perdido antes, vuelve)
- `D1.2.5` Cliente actual
- `D1.2.6` Ex-cliente
- `D1.2.7` No-show previo (agendó y no asistió)
- `D1.2._UNCLASSIFIED`

### D1.3 Contexto de funnel (etapa)
Alineado al funnel de prospección de 5 etapas:
- `D1.3.1` Initiated — contacto iniciado
- `D1.3.2` Media Seen — consumió el contenido/media enviado
- `D1.3.3` Engaged — respondió con sustancia, hay diálogo real
- `D1.3.4` Calendly Sent — recibió link de agenda
- `D1.3.5` Booked — cita agendada
- `D1.3.6` Post-booking (confirmación, recordatorio, reagenda) — *etapa extendida*
- `D1.3._UNCLASSIFIED`

> Ojo: la etapa de funnel es **estado de negocio**, distinta del estado conversacional (D8). Un lead puede estar en `Booked` y la conversación en `ghosting`.

### D1.4 Contexto temporal
- `D1.4.1` Hora local del lead (inferida) y franja (madrugada/laboral/noche)
- `D1.4.2` Día de semana / fin de semana / festivo
- `D1.4.3` Tiempo transcurrido desde el último mensaje (propio y del lead)
- `D1.4.4` Posición respecto a la ventana de 24h de Meta (dentro / por expirar / expirada)
- `D1.4.5` Proximidad a eventos: cita agendada en X horas, fin de promoción, cierre de cohorte
- `D1.4._UNCLASSIFIED`

### D1.5 Contexto de negocio
- `D1.5.1` Oferta activa (qué se vende ahora, a qué precio, con qué promesa)
- `D1.5.2` Capacidad (¿hay cupos en la agenda? ¿el calendario está lleno?)
- `D1.5.3` Promociones/urgencias reales vigentes
- `D1.5.4` Estado del Calendly (link vigente, horarios disponibles)
- `D1.5._UNCLASSIFIED`

### D1.6 Contexto de plataforma
- `D1.6.1` Superficie: DM principal / hilo de story reply / respuesta a comentario
- `D1.6.2` Capacidades disponibles: ¿se puede enviar link? ¿botones? ¿media?
- `D1.6.3` Estado técnico: webhook activo, echo recibido, mensaje deduplicado
- `D1.6._UNCLASSIFIED`

### D1.7 Contexto operativo (quién opera)
- `D1.7.1` Agente IA activo (modo normal)
- `D1.7.2` Humano activo en el hilo (ventana `humano_activo` viva)
- `D1.7.3` Pausa manual (`pausa_manual` puesta por el operador)
- `D1.7.4` Modo híbrido / co-pilot (humano supervisa, IA sugiere)
- `D1.7.5` Agente degradado (falla de servicio, modo fallback)
- `D1.7._UNCLASSIFIED`

---

## D2. PARTICIPANTES

### D2.1 El lead (humano)
- `D2.1.1` Identidad técnica: IGSID, handle, nombre visible
- `D2.1.2` Identidad inferida: nombre real, género gramatical para conjugar, idioma y variante (es-DO, es-MX, en, spanglish)
- `D2.1.3` Perfil profesional/nicho: qué hace, tamaño de su negocio/audiencia
- `D2.1.4` Geografía y timezone inferida
- `D2.1.5` Sofisticación: ¿conoce el mercado? ¿ya consumió ofertas similares?
- `D2.1._UNCLASSIFIED`

### D2.2 Clasificación del lead
- `D2.2.1` Fit con ICP: dentro / borde / fuera
- `D2.2.2` Temperatura: frío / tibio / caliente
- `D2.2.3` Señales de coachability: hace preguntas genuinas, acepta reencuadres, ejecuta micro-compromisos
- `D2.2.4` Descalificadores duros: menor de edad, competidor, busca empleo, geografía no servida, spam/bot
- `D2.2.5` Rol de compra: decisor / influenciador / gatekeeper
- `D2.2._UNCLASSIFIED`

### D2.3 El agente (IA)
- `D2.3.1` Persona: nombre, rol declarado, voz y tono
- `D2.3.2` Conocimiento autorizado: qué puede afirmar, sobre qué debe decir "no sé"
- `D2.3.3` Identidad ante la pregunta "¿eres un bot?": política de transparencia
- `D2.3._UNCLASSIFIED`

### D2.4 El humano detrás del agente
- `D2.4.1` Operador que toma control (override)
- `D2.4.2` Closer que recibirá la cita
- `D2.4.3` Dueño de la cuenta (la "marca persona", ej: Alex)
- `D2.4._UNCLASSIFIED`

### D2.5 Terceros invocados
Personas que no están en el chat pero entran al modelo:
- `D2.5.1` Decisores externos ("lo tengo que hablar con mi socio/esposa")
- `D2.5.2` Competidores mencionados
- `D2.5.3` Referencias/prueba social ("vi que trabajaste con X")
- `D2.5.4` Equipo del lead ("mi community manager te escribe")
- `D2.5._UNCLASSIFIED`

---

## D3. INTENCIÓN

La dimensión más importante para un setter. Qué busca el lead con su mensaje. **Un mensaje puede portar múltiples intenciones simultáneas** (multi-intent es la norma, no la excepción), y la intención manifiesta puede diferir de la latente.

### D3.1 Intenciones informacionales (busca saber)
- `D3.1.1` Qué es / en qué consiste la oferta
- `D3.1.2` Cómo funciona / proceso / logística
- `D3.1.3` Precio y formas de pago
- `D3.1.4` Resultados y prueba social ("¿a quién has ayudado?")
- `D3.1.5` Diferenciación ("¿en qué se distingue de X?")
- `D3.1.6` Aplicabilidad a su caso ("¿esto sirve para mi nicho?")
- `D3.1.7` Sobre la persona/marca ("¿quién eres tú?")
- `D3.1._UNCLASSIFIED`

### D3.2 Intenciones de progresión (busca avanzar)
- `D3.2.1` Quiere agendar / pide el link
- `D3.2.2` Acepta propuesta del agente ("dale, mándamelo")
- `D3.2.3` Propone horario/fecha
- `D3.2.4` Reagendar
- `D3.2.5` Confirmar asistencia
- `D3.2.6` Quiere comprar directo (saltarse la llamada)
- `D3.2._UNCLASSIFIED`

### D3.3 Objeciones (resistencia con interés residual)
- `D3.3.1` Precio / dinero ("está caro", "no tengo ahora")
- `D3.3.2` Tiempo ("estoy a full", "ahora no puedo")
- `D3.3.3` Confianza / escepticismo ("¿esto no es una estafa?", "he visto muchos así")
- `D3.3.4` Experiencia previa negativa ("ya probé algo igual y no funcionó")
- `D3.3.5` Necesidad ("no creo que lo necesite todavía")
- `D3.3.6` Autoridad ("tengo que consultarlo con…")
- `D3.3.7` Postergación difusa ("déjame pensarlo", "te aviso")
- `D3.3.8` Objeción al formato ("¿no me lo puedes explicar por aquí?", rechazo a la llamada)
- `D3.3._UNCLASSIFIED`

### D3.4 Intenciones de retirada/descalificación (del lado del lead)
- `D3.4.1` Rechazo explícito ("no me interesa")
- `D3.4.2` Pide que no le escriban más (opt-out) — **trigger de compliance**
- `D3.4.3` Cancelación de cita
- `D3.4.4` Auto-descalificación ("no tengo negocio, solo curioseaba")
- `D3.4._UNCLASSIFIED`

### D3.5 Meta-intenciones (sobre la conversación misma)
- `D3.5.1` ¿Eres un bot / IA?
- `D3.5.2` ¿Cómo conseguiste mi contacto? / ¿por qué me escribes?
- `D3.5.3` Pide hablar con un humano
- `D3.5.4` Queja sobre el proceso ("me escribes mucho", "no respondiste lo que pregunté")
- `D3.5.5` Corrección de malentendido ("no, yo no dije eso")
- `D3.5._UNCLASSIFIED`

### D3.6 Intenciones sociales/fáticas (mantener el canal)
- `D3.6.1` Saludo / apertura
- `D3.6.2` Agradecimiento
- `D3.6.3` Small talk / cortesía
- `D3.6.4` Cumplido a la marca/contenido ("me encanta tu contenido")
- `D3.6.5` Humor / broma
- `D3.6.6` Despedida
- `D3.6._UNCLASSIFIED`

### D3.7 Intenciones inversas y hostiles
- `D3.7.1` El lead vende algo (pitch invertido: te quiere vender SU servicio)
- `D3.7.2` Busca empleo / colaboración no solicitada
- `D3.7.3` Pide cosas gratis (consultoría gratis encubierta)
- `D3.7.4` Trolling / provocación
- `D3.7.5` Insulto / abuso
- `D3.7.6` Scam / phishing / link malicioso
- `D3.7.7` Spam automatizado (otro bot)
- `D3.7._UNCLASSIFIED`

### D3.8 Intenciones de soporte/postventa (si ya es cliente)
- `D3.8.1` Duda de uso / acceso
- `D3.8.2` Reclamo / reembolso
- `D3.8.3` Upsell-ready ("¿qué más tienes?")
- `D3.8.4` Testimonio espontáneo
- `D3.8._UNCLASSIFIED`

### D3.9 Ambigüedad estructural
- `D3.9.1` Mensaje genuinamente ambiguo (requiere clarificación, no adivinanza)
- `D3.9.2` Multi-intent explícito (pregunta precio + objeta tiempo en el mismo mensaje)
- `D3.9.3` Intención manifiesta ≠ latente detectada (anotar ambas)
- `D3.9._UNCLASSIFIED`

---

## D4. ACTOS DE HABLA (forma pragmática)

Dimensión distinta de la intención: aquí se clasifica la **forma** del mensaje, no su propósito. Basada en la teoría de actos de habla (Searle), adaptada al DM. Útil porque la forma condiciona la respuesta correcta: una pregunta exige respuesta; un comisivo ("te aviso") exige seguimiento programado, no respuesta inmediata.

### D4.1 Asertivos (afirma algo sobre el mundo)
- Declaración de hechos sobre sí mismo ("tengo una tienda online")
- Opinión / evaluación ("eso suena interesante")
- Negación / corrección

### D4.2 Directivos (busca que el otro haga algo)
- `D4.2.1` Pregunta abierta
- `D4.2.2` Pregunta cerrada (sí/no)
- `D4.2.3` Pedido / solicitud ("mándame info")
- `D4.2.4` Orden / imperativo ("deja de escribirme")
- `D4.2.5` Sugerencia / propuesta

### D4.3 Comisivos (se compromete a algo)
- Promesa ("te aviso el lunes") — **genera un hilo abierto con fecha**
- Aceptación de compromiso ("ok, ahí estaré")
- Compromiso condicional ("si me baja el precio, entro")

### D4.4 Expresivos (expresa estado interno)
- Agradecimiento, disculpa, queja, entusiasmo, sorpresa

### D4.5 Formas degeneradas o mínimas
Casos frecuentísimos en IG que rompen clasificadores ingenuos:
- `D4.5.1` Emoji-only (🙌, 🔥, ❤️)
- `D4.5.2` Reacción a un mensaje (like/heart sobre burbuja)
- `D4.5.3` Monosílabo ("ok", "ya", "ah")
- `D4.5.4` Sticker / GIF sin texto
- `D4.5.5` Voice note (forma audio — el contenido se clasifica aparte tras transcribir)
- `D4.5.6` Mensaje borrado (unsend) — evento con significado propio
- `D4.5.7` Mensaje vacío / solo media sin texto
- `D4.5._UNCLASSIFIED`

### D4.6 Indirectos y no-literales
- Ironía / sarcasmo ("sí claro, seguro es gratis 🙄")
- Hedging / atenuación ("no sé, quizás, tal vez podría…")
- Pregunta retórica
- Indirecta que es en realidad un pedido ("ojalá alguien me explicara esto…")

---

## D5. ENTIDADES Y ATRIBUTOS (slots extraíbles)

Lo que se puede **extraer y persistir** de los mensajes. Cada entidad extraída lleva metadatos: *fuente* (explícita / inferida), *confianza*, *fecha de captura* y *vigencia* (los slots caducan: "no tengo presupuesto" dicho hace 6 meses ya no es verdad necesariamente).

### D5.1 Slots de calificación (el corazón del setter)
Adaptación de BANT/PAIN al contexto DM:
- `D5.1.1` **Dolor / problema:** qué le duele, en sus palabras
- `D5.1.2` **Situación actual:** qué tiene hoy (negocio, facturación, equipo, métodos)
- `D5.1.3` **Objetivo deseado:** a dónde quiere llegar, en cuánto tiempo
- `D5.1.4` **Brecha / consecuencia:** qué pasa si no resuelve (urgencia implícita)
- `D5.1.5` **Presupuesto:** capacidad y disposición de inversión
- `D5.1.6` **Urgencia / timeline:** cuándo quiere empezar
- `D5.1.7` **Autoridad:** ¿decide solo?
- `D5.1.8` **Experiencia previa:** qué ya intentó y qué pasó
- `D5.1._UNCLASSIFIED`

### D5.2 Entidades de negocio
- Producto/oferta referida, precio mencionado, promoción, garantía, link (Calendly u otro), nombre del programa

### D5.3 Entidades personales del lead
- Nombre, nombre del negocio, nicho, ubicación/ciudad, idioma preferido, canal alternativo ofrecido (WhatsApp, email)

### D5.4 Entidades de agenda
- Fecha/hora propuesta o confirmada, timezone, duración, tipo de llamada, estado de la cita (propuesta → confirmada → reagendada → cancelada → realizada → no-show)

### D5.5 Entidades temporales relativas
- "el lunes", "en dos semanas", "después de fin de mes" — requieren resolución a fecha absoluta con timezone del lead. Subdimensión propia porque es fuente sistemática de errores.

### D5._UNCLASSIFIED

---

## D6. OBJETOS Y MEDIA

Artefactos que el mensaje transporta. Cada objeto tiene atributos: *procesable* (¿se puede transcribir/analizar?), *efímero* (¿expira?), *propiedad* (propio del hilo vs contenido ajeno compartido), *dirección* (entrante / saliente / echo propio — clave para tu deduplicación por `mid`).

- `D6.1` Texto plano
- `D6.2` Voice note / audio (→ pipeline de transcripción; la duración es señal en sí misma)
- `D6.3` Imagen (foto propia, captura de pantalla — las capturas suelen ser prueba: "mira lo que me pasó")
- `D6.4` Video subido
- `D6.5` Reel/post compartido (propio del negocio ← señal de consumo de contenido = Media Seen; o ajeno ← contexto externo)
- `D6.6` Story reply con la story adjunta (la story referida es contexto efímero: capturar antes de que expire)
- `D6.7` Link / URL (clasificar destino: Calendly, sitio propio, externo, sospechoso)
- `D6.8` Sticker / GIF
- `D6.9` Reacción a mensaje (emoji sobre burbuja — evento, no mensaje)
- `D6.10` Ubicación compartida
- `D6.11` Contacto compartido
- `D6.12` Mensaje reenviado de otro chat
- `D6.13` Unsend / borrado (el objeto desaparece pero el evento queda)
- `D6.14` Mensaje efímero (modo desaparición)
- `D6._UNCLASSIFIED`

---

## D7. SEÑALES PARALINGÜÍSTICAS

El "cómo" más allá del "qué". Son señales débiles individualmente pero potentes agregadas. Alimentan D9 (emoción) y D2.2 (temperatura).

- `D7.1` **Emojis:** presencia, valencia, densidad (🙌🔥 ≠ 🙄 ≠ ausencia total)
- `D7.2` **Puntuación y mayúsculas:** "QUÉ PRECIO TIENE???" ≠ "qué precio tiene"
- `D7.3` **Longitud del mensaje:** monosílabos vs párrafos (inversión de esfuerzo = interés)
- `D7.4` **Latencia de respuesta:** contesta en segundos / horas / días; tendencia (acelera = calienta, desacelera = enfría)
- `D7.5` **Patrón de ráfaga:** varios mensajes seguidos (burst) — tratar como una sola unidad semántica (tu debounce/agregación)
- `D7.6` **Hora habitual de actividad:** ventanas en que el lead responde
- `D7.7` **Registro:** formal/informal, voseo/tuteo/usted, jerga del nicho
- `D7.8` **Code-switching:** cambia de idioma o mezcla (spanglish) — el agente debe espejar
- `D7.9` **Errores de tipeo / escritura desde móvil apurado:** señal de canal y contexto
- `D7.10` **Duración de voice notes:** un audio de 2 min es self-disclosure alto
- `D7._UNCLASSIFIED`

---

## D8. ESTADO Y DINÁMICA CONVERSACIONAL

La conversación como **proceso con estado propio**, independiente del funnel de negocio. Aquí vive la máquina de estados del diálogo.

### D8.1 Estructura de turnos
- Quién tiene el turno / quién habló último
- Quién tiene la **iniciativa** (quién está empujando la conversación) — si la iniciativa es siempre del agente, el lead está frío
- Ratio de iniciativa (preguntas del lead vs preguntas del agente)

### D8.2 Hilos abiertos (open loops)
- Preguntas del lead sin responder (deuda del agente — prioridad máxima)
- Preguntas del agente sin responder (deuda del lead)
- Compromisos pendientes con fecha ("te aviso el lunes" → follow-up programado)
- Temas abiertos no cerrados (multi-tema simultáneo)

### D8.3 Fases del diálogo (máquina de estados conversacional)
- `D8.3.1` Apertura
- `D8.3.2` Exploración / descubrimiento (calificación activa)
- `D8.3.3` Profundización (dolor + objetivo sobre la mesa)
- `D8.3.4` Negociación de siguiente paso (pitch de la llamada)
- `D8.3.5` Cierre del paso (link enviado / cita agendada)
- `D8.3.6` Mantenimiento post-cierre (confirmaciones, recordatorios)
- `D8.3.7` Latencia / pausa (nadie ha hablado en X tiempo)
- `D8.3.8` Cerrada (resuelta o abandonada)
- `D8.3._UNCLASSIFIED`

### D8.4 Disrupciones y reparaciones
- `D8.4.1` Ghosting (el lead desaparece) — con umbrales: micro-silencio (<24h), silencio (1–7d), abandono (>7d)
- `D8.4.2` Reactivación (quién retoma y cómo: lead espontáneo vs follow-up del agente)
- `D8.4.3` Malentendido detectado y reparación ("perdón, me expliqué mal")
- `D8.4.4` Cambio brusco de tema
- `D8.4.5` Interrupción por humano (handoff entrante o saliente)
- `D8.4.6` Conversación duplicada / canal paralelo (te escribe también por WhatsApp)
- `D8.4.7` Regresión de etapa (estaba por agendar y vuelve a objeción)
- `D8.4._UNCLASSIFIED`

### D8.5 Cadencia y anti-silencio
- Política de follow-ups: cuántos, con qué espaciado, con qué ángulo distinto cada vez
- Regla anti-silencio del agente (nunca cerrar un turno sin pelota en el campo del lead, salvo cierre deliberado)
- Punto de rendición (cuándo dejar de insistir → nurture pasivo)

---

## D9. EMOCIÓN Y RAPPORT

### D9.1 Estado emocional del mensaje (evento)
- Valencia: positiva / neutra / negativa
- Activación: calmado / activado (entusiasmo y enojo son ambos alta activación)
- Emociones específicas relevantes al setting: entusiasmo, curiosidad, escepticismo, frustración, ansiedad/urgencia, vergüenza (común al hablar de dinero), indiferencia

### D9.2 Clima relacional (estado acumulado)
- Nivel de confianza percibida (¿baja la guardia? ¿comparte datos sensibles?)
- Fricción acumulada (correcciones, quejas, sarcasmo creciente)
- Rapport: reciprocidad (pregunta de vuelta), self-disclosure (cuenta cosas personales), humor compartido, uso del nombre del agente

### D9.3 Trayectoria
- Calentando / estable / enfriando — la derivada importa más que el valor puntual
- `D9._UNCLASSIFIED`

---

## D10. ACCIONES DEL AGENTE

El repertorio completo de lo que la IA puede *hacer*. Cada turno del agente es un **plan** (posiblemente compuesto) de estas acciones.

### D10.1 Acciones comunicativas
- `D10.1.1` Responder pregunta (saldar deuda de hilo abierto)
- `D10.1.2` Preguntar (calificar, profundizar, clarificar ambigüedad)
- `D10.1.3` Validar / empatizar (acknowledgment antes de avanzar)
- `D10.1.4` Reformular / parafrasear (confirmar entendimiento del dolor)
- `D10.1.5` Reencuadrar objeción
- `D10.1.6` Aportar prueba social / historia / caso
- `D10.1.7` Proponer siguiente paso (micro-compromiso o llamada)
- `D10.1.8` Enviar link (Calendly, contenido)
- `D10.1.9` Enviar media (video, voice note del closer, imagen)
- `D10.1.10` Reaccionar a mensaje (emoji sobre burbuja — acción de bajo costo, alto rapport)
- `D10.1.11` Espejar registro/idioma/emoji del lead
- `D10.1.12` Cerrar con elegancia (descalificado o rechazo: dejar puerta abierta)
- `D10.1._UNCLASSIFIED`

### D10.2 Acciones de proceso (no visibles para el lead)
- `D10.2.1` Avanzar/retroceder etapa de funnel
- `D10.2.2` Actualizar slots de calificación (escribir en perfil)
- `D10.2.3` Marcar calificado / descalificado (con razón)
- `D10.2.4` Programar follow-up (fecha + ángulo)
- `D10.2.5` Pausar agente para este contacto
- `D10.2.6` Escalar a humano (con resumen de contexto — handoff package)
- `D10.2.7` Etiquetar conversación / contacto
- `D10.2.8` Registrar outcome
- `D10.2.9` Loggear evento `_UNCLASSIFIED` para revisión (§14)
- `D10.2._UNCLASSIFIED`

### D10.3 No-acciones deliberadas
- `D10.3.1` Silencio estratégico (no responder a emoji-only de cortesía; no perseguir tras cierre)
- `D10.3.2` Delay humanizado (no responder en 0.3 segundos)
- `D10.3.3` Ceder el turno al humano activo (tu cascada de decisión en n8n)
- `D10.3.4` No morder anzuelos (trolling, debate, consultoría gratis extensa)

### D10.4 Restricciones de composición del plan
- Máximo de preguntas por turno (una, idealmente)
- Nunca dos follow-ups idénticos seguidos
- Toda objeción se valida antes de reencuadrarse
- Todo turno deja claro el siguiente paso (salvo cierre deliberado)

---

## D11. RESTRICCIONES Y POLÍTICAS

Los límites que acotan todo lo anterior. Se violan a costo alto: ban de cuenta, problema legal o daño de marca.

### D11.1 Restricciones de plataforma (Meta/Instagram)
- `D11.1.1` Ventana de mensajería de 24h y sus excepciones (human agent tag, etc.)
- `D11.1.2` Rate limits y patrones que disparan detección de spam
- `D11.1.3` Contenido prohibido por políticas de Meta
- `D11.1.4` Capacidades por superficie (qué se puede enviar dónde)
- `D11.1._UNCLASSIFIED`

### D11.2 Restricciones legales/regulatorias
- `D11.2.1` Claims de resultados (promesas de ingresos: terreno minado)
- `D11.2.2` Datos personales: qué se pide, qué se guarda, qué jamás se pide por DM (tarjetas, contraseñas)
- `D11.2.3` Menores de edad: detección → cierre inmediato
- `D11.2.4` Opt-out: respeto inmediato e irreversible sin confirmación humana
- `D11.2._UNCLASSIFIED`

### D11.3 Políticas de marca
- `D11.3.1` Qué se dice y qué no por DM (¿se da el precio? ¿se da solo en llamada?)
- `D11.3.2` Tono: qué jamás diría la marca
- `D11.3.3` Transparencia sobre IA: qué responde el agente si le preguntan si es bot
- `D11.3.4` Promesas que el agente no puede hacer (descuentos, excepciones)
- `D11.3._UNCLASSIFIED`

### D11.4 Límites del agente (escalación obligatoria)
- Reclamos de cliente, amenazas legales, crisis emocional del lead, negociación de precio, casos `_UNCLASSIFIED` de alta apuesta
- `D11._UNCLASSIFIED`

---

## D12. MEMORIA Y CONOCIMIENTO

Qué sabe el sistema, con qué alcance temporal y de qué fuente.

### D12.1 Memoria de trabajo (hilo actual)
- Últimos N turnos, hilos abiertos, plan vigente del agente

### D12.2 Memoria de contacto (perfil persistente)
- Slots de D5 consolidados, etapa, etiquetas, historial de outcomes, preferencias (idioma, horarios), eventos clave ("no-show el 12/5")
- Tu arquitectura de dual memory-lane con deduplicación de echoes vive aquí

### D12.3 Memoria episódica cross-conversación
- Resúmenes de conversaciones pasadas (no transcripciones crudas)
- Qué se le prometió y qué se le dijo (consistencia: el agente no puede contradecirse entre sesiones)

### D12.4 Conocimiento del negocio (semántico)
- FAQ, oferta, precios, casos de éxito, calendario — fuente de verdad versionada (si cambia el precio, el agente no puede citar el viejo)

### D12.5 Conocimiento del mundo
- Lo que el modelo base sabe — con política explícita de qué NO debe usar (no improvisar datos del negocio)

### D12.6 Anti-memoria
- Qué se debe olvidar/no usar: datos sensibles accidentales, información de otros leads (aislamiento multi-tenant), opt-outs
- `D12._UNCLASSIFIED`

---

## D13. OUTCOMES Y MÉTRICAS

### D13.1 Outcomes por conversación
- `D13.1.1` Booked (cita agendada) ✅ objetivo primario
- `D13.1.2` Calificado sin booking (pasó filtros pero no agendó) → nurture
- `D13.1.3` Descalificado (con razón codificada: presupuesto, ICP, geografía, comportamiento)
- `D13.1.4` Ghosted (se perdió en etapa X — la etapa de pérdida es el dato)
- `D13.1.5` Rechazo explícito
- `D13.1.6` Opt-out
- `D13.1.7` Escalado a humano (y sub-outcome del humano)
- `D13.1.8` Convertido directo (compró sin llamada)
- `D13.1._UNCLASSIFIED`

### D13.2 Outcomes post-conversación
- Show / no-show, reagendado, cerrado-ganado / cerrado-perdido (feedback loop del closer hacia el setter: ¿los leads que agenda la IA cierran?)

### D13.3 Métricas de funnel (tus ratios)
- MSR (Media Seen Rate), PRR (Prospect Response Rate), CSR (Calendly Sent Rate), ABR (Appointment Booked Rate)
- Tiempo a booking, número de turnos a booking, tasa de reactivación de follow-ups por ángulo

### D13.4 Métricas de calidad del agente
- Tasa de escalación, tasa de `_UNCLASSIFIED`, tasa de corrección humana (cuántas veces el operador pisa al agente), consistencia (contradicciones detectadas), quejas meta (D3.5.4)

### D13.5 Métricas de salud de cuenta
- Señales de spam/restricción de Meta, ratio de bloqueos/reportes
- `D13._UNCLASSIFIED`

---

## 14. MECANISMO DE EVOLUCIÓN (la arquitectura viva)

Esta sección es la que convierte el documento en un organismo y no en un PDF muerto. Regla de oro acordada: **si algo real no cabe en el modelo, el problema es del modelo.**

### 14.1 El contrato de clasificación
Todo evento conversacional se anota en las 13 dimensiones. Para cada dimensión donde el clasificador (LLM o regla) no encuentre categoría con confianza suficiente, asigna `_UNCLASSIFIED` y **adjunta obligatoriamente**:
- El texto/objeto crudo del evento
- La dimensión donde falló
- Las 2 categorías más cercanas que consideró y por qué no encajaron
- Confianza y timestamp

### 14.2 La cola de residuos
Los `_UNCLASSIFIED` se acumulan en una cola de revisión (tabla en Postgres, no un canal de Slack que se pierde). Revisión humana periódica (semanal al inicio, luego según volumen).

### 14.3 Reglas de decisión sobre un residuo
Para cada patrón residual, exactamente una de estas resoluciones:
1. **Error de clasificador** → la categoría existía; mejorar prompt/ejemplos del clasificador. El modelo no cambia.
2. **Nueva subcategoría** → cabe bajo una categoría existente pero merece distinción propia (ej: aparece sistemáticamente "objeción de pareja" distinta de "autoridad" genérica).
3. **Nueva categoría** → no cabe bajo ninguna existente dentro de su dimensión.
4. **Nueva dimensión** → (raro, evento mayor) el residuo no pertenece a ninguno de los 13 ejes. Requiere revisar ortogonalidad de todo el modelo.
5. **Ruido genuino** → caso único sin patrón. Se archiva. **Anti-patrón a evitar: crear categorías por un solo caso.**

### 14.4 Umbral de promoción
Un patrón residual se promueve a candidato cuando aparece **N veces** (sugerido: 5+ ocurrencias o 1% del volumen mensual, lo que llegue primero). Antes de eso, se observa.

### 14.5 Test de ortogonalidad para nuevas categorías
Antes de agregar, responder:
- ¿Es realmente de esta dimensión, o estoy mezclando ejes? (el error #1)
- ¿Es excluyente con sus hermanas, o es un atributo transversal? (si todo puede tenerlo, es atributo, no categoría)
- ¿Cambia alguna decisión del agente? Si dos categorías llevan siempre a la misma acción, quizás sobran.

### 14.6 Versionado
- Versionado semántico del modelo: **MAJOR** = nueva dimensión o reestructuración; **MINOR** = nueva categoría/subcategoría; **PATCH** = redacción, ejemplos, criterios.
- Changelog al final de este documento. Cada clasificación en producción guarda la versión de taxonomía con la que fue anotada (para no mezclar épocas en analítica).

### 14.7 Fuentes de evolución además de los residuos
- Correcciones del operador humano (cada override es señal de que el agente leyó mal alguna dimensión)
- Outcomes negativos sistemáticos (leads que agendan y no se presentan: ¿qué dimensión no estamos leyendo?)
- Cambios de plataforma (Meta agrega/quita capacidades → D6 y D11 cambian)
- Cambios de oferta del negocio (D1.5, D12.4)

---

## 15. ANEXO: ejemplo de anotación completa

Mensaje real hipotético, primer contacto tras comment-to-DM:

> *"Holaaa 🙌 vi tu reel del sistema de DMs, está brutal. Cuánto cuesta eso? Aunque te digo, este mes ando apretado jaja. Tengo una barbería y quiero meterle a las redes"*

| Dimensión | Anotación |
|-----------|-----------|
| D1 Contexto | Origen: D1.1.2 comment-to-DM · Histórico: D1.2.1 primer contacto · Funnel: D1.3.2 Media Seen (vio el reel) · Ventana 24h: abierta · Operativo: D1.7.1 agente activo |
| D2 Participantes | Lead: es-latino informal, dueño de barbería (nicho local-service) · ICP fit: a evaluar · Decisor probable: sí (negocio propio) |
| D3 Intención | Manifiesta: D3.1.3 precio + D3.6.4 cumplido · Latente: D3.3.1 objeción de precio *anticipada* (se auto-protege antes de oír el número) + D3.1.6 aplicabilidad implícita ("tengo una barbería" = ¿sirve para mí?) → multi-intent D3.9.2 |
| D4 Acto de habla | Directivo D4.2.1 (pregunta) + asertivo (self-disclosure de situación) + expresivo (cumplido) |
| D5 Entidades | Nicho: barbería · Objetivo: D5.1.3 "meterle a las redes" (vago, profundizar) · Presupuesto: D5.1.5 señal negativa débil, vigencia "este mes" (temporal, no estructural) |
| D6 Media | Solo texto; referencia a reel propio consumido |
| D7 Paralingüístico | "Holaaa" + 🙌 + "jaja" + "brutal": registro informal caribeño, valencia positiva, esfuerzo medio-alto (mensaje largo para ser el primero) |
| D8 Dinámica | Apertura D8.3.1 con salto directo a exploración · Iniciativa: del lead (buena señal) · Hilo abierto creado: deuda del agente (pregunta de precio) |
| D9 Emoción | Valencia positiva, entusiasmo + pre-vergüenza por dinero (el "jaja" amortiguador) · Trayectoria: caliente |
| D10 Acción del agente (plan) | Validar cumplido (D10.1.3) → espejar registro (D10.1.11) → NO dar precio seco: reencuadre suave de la objeción anticipada (D10.1.5) → pregunta de profundización sobre la barbería (D10.1.2, una sola) → actualizar slots (D10.2.2) → avanzar a Engaged si responde (D10.2.1) |
| D11 Restricciones | Política de marca: ¿precio por DM o solo en llamada? (decisión de D11.3.1 condiciona todo el plan) |
| D12 Memoria | Crear perfil de contacto, persistir nicho + señal de presupuesto con vigencia |
| D13 Outcome esperado | Trayectoria hacia Calendly Sent; riesgo principal: ghosting tras respuesta de precio |

> Nota: si en este mensaje hubiera aparecido algo inclasificable —p. ej. el lead manda la captura de un chat con un competidor pidiendo que se lo "tradzcas"— eso cae a `_UNCLASSIFIED` de D3 y entra a la cola del §14.

---

## Changelog

- **v1.0.0** — Borrador inicial. 13 dimensiones + mecanismo de evolución. Pendiente: revisión de RevolicoRD con experiencia de campo.
