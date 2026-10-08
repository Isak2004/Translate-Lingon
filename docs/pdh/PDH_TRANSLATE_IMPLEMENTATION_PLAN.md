# PDH ↔ Translate — implementationsplan

Förslag på hur designen i [`PDH_TRANSLATE_DESIGN.md`](./PDH_TRANSLATE_DESIGN.md)
kan byggas i PDH. Translate-sidan är redan klar (designdokumentet §6) — den här
planen gäller bara PDH. Planen är skriven mot `main` @ `a396791` (2026-08-31) —
kontrollera filnamn och radnummer mot aktuell `main` innan du börjar.

Två PR:er: först det nya (additivt, ingenting går sönder), sedan borttagningen.

---

## PR 1 — Import av Translate-filer

### 1.1 Nytt management-kommando
**Fil:** `pdh-django-backend/glossary/management/commands/import_translations.py`

```
python manage.py import_translations sv-changes.json
python manage.py import_translations sv-changes.json --dry-run
```

Återanvänd hjälpfunktionerna i `translate_locale.py`: `LOCALES_DIR`,
`SOURCE_LOCALE`, `flatten`, `reorder_like`, `unflatten_into`, `placeholders`,
`source_hash`, `load_sources`, `sources_path`. Ett bra mönster att följa är
dagens `review_locale._import()` — samma per-rad-logik, men utan Excel, verdicts,
branch-check och terminologiflagga.

**Filnivå (avbryt hela importen med `CommandError`):**
- Filen går inte att läsa som JSON.
- `format` ≠ `translate-lingon/v1`.
- `source_locale` ≠ `en`, eller `<locale>.json` saknas i `LOCALES_DIR`.
- `keys` saknas eller är inte ett objekt.

**Radnivå (vägra raden, fortsätt med övriga):**
1. `key` finns inte i platt `en.json` → "no longer in en.json".
2. `entry["src"] != source_hash(en_flat[key])` → "the English changed after
   Translate imported it — re-import in Translate and review again". Visa
   nuvarande engelska.
3. `placeholders(entry["sv"]) != placeholders(en_flat[key])` → visa förväntade
   och faktiska.
4. `sv` tom → vägras (Translate skickar aldrig tomma, men kontrollera ändå).
5. `sv` identisk med nuvarande `sv.json` → räknas som oförändrad, inget skrivs.

Fältet `en` i filen läses inte för logik (design D6). Det kan med fördel visas i
rapporten när rad 2 slår till.

**Skrivning (hoppas över vid `--dry-run`):**
- `sv.json`: slå ihop ändringarna med befintlig platt `sv`, bygg om med
  `reorder_like(en_tree, merged)` och lägg tillbaka orphans med
  `unflatten_into` — exakt som `review_locale._import()` gör idag. Skriv med
  `ensure_ascii=False, indent=2` + avslutande `\n`.
- Sidecar `sv.sources.json`: för varje skriven nyckel, sätt
  `src = source_hash(en_flat[key])`. Behåll `$comment` och sortera `keys`.

**Rapport:** antal ändrade / oförändrade / vägrade, per ändrad nyckel `was` →
`now`, per vägrad nyckel orsaken. Avsluta med en påminnelse om att committa
`sv.json` och sidecar-filen tillsammans.

**Valfritt:** kör även `translate_locale`s mjuka kontroller (citattecken,
längdkvot, skriptblandning) på de importerade texterna och visa dem som
varningar — inte vägran, eftersom en människa har valt texten.

### 1.2 Tester
**Fil:** `pdh-django-backend/tests/test_import_translations.py`

Använd `--locales-dir` mot en tmp-katalog (som `test_review_workflow.py` gör).
Täck: lyckad import, okänt format, borttagen nyckel, ändrad engelska,
trasig placeholder, oförändrad text, `--dry-run` skriver inget, orphans i
`sv.json` överlever, sidecar får rätt `src`.

Lägg gärna till ett test som låser hash-kompatibiliteten:
`source_hash("Home")` ska vara samma värde som Translate räknar fram.

