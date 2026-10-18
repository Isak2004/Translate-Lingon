// Netlify Function — skickar en export (translate-lingon/v1) till PDH-repot.
//
// Translate pushar BARA exportfilen. Den committas till
// translations/incoming/sv-changes.json på branchen translate/sv, och en GitHub
// Action i PDH gör själva importen (design D8/§9 i docs/pdh/). Den här
// funktionen skriver aldrig sv.json och rör inga andra filer.
//
// Miljövariabler: se netlify/lib/github.js.

import { appConfig, gh, installationToken } from '../lib/github.js';

const FORMAT = 'translate-lingon/v1';
const BASE_BRANCH = 'main';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ── Validering ──
// Samma filnivåkontroller som PDH gör (glossary/translate_import.py), så att en
// trasig fil stoppas här i stället för att bli en röd Action. Radnivån
// (hash, placeholders, borttagna nycklar) avgörs bara i PDH.

function validateExport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Exporten är inte ett JSON-objekt.';
  }
  if (payload.format !== FORMAT) return `Okänt format: ${payload.format}`;
  if (payload.source_locale !== 'en') return 'source_locale måste vara "en".';
  if (typeof payload.locale !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(payload.locale)
      || payload.locale === 'en') {
    return `Ogiltigt locale: ${payload.locale}`;
  }
  const keys = payload.keys;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return '"keys" saknas.';
  const entries = Object.entries(keys);
  if (entries.length === 0) return 'Inga ändrade texter att skicka.';
  for (const [key, e] of entries) {
    if (!e || typeof e !== 'object'
        || typeof e.en !== 'string' || typeof e.src !== 'string' || typeof e.sv !== 'string') {
      return `Ogiltig rad: ${key}`;
    }
  }
  return null;
}

// ── Branch + fil ──

async function ensureBranch(repo, branch, token) {
  const ref = await gh(`/repos/${repo}/git/ref/heads/${branch}`, token, { allow404: true });
  if (ref) return false;
  const base = await gh(`/repos/${repo}/git/ref/heads/${BASE_BRANCH}`, token);
  await gh(`/repos/${repo}/git/refs`, token, {
    method: 'POST',
    body: { ref: `refs/heads/${branch}`, sha: base.object.sha },
  });
  return true;
}

async function writeFile(repo, branch, path, content, message, token) {
  const existing = await gh(
    `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, token, { allow404: true },
  );
  // En tidigare fil som Actionen inte hunnit importera skrivs över. Exporten
  // jämför mot senast importerade sv.json, inte mot förra exporten, så den nya
  // filen innehåller allt den gamla hade.
  return gh(`/repos/${repo}/contents/${path}`, token, {
    method: 'PUT',
    body: {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      ...(existing && existing.sha ? { sha: existing.sha } : {}),
    },
  });
}

async function openPullRequest(repo, branch, token) {
  // Bara för att kunna visa en länk. Filen är redan pushad, så ett fel här får
  // inte få användaren att tro att skicket misslyckades.
  const owner = repo.split('/')[0];
  try {
    const pulls = await gh(
      `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`, token,
    );
    return pulls[0]?.html_url ?? null;
  } catch (err) {
    console.warn('push-to-pdh: kunde inte slå upp PR:', err.message);
    return null;
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const { appId, privateKey, repo } = appConfig();
  if (!appId || !privateKey) {
    return json(500, { error: 'GitHub-appen är inte konfigurerad (PDH_GITHUB_APP_ID / PDH_GITHUB_APP_PRIVATE_KEY).' });
  }

  if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY_BYTES) {
    return json(413, { error: 'Exporten är för stor.' });
  }
  let payload;
  try {
    payload = JSON.parse(event.body || '');
  } catch {
    return json(400, { error: 'Ogiltig request body' });
  }
  const problem = validateExport(payload);
  if (problem) return json(400, { error: problem });

  const locale = payload.locale;
  const branch = `translate/${locale}`;
  const path = `translations/incoming/${locale}-changes.json`;
  const count = Object.keys(payload.keys).length;

  try {
    const token = await installationToken(appId, privateKey, repo, {
      contents: 'write', pull_requests: 'read',
    });
    const created = await ensureBranch(repo, branch, token);
    const result = await writeFile(
      repo, branch, path, JSON.stringify(payload, null, 2) + '\n',
      `Translate: ${count} ändrade ${locale}-texter (${payload.exported_at || 'okänd tid'})`,
      token,
    );
    const prUrl = await openPullRequest(repo, branch, token);
    return json(200, {
      branch,
      branch_created: created,
      count,
      commit_url: result.commit?.html_url ?? null,
      branch_url: `https://github.com/${repo}/tree/${branch}`,
      pr_url: prUrl,
    });
  } catch (err) {
    console.error('push-to-pdh:', err);
    return json(502, { error: `Kunde inte skicka till PDH: ${err.message}` });
  }
};
