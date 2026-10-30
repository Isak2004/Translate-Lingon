// Kör hela funktionen mot en låtsad GitHub, så att anropen i rätt ordning går att
// kontrollera utan att röra PDH.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { handler } from '../functions/push-to-pdh.js';
import { sourceHash } from './pdh-locale-edit.js';

const write = (data) => JSON.stringify(data, null, 2) + '\n';
const REPO = 'lingon/product-data-hub';
const DIR = 'pdh-react-frontend/src/i18n/locales';
const SHA = 'a'.repeat(40);

const FILES = {
  'en.json': write({ common: { save: 'Save', home: 'Home' } }),
  'sv.json': write({ common: { save: 'Spara', home: 'Hem' } }),
  'sv.sources.json': write({
    keys: { 'common.home': { src: sourceHash('Home') }, 'common.save': { src: sourceHash('Save') } },
  }),
};

const row = { key: 'common.save', text: 'Spara nu', src: sourceHash('Save'), before: 'Spara' };

let calls;
let openPulls;
let files;
let failPullCreate;
let takenRefs;
const realFetch = globalThis.fetch;

function respond(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

async function fakeGitHub(url, init = {}) {
  const u = new URL(url);
  const path = u.pathname;
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path, body });

  if (path === `/repos/${REPO}/installation`) return respond(200, { id: 1 });
  if (path === '/app/installations/1/access_tokens') return respond(200, { token: 't' });
  if (path === `/repos/${REPO}/commits/main`) return respond(200, { sha: SHA });
  if (path.startsWith(`/repos/${REPO}/contents/${DIR}/`)) {
    const raw = files[path.split('/').pop()];
    return raw === undefined ? respond(404, {}) : new Response(raw, { status: 200 });
  }
  if (method === 'POST' && path.endsWith('/git/blobs')) return respond(201, { sha: `blob${calls.length}` });
  if (method === 'POST' && path.endsWith('/git/trees')) return respond(201, { sha: 'tree1' });
  if (method === 'POST' && path.endsWith('/git/commits')) return respond(201, { sha: 'commit1' });
  if (method === 'POST' && path.endsWith('/git/refs')) {
    if (takenRefs-- > 0) return respond(422, { message: 'Reference already exists' });
    return respond(201, {});
  }
  if (method === 'POST' && path.endsWith('/pulls')) {
    if (failPullCreate) return respond(500, { message: 'boom' });
    return respond(201, { number: 99, html_url: 'https://github.test/pr/99' });
  }
  if (method === 'GET' && path.endsWith('/pulls')) return respond(200, openPulls);
  if (method === 'POST' && path.includes('/issues/')) return respond(201, {});
  if (method === 'PATCH' && path.includes('/pulls/')) return respond(200, {});
  if (method === 'DELETE' && path.includes('/git/refs/')) return respond(204);
  throw new Error(`Oväntat anrop: ${method} ${path}`);
}

const pull = (number, ref, repo = REPO) => ({ number, head: { ref, repo: { full_name: repo } } });

