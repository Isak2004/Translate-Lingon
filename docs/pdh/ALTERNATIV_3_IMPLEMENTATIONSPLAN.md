# Alternativ 3 – implementationsplan

Bygger på [SKICKA_TILL_PDH_ALTERNATIV.md](SKICKA_TILL_PDH_ALTERNATIV.md), alternativ 3. Gäller bara UI-texterna i `pdh-react-frontend/src/i18n/locales/` (inte `notifications/locales`).

Arbetet görs i två delar som kan levereras var för sig:

- **Del A – Translate** (`Isak2004/Translate-Lingon`): ny sändning och synk vid start. Pushas av oss.
- **Del B – PDH** (`lingon/product-data-hub`): ta bort det gamla flödet, lägg till placeholder-kontroll i CI. En PR som PDH-utvecklarna mergar.

Del A först. Den fungerar oberoende av att den gamla Actionen finns kvar, och när den är verifierad kan Del B ta bort Actionen.

Ingen databasändring i Translate behövs, så Isak behöver inte köra någon SQL.

---

## Fakta som planen vilar på (kontrollerat 2026-10-21 mot PDH main `08710099`)

- `sv.json`: nästlad (upp till 6 nivåer), 5 480 texter, en text per rad.
- `sv.sources.json`: `{"$comment": [...], "keys": {"<platt nyckel>": {"src": "<12 tecken>"}}}`, nycklarna sorterade, alla ASCII.
- `JSON.stringify(data, null, 2) + "\n"` återskapar båda filerna byte för byte.
- Inga nycklar innehåller punkt, så platt nyckel ↔ nästlad sökväg är entydig.
- `src` = `sha256(engelska).hex[:12]`, samma som Translates `sourceHash`.
- Placeholders enligt PDH: `\{\{[^}]+\}\}|</?[a-zA-Z][a-zA-Z0-9_]*>`, jämförs som sorterad lista.
- Translates `imported_target_text` är redan "bas" (PDH:s text vid förra importen), och dagens `importFiles` följer redan reglerna bas/Translate/main.
- PDH:s `ci.yml` kör `translate_locale sv --check` på varje pull request med bara läsbehörighet.
- `sv.json` placeholders mot `en.json` i dag: 0 avvikelser.

---

## Del A – Translate

### A1. Ren funktion för filändringen: `netlify/lib/pdh-locale-edit.js`

Hjärtat i lösningen, utan nätverk, så den går att testa mot riktiga filer.

```
planEdit({ rawEn, rawTarget, rawSources, rows }) → { targetOut, sourcesOut, report }
rows: [{ key, text, src, before }]   // before = Translates imported_target_text
```

1. **Formatkontroll:** för de två filer som skrivs (`sv.json`, `sv.sources.json`), `JSON.stringify(JSON.parse(raw), null, 2) + "\n" === raw`. Stämmer det inte: avbryt med "PDH har ändrat filformatet – Translate måste anpassas". Inget skickas.
2. **Per rad**, mot `en`/`sv` från samma commit:
   - nyckeln saknas i `en.json` → stoppas: "finns inte längre i PDH"
   - nyckeln saknas i `sv.json` → stoppas: "saknar svensk text i PDH" (ska inte hända, CI kräver att alla finns)
   - `src !== sha256(en[key])[:12]` → stoppas: "engelskan har ändrats"
   - tom text → stoppas
   - placeholders skiljer sig från engelskan → stoppas
   - `sv[key] === row.text` → "finns redan i PDH", räknas inte som ändring
   - annars → skickas. Om `sv[key] !== row.before`: varning "texten har ändrats i PDH sedan importen, Translates text ersätter den"
3. **Skriv:** sätt värdet på sin nästlade sökväg i `sv`-objektet (ordningen bevaras), sätt `keys[key] = { src }` i sources. Saknas nyckeln i sources: lägg till och sortera om nycklarna (Pythons `sorted` och JS `sort` ger samma ordning för ASCII).
4. `report = { sent: [{key, en, before: pdhNu, after, warning?}], stopped: [{key, reason}], alreadyInPdh: [key] }`.

