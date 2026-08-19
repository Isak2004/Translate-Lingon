// Netlify Function — proxy till Claude API för översättningsgranskning.
// ANTHROPIC_API_KEY sätts som miljövariabel i Netlify dashboard.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY saknas i miljövariabler' }),
    };
  }

  let translations;
  try {
    const body = JSON.parse(event.body);
    translations = body.translations;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ogiltig request body' }) };
  }

  // Bygg prompt med alla översättningar
  const translationList = translations
    .map((t) => `KEY: ${t.key}\nEN: ${t.source_text}\nSV: ${t.target_text}`)
    .join('\n---\n');

  const systemPrompt = `Du är en expert på svenska översättningar. Du granskar översättningar från engelska till svenska i en webbapplikation (Product Data Hub — en plattform för produktdatahantering, ESPR-efterlevnad och digitala produktpass).

Din uppgift är att hitta problem i de svenska översättningarna. Leta efter:
1. Översättningar som låter stela, onaturliga eller "maskinöversatta" på svenska
2. Inkonsekvent terminologi (t.ex. "ta bort" på ett ställe och "radera" på ett annat för samma koncept)
3. Grammatiska fel eller stavfel
4. Texter som verkar vara oöversatta (engelska ord kvar i svensk text utan anledning)
5. Interpoleringar ({{variable}}) som saknas eller ändrats jämfört med engelskan
6. Översättningar som inte matchar den engelska källtextens betydelse

Svara ENBART med en JSON-array. Varje element ska ha:
- "key": nyckeln
- "issue": kort beskrivning av problemet (på svenska)
- "suggestion": ditt förslag på bättre översättning (eller null om du bara flaggar utan förslag)
- "severity": "error" (fel som påverkar förståelsen), "warning" (onaturligt men begripligt), eller "info" (förbättringsförslag)

Om en översättning är helt ok, inkludera den INTE.
Svara bara med JSON-arrayen, inget annat.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Granska följande översättningar:\n\n${translationList}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', errorText);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Kunde inte nå Claude API', detail: errorText }),
      };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? '[]';

    // Extrahera JSON-arrayen (Claude kan wrappa i markdown-block)
    let findings;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      findings = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      console.error('Kunde inte parsa Claude-svar:', text);
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
