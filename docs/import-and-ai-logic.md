# Import- och AI-analyslogik

## Import

Körs automatiskt när ett projekt öppnas (utan förhandsvisning, med en kort sammanfattning) och manuellt via "Hämta igen". Bara rader där något ändras skrivs till databasen. Stoppvarningar (filerna verkar ha bytt plats) gör att den automatiska hämtningen avbryts.

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

### Vid skick till PDH
Nycklar med ändrad engelska hoppas över, med en varning. Annars skulle en svensk text skriven för gammal engelska skickas till PDH med den nya engelskans hash och passera PDH:s kontroll.

## Skicka till PDH

`netlify/functions/push-to-pdh.js` har två lägen. `preview` läser `en.json`, `<språk>.json` och `<språk>.sources.json` från PDH:s main och kontrollerar varje text (`netlify/lib/pdh-locale-edit.js`): nyckeln finns, `src` (sha256 av engelskan, 12 första hex-tecknen, samma som PDH:s `source_hash`) stämmer, texten är inte tom, platshållarna stämmer. `send` kör samma kontroll mot samma commit, gör en commit med de två filerna på en ny branch `translate/<språk>-ÅÅÅÅ-MM-DD-TTMM`, öppnar en pull request och stänger äldre sådana.

Bara de skickade värdena byts, resten av filerna är orörda byte för byte. Därför visar pull requesten bara de ändrade raderna och git-mergen kan smälta ihop den med main. Kan filen inte skrivas tillbaka exakt avbryts skicket. Design: `docs/pdh/SKICKA_TILL_PDH_ALTERNATIV.md`.