### A2. Test för A1: `netlify/lib/pdh-locale-edit.test.js`

Kör med Nodes inbyggda testrunner (`node --test`), inga nya beroenden. Lägg till `"test": "node --test netlify/lib/pdh-locale-edit.test.js"` i `package.json`.

- Fixturer: en liten nästlad `en`/`sv`/`sources` i testet.
- Varje stoppskäl ger rätt utfall.
- **Diff-test:** ändra två texter → `targetOut` skiljer sig från `rawTarget` på exakt två rader. `sourcesOut` ändras bara om hashen var föråldrad eller saknades.
- Formatkontroll: en fil med 4 mellanslags indrag → avbryts.
- Manuellt en gång: kör `planEdit` mot de riktiga filerna från PDH main och kontrollera med `git diff --no-index` att bara de väntade raderna ändras.

### A3. Netlify-funktionen `push-to-pdh.js` skrivs om

En funktion, två lägen:

**`POST { mode: "preview", locale, rows }`**
1. Token med `contents: read`.
2. Läs `main`s sha och de tre filerna från den commiten (`getRawFile`).
3. `planEdit` → returnera `{ base_sha, report }`. Inget skrivs.

**`POST { mode: "send", locale, rows, base_sha }`**
1. Token med `contents: write, pull_requests: write`.
2. Läs de tre filerna från `base_sha` (samma som popupen visade) och kör `planEdit` igen. Servern litar aldrig på klientens rapport.
3. Inga texter att skicka → svara "Allt finns redan i PDH", inget skapas.
4. Git Data API, en commit med båda filerna:
   - `POST /git/blobs` × 2
   - `POST /git/trees` med `base_tree = base_sha`
   - `POST /git/commits` med `parents: [base_sha]`, meddelande "Translate: N svenska texter"
   - `POST /git/refs` → `refs/heads/translate/sv-YYYY-MM-DD-HHMM` (lägg till `-2` osv. om namnet finns)
5. `POST /pulls` → base `main`. Beskrivning: tabell nyckel / före / efter, varningar, stoppade texter, och "Skickad från Translate".
6. Stäng äldre öppna PR:er vars head-branch börjar med `translate/sv-` (och den gamla `translate/sv` från alternativ 2): kommentar "Ersatt av #N", `state: closed`, ta bort branchen. Fel här loggas men stoppar inte svaret, PR:en finns ju.
7. Svara `{ pr_url, pr_number, sent, stopped, closed: [#…] }`.

Validering av request body som i dag (storlek, locale-format, radernas typer). `pdh-locales.js` och `github.js` behålls; konstanterna `LOCALES_DIR`/`BRANCH` flyttas till `github.js` så båda funktionerna delar dem.

### A4. Editor: popupen "Skicka till PDH"

- `buildExport` byter namn till `buildPushRows` och skickar `{ key, sv, src, before }`. Den lokala kontrollen av "Engelska ändrad" (`isSourceChanged`) behålls, så sådana rader skickas inte ens.
- Öppna popupen → anropa `preview` → visa "Hämtar från PDH…", sedan listan. "Före" = PDH:s text nu (från rapporten).
- Separata avsnitt: **Skickas** (med varningar), **Stoppas** (med orsak), **Finns redan i PDH** (bara antal).
- "Skicka" skickar `base_sha` från förhandsvisningen. Resultat: länk till PR:en och "Ersatte #…" om äldre stängdes.
- Ta bort `handleExportChanged`, knappen "Exportera ändrade" och typerna `ExportEntry`/`EXPORT_FORMAT`.

### A5. Synk när man öppnar ett projekt

- I `Editor`, efter `loadTranslations`: hämta från `pdh-locales` och kör `planImport`.
  - Varningar med nivå `stop` (fel filer) → importera inte, visa varningen.
  - Annars → `importFiles` direkt, utan förhandsvisning.
