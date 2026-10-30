# "Skicka till PDH" – lösningsalternativ

## Alternativ 2

Hur ändrade texter går från Translate till produktion i PDH, och var nyckeln används.

### Flödet

1. Translate skriver filen `translations/incoming/sv-changes.json` till branchen `translate/sv` i PDH-repot. Finns branchen inte än skapar Translate den först som en kopia av `main`.
   *Nyckel: Translates Netlify-funktion använder GitHub-appens nyckel, som ligger i Netlify.*
2. Skrivningen är en push, och den startar GitHub Action i PDH-repot.
3. Actionen kör stegen i `.github/workflows/translate-import.yml`, en fil i PDH-repot. Den filen är Actionens "kod".
4. Actionen tar in följande:
   - från `main`: PDH:s importkod, `manage.py import_translations`, och de aktuella `en.json` och `sv.json`
   - från `translate/sv`: bara `sv-changes.json`, som läses som data

   *Nyckel: bara GitHubs inbyggda läsbehörighet. Appens nyckel finns inte i Actionen än.*
5. Actionen kör `manage.py import_translations` från `main`. Den lägger in de ändrade texterna i `main`s `sv.json` och uppdaterar `sv.sources.json`.
6. **Först nu** hämtar Actionen appens nyckel, som ligger som en hemlighet (secret) i PDH-repot.
7. Med nyckeln bygger Actionen om `translate/sv` som `main` plus en commit med de uppdaterade `sv.json` och `sv.sources.json`. `sv-changes.json` är borta.
8. Med samma nyckel öppnar Actionen en pull request från `translate/sv` till `main`, eller uppdaterar den som redan finns. Den innehåller bara ändringarna i `sv.json` och `sv.sources.json`.
9. PDH:s vanliga kontroller körs på pull requesten.
10. Du eller Christian mergar den, och texterna är live efter nästa deploy.

### Därför är det säkert

Nyckeln finns bara i Actionen under steg 6–8. Då är allt som har körts `main`s egen kod, och ingenting från `translate/sv` körs någonsin.

---

## Alternativ 3

Translate skriver språkfilerna själv och låter git-mergen smälta ihop dem med `main`. Ingen GitHub Action och ingen importkod i PDH.

### Grundidén

`sv.json` och `sv.sources.json` har en text per rad. Git jämför rad för rad. Om Translate bara byter de rader som ändrats och lämnar resten orört byte för byte, innehåller pull requesten bara de raderna. Nya texter som utvecklarna lagt till i `main` under tiden smälter mergen ihop automatiskt.

Kontrollerat mot PDH `main` 2026-10-21: `JSON.stringify(data, null, 2)` plus radbrytning återskapar båda filerna exakt, så Translate kan läsa, ändra och skriva tillbaka dem utan formatskillnader.

### Flödet

1. Användaren klickar "Skicka till PDH" i Translate.
2. Translates Netlify-funktion läser `en.json`, `sv.json` och `sv.sources.json` från `main` som de ser ut just nu, och kontrollerar varje ändrad text:
   - nyckeln finns i `en.json`
   - engelskan är densamma som när texten granskades (src-hashen stämmer)
   - placeholders (`{{count}}`, `<1>`) stämmer med engelskan
   - texten är inte tom
   - texten finns inte redan i PDH

   *Nyckel: appens nyckel, som ligger i Netlify, med bara läsbehörighet.*
3. Popupen visar resultatet: varje text som skickas (nyckel, engelska, PDH:s text just nu, ny text), och separat de som stoppas och varför. Har den svenska texten ändrats i PDH sedan importen visas en varning, men Translates text skrivs över den (Translates texter är granskade av en människa, PDH:s är AI-utkast).
4. Användaren klickar "Skicka". Funktionen:
   - skapar en ny branch, t.ex. `translate/sv-2026-10-21-1432`, från den `main` som popupen visade
   - gör en commit med `sv.json` och `sv.sources.json` där bara de skickade texterna (och deras src-hashar) är ändrade
   - öppnar en pull request med en tabell före/efter i beskrivningen
   - stänger äldre öppna `translate/sv-*`-pull requests ("Ersatt av #N") och tar bort deras brancher. Den nya innehåller allt de hade.

   *Nyckel: appens nyckel, som ligger i Netlify, med skrivbehörighet för Contents och Pull requests.*
