# Modelos de diálogo 2009 vs. 2026: qué sigue vigente y qué usar para tu setter de IA en Instagram DM

## TL;DR
- **El concepto del paper de Zapata y Mesa (2009) con MAYOR vigencia en producción en 2026 es la teoría de actos del habla materializada como intent/dialogue-act detection + sistemas intencionales orientados a la tarea (TOD) con dialogue state tracking (DST) e iniciativa mixta.** No murió: se renombró y se reimplementó sobre LLMs. La distinción "pregunta-respuesta vs. intencional" sigue siendo la columna vertebral del diseño conversacional.
- **Lo obsoleto:** VoiceXML/ASR de gramática (Nuance Enterprise descontinuado por Microsoft, con retiro escalonado 2024-2027), NL-to-SQL vía lambda calculus, etiquetado manual de corpus a gran escala, gestión "por hilos" codificada a mano y los gestores de diálogo POMDP entrenados sobre corpus. El "dialog manager" NO desapareció: sobrevive como capa de orquestación determinista (Rasa CALM, LangGraph, máquinas de estado + LLM).
- **Para tu caso (setter por DM de Instagram con ManyChat + Meta webhooks + n8n):** el patrón ganador en 2026 es **LLM para entender (dialogue understanding) + lógica determinista para decidir (flows/state machine) + function calling/tool use para actuar**, con qualification BANT como "slot filling" moderno, respetando la ventana de 24 h de Meta y el timeout de ManyChat.

## Key Findings

1. **Actos del habla → intent detection / dialogue act classification: VIGENTE.** La tarea sigue activa en la literatura 2024-2026 (ACL 2025) y en producción como intent classification y routing. Es el concepto de 2009 que más claramente "sigue siendo verdad" y se usa hoy.
2. **Sistemas intencionales con iniciativa mixta + DST: VIGENTE y dominante.** La dicotomía TOD (task-oriented) vs. open-domain del paper sigue estructurando todo el campo; DST se mantiene como componente, ahora a menudo impulsado por LLM.
3. **Gestor de diálogo (dialog manager): VIGENTE pero transformado.** Pasó de POMDP/máquinas de estado entrenadas a una capa de orquestación que separa "lenguaje" (LLM) de "lógica de negocio" (flows deterministas). Rasa CALM lo nombra explícitamente "Dialogue Manager".
4. **Estructura del discurso (Grosz y Sidner: intención/atención): VIGENTE como teoría base**, citada todavía, aunque hoy el manejo de contexto/atención lo resuelve el mecanismo de atención del Transformer y la gestión de ventana de contexto/memoria.
5. **Modelos estocásticos (POMDP, HMM) para gestión: SUPERADOS** por seq2seq → Transformers → LLMs. Siguen siendo referencia histórica y aún hay nichos.
6. **VoiceXML, NL-to-SQL vía lambda calculus, etiquetado manual de corpus, modelo de hilos manual: OBSOLETOS** como práctica de construcción, reemplazados por STT neuronal/voice agents, text-to-SQL con LLM (Spider 2.0), datos sintéticos generados por LLM y orquestación basada en grafos/flows.
7. **Métricas de evaluación (Bernsen et al.): el ESPÍRITU sigue vigente** (tasa de éxito de tarea, diálogos completados), ampliado con Joint Goal Accuracy (DST), benchmarks (MultiWOZ) y evaluación LLM-as-judge.
8. **Nuevo paradigma de producción (no existía en 2009):** RAG, function calling/tool use con salidas estructuradas (JSON), Model Context Protocol (MCP) como estándar de integración de herramientas, guardrails y memoria conversacional.

## Details

### El paper de 2009 en una frase
Zapata y Mesa hacen una revisión de literatura que organiza los modelos de diálogo alrededor de: (a) **actos del habla** (Austin, Searle, Grice, Sperber y Wilson) como unidad de análisis; (b) **caracterización del discurso** (Grosz y Sidner: intención + atención; Zubizarreta: funciones ilocutivas y gramática léxico-funcional; Really); (c) **etiquetado multinivel** de actos del habla (Martínez et al., Clark y Popescu-Belis) para alimentar **modelos estocásticos**; (d) un **gestor de diálogo** que administra subdiálogos (modelo de hilos de Calle); (e) dos arquetipos de sistema: **pregunta-respuesta** (solo el sistema dirige) e **intencionales** (iniciativa mixta, metas, generación); (f) tecnologías de la época: **VoiceXML**, **NL-to-SQL vía lambda calculus**; (g) **métricas** (Bernsen et al.); y (h) aplicabilidad a **educción de requisitos de software**. El dominio implícito es el diálogo HABLADO (comprar tiquete de tren, reservar vuelo).

