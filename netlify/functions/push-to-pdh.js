// Netlify Function — skickar ändrade texter till PDH som en pull request.
//
//   POST { mode: "preview", locale, rows }
//     Läser PDH:s språkfiler från main och kontrollerar varje text. Skriver inget.
//     → { base_sha, commit_short, report }
//
//   POST { mode: "send", locale, rows, base_sha }
//     Kontrollerar igen mot samma commit, skapar en ny branch från den med
//     <locale>.json, <locale>.sources.json och de kopior i PDH som berörs (se
//     mirrorFiles), öppnar en pull request och stänger äldre "Skicka"-pull
//     requests (den nya innehåller allt de hade).
//     → { pr_url, pr_number, sent, stopped, closed }
//
// rows: [{ key, text, src, before }], se netlify/lib/pdh-locale-edit.js.
// Design: docs/pdh/SKICKA_TILL_PDH_ALTERNATIV.md, alternativ 3.
// Miljövariabler: se netlify/lib/github.js.

import {
  appConfig, gh, installationToken, getRawFile, BASE_BRANCH, LOCALES_DIR, LOCALE_RE, SOURCE_LOCALE,
} from '../lib/github.js';
import { FormatError, mirrorFiles, planEdit, renderPrBody } from '../lib/pdh-locale-edit.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const SHA_RE = /^[0-9a-f]{40}$/;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

// ── Validering ──

function validateRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Förfrågan är inte ett JSON-objekt.';
  }
  if (payload.mode !== 'preview' && payload.mode !== 'send') return `Okänt läge: ${payload.mode}`;
  if (typeof payload.locale !== 'string' || !LOCALE_RE.test(payload.locale)
      || payload.locale === SOURCE_LOCALE) {
    return `Ogiltigt språk: ${payload.locale}`;
  }
  if (!Array.isArray(payload.rows) || payload.rows.length === 0) return 'Inga ändrade texter att skicka.';
  for (const r of payload.rows) {
    if (!r || typeof r.key !== 'string' || typeof r.text !== 'string' || typeof r.src !== 'string'
        || (r.before !== null && typeof r.before !== 'string')) {
      return `Ogiltig rad: ${r?.key}`;
    }
  }
  if (payload.mode === 'send' && !(typeof payload.base_sha === 'string' && SHA_RE.test(payload.base_sha))) {
    return 'Ogiltig commit (base_sha).';
  }
  return null;
}

// ── Läs och skriv i PDH-repot ──

async function readPlan(repo, locale, rows, sha, token) {
  const read = (name) => getRawFile(repo, `${LOCALES_DIR}/${name}`, sha, token);
  const mirrorPaths = mirrorFiles(locale).map((m) => m.path);
  const [rawEn, rawTarget, rawSources, ...rawMirrors] = await Promise.all([
    read(`${SOURCE_LOCALE}.json`), read(`${locale}.json`), read(`${locale}.sources.json`),
    ...mirrorPaths.map((path) => getRawFile(repo, path, sha, token)),
  ]);
  if (rawEn === null) throw new FormatError(`Hittade inte ${SOURCE_LOCALE}.json i PDH.`);
  if (rawTarget === null) throw new FormatError(`PDH har ingen ${locale}.json.`);
  if (rawSources === null) throw new FormatError(`PDH har ingen ${locale}.sources.json.`);
  const mirrors = Object.fromEntries(mirrorPaths.map((path, i) => [path, rawMirrors[i]]));
  return planEdit({ rawEn, rawTarget, rawSources, rows, locale, mirrors });
}

// En commit med alla ändrade filer, ovanpå base_sha.
async function createCommit(repo, baseSha, files, message, token) {
  const blob = async (path, content) => {
    const { sha } = await gh(`/repos/${repo}/git/blobs`, token, {
      method: 'POST', body: { content, encoding: 'utf-8' },
    });
    return { path, mode: '100644', type: 'blob', sha };
  };
  const tree = await gh(`/repos/${repo}/git/trees`, token, {
    method: 'POST',
    body: {
      base_tree: baseSha,
      tree: await Promise.all(Object.entries(files).map(([path, content]) => blob(path, content))),
    },
  });
  const commit = await gh(`/repos/${repo}/git/commits`, token, {
    method: 'POST', body: { message, tree: tree.sha, parents: [baseSha] },
  });
  return commit.sha;
}

// translate/sv-2026-10-21-1432. Finns namnet redan läggs -2, -3 osv. till.
async function createBranch(repo, locale, commitSha, token) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-').replace(/-(\d\d)$/, '$1');
  for (let n = 1; n <= 9; n++) {
    const branch = `translate/${locale}-${stamp}${n === 1 ? '' : `-${n}`}`;
    try {
      await gh(`/repos/${repo}/git/refs`, token, {
        method: 'POST', body: { ref: `refs/heads/${branch}`, sha: commitSha },
      });
      return branch;
    } catch (err) {
      if (err.status !== 422) throw err;
    }
  }
  throw new Error('Kunde inte skapa en ledig branch.');
}

