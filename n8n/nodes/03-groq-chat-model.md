# Nodo: Anthropic Chat Model

> **Nota:** este archivo se llamaba "Groq Chat Model" hasta que el workflow migró a Anthropic Claude. Groq (`llama-3.3-70b-versatile`) fue reemplazado en la v3+ del workflow.

**Tipo:** `@n8n/n8n-nodes-langchain.lmChatAnthropic`  
**typeVersion:** 1.5  
**Conexión:** `ai_languageModel` → `AI Agent` y `Structured Output Parser`

---

## Configuración

| Campo | Valor |
|-------|-------|
| Model | `claude-sonnet-4-6` |
| Temperature | `0.3` |
| Credencial | `Anthropic account` (id: `CqaNlJsRteqVJlUs`) |

---

## Notas

- El modelo está hardcoded en el nodo. El campo `tenant.config.model` del payload (ej. `"gpt-4o-mini"`) se ignora.
- Temperature 0.3 provee salidas deterministas suficientes para el JSON plan sin ser completamente rígido.
- El nodo alimenta tanto al `AI Agent` (languageModel) como al `Structured Output Parser` (también languageModel) — n8n conecta ambos desde el mismo nodo.
- Para cambiar modelo: editar este nodo en la UI de n8n y actualizar el campo `model`.

---

## Por qué Anthropic y no Groq

Groq (`llama-3.3-70b-versatile`) fue descartado porque:
- El Structured Output Parser con `autoFix: true` requiere un modelo con JSON mode robusto.
- Claude Sonnet 4.6 produce JSON válido consistentemente incluso con el schema complejo de `actions` array.
- Latencia aceptable para el caso de uso (turnos de DM, no tiempo real).