### EJE A — Validación teórica concepto por concepto

**Actos del habla / dialogue act classification (VIGENTE — el ganador).** La tarea que en 2009 era "etiquetar actos del habla" hoy se llama dialogue act classification / intent detection y sigue siendo un área activa: hay trabajo reciente (ACL 2025) que estudia por qué los LLMs aún fallan en la clasificación fina de 50 clases multipartita, y repositorios canónicos (NLP-progress) siguen definiendo la tarea citando directamente a Austin (1975) y Searle (1969). La conexión es explícita y directa. En producción, el "intent" es la base de chatbots, asistentes y routing. La pregunta caliente de 2024-2026 es si los LLMs grandes hacen innecesario un paso explícito de clasificación de intención: hay trabajos que muestran que un LLM suficientemente grande puede "compensar la ausencia de un paso explícito de clasificación de intención usando su razonamiento interno" (AutoTOD con GPT-4), pero otros lo refutan para datos completos. Según el paper arXiv 2507.01541 (2025): *"Previous studies reporting comparisons in full-data settings show that LLMs still underperform relative to BERT-based approaches in such cases (Parikh et al., 2023; Mirza et al., 2024). This underscores the continued relevance of BERT-based methods for practical deployment."*

**Sistemas intencionales vs. pregunta-respuesta + iniciativa mixta (VIGENTE).** La dicotomía del paper mapea casi 1:1 a la dicotomía moderna **task-oriented dialogue (TOD) vs. open-domain dialogue (ODD)**, que organiza los surveys de 2023-2026. La "iniciativa mixta" sigue siendo un objetivo de diseño. El concepto de "sistema intencional con metas" es exactamente lo que hoy es un agente TOD.

**Dialogue State Tracking (heredero del seguimiento de intención/atención): VIGENTE.** DST "sigue siendo un componente importante en sistemas TOD" y en 2025 "comúnmente trabaja junto a LLMs: el LLM entiende texto libre mientras DST mantiene el estado estructurado necesario para acciones, llamadas a API o consultas a base de datos". Esto es la versión moderna del "estado de atención" de Grosz y Sidner combinado con slot filling.

**Gestor de diálogo (VIGENTE, transformado).** No desapareció con los LLMs. Rasa CALM lo nombra explícitamente y separa "dialogue understanding" (un LLM interpreta y genera comandos) de un "Dialogue Manager" que ejecuta flows deterministas. La documentación oficial de Rasa (rasa.com/docs/learn/concepts/dialogue-management) lo describe así: *"The dialogue understanding component delivers a set of commands to the dialogue manager, these commands might include something like StartFlow(\"transfer_money\") or SetSlot(transfer_amount, 100)"*; y CALM *"combines language model flexibility with predefined logic ... LLMs keep the conversation fluent but don't guess your business logic."* LangGraph cumple la misma función con grafos de estado, checkpointing y human-in-the-loop.

**Estructura del discurso de Grosz y Sidner (VIGENTE como base teórica).** Se sigue citando, pero la atención/foco que ellos modelaban manualmente hoy emerge del mecanismo de atención del Transformer y de la gestión de ventana de contexto y memoria. Es decir: la teoría se mantiene, la implementación cambió radicalmente.

**Modelos estocásticos / POMDP (SUPERADOS).** El POMDP fue el estado del arte de gestión estadística (Young et al. 2013). El trabajo reciente "va mucho más allá del modelo POMDP, incluyendo RLHF y PPO" y muestra "cómo los LMs pueden usarse para gestión de diálogo". Quedaron como hito histórico.

**Funciones ilocutivas + gramática léxico-funcional (Zubizarreta) (NICHO/SUPERADO en producción).** El análisis sintáctico-semántico explícito vía LFG fue reemplazado por representaciones neuronales aprendidas. Sobrevive en lingüística computacional teórica, no en el stack de producción.

### EJE B — Evolución técnica hacia producción 2026

