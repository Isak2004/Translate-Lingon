// Delad GitHub App-inloggning för funktionerna som pratar med PDH-repot
// (push-to-pdh skriver, pdh-locales läser). Appens nyckel finns bara här, på
// servern, och varje anrop ber bara om de rättigheter det behöver.
//
// Miljövariabler (Netlify dashboard):
//   PDH_GITHUB_APP_ID           GitHub-appens id
//   PDH_GITHUB_APP_PRIVATE_KEY  appens privata nyckel, hela .pem-filen. Citattecken
//                               runt, "\n" i en rad, mellanslag i stället för
//                               radbrytningar och base64-kodad fil går också bra.
//   PDH_GITHUB_REPO             valfri, standard "lingon/product-data-hub"

import { createPrivateKey, createSign } from 'node:crypto';

export const API = 'https://api.github.com';

export const BASE_BRANCH = 'main';
export const LOCALES_DIR = 'pdh-react-frontend/src/i18n/locales';
export const SOURCE_LOCALE = 'en';
export const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

export function appConfig() {
  return {
    appId: process.env.PDH_GITHUB_APP_ID,
    privateKey: process.env.PDH_GITHUB_APP_PRIVATE_KEY || '',
    repo: process.env.PDH_GITHUB_REPO || 'lingon/product-data-hub',
  };
}

// Nyckeln klistras in för hand i Netlify, så den kan ha fått fel form på vägen.
// Rättar det som går att rätta; annars ett fel som beskriver formen men aldrig
// visar något av själva nyckeln.
export function parsePrivateKey(raw) {
  let pem = String(raw).trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim()
    .replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');

  if (!pem.includes('-----BEGIN') && /^[A-Za-z0-9+/=\s]+$/.test(pem)) {
    const decoded = Buffer.from(pem.replace(/\s+/g, ''), 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN')) pem = decoded.trim();
  }

  // Bygg om PEM-blocket, så att en nyckel på en rad eller med mellanslag fungerar.
  const block = pem.match(/^-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----$/);
  if (block) {
    const lines = block[2].replace(/\s+/g, '').match(/.{1,64}/g) ?? [];
    pem = `-----BEGIN ${block[1]}-----\n${lines.join('\n')}\n-----END ${block[1]}-----\n`;
  }

  try {
    return createPrivateKey(pem);
  } catch {
    throw new Error(`appens nyckel i PDH_GITHUB_APP_PRIVATE_KEY går inte att läsa (${describeKey(raw)})`);
  }
}

function describeKey(raw) {
  const s = String(raw);
  const begin = s.match(/-----BEGIN ([A-Z0-9 ]+)-----/);
  const parts = [
    `${s.length} tecken`,
    begin ? `BEGIN-rad "${begin[1]}"` : 'ingen BEGIN-rad',
    /-----END [A-Z0-9 ]+-----/.test(s) ? 'END-rad finns' : 'ingen END-rad',
    `${(s.match(/\n/g) ?? []).length} radbrytningar`,
  ];
  if (s.includes('\\n')) parts.push('innehåller \\n som text');
  if (/^\s*["']/.test(s)) parts.push('börjar med citattecken');
  if (begin && !/PRIVATE KEY/.test(begin[1])) parts.push('är inte en privat nyckel');
  if (begin && /ENCRYPTED|OPENSSH/.test(begin[1])) {
    parts.push('fel nyckelformat, använd .pem-filen från GitHub-appens inställningar');
  }
  return parts.join(', ');
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
  const signature = createSign('RSA-SHA256').update(`${header}.${body}`).sign(parsePrivateKey(privateKey));
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
