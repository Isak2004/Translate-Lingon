# Import- och AI-analyslogik

## Import

### Nya nycklar
Läggs in i databasen. Om nyckeln redan finns (t.ex. från en tidigare avbruten import) ignoreras den.

### Befintliga nycklar, ej manuellt redigerade
Om PDH:s översättning ändrats uppdateras `target_text` till det nya värdet. AI-status nollställs så att texten granskas vid nästa AI-körning.

### Befintliga nycklar, manuellt redigerade
Bara `imported_target_text` (referensvärdet) uppdateras. Den manuella texten rörs aldrig — en manuell översättning har alltid företräde framför en AI-genererad text från PDH.

### Radering
Nycklar raderas aldrig vid import. En saknad nyckel i importfilen kan bero på en delmängd eller en korrupt fil.

### Idempotens
Samma fil kan importeras flera gånger utan bieffekter. Andra körningen ändrar ingenting.

## AI-analys

### Vad granskas
Alla nycklar som har `source_text` + `target_text` och inte redan granskats (`ai_reviewed_at` är null).

### Resultat
Problem sparas i `ai_findings`. Granskade nycklar stämplas med `ai_reviewed_at` så de inte granskas igen.

### Samspel med import
När en import uppdaterar `target_text` nollställs `ai_reviewed_at` och gamla findings tas bort. Nästa AI-körning granskar den nya texten.

### Idempotens
Kan köras flera gånger utan problem. Redan granskade nycklar hoppas över.
