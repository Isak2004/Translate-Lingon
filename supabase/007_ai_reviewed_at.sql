-- Migration 007: Spåra vilka nycklar som AI-granskats
--
-- ai_reviewed_at: tidstämpel för när nyckeln senast AI-granskades.
--   NULL = aldrig granskad → inkluderas vid nästa AI-körning.
--   Satt = hoppas över vid AI-granskning (redan granskad).

ALTER TABLE translations ADD COLUMN ai_reviewed_at TIMESTAMPTZ;
