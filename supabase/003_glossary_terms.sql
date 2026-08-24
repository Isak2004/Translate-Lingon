-- Ordlista (glossary) — godkända termer per projekt
CREATE TABLE glossary_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_term TEXT NOT NULL,
  definition TEXT NOT NULL DEFAULT '',
  approved_translation TEXT,          -- godkänd SV-översättning (null = ej fastställd)
  notes TEXT NOT NULL DEFAULT '',
  do_not_translate BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, source_term)
);

-- Samma trigger för updated_at som translations använder
CREATE TRIGGER set_glossary_updated_at
  BEFORE UPDATE ON glossary_terms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE glossary_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access" ON glossary_terms FOR ALL USING (true) WITH CHECK (true);
