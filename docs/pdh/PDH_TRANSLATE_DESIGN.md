# PDH ↔ Translate — designbeskrivning

**Syfte:** beskriva hur översättningar som redigerats i Translate förs tillbaka in
i Product Data Hub (PDH), och vilka delar av PDH:s nuvarande översättningsflöde
som därmed blir överflödiga.

Detta är den övergripande designen. En stegvis implementationsplan finns i
[`PDH_TRANSLATE_IMPLEMENTATION_PLAN.md`](./PDH_TRANSLATE_IMPLEMENTATION_PLAN.md).
Använd den om den passar — designen här är det som är bestämt, planen är ett
förslag på hur.

Underlaget är PDH `main` @ `a396791` (2026-08-31) och Translate-Lingon `main` @
`f29d396` (2026-10-01).

---

## 1. Bakgrund

### PDH idag
- UI-texterna ligger i git: `pdh-react-frontend/src/i18n/locales/en.json` och
  `sv.json`, bundlade i frontend. En textändring = commit + PR + deploy.
- `manage.py translate_locale sv` AI-översätter saknade nycklar och nycklar vars
  engelska ändrats (stale).
- Sidecar `sv.sources.json` håller per nyckel `src` (hash av engelskan
  översättningen gjordes från) och `status` (`machine` / `reviewed`).
- Mänsklig granskning sker via `manage.py review_locale` — en kö i terminalen
  plus en Excel-rundtur (`--export` → granska i Excel → `--import`).

I praktiken har Excel-rundturen knappt använts: 1 205 av dagens 1 214
`reviewed`-nycklar kommer från en enda massgodkännande commit (`7a7b682`,
2026-07-30). 2 829 AI-utkast står som `machine`.

### Translate
Translate-Lingon är en webbapp där användaren importerar PDH:s `en.json` +
`sv.json` (+ valfritt `glossary/terms.json`), redigerar och godkänner svenskan
med stöd av AI-granskning, historik och ordlista, och exporterar de ändrade
texterna. Translate håller själv reda på vad som är granskat och godkänt.

---

## 2. Beslut

| # | Beslut |
|---|---|
| D1 | **Translate är det enda granskningsverktyget.** PDH:s Excel-rundtur tas bort. |
| D2 | **Translate äger granskningsstatusen.** PDH slutar spåra `machine`/`reviewed`. Sidecar-filen behåller bara `src`. Granskningskön (`review_locale`), CI-steget som skriver ut den och veckodigesten tas bort. |
| D3 | **Bara ändrade texter kommer tillbaka.** En text som inte finns i exportfilen är OK som den är. |
| D4 | **PDH:s säkerhetskontroller vid import behålls** — per rad, aldrig per fil: nyckeln måste finnas, engelskan får inte ha ändrats sedan Translate läste in den, placeholders måste vara intakta. |
| D5 | **Ingen branch/commit-stämpel i filen.** Hashen per nyckel fångar den verkliga risken (ändrad engelska). |
| D6 | **Engelskan skrivs aldrig tillbaka.** Fältet `en` finns i filen för kontroll och för att förbereda en framtida möjlighet att redigera källtext — men PDH läser det inte som en ändring nu. |
| D7 | **Bara UI-texterna.** E-posttexterna (`notifications/locales`, 82 nycklar) stöds inte av Translate och ligger utanför detta arbete. |

---

## 3. Flödet

```
 PDH (repo)                         Translate                       PDH (repo)
 ──────────                         ─────────                       ──────────
 translate_locale sv                                                
   → AI-utkast i sv.json            
 en.json + sv.json  ───import──▶    redigera / godkänn             
 (+ glossary/terms.json)            AI-granskning                  
                                    "Exportera ändrade"            
                                      → sv-changes.json ──────▶   import (ny)
                                                                    → sv.json + sidecar
                                                                  commit → PR → CI → deploy
```

1. Utvecklare kör `translate_locale sv` som idag och committar AI-utkasten.
2. Translate-användaren importerar `en.json` + `sv.json` från PDH `main`.
3. Användaren granskar och redigerar i Translate. Texter vars engelska ändrats
   i PDH sedan förra importen flaggas och måste lösas först (§6).
4. Användaren exporterar `sv-changes.json` och lämnar den till PDH-utvecklaren.
5. PDH-utvecklaren kör den nya importen, granskar diffen, committar och gör PR.
   CI (`translate_locale sv --check`) körs som vanligt.

---

## 4. Filformatet (kontraktet)

