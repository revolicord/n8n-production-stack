-- Persistir el último instagram_context recibido por subscriber (presencia IG:
-- last_seen, last_interaction, messaging_window, etc.).
-- Antes el campo solo vivía en messages_raw.payload y nunca llegaba al worker,
-- por lo que el dispatch a n8n omitía instagram_context y el Build Context
-- siempre veía igCtx = {} para todos los leads. Esta columna lo hace persistente
-- y legible por el worker, que ya carga el subscriber desde DB.
ALTER TABLE api.subscribers
  ADD COLUMN IF NOT EXISTS instagram_context jsonb NOT NULL DEFAULT '{}'::jsonb;
