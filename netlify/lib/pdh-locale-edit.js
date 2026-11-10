// Lägger in ändrade texter i PDH:s språkfiler. Inget nätverk, så att logiken går
// att testa mot riktiga filer.
//
// Bara de skickade värdena byts. Allt annat i filerna är orört byte för byte, så
// en pull request visar bara de ändrade raderna och git-mergen kan smälta ihop
// den med det som hänt i main under tiden.

import { createHash } from 'node:crypto';

// Samma regex och samma jämförelse som PDH:s translate_locale.placeholders().
const PLACEHOLDER_RE = /\{\{[^}]+\}\}|<\/?[a-zA-Z][a-zA-Z0-9_]*>/g;

export class FormatError extends Error {}

// Samma som PDH:s source_hash: sha256, första 12 hex-tecknen.
export function sourceHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

export function placeholders(text) {
  return (text.match(PLACEHOLDER_RE) ?? []).sort();
}

// Läser en fil och kräver att den går att skriva tillbaka exakt. Annars skulle
// hela filen bli "ändrad" och mergen konflikta.
function parseExact(raw, name) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new FormatError(`${name} i PDH är inte giltig JSON: ${err.message}`);
  }
  if (serialize(data) !== raw) {
    throw new FormatError(
      `PDH har ändrat formatet på ${name}, så Translate kan inte skriva filen utan ` +
      'att hela filen blir ändrad. Translate måste anpassas.',
    );
  }
  return data;
}

function serialize(data) {
  return JSON.stringify(data, null, 2) + '\n';
}

// Platt nyckel → var värdet ligger, så att det kan bytas på plats.
function leaves(node, prefix = '', out = new Map()) {
  for (const [name, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      leaves(value, path, out);
    } else if (typeof value === 'string') {
      out.set(path, { parent: node, name, value });
    }
  }
  return out;
}

// ── Kopior av texterna på andra ställen i PDH ──
// Backend kan inte läsa frontendens språkfiler, så PDH har kopior av några
// etiketter. PDH:s tester kräver att de stämmer med <locale>.json, så de måste
// ändras i samma commit. Varje kopia vet själv vilka nycklar den har.

export function mirrorFiles(locale) {
  return [
    {
      // AI-assistentens etiketter, `manage.py sync_ui_labels` i PDH.
      path: 'pdh-django-backend/assistant/ui_labels.json',
      apply(data, key, text) {
        const entry = data.labels?.[key];
        if (!entry || typeof entry !== 'object' || entry[locale] === text) return false;
        entry[locale] = text;
        return true;
      },
    },
    {
      // Flikarnas namn i Excel-exporten = article.detail.tab.<flik>.
      path: `pdh-django-backend/exports/locales/${locale}.json`,
      apply(data, key, text) {
        const tab = key.match(/^article\.detail\.tab\.([^.]+)$/)?.[1];
        if (!tab || !data.tabs || !Object.hasOwn(data.tabs, tab) || data.tabs[tab] === text) return false;
        data.tabs[tab] = text;
        return true;
      },
    },
  ];
}