async function deleteBranch(repo, branch, token) {
  await gh(`/repos/${repo}/git/refs/heads/${branch}`, token, { method: 'DELETE' });
}

// Äldre skick för samma språk. translate/<locale> är den gamla Action-branchen.
async function closeOlderPullRequests(repo, locale, newNumber, token) {
  const ours = new RegExp(`^translate/${locale}(-\\d{4}-\\d{2}-\\d{2}-\\d{4}(-\\d+)?)?$`);
  const open = [];
  for (let page = 1; page <= 10; page++) {
    const pulls = await gh(`/repos/${repo}/pulls?state=open&per_page=100&page=${page}`, token);
    open.push(...pulls);
    if (pulls.length < 100) break;
  }
  const older = open.filter((p) => p.number !== newNumber
    && p.head?.repo?.full_name === repo && ours.test(p.head.ref));

  const closed = [];
  await Promise.all(older.map(async (p) => {
    try {
      await gh(`/repos/${repo}/issues/${p.number}/comments`, token, {
        method: 'POST', body: { body: `Ersatt av #${newNumber}.` },
      });
      await gh(`/repos/${repo}/pulls/${p.number}`, token, {
        method: 'PATCH', body: { state: 'closed' },
      });
      closed.push(p.number);
      await deleteBranch(repo, p.head.ref, token);
    } catch (err) {
      // Den nya pull requesten finns redan, så det här får inte se ut som ett fel.
      console.warn(`push-to-pdh: kunde inte stänga #${p.number}:`, err.message);
    }
  }));
  return closed.sort((a, b) => a - b);
}

// ── Lägena ──

async function preview(repo, { locale, rows }, appId, privateKey) {
  const token = await installationToken(appId, privateKey, repo, { contents: 'read' });
  const head = await gh(`/repos/${repo}/commits/${BASE_BRANCH}`, token);
  const { report } = await readPlan(repo, locale, rows, head.sha, token);
  return json(200, { base_sha: head.sha, commit_short: head.sha.slice(0, 7), report });
}

async function send(repo, { locale, rows, base_sha: baseSha }, appId, privateKey) {
  const token = await installationToken(appId, privateKey, repo, {
    contents: 'write', pull_requests: 'write',
  });
  const { targetOut, sourcesOut, mirrorsOut, report } = await readPlan(repo, locale, rows, baseSha, token);
  const sent = report.sent.length;
  const stopped = report.stopped.length;
  if (sent === 0) return json(200, { pr_url: null, pr_number: null, sent, stopped, closed: [] });

  const title = `Translate: ${sent} ${sent === 1 ? 'text' : 'texter'} (${locale})`;
  const files = {
    [`${LOCALES_DIR}/${locale}.json`]: targetOut,
    [`${LOCALES_DIR}/${locale}.sources.json`]: sourcesOut,
    ...mirrorsOut,
  };
  const commitSha = await createCommit(repo, baseSha, files, title, token);
  const branch = await createBranch(repo, locale, commitSha, token);

  let pr;
  try {
    pr = await gh(`/repos/${repo}/pulls`, token, {
      method: 'POST',
      body: { title, head: branch, base: BASE_BRANCH, body: renderPrBody(report) },
    });
  } catch (err) {
    await deleteBranch(repo, branch, token).catch(() => {});
    throw err;
  }
  const closed = await closeOlderPullRequests(repo, locale, pr.number, token).catch((err) => {
    console.warn('push-to-pdh: kunde inte lista äldre pull requests:', err.message);
    return [];
  });
  return json(200, { pr_url: pr.html_url, pr_number: pr.number, sent, stopped, closed });
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const { appId, privateKey, repo } = appConfig();
  if (!appId || !privateKey) {
    return json(500, { error: 'GitHub-appen är inte konfigurerad (PDH_GITHUB_APP_ID / PDH_GITHUB_APP_PRIVATE_KEY).' });
  }

  if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY_BYTES) {
    return json(413, { error: 'För många texter på en gång.' });
  }
  let payload;
  try {
    payload = JSON.parse(event.body || '');
  } catch {
    return json(400, { error: 'Ogiltig request body' });
  }
  const problem = validateRequest(payload);
  if (problem) return json(400, { error: problem });

  try {
    return payload.mode === 'preview'
      ? await preview(repo, payload, appId, privateKey)
      : await send(repo, payload, appId, privateKey);
  } catch (err) {
    if (err instanceof FormatError) return json(409, { error: err.message });
    console.error('push-to-pdh:', err);
    return json(502, { error: `Kunde inte skicka till PDH: ${err.message}` });
  }
};