5. PDH:s vanliga CI körs på pull requesten. Den kontrollerar redan att ingen svensk text saknas eller är inaktuell (`translate_locale sv --check`). Vi lägger till en kontroll av placeholders.
   *Nyckel: ingen. CI har bara läsbehörighet.*
6. Du eller Christian mergar den, och texterna är live efter nästa deploy.

Ingenting skickas om alla texter redan finns i PDH.

### Synk när man öppnar ett projekt

När man öppnar ett projekt hämtar Translate automatiskt `en.json` och `sv.json` från `main` ("Hämtar senaste texter…", några sekunder). Ingen förhandsvisning, bara en sammanfattning, t.ex. "12 nya texter, 3 med ändrad engelska".

En synk är inte en ren kopia av `main`: Translate har ändringar som inte finns i `main` än (osända, eller skickade men inte mergade). För varje text jämförs tre värden: PDH:s text vid förra synken (bas), Translates text och PDH:s text nu.

- Translate = bas (ingen egen ändring): PDH:s text tas in.
- PDH nu = bas (PDH har inte ändrat): Translates text behålls.
- Båda har ändrats: Translates text behålls, med varning.
- Engelskan har ändrats: texten flaggas "Engelska ändrad", som i dag.

Synken är ett komfortlager, inget skydd. Kontrollen vid "Skicka", PDH:s CI och git-mergen behövs ändå, eftersom `main` hinner ändras efter synken. Den ger:

- färre överraskningar i popupen (ändrad engelska, finns redan i PDH)
- att texter som redan mergats slutar räknas som ändrade
- att nya AI-utkast i PDH hamnar i Translate för granskning av sig själva

*Nyckel: appens nyckel, som ligger i Netlify, med bara läsbehörighet.*

### Om mergen får en konflikt

Det händer bara om någon i `main` har ändrat samma rad, eller raden intill, medan pull requesten låg öppen. Botemedel: tryck "Skicka till PDH" igen. Då görs en ny pull request från färsk `main` och den gamla stängs.

### Det som tas bort

- I PDH: `.github/workflows/translate-import.yml`, `manage.py import_translations`, appens nyckel som secret i PDH-repot
- I Translate: knappen "Exportera ändrade" och filen `sv-changes.json`

### Därför är det säkert

Nyckeln finns bara i Translates Netlify-funktion, som är Translates egen kod. Ingen kod från en branch körs någonsin med nyckeln. CI, som kör branchens kod, har ingen nyckel.

---

## Skillnader i korthet

- **Enklare:** alternativ 3 har inga Actions, ingen importkod i PDH och ingen secret i PDH. Hela skrivningen är Translates Netlify-funktion.
- **Säkerhet:** i alternativ 2 måste ordningen i Actionen vara rätt för att nyckeln inte ska nå branchkod. I alternativ 3 är frågan borta, nyckeln är aldrig i PDH.
- **Besked till användaren:** i alternativ 3 ser användaren i popupen vilka texter som stoppas innan något skickas. I alternativ 2 kommer beskedet först i Actionens pull request.
- **Kontroller:** i alternativ 2 görs de av PDH:s Python-kod. I alternativ 3 görs de i Translate och dubbelkollas av PDH:s vanliga CI. Kontrollerna finns alltså på två ställen och måste hållas lika.
- **Nackdel med alternativ 3:** Translate måste skriva filerna i exakt samma format som PDH. Ändrar PDH formatet blir diffen hela filen och mergen konfliktar, tills Translate anpassas.
- **Konflikter:** finns i båda. I alternativ 3 löses de genom att skicka igen, och synken vid start gör dem ovanligare.