### 1.3 Dokumentation
Kort avsnitt i `multilang-build-plan.md` (eller en egen `TRANSLATE_IMPORT.md`)
med flödet från designdokumentet §3.

---

## PR 2 — Ta bort Excel-rundturen och granskningsstatusen

### 2.1 Excel
- Ta bort `pdh-django-backend/glossary/review_export.py`.
- Ta bort `pdh-django-backend/tests/test_review_export.py`.
- `openpyxl` används även av `orders/` och `articles/importers/` — **behåll
  beroendet**.

### 2.2 Granskningskön
- Ta bort `pdh-django-backend/glossary/management/commands/review_locale.py`.
- Ta bort `pdh-django-backend/tests/test_review_workflow.py` (eller flytta de
  delar som testar digesten/sidecar till rätt plats om något ska vara kvar).
- `.github/workflows/ci.yml`: ta bort steget **"i18n review queue for this
  branch"** (≈ rad 152–169). Behåll steget **"i18n delta"** med
  `translate_locale --check`.

### 2.3 Status i sidecar-filen
I `translate_locale.py`:
- `_write_sources()`: skriv bara `{"src": ...}` per nyckel. Uppdatera
  `$comment`-texten.
- `_check()`: ta bort "awaiting review" ur utskriften.
- Ta bort `STATUS_MACHINE` / `STATUS_REVIEWED` när inget längre importerar dem.
- Uppdatera modulens docstring (stycket om sidecar och status).

Engångsmigrering av filerna: kör `translate_locale sv` respektive
`translate_locale sv --locales-dir notifications/locales` efter ändringen så
skrivs sidecar-filerna om utan `status` (inga API-anrop om inget saknas eller är
stale — verifiera med `--dry-run`/`--check` först). Alternativt ett kort
engångsskript. Committa båda sidecar-filerna.

`load_sources()` behöver ingen ändring — den läser bara `keys`.

### 2.4 Veckodigesten
- Ta bort `pdh-django-backend/glossary/tasks.py` (`translation_review_digest`).
- Ta bort `SLACK_DIGEST_WEBHOOK_URL` ur `config/settings.py` (≈ rad 382–391).
- Ta bort variabeln ur serverns `.env.production` vid nästa deploy (se
  `deployment/CLAUDE.md`).
- Uppdatera `BACKGROUND_JOBS.md` (tabellraden ≈ 373 och listan ≈ 419) och
  `deployment/CLAUDE.md` (≈ rad 121–130).

### 2.5 Dokumentation
- `multilang-build-plan.md`: statustabellen överst (raden "Review (§1.3)") och
  §1.3/§1.4 — markera som ersatta av Translate.
- `HANDOFF_I18N_EXTRACTION.md`: §0.2 (granskningskön som kritisk väg) och §7
  ("The review bootstrap") — inte längre aktuella.
- Docstringen i `translate_locale.py` hänvisar till `review_locale` — rensa.

### 2.6 Kontroll innan merge
```
grep -rn "review_locale\|review_export\|STATUS_REVIEWED\|STATUS_MACHINE\|translation_review_digest\|SLACK_DIGEST_WEBHOOK_URL" .
```
Ska bara ge träffar i historiska dokument (om några).

---

## Verifiering end-to-end

1. Importera PDH:s `en.json` + `sv.json` i Translate.
2. Ändra ett par texter, varav en med placeholder.
3. "Exportera ändrade" → `sv-changes.json`.
4. `python manage.py import_translations sv-changes.json --dry-run` → rapporten
   ska lista exakt de ändrade nycklarna.
5. Kör utan `--dry-run`, kontrollera `git diff` på `sv.json` och sidecar.
6. `python manage.py translate_locale sv --check` → 0 missing, 0 stale.
7. Ändra engelskan för en av nycklarna i `en.json` och importera samma fil igen
   → raden ska vägras med "English changed".
8. (Translates sida, för helhetens skull.) Importera den ändrade `en.json` i
   Translate → nyckeln ska flaggas "Engelska ändrad" och hoppas över vid export
   tills användaren valt "Behåll min text" eller "Använd PDH:s text".
