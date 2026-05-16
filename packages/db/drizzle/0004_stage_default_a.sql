-- Change default stage from 'nuevo' to 'A' and fix existing rows
ALTER TABLE api.lead_stages ALTER COLUMN current_stage SET DEFAULT 'A';

UPDATE api.lead_stages
SET current_stage = 'A'
WHERE current_stage = 'nuevo';
