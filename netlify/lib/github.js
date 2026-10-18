// Delad GitHub App-inloggning för funktionerna som pratar med PDH-repot
// (push-to-pdh skriver, pdh-locales läser). Appens nyckel finns bara här, på
// servern, och varje anrop ber bara om de rättigheter det behöver.
//
// Miljövariabler (Netlify dashboard):
//   PDH_GITHUB_APP_ID           GitHub-appens id
//   PDH_GITHUB_APP_PRIVATE_KEY  appens privata nyckel (PEM; "\n" i en rad går bra)
//   PDH_GITHUB_REPO             valfri, standard "lingon/product-data-hub"

import { createSign } from 'node:crypto';

export const API = 'https://api.github.com';

export function appConfig() {
  return {
    appId: process.env.PDH_GITHUB_APP_ID,
    privateKey: (process.env.PDH_GITHUB_APP_PRIVATE_KEY || '').replace(/\n/g, '\n'),
    repo: process.env.PDH_GITHUB_REPO || 'lingon/product-data-hub',
  };
}

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function appJwt(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  // iat 60 s bakåt mot klockskillnad; GitHub tillåter max 10 min livslängd.
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const signature = createSign('RSA-SHA256').update(`${header}.${body}`).sign(privateKey);
  return `${header}.${body}.${b64url(signature)}`;
}

export async function gh(path, token, { method = 'GET', body, allow404 = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'translate-lingon',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (allow404 && res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`GitHub ${method} ${path}: ${res.status} ${data.message || ''}`.trim());
    err.status = res.status;
    throw err;
  }
  return data;
}

// Token för appens installation på repot, begränsad till `permissions`.
export async function installationToken(appId, privateKey, repo, permissions) {
  const jwt = appJwt(appId, privateKey);
  const installation = await gh(`/repos/${repo}/installation`, jwt);
  const { token } = await gh(`/app/installations/${installation.id}/access_tokens`, jwt, {
    method: 'POST',
    body: { repositories: [repo.split('/')[1]], permissions },
  });
  return token;
}

// En fils råa innehåll vid en viss commit. Contents-API:ts base64-svar räcker
// bara till 1 MB; raw-formatet klarar större locale-filer.
export async function getRawFile(repo, path, ref, token) {
  const res = await fetch(`${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'translate-lingon',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`GitHub GET ${path}: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}
