// Netlify Function — proxy till OpenAI API för översättningsgranskning.
// ANTHROPIC_API_KEY (OpenAI-nyckel) sätts som miljövariabel i Netlify dashboard.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API-nyckel saknas i miljövariabler' }),
    };
  }

  let translations;
  let glossary = [];
  try {
    const body = JSON.parse(event.body);
    translations = body.translations;
    glossary = body.glossary ?? [];
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ogiltig request body' }) };
  }

  // Bygg prompt med alla översättningar
  const translationList = translations
    .map((t) => `KEY: ${t.key}\nEN: ${t.source_text}\nSV: ${t.target_text}`)
    .join('\n---\n');

  // Bygg ordlistesektionen om den finns
  let glossarySection = '';
  if (glossary.length > 0) {
    const glossaryLines = glossary.map((g) => {
      if (g.do_not_translate) {
        return `• "${g.source_term}" — SKA INTE ÖVERSÄTTAS, behåll på engelska. ${g.notes || ''}`;
      }
      const sv = g.approved_translation
        ? `→ "${g.approved_translation}"`
        : '(ej fastställd)';
      const notes = g.notes ? ` OBS: ${g.notes}` : '';
      return `• "${g.source_term}" ${sv}${notes}`;
    });

    glossarySection = `

VIKTIGT — GODKÄND ORDLISTA:
Följande termer har fastställda svenska översättningar. Flagga ALLA översättningar
som avviker från ordlistan med severity "error". Det här är den viktigaste kontrollen.

${glossaryLines.join('\n')}
`;
  }

  const systemPrompt = `Du är en expert på svenska översättningar. Du granskar översättningar från engelska till svenska i en webbapplikation (Product Data Hub — en plattform för produktdatahantering, ESPR-efterlevnad och digitala produktpass).

Din uppgift är att hitta problem i de svenska översättningarna. Leta efter:
1. Översättningar som BRYTER MOT ORDLISTAN (se nedan) — detta är det viktigaste
2. Översättningar som låter stela, onaturliga eller "maskinöversatta" på svenska
3. Inkonsekvent terminologi (t.ex. "ta bort" på ett ställe och "radera" på ett annat för samma koncept)
4. Grammatiska fel eller stavfel
5. Texter som verkar vara oöversatta (engelska ord kvar i svensk text utan anledning)
6. Interpoleringar ({{variable}}) som saknas eller ändrats jämfört med engelskan
7. Översättningar som inte matchar den engelska källtextens betydelse
${glossarySection}
Svara ENBART med en JSON-array. Varje element ska ha:
- "key": nyckeln
- "issue": kort beskrivning av problemet (på svenska)
- "suggestion": ditt förslag på bättre översättning (eller null om du bara flaggar utan förslag)
- "severity": "error" (fel som påverkar förståelsen ELLER bryter mot ordlistan), "warning" (onaturligt men begripligt), eller "info" (förbättringsförslag)

Om en översättning är helt ok, inkludera den INTE.
Svara bara med JSON-arrayen, inget annat.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 8192,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `Granska följande översättningar:\n\n${translationList}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Kunde inte nå OpenAI API', detail: errorText }),
      };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? '[]';

    // Extrahera JSON-arrayen (modellen kan wrappa i markdown-block)
    let findings;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      findings = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      console.error('Kunde inte parsa AI-svar:', text);
      findings = [];
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ findings }),
    };
  } catch (err) {
    console.error('Review error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internt fel vid granskning' }),
    };
  }
};