**La transición histórica (cuatro etapas).** Los surveys de evolución de sistemas de diálogo la dividen en: (1) reglas/ELIZA (1966) y estadístico (HMM, años 90-2015); (2) desarrollo independiente de TOD y ODD con deep learning (2015-2019, seq2seq, Word2Vec); (3) fusión con Transformers/PLM (2019-2022, BERT, GPT-2); (4) sistemas basados en LLM (2022-hoy). Tu intuición de "reglas → estocástico → neuronal → Transformers → LLMs → agentes con tool use" es exactamente la trayectoria documentada.

**Function calling / tool use + structured outputs (NÚCLEO de producción).** Es lo que convierte un "generador de texto" en un "agente que actúa": el LLM emite JSON conforme a un esquema indicando qué función llamar y con qué argumentos; tu código ejecuta. Soportado por OpenAI, Anthropic, Google. Es el reemplazo moderno y robusto del viejo NL-to-SQL: en lugar de traducir a SQL vía lambda calculus, el LLM llama una herramienta `buscar_disponibilidad(fecha)`.

**RAG y memoria conversacional.** RAG (retrieve-then-answer) es el patrón estándar para dar conocimiento de producto/FAQ al agente sin reentrenar, y reduce alucinaciones. La memoria de largo plazo del agente funciona como un datastore tipo RAG.

**Guardrails (nuevo, esencial).** Capa de defensa en producción: input rails, output rails, dialog rails, retrieval rails (NeMo Guardrails de NVIDIA usa el DSL Colang; Guardrails AI valida salidas estructuradas). Sin esto, un piloto de LLM "falla la revisión de seguridad y nunca se despliega".

**Model Context Protocol (MCP) (nuevo estándar de facto).** Lanzado el 25 de noviembre de 2024 por los desarrolladores de Anthropic David Soria Parra y Justin Spahr-Summers; el anuncio oficial ("Introducing the Model Context Protocol", Nov 25, 2024) lo describe: *"Today, we're open-sourcing the Model Context Protocol (MCP), a new standard for connecting AI assistants to the systems where data lives."* En diciembre de 2025 Anthropic lo donó a la Agentic AI Foundation (Linux Foundation). Para 2026 hay más de 16.000 servidores MCP y SDKs para todos los lenguajes principales, con adopción por OpenAI (ChatGPT, Agents SDK, Responses API) y Google DeepMind; Demis Hassabis (CEO de Google DeepMind) afirmó: *"MCP is a good protocol and it's rapidly becoming an open standard for the AI agentic era."* Es el "puerto universal" para conectar agentes a herramientas/datos; relevante si quieres exponer tu CRM o catálogo como herramienta estándar.

**Frameworks de producción 2026 (panorama):**
- **Rasa / Rasa CALM:** conversational AI de nivel empresarial, on-premise, lógica determinista (flows en YAML), separa LLM de lógica; usado en banca/telecom/salud. Su arquitectura CALM es el ejemplo más claro de "el dialog manager de 2009 reencarnado".
- **LangGraph:** orquestación basada en grafos de estado, checkpointing, durable execution, human-in-the-loop. El más usado para controlar cada paso del razonamiento.
- **LangChain:** framework modular de propósito general (chains, tools, memory).
- **LlamaIndex:** RAG-first.
- **Microsoft Semantic Kernel / Copilot Studio:** ecosistema .NET/Azure.
- **CrewAI, AutoGen/AG2, OpenAI Agents SDK, Anthropic Claude Agent SDK, Pydantic AI:** orquestación multi-agente y agentes nativos.
- **Botpress, Voiceflow, Dialogflow CX, ManyChat:** plataformas de chatbot/no-code.
- **n8n:** orquestación event-driven (tu stack actual).

**Intent classification: ¿vivo o muerto?** Vivo, pero hibridado. Patrón común: clasificador rápido y barato (BERT/embeddings/FAISS) para enrutar + LLM para los casos complejos. "El clasificador de intención basado en FAISS permanece sin cambios sin importar qué LLM uses... la clasificación de intención permanece rápida, local y determinista". Esto es directamente aplicable a optimizar costo/latencia en tu setter.

**Dialog flows: máquina de estados vs. LLM-driven.** El consenso 2026 es híbrido (CALM lo formaliza): el LLM maneja la variabilidad lingüística ("hook me up with a spot" = "make a reservation"), pero la lógica de negocio crítica va en flows deterministas y versionados para fiabilidad y debugging. Esto reemplaza tanto al "modelo de hilos" manual de Calle como a las stories rígidas del Rasa clásico.

### Aplicación específica: setter de IA / SDR por DM de Instagram

