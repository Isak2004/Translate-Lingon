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

## Engelskan ändrad i PDH

### Spårning
`edited_source_text` sparar vilken engelska (`source_text`) en manuell text gjordes mot. Den sätts när användaren sparar en text eller godkänner den manuellt.

### Vid import
Om PDH:s engelska för en nyckel har ändrats uppdateras `source_text`. Den manuella svenskan rörs inte, men AI-status nollställs och gamla findings tas bort. Nyckeln räknas som "engelska ändrad" så länge `edited_source_text` skiljer sig från `source_text`.

### I gränssnittet
Filtret "Engelska ändrad" visar dessa nycklar. Raden visar tidigare och nuvarande engelska, din svenska och PDH:s svenska, med två val:
- **Behåll min text** — texten gäller även den nya engelskan (`edited_source_text` sätts till nuvarande engelska).
- **Använd PDH:s text** — svenskan återställs till den importerade texten och räknas inte längre som ändrad.

Att redigera och spara texten löser också flaggan.

### Vid export
Nycklar med ändrad engelska hoppas över, med en varning. Annars skulle en svensk text skriven för gammal engelska skickas till PDH med den nya engelskans hash och passera PDH:s kontroll.

## Exportformat

"Exportera ändrade" skriver `sv-changes.json` i formatet `translate-lingon/v1`: en platt map nyckel → `{ en, src, sv }` där `src` är sha256 av engelskan (12 första hex-tecknen, samma som PDH:s `source_hash`). Bara ändrade, icke-tomma texter tas med.
