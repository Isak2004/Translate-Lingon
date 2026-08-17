-- Lägg till reviewed-kolumn på translations
-- Kör detta i Supabase SQL Editor
ALTER TABLE translations ADD COLUMN reviewed BOOLEAN NOT NULL DEFAULT false;
