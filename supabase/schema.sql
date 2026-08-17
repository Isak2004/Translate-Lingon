-- ============================================
-- Lingon Translation Editor — databasschema
-- Kör detta i Supabase SQL Editor (supabase.com → ditt projekt → SQL Editor)
-- ============================================

-- Projekt (en rad per JSON-filpar)
CREATE TABLE projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  source_language TEXT NOT NULL DEFAULT 'en',
  target_language TEXT NOT NULL DEFAULT 'sv',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Översättningar (en rad per nyckel)
CREATE TABLE translations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  source_text TEXT DEFAULT '',
  target_text TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(project_id, key)
);

-- Ändringshistorik (en rad per ändring)
CREATE TABLE translation_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  translation_id UUID NOT NULL REFERENCES translations(id) ON DELETE CASCADE,
  old_text TEXT,
  new_text TEXT NOT NULL,
  changed_by TEXT DEFAULT 'anonymous',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index för snabba uppslag
CREATE INDEX idx_translations_project ON translations(project_id);
CREATE INDEX idx_translations_key ON translations(key);
CREATE INDEX idx_history_translation ON translation_history(translation_id);
CREATE INDEX idx_history_created ON translation_history(created_at DESC);

-- Automatisk updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_projects
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_translations
  BEFORE UPDATE ON translations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security (öppen åtkomst via anon key — lås ner med auth senare)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_projects" ON projects
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "public_translations" ON translations
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "public_history" ON translation_history
  FOR ALL USING (true) WITH CHECK (true);
