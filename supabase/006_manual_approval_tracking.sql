-- Migration 006: Spårning av manuellt godkännande och importerad text
--
-- manually_approved_text: den target_text-version som en människa senast godkände.
--   NULL = aldrig manuellt godkänd.
--   Om target_text === manually_approved_text → texten är manuellt godkänd.
--
-- imported_target_text: target_text som den såg ut vid import.
--   Används för "exportera bara ändrade" (target_text !== imported_target_text).

ALTER TABLE translations ADD COLUMN manually_approved_text TEXT;
ALTER TABLE translations ADD COLUMN imported_target_text TEXT;
