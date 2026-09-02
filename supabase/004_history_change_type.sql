-- Lägg till change_type i translation_history för komplett audit-trail
ALTER TABLE translation_history
  ADD COLUMN IF NOT EXISTS change_type TEXT NOT NULL DEFAULT 'edit';

-- Kommentar: möjliga värden:
-- 'edit'           — manuell redigering av översättningstext
-- 'created'        — nyckel skapad (vid import)
-- 'source_updated' — engelska källtexten uppdaterad (vid import)
-- 'deleted'        — nyckel borttagen (vid import) — loggas innan radering
-- 'reviewed'       — manuellt markerad som granskad
-- 'unreviewed'     — manuellt markerad som ogranskad
-- 'ai_reviewed'    — automatiskt markerad som granskad av AI
