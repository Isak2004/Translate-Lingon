-- AI-granskningsresultat — sparas mellan sessioner, en körning per projekt
CREATE TABLE ai_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  issue TEXT NOT NULL,
  suggestion TEXT,
  severity TEXT NOT NULL,  -- 'error', 'warning', 'info'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE ai_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access" ON ai_findings FOR ALL USING (true) WITH CHECK (true);