// rows: [{ key, text, src, before }]. src = hashen av den engelska texten
// granskades mot, before = PDH:s text vid senaste import i Translate.
// mirrors: { sökväg: filens innehåll eller null }, för filerna i mirrorFiles().
export function planEdit({ rawEn, rawTarget, rawSources, rows, locale = 'sv', mirrors = {} }) {
  const en = leaves(JSON.parse(rawEn));
  const targetTree = parseExact(rawTarget, `${locale}.json`);
  const target = leaves(targetTree);
  const sources = parseExact(rawSources, `${locale}.sources.json`);
  const sourceKeys = sources.keys && typeof sources.keys === 'object' ? sources.keys : {};

  const report = { sent: [], stopped: [], alreadyInPdh: [] };
  let addedSourceKey = false;

  for (const { key, text, src, before } of rows) {
    const english = en.get(key)?.value;
    const current = target.get(key);
    const stop = (reason) => report.stopped.push({ key, reason });

    if (english === undefined) {
      stop('Texten finns inte längre i PDH.');
    } else if (!current) {
      stop('Texten saknar översättning i PDH.');
    } else if (src !== sourceHash(english)) {
      stop('Engelskan har ändrats i PDH. Granska texten igen.');
    } else if (!text.trim()) {
      stop('Texten är tom.');
    } else if (JSON.stringify(placeholders(english)) !== JSON.stringify(placeholders(text))) {
      stop(
        `Platshållarna stämmer inte med engelskan: väntade ${placeholders(english).join(' ') || '(inga)'}, ` +
        `fick ${placeholders(text).join(' ') || '(inga)'}.`,
      );
    } else if (current.value === text) {
      report.alreadyInPdh.push(key);
    } else {
      const row = { key, en: english, before: current.value, after: text };
      if (current.value !== before) {
        row.warning = 'Texten har ändrats i PDH sedan importen. Din text ersätter den.';
      }
      report.sent.push(row);
      current.parent[current.name] = text;
      if (!Object.hasOwn(sourceKeys, key)) addedSourceKey = true;
      sourceKeys[key] = { src: sourceHash(english) };
    }
  }

  if (addedSourceKey) {
    sources.keys = Object.fromEntries(
      Object.entries(sourceKeys).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }

  // En kopia som inte berörs läses aldrig strikt, så ett ändrat format i en fil
  // vi inte skriver stoppar inget.
  const mirrorsOut = {};
  report.mirrored = [];
  for (const mirror of mirrorFiles(locale)) {
    const raw = mirrors[mirror.path];
    if (typeof raw !== 'string') continue;
    const data = JSON.parse(raw);
    const keys = report.sent.filter((r) => mirror.apply(data, r.key, r.after)).map((r) => r.key);
    if (keys.length === 0) continue;
    parseExact(raw, mirror.path.split('/').slice(-2).join('/'));
    mirrorsOut[mirror.path] = serialize(data);
    report.mirrored.push({ path: mirror.path, keys });
  }

  return {
    targetOut: serialize(targetTree),
    sourcesOut: serialize({ ...sources, keys: sources.keys ?? sourceKeys }),
    mirrorsOut,
    report,
  };
}

// ── Beskrivning av pull requesten ──

const MAX_BODY_CHARS = 60000; // GitHub tillåter 65 536

function cell(text) {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

export function renderPrBody(report) {
  const lines = [`Skickad från Translate. ${report.sent.length} ändrade texter.`, ''];
  const warned = report.sent.filter((r) => r.warning);
  if (warned.length > 0) {
    lines.push(
      `**${warned.length} texter hade ändrats i PDH sedan importen** och ersätts av den granskade texten från Translate: ` +
      warned.map((r) => `\`${r.key}\``).join(', '),
      '',
    );
  }
  lines.push('| Nyckel | Före | Efter |', '|---|---|---|');

  let length = lines.join('\n').length;
  let shown = 0;
  for (const r of report.sent) {
    const line = `| \`${r.key}\` | ${cell(r.before)} | ${cell(r.after)} |`;
    if (length + line.length > MAX_BODY_CHARS) break;
    lines.push(line);
    length += line.length + 1;
    shown++;
  }
  if (shown < report.sent.length) {
    lines.push('', `…och ${report.sent.length - shown} till, se diffen.`);
  }

  if (report.mirrored?.length > 0) {
    lines.push('', '**Kopior som uppdaterats i samma commit:**', '');
    for (const m of report.mirrored) {
      lines.push(`- \`${m.path}\`: ${m.keys.map((k) => `\`${k}\``).join(', ')}`);
    }
  }

  if (report.stopped.length > 0) {
    lines.push('', `**${report.stopped.length} texter skickades inte:**`, '');
    for (const s of report.stopped.slice(0, 50)) lines.push(`- \`${s.key}\`: ${s.reason}`);
    if (report.stopped.length > 50) lines.push(`- …och ${report.stopped.length - 50} till`);
  }
  return lines.join('\n');
}
