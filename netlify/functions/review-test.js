// Enkel test-funktion — anropa /.netlify/functions/review-test
// för att verifiera att Netlify Functions körs och OpenAI API-nyckeln finns.

exports.handler = async () => {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const keyPreview = hasKey
    ? process.env.ANTHROPIC_API_KEY.substring(0, 8) + '...'
    : '(saknas)';

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      nodeVersion: process.version,
      hasApiKey: hasKey,
      keyPreview,
      hasFetch: typeof fetch !== 'undefined',
    }),
  };
};