async function call(body) {
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

const writes = () => calls.filter((c) => c.method !== 'GET' && !c.path.includes('/app/'));
const find = (method, suffix) => calls.filter((c) => c.method === method && c.path.endsWith(suffix));

beforeEach(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.PDH_GITHUB_APP_ID = '1';
  process.env.PDH_GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
  delete process.env.PDH_GITHUB_REPO;
  calls = [];
  openPulls = [];
  files = { ...FILES };
  failPullCreate = false;
  takenRefs = 0;
  globalThis.fetch = fakeGitHub;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('preview rapporterar och skriver inget', async () => {
  const { status, data } = await call({ mode: 'preview', locale: 'sv', rows: [row] });
  assert.equal(status, 200);
  assert.equal(data.base_sha, SHA);
  assert.equal(data.report.sent[0].after, 'Spara nu');
  assert.deepEqual(writes(), []);
});

test('send gör en commit med båda filerna ovanpå base_sha och öppnar en PR', async () => {
  const { status, data } = await call({ mode: 'send', locale: 'sv', rows: [row], base_sha: SHA });
  assert.equal(status, 200);
  assert.equal(data.pr_url, 'https://github.test/pr/99');
  assert.equal(data.sent, 1);

  const blobs = find('POST', '/git/blobs');
  assert.equal(blobs.length, 2);
  assert.ok(blobs.some((b) => b.body.content.includes('"Spara nu"')));

  const [tree] = find('POST', '/git/trees');
  assert.equal(tree.body.base_tree, SHA);
  assert.deepEqual(tree.body.tree.map((t) => t.path).sort(), [`${DIR}/sv.json`, `${DIR}/sv.sources.json`]);

  const [commit] = find('POST', '/git/commits');
  assert.deepEqual(commit.body.parents, [SHA]);

  const [ref] = find('POST', '/git/refs');
  assert.match(ref.body.ref, /^refs\/heads\/translate\/sv-\d{4}-\d{2}-\d{2}-\d{4}$/);
  assert.equal(ref.body.sha, 'commit1');

  const [pr] = find('POST', '/pulls');
  assert.equal(pr.body.base, 'main');
  assert.equal(pr.body.head, ref.body.ref.replace('refs/heads/', ''));
  assert.match(pr.body.body, /Spara nu/);
});

test('send läser filerna från base_sha, inte från senaste main', async () => {
  await call({ mode: 'send', locale: 'sv', rows: [row], base_sha: SHA });
  assert.equal(find('GET', '/commits/main').length, 0);
});

test('äldre skick stängs, andra pull requests lämnas ifred', async () => {
  openPulls = [
    pull(5, 'translate/sv-2026-10-20-1000'),
    pull(6, 'translate/sv'),
    pull(7, 'translate/sv-SE-2026-10-20-1000'),
    pull(8, 'translate/sv-2026-10-20-1000', 'someone/fork'),
    pull(9, 'feature/sv-2026-10-20-1000'),
    pull(10, 'translate/sv-feature'),
  ];
  const { data } = await call({ mode: 'send', locale: 'sv', rows: [row], base_sha: SHA });
  assert.deepEqual(data.closed, [5, 6]);
  assert.deepEqual(
    calls.filter((c) => c.method === 'PATCH').map((c) => c.path),
    [`/repos/${REPO}/pulls/5`, `/repos/${REPO}/pulls/6`],
  );
  const comments = calls.filter((c) => c.path.endsWith('/comments'));
  assert.equal(comments[0].body.body, 'Ersatt av #99.');
  assert.deepEqual(
    calls.filter((c) => c.method === 'DELETE').map((c) => c.path).sort(),
    [
      `/repos/${REPO}/git/refs/heads/translate/sv`,
      `/repos/${REPO}/git/refs/heads/translate/sv-2026-10-20-1000`,
    ],
  );
});

test('upptaget branchnamn får ett suffix', async () => {
  takenRefs = 1;
  await call({ mode: 'send', locale: 'sv', rows: [row], base_sha: SHA });
  const refs = find('POST', '/git/refs');
  assert.equal(refs.length, 2);
  assert.match(refs[1].body.ref, /-2$/);
});

test('inget skickas om allt redan finns i PDH', async () => {
  const same = { ...row, text: 'Spara' };
  const { status, data } = await call({ mode: 'send', locale: 'sv', rows: [same], base_sha: SHA });
  assert.equal(status, 200);
  assert.equal(data.pr_url, null);
  assert.deepEqual(writes(), []);
});

test('misslyckad PR städar bort branchen', async () => {
  failPullCreate = true;
  const { status, data } = await call({ mode: 'send', locale: 'sv', rows: [row], base_sha: SHA });
  assert.equal(status, 502);
  assert.match(data.error, /Kunde inte skicka/);
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 1);
});

test('ändrat filformat ger ett tydligt fel och inga skrivningar', async () => {
  files['sv.json'] = JSON.stringify(JSON.parse(FILES['sv.json']), null, 4) + '\n';
  const { status, data } = await call({ mode: 'send', locale: 'sv', rows: [row], base_sha: SHA });
  assert.equal(status, 409);
  assert.match(data.error, /ändrat formatet/);
  assert.deepEqual(writes(), []);
});

test('saknad sources-fil ger ett tydligt fel', async () => {
  delete files['sv.sources.json'];
  const { status, data } = await call({ mode: 'preview', locale: 'sv', rows: [row] });
  assert.equal(status, 409);
  assert.match(data.error, /sv\.sources\.json/);
});

test('ogiltiga förfrågningar stoppas innan GitHub', async () => {
  for (const body of [
    { mode: 'nope', locale: 'sv', rows: [row] },
    { mode: 'preview', locale: 'en', rows: [row] },
    { mode: 'preview', locale: '../x', rows: [row] },
    { mode: 'preview', locale: 'sv', rows: [] },
    { mode: 'preview', locale: 'sv', rows: [{ key: 'a' }] },
    { mode: 'send', locale: 'sv', rows: [row], base_sha: 'main' },
  ]) {
    const { status } = await call(body);
    assert.equal(status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});