**Patrones de diseño de cualificación de leads.** BANT (Budget, Authority, Need, Timeline) es el framework dominante para AI SDR/setters; es, en términos del paper, **slot filling intencional**: el agente "adapta el cuestionamiento según las respuestas del prospecto en tiempo real". MEDDIC es la alternativa B2B compleja. La arquitectura típica de un AI SDR en 2025 tiene: motor NLP (intent/entidades/contexto multi-turno), motor de lógica de cualificación (BANT scoring, decide qualified/disqualified/handoff), base de conocimiento + generación, y capa de integración CRM. Esto es un sistema intencional con iniciativa mixta y DST — exactamente el arquetipo "intencional" de Zapata y Mesa.

**Restricciones de plataforma de Instagram (Meta) — CRÍTICAS:**
- **Ventana estándar de mensajería: 24 horas.** Documentación oficial de Meta (developers.facebook.com, Instagram API with Instagram Login – Messaging): *"Your app has 24 hours to respond to any message sent from an Instagram user to your app user."* No puedes iniciar en frío: la conversación solo empieza cuando el usuario manda mensaje primero.
- **Tag HUMAN_AGENT extiende a 7 días, PERO es solo para humanos.** Documentación oficial de Meta (Overview of the Instagram API): *"The Human Agent feature allows your app to have a human agent respond to user messages using the human_agent tag within 7 days of a user's message ... for cases where a user's issue cannot be resolved in the standard messaging window."* Los bots automatizados NO pueden usarlo: la API lo bloquea y devuelve error 400. **Tu setter de IA no puede usar este tag para extender outreach automatizado**; solo aplica a respuestas humanas genuinas (vía Handover Protocol/Inbox).
- **Deprecación abril-2026:** los tags CONFIRMED_EVENT_UPDATE, ACCOUNT_UPDATE y POST_PURCHASE_UPDATE dejan de funcionar (error 100); migrar a Utility Templates / Marketing Messages API.
- **Disclosure de bot obligatorio** en algunas jurisdicciones (California, Alemania): "las experiencias de chat automatizadas deben revelar que una persona interactúa con un servicio automatizado".
- **Rate limits oficiales** (confirmados en docs de Meta, Overview of the Instagram API): *"Your app can make 2 calls per second per Instagram professional account ... 100 calls per second per Instagram professional account for messages that contain text, links, reactions, and stickers ... 10 calls per second ... for audio or video ... 750 calls per hour ... for private replies to comments."* Límite de 1.000 caracteres por mensaje de Instagram. (Las cifras de "200 DMs/hora" y "1 DM por usuario/24h" que circulan en blogs de proveedores NO están en la documentación oficial de Meta; CreatorFlow (mayo 2026) reconoce que el cap de ~200 DMs/hora *"is a tool-side and behavioral pacing convention, not a number Meta publishes"* — es throttling del lado de la herramienta, no de Meta. Trátalas como no verificadas.)

**ManyChat AI en 2025-2026:**
- **AI Step:** "usa inteligencia artificial para manejar interacciones complejas de usuario... opera con base en un script o conjunto de instrucciones para lograr objetivos específicos como recolectar información o dar respuestas personalizadas". Soporta Instagram, Messenger, WhatsApp y Telegram. Puede guardar la respuesta del usuario en un Custom Field (= captura de datos de cualificación).
- **Intention Recognition:** trigger avanzado con NLP que "entiende intenciones del usuario más allá de keywords simples". (Es literalmente "intent detection" del paper.)
- **GPT bajo el capó:** ManyChat ofrece integración directa con ChatGPT (con tu propia API key de OpenAI) además del AI Step nativo; las respuestas "deben completarse en 120 segundos o se descartan".
- **Handoff a n8n:** vía "External Request" (feature PRO; POST/GET/PUT/DELETE con body JSON). **Cuidado: timeout máximo ~10 segundos** (reportado por la comunidad, no en docs oficiales) — para respuestas LLM más lentas usa patrón asíncrono: n8n responde al webhook de inmediato y luego empuja la respuesta vía la Public API de ManyChat.
- **Precio (en transición):** modelo legacy = Pro (~$15-29/mes) + AI add-on $29/mes; modelo nuevo distribuye AI entre planes por "Active Contacts". Verifica el precio según tu cuenta.

