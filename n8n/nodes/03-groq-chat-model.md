# Nodo: Groq Chat Model

**Tipo:** `@n8n/n8n-nodes-langchain.lmChatGroq`  
**typeVersion:** 1  
**Conexión:** `ai_languageModel` → `AI Agent`

---

## Configuración

| Campo | Valor |
|-------|-------|
| Model | `llama-3.3-70b-versatile` |
| Credencial | Groq API (crear en console.groq.com — free tier) |

---

## Notas

- `llama-3.3-70b-versatile` soporta tool calling vía API de Groq, pero requiere que el system prompt sea explícito sobre cómo usar las tools (ver `system-prompt.md`).
- Si el modelo emite `<function=name>{...}` como texto plano en vez de ejecutar la tool, el problema es el prompt, no el modelo. Groq sí ejecuta tools correctamente cuando el prompt es claro.
- Alternativas probadas si sigue fallando: `llama-3.1-8b-instant` (más ligero, mejor tool use en casos simples), o migrar a Claude Haiku 4.5 cuando haya créditos Anthropic.