Translate exporterar redan detta format (commit `56db0f4`), via knappen
"Exportera ändrade" som skriver `sv-changes.json`.

```json
{
  "format": "translate-lingon/v1",
  "source_locale": "en",
  "locale": "sv",
  "exported_at": "2026-10-01T12:00:00.000Z",
  "keys": {
    "nav.home": {
      "en": "Home",
      "src": "a1b2c3d4e5f6",
      "sv": "Hem"
    }
  }
}
```

| Fält | Betydelse |
|---|---|
| `format` | Formatversion. PDH ska vägra okända versioner. |
| `source_locale` / `locale` | Alltid `en` / `sv` i nuläget. |
| `exported_at` | ISO 8601 UTC. Bara information. |
| `keys` | Platt map, punktnotation, samma nycklar som i `en.json`. Bara ändrade texter, aldrig tomma. |
| `en` | Den engelska text Translate visade när texten redigerades. |
| `src` | `sha256(en)` i hex, de 12 första tecknen — **exakt** samma som PDH:s `source_hash()`. Verifierat mot alla 4 043 nycklar i `sv.sources.json`. |
| `sv` | Den nya svenska texten. |

---

## 5. Regler vid import i PDH

Per rad, oberoende av övriga rader:

| Situation | Utfall |
|---|---|
| Nyckeln finns inte i `en.json` | **Vägras** — nyckeln har bytt namn eller tagits bort. |
| `src` ≠ hash av nuvarande engelska | **Vägras** — engelskan har ändrats sedan Translate läste in den. Lösning: importera om i Translate och granska texten igen. |
| Placeholders (`{{x}}`, `<tag>`) skiljer sig från engelskan | **Vägras** — skulle visas som bokstavlig text för användaren. |
| `sv` är identisk med nuvarande `sv.json` | Ingen ändring. |
| Annars | `sv.json` uppdateras; sidecar-posten får `src` = hash av nuvarande engelska. |

Vägrade rader rapporteras med orsak; övriga rader skrivs. Det finns en `--dry-run`.
`sv.json` och sidecar-filen ska committas tillsammans.

---

## 6. Vad Translate garanterar

Ändringar redan gjorda i Translate (commits `56db0f4` och `f29d396`), så att PDH
kan lita på filen:

- **Bara ändrade, icke-tomma texter** exporteras.
- **`src` räknas på den engelska texten användaren faktiskt såg.** Hashen är
  verifierad mot PDH:s egen `source_hash()` för alla 4 043 nycklar.
- **Ändrad engelska stoppas redan i Translate.** Translate sparar vilken
  engelska en manuell text eller ett godkännande gjordes mot. Om en ny import
  från PDH visar att engelskan har ändrats:
  - flaggas raden som "Engelska ändrad", med tidigare och nuvarande engelska,
    användarens svenska och PDH:s svenska,
  - väljer användaren "Behåll min text" (gäller även ny engelska) eller
    "Använd PDH:s text", eller redigerar om,
  - hoppas raden över vid export tills den är löst, med en varning.

  Utan detta skulle en svensk text skriven för gammal engelska skickas med den
  *nya* engelskans hash och passera PDH:s kontroll. PDH:s hash-kontroll (§5) är
  kvar som andra skydd — för fallet att engelskan ändras i PDH *efter* att
  användaren importerat i Translate.

---

## 7. Vad som tas bort i PDH

| Del | Varför |
|---|---|
| Excel-export/-import (`review_export.py`, `review_locale --export/--import`) | Ersatt av Translate (D1). |
| `status` i sidecar-filerna och allt som läser den | Translate äger statusen (D2). |
| `review_locale` (kö, `--approve`, `--since`) | Kön finns inte längre (D2). |
| CI-steget "i18n review queue for this branch" | Skriver ut kön. |
| Veckodigesten `translation_review_digest` + `SLACK_DIGEST_WEBHOOK_URL` | Räknar `machine`-nycklar. |

**Kvar:** `translate_locale` (AI-utkast, stale-detektering via `src`), CI-steget
`translate_locale --check`, ordlistan `glossary/terms.json`.

---

## 8. Kända begränsningar

- **Translate är enda vägen** att granska svenskan utanför repot. Accepterat —
  Translate ägs av oss.
- **Ordlistan går en väg.** Translate läser `terms.json` men skickar inga nya
  termer tillbaka. Termförslag läggs in för hand i PDH som idag.
- **Manuell import.** Filen lämnas över för hand. En automatisk koppling
  (API eller automatisk PR) kan byggas senare ovanpå samma format.
