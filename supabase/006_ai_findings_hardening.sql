-- Härda ai_findings — default severity + validering.
-- Appen städar redan AI-resultatet innan insert (se Editor.tsx), men det här
-- gör att SJÄLVA TABELLEN garanterar giltig data oavsett vem som skriver till
-- den. Belt-and-suspenders: en saknad/felaktig severity kan aldrig mer fälla
-- ett insert och radera projektets resultat.

-- Sätt default så en saknad severity fylls i istället för att avvisas
ALTER TABLE ai_findings ALTER COLUMN severity SET DEFAULT 'info';

-- Städa ev. befintliga ogiltiga värden FÖRST (annars misslyckas CHECK nedan)
UPDATE ai_findings SET severity = 'info'
WHERE severity NOT IN ('error', 'warning', 'info');

-- Tillåt bara de tre giltiga värdena
ALTER TABLE ai_findings
  ADD CONSTRAINT ai_findings_severity_check
  CHECK (severity IN ('error', 'warning', 'info'));
