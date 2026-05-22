-- Escrito a mano: Drizzle genera DROP+ADD para RENAME de columnas con constraints,
-- lo que destruiría datos en producción. El RENAME preserva los valores existentes
-- y el UPDATE los convierte de horas a minutos.
ALTER TABLE api.followup_templates RENAME COLUMN delay_hours TO delay_minutes;

UPDATE api.followup_templates
  SET delay_minutes = delay_minutes * 60;
