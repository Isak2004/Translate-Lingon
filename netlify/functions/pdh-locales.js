// Netlify Function — läser PDH:s locale-filer direkt från GitHub, så att
// användaren inte behöver ladda ner och välja filer vid import.
//
//   GET ?list=1      → vilka språk som finns i PDH (för att välja språk när ett
//                      projekt skapas)
//   GET ?locale=sv   → en.json och sv.json från PDH:s main, från samma commit
//
// Bara läsning: token ber om contents: read. Filerna är inte hemliga (samma
// texter finns i PDH:s webbapp), men funktionen lämnar bara ut locale-filer.
// Miljövariabler: se netlify/lib/github.js.

import { appConfig, gh, installationToken, getRawFile } from '../lib/github.js';

const BRANCH = 'main';
const LOCALES_DIR = 'pdh-react-frontend/src/i18n/locales';
const SOURCE_LOCALE = 'en';
const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

async function readJson(repo, locale, sha, token) {
  const raw = await getRawFile(repo, `${LOCALES_DIR}/${locale}.json`, sha, token);
  if (raw === null) return null;
  return JSON.parse(raw);
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const { appId, privateKey, repo } = appConfig();
  if (!appId || !privateKey) {
    return json(500, { error: 'GitHub-appen är inte konfigurerad (PDH_GITHUB_APP_ID / PDH_GITHUB_APP_PRIVATE_KEY).' });
  }

  const params = event.queryStringParameters || {};
  const locale = params.locale;
  if (!params.list && !(typeof locale === 'string' && LOCALE_RE.test(locale) && locale !== SOURCE_LOCALE)) {
    return json(400, { error: `Ogiltigt språk: ${locale}` });
  }

  try {
    const token = await installationToken(appId, privateKey, repo, { contents: 'read' });
    // Läs allt från en och samma commit, så att en.json och sv.json hör ihop.
    const head = await gh(`/repos/${repo}/commits/${BRANCH}`, token);
    const sha = head.sha;
    const commit = {
      sha,
      short: sha.slice(0, 7),
      url: head.html_url,
      date: head.commit?.committer?.date ?? null,
    };

    if (params.list) {
      const entries = await gh(`/repos/${repo}/contents/${LOCALES_DIR}?ref=${sha}`, token);
      const locales = entries
        .map((e) => e.name)
        .filter((n) => n.endsWith('.json') && !n.endsWith('.sources.json'))
        .map((n) => n.slice(0, -'.json'.length))
        .filter((l) => l !== SOURCE_LOCALE && LOCALE_RE.test(l))
        .sort();
      return json(200, { locales, commit });
    }

    const [en, target] = await Promise.all([
      readJson(repo, SOURCE_LOCALE, sha, token),
      readJson(repo, locale, sha, token),
    ]);
    if (!en) return json(502, { error: `Hittade inte ${SOURCE_LOCALE}.json i PDH.` });
    if (!target) return json(404, { error: `PDH har ingen ${locale}.json.` });
    return json(200, { locale, commit, en, target });
  } catch (err) {
    console.error('pdh-locales:', err);
    return json(502, { error: `Kunde inte läsa från PDH: ${err.message}` });
  }
};