**Manejo de turnos en chat asíncrono (clave para DM).** A diferencia del diálogo hablado del paper (turnos limpios por respiros/pausas), el DM es asíncrono y los usuarios mandan mensajes fragmentados ("Hola", "una pregunta", "¿tienen stock?"). El patrón de producción es **debounce/buffering**: esperar N segundos (típico 5s) agrupando mensajes del mismo remitente antes de invocar al LLM, para evitar respuestas spam, perder contexto y multiplicar costo de API. Hay enfoques más avanzados de "end-of-turn detection" con un clasificador que predice si el usuario terminó de escribir, sin límite de tiempo fijo.

## Recommendations

**Respuesta a tu pregunta central:** el modelo de 2009 con más vigencia es **los actos del habla operacionalizados como intent/dialogue-act detection, dentro del arquetipo de sistema intencional (TOD) con iniciativa mixta y seguimiento de estado (DST)**. Confirma tu hipótesis con un matiz: no es "actos del habla" en abstracto (la teoría lingüística es base, no implementación), sino su materialización como detección de intención + gestión de estado intencional. El "gestor de diálogo" también sobrevive fuerte, ahora como capa determinista sobre el LLM.

**Arquitectura recomendada para tu setter (etapas):**

1. **MVP (semanas 1-2): aprovecha tu stack.** ManyChat (trigger + Intention Recognition para enrutar) + External Request → n8n → LLM con function calling. Define la cualificación BANT como slots a llenar. Implementa **debounce de ~5s** en n8n antes de invocar el LLM. Añade el disclosure de bot. Responde el webhook de ManyChat en <10s o usa callback asíncrono vía Public API.
2. **Estructura del diálogo: híbrido LLM + flow determinista.** No dejes que el LLM "improvise" toda la lógica de venta. Usa el LLM para entender (dialogue understanding) y un flow/máquina de estados explícito para decidir (preguntar siguiente slot BANT, calificar, agendar, escalar a humano). Si creces en complejidad, migra la orquestación a **LangGraph** (state + checkpointing) o evalúa **Rasa CALM** si necesitas lógica determinista y on-premise.
3. **Conocimiento y acciones:** RAG para FAQ/catálogo de producto; function calling para acciones reales (agendar, crear lead en CRM, consultar stock). Considera **MCP** para estandarizar la conexión a tu CRM si vas a tener varias herramientas.
4. **Guardrails desde el día uno:** valida salidas estructuradas (JSON del scoring BANT), filtra inputs, y define respuestas de fallback/escalado. Usa un clasificador barato (embeddings/FAISS) para enrutar y reservar el LLM grande para casos complejos — baja costo y latencia.
5. **Evaluación:** mide tasa de conversaciones completadas con éxito y tasa de cualificación (espíritu de Bernsen et al.), más métricas de negocio (leads calificados, citas agendadas). Si usas DST formal, Joint Goal Accuracy.

**Umbrales que cambian la recomendación:**
- Si tu volumen y la lógica de venta son simples → quédate en ManyChat + n8n + un LLM con prompt + flows; no añadas frameworks pesados.
- Si necesitas multi-paso complejo, ramificaciones, human-in-the-loop, auditoría → LangGraph.
- Si necesitas cumplimiento estricto/on-premise/datos sensibles → Rasa CALM.
- Si la latencia/costo del LLM por cada turno se vuelve problema → introduce clasificador de intención local (BERT/FAISS) como primer filtro.
- Si quieres expandir a voz (llamadas) → ahí entran voice agents (no VoiceXML); arquitectura distinta.

## Tabla de seguimiento: concepto del paper (2009) → estado en 2026 → términos de búsqueda