- Visa "Hämtar senaste texter från PDH…" under tiden och efteråt en kort sammanfattning, t.ex. "12 nya texter, 3 med ändrad engelska, 5 skickade texter finns nu i PDH". Inget att rapportera → ingen ruta.
- Går synken inte (PDH eller GitHub nere): visa en diskret varning, användaren kan jobba vidare.
- **Prestanda:** `importFiles` uppdaterar i dag alla rader (5 480 anrop i grupper om 50). Ändra så att bara rader där något faktiskt ändras uppdateras. Annars blir varje öppning långsam.
- Den manuella importrutan behålls som "Hämta igen" (inklusive ordlisteimport och den hopfällda filimporten).

### A6. Guide och dokumentation

- `/hjalp`: beskriv synken vid start, popupens tre avsnitt, att en konflikt löses med "Skicka igen", och att mergade texter försvinner ur "ändrade" vid nästa öppning.
- `docs/pdh/`: ersätt designen och planen för alternativ 2 med `SKICKA_TILL_PDH_ALTERNATIV.md` och den här planen.

### A7. Verifiering av Del A

1. `npm run build` och `npm test`.
2. Lokalt med den tillfälliga fejk-Supabase-konfigurationen (som förra gången, raderas efteråt): popupen, utfallen, synken.
3. **Live mot PDH** (kräver Translate-sajtens URL):
   - öppna ett projekt → synken körs
   - ändra en text → "Skicka till PDH" → förhandsvisningen stämmer
   - skicka → PR skapas, diffen visar bara den ändrade raden i `sv.json` (och i `sv.sources.json` bara om hashen var föråldrad), PDH:s CI blir grön
   - skicka igen med en ändring till → ny PR, den första stängs med "Ersatt av"
   - stäng test-PR:en utan merge (eller låt Christian merga om texten är riktig)

---

## Del B – PDH (PR, mergas av PDH-utvecklarna)

### B1. Ta bort det gamla flödet

- `.github/workflows/translate-import.yml`
- `pdh-django-backend/glossary/management/commands/import_translations.py`
- `pdh-django-backend/glossary/translate_import.py`
- `pdh-django-backend/tests/test_import_translations.py`
- `translations/incoming/` (README)
- `features/TRANSLATE_IMPORT.md`: ersätt med en kort beskrivning av alternativ 3 (Translate öppnar PR:er direkt).
- Uppdatera hänvisningar: `translate_locale.py` rad ~648 ("bring the result back with `manage.py import_translations`") → "skicka från Translate". Kontrollera `multilang-build-plan.md`, `HANDOFF_*.md` och `CLAUDE.md` (antal tester).

### B2. Placeholder-kontroll i CI

I `translate_locale._check`: för varje nyckel som finns i både `en` och `sv`, jämför `placeholders(en)` med `placeholders(sv)`. Avvikelser listas (max 20) och får CI att faila, som saknade och inaktuella. Tomma svenska texter räknas också som fel.

- Test i `tests/test_translate_locale_staleness.py` (eller ny fil): en avvikelse → `CommandError`, ingen avvikelse → grönt.
- Fångar både Translate-fel och utvecklares handredigering.

### B3. Efter merge (Mats/admin)

- Ta bort repo-variabeln `TRANSLATE_APP_ID` och secret `TRANSLATE_APP_PRIVATE_KEY` i PDH.
- Ta bort den gamla branchen `translate/sv` om den finns.
- GitHub-appen behåller Contents + Pull requests (skriv), fortfarande inte Workflows.

---

## Ordning

1. A1 + A2 (ren funktion och test)
2. A3 + A4 (sändning), A5 (synk), A6 (guide)
3. A7: push till Translate main, live-test
4. B1 + B2: PR till PDH, Christian/David mergar
5. B3

## Öppna punkter

- Translate-sajtens URL för live-testet.
- Ska test-PR:en i A7 mergas eller stängas?
