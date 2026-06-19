ALTER TABLE api.stage_transitions_map
  ADD COLUMN trigger TEXT;
--> statement-breakpoint
-- Backfill conservador para los funnels existentes (idempotente, sólo NULL):
-- la escotilla hacia `disqualified` es 'deny'; la única arista de avance restante
-- por etapa es el camino feliz 'affirm'. Si una etapa tuviera 2 avances legítimos,
-- ambos quedarían 'affirm' (el motor reportaría ambiguous_target) y se corrige en
-- el panel /settings — la determinación se declara, no se infiere de la topología.
UPDATE api.stage_transitions_map
  SET trigger = 'deny'
  WHERE trigger IS NULL AND to_stage_slug = 'disqualified';
--> statement-breakpoint
UPDATE api.stage_transitions_map
  SET trigger = 'affirm'
  WHERE trigger IS NULL;
