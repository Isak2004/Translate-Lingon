-- Migration 009: spåra vilken engelska en manuell text/godkännande gjordes mot.
--
-- edited_source_text: source_text vid senaste manuella sparning eller godkännande.
--   NULL = aldrig manuellt ändrad/godkänd.
--   Om edited_source_text != source_text har engelskan ändrats i PDH efteråt,
--   och texten måste granskas igen innan den får exporteras.

ALTER TABLE translations ADD COLUMN IF NOT EXISTS edited_source_text TEXT;

-- Befintliga manuellt ändrade eller godkända rader antas gälla nuvarande engelska.
UPDATE translations
SET edited_source_text = source_text
WHERE edited_source_text IS NULL
  AND (
    (imported_target_text IS NOT NULL AND target_text IS DISTINCT FROM imported_target_text)
    OR manually_approved_text IS NOT NULL
  );