| Concepto del paper (2009) | Estado en 2026 | Términos / fuentes para mantenerte al día |
|---|---|---|
| Actos del habla (Austin, Searle, Grice) | VIGENTE como base teórica; citado en papers actuales | "speech act theory LLM", "dialogue act classification 2026", Austin/Searle en NLP-progress |
| Etiquetado/clasificación de actos del habla | VIGENTE como **dialogue act classification / intent detection** | "intent detection LLM era", "dialogue act classification ACL", paperswithcode "Dialogue Act Classification" |
| Sistemas pregunta-respuesta vs. intencionales | VIGENTE como **TOD vs. open-domain (ODD)** | "task-oriented dialogue vs open-domain", "TOD LLM survey 2024-2026" |
| Iniciativa mixta | VIGENTE como objetivo de diseño | "mixed-initiative dialogue", "proactive dialogue systems" |
| Estructura del discurso (Grosz y Sidner: intención/atención) | VIGENTE como teoría; atención hoy = Transformer + ventana de contexto/memoria | "discourse structure dialogue", "conversational memory LLM", "Grosz Sidner attention intention" |
| Gestor de diálogo / modelo de hilos (Calle) | VIGENTE pero transformado: capa de orquestación determinista sobre LLM | "Rasa CALM dialogue manager", "LangGraph state management", "dialogue management LLM" |
| Modelos estocásticos / POMDP | SUPERADO (referencia histórica) | "POMDP dialogue management", "from POMDP to LLM dialogue" |
| Dialogue state tracking (implícito en "atención"/intención) | VIGENTE y central, ahora LLM-driven | "dialogue state tracking 2025", "DST LLM", "slot filling", "MultiWOZ Joint Goal Accuracy" |
| Funciones ilocutivas + LFG (Zubizarreta) | NICHO/superado en producción | "lexical functional grammar", "semantic parsing dialogue" |
| NL-to-SQL vía lambda calculus | SUPERADO por text-to-SQL con LLM | "text-to-SQL LLM", "Spider 2.0 benchmark", "BIRD-bench" |
| VoiceXML | OBSOLETO (Nuance Enterprise descontinuado, retiro 2024-2027); reemplazado por voice agents | "VoiceXML legacy IVR", "replace IVR AI voice agents", "voice AI agent 2026" |
| Métricas (Bernsen et al.) | ESPÍRITU vigente, ampliado | "task success rate dialogue", "LLM-as-judge evaluation", "multi-turn dialogue evaluation survey" |
| (No existía) Function calling / tool use | NÚCLEO de producción | "function calling LLM", "tool use agents", "structured outputs JSON schema" |
| (No existía) RAG | Estándar para conocimiento | "retrieval augmented generation", "RAG production best practices" |
| (No existía) Guardrails | Esencial en producción | "LLM guardrails", "NeMo Guardrails Colang", "Guardrails AI validators" |
| (No existía) MCP | Estándar de facto de integración de herramientas | "Model Context Protocol", "MCP servers", "MCP enterprise adoption" |
| (No existía) Frameworks de agentes | Ecosistema maduro | "best AI agent frameworks 2026", "LangGraph vs Rasa vs CrewAI" |
| Caso: educción de requisitos | Línea de investigación viva con LLMs | "LLM requirements elicitation", "conversational requirements engineering" |
| Caso: setter/SDR por DM | Categoría comercial activa | "AI SDR BANT qualification", "ManyChat AI agent Instagram", "Instagram messaging API 24 hour window", "asynchronous chat debounce LLM agent" |

## Caveats
- **Sesgo de fuentes comerciales:** mucha información sobre frameworks y AI SDR proviene de blogs de proveedores (Rasa, Lindy, NextLevel, ManyChat) con incentivo de marketing; las cifras de conversión ("2x pipeline", "70% más rápido") son afirmaciones de vendedor, no estudios independientes.
- **Cifras de Instagram no oficiales:** los límites de "200 DMs/hora" y "1 DM por usuario/24h" aparecen solo en blogs de terceros, no en docs de Meta (que solo publica límites por segundo); el timeout de ~10s de ManyChat External Request es reportado por la comunidad, no documentado oficialmente. Verifica contra la documentación oficial vigente antes de diseñar.
- **VoiceXML/Nuance:** la fecha exacta es matizable — Microsoft descontinuó la venta de Nuance Enterprise (hosted/on-premise) en agosto de 2024, con soporte hosted terminando en diciembre de 2025 y retiro escalonado de productos hacia 2026-2027. El punto de fondo (VoiceXML como tecnología legacy reemplazada por voice agents neuronales) se mantiene.
- **Precio de ManyChat en transición** (2025-2026): cifras varían según plan legacy vs. nuevo modelo de "Active Contacts". Confirma con tu cuenta.
- **Debate abierto intent-vs-LLM:** la evidencia es contradictoria sobre si un LLM grande elimina la necesidad de clasificación de intención explícita; depende de datos, costo y latencia. No es una verdad cerrada.
- **El paper de 2009 es una revisión, no un sistema:** algunos "modelos" que cita ya estaban en transición entonces; la comparación es de paradigmas, no de productos uno a uno.
- **Versionado de APIs:** las cifras de rate limit difieren entre la documentación de Messenger y la de Instagram Login (p. ej. 100 vs. 300 llamadas/seg); usa la versión de API que corresponda a tu integración.