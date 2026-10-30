import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormatError, planEdit, renderPrBody, sourceHash } from './pdh-locale-edit.js';

const write = (data) => JSON.stringify(data, null, 2) + '\n';

const en = {
  common: { save: 'Save', hello: 'Hello {{name}}', link: 'See <b>more</b>' },
  menu: { home: 'Home', help: 'Help' },
};
const sv = {
  common: { save: 'Spara', hello: 'Hej {{name}}', link: 'Se <b>mer</b>' },
  menu: { home: 'Hem', help: 'Hjälp' },
};
const srcOf = (text) => ({ src: sourceHash(text) });
const sources = {
  $comment: ['Not a locale file.'],
  keys: {
    'common.hello': srcOf('Hello {{name}}'),
    'common.link': srcOf('See <b>more</b>'),
    'common.save': srcOf('Save'),
    'menu.help': srcOf('Help'),
    'menu.home': srcOf('Home'),
  },
};

function run(rows, overrides = {}) {
  return planEdit({
    rawEn: write(en),
    rawTarget: write(sv),
    rawSources: write(sources),
    rows,
    ...overrides,
  });
}

const row = (key, text, english, before) => ({ key, text, src: sourceHash(english), before });

const changedLines = (a, b) => {
  const [x, y] = [a.split('\n'), b.split('\n')];
  assert.equal(x.length, y.length, 'antalet rader ska vara oförändrat');
  return x.filter((line, i) => line !== y[i]).length;
};

test('sourceHash stämmer med PDH:s source_hash', () => {
  assert.match(sourceHash('x'), /^[0-9a-f]{12}$/);
  assert.equal(sourceHash('x'), '2d711642b726');
});

test('två ändrade texter ändrar exakt två rader i vardera filen', () => {
  const { targetOut, sourcesOut, report } = run([
    row('common.save', 'Spara nu', 'Save', 'Spara'),
    row('menu.home', 'Start', 'Home', 'Hem'),
  ]);
  assert.equal(changedLines(write(sv), targetOut), 2);
  assert.deepEqual(report.sent.map((r) => r.key), ['common.save', 'menu.home']);
  assert.equal(JSON.parse(targetOut).common.save, 'Spara nu');
  // Hashen var redan rätt, så sources är orörd.
  assert.equal(sourcesOut, write(sources));
});

test('en föråldrad hash i sources uppdateras på en rad', () => {
  const stale = { ...sources, keys: { ...sources.keys, 'common.save': { src: 'aaaaaaaaaaaa' } } };
  const { sourcesOut } = run([row('common.save', 'Spara nu', 'Save', 'Spara')], {
    rawSources: write(stale),
  });
  assert.equal(changedLines(write(stale), sourcesOut), 1);
  assert.equal(JSON.parse(sourcesOut).keys['common.save'].src, sourceHash('Save'));
});

test('en nyckel som saknas i sources läggs in i sorterad ordning', () => {
  const { 'common.save': _, ...rest } = sources.keys;
  const { sourcesOut } = run([row('common.save', 'Spara nu', 'Save', 'Spara')], {
    rawSources: write({ ...sources, keys: rest }),
  });
  assert.equal(sourcesOut, write(sources));
});

test('nyckel som inte finns i engelskan stoppas', () => {
  const { report, targetOut } = run([row('gone.key', 'Text', 'Text', 'Text')]);
  assert.equal(report.stopped[0].key, 'gone.key');
  assert.match(report.stopped[0].reason, /finns inte längre/);
  assert.equal(targetOut, write(sv));
});

test('nyckel som bara finns i engelskan stoppas', () => {
  const { report } = run([row('menu.new', 'Ny', 'New', '')], {
    rawEn: write({ ...en, menu: { ...en.menu, new: 'New' } }),
  });
  assert.match(report.stopped[0].reason, /saknar översättning/);
});

test('ändrad engelska stoppas', () => {
  const { report, targetOut } = run([row('common.save', 'Spara nu', 'Old save', 'Spara')]);
  assert.match(report.stopped[0].reason, /Engelskan har ändrats/);
  assert.equal(targetOut, write(sv));
});

test('tom text stoppas', () => {
  const { report } = run([row('common.save', '   ', 'Save', 'Spara')]);
  assert.match(report.stopped[0].reason, /tom/);
});

test('fel platshållare stoppas, flyttade går bra', () => {
  const bad = run([row('common.hello', 'Hej {{namn}}', 'Hello {{name}}', 'Hej {{name}}')]);
  assert.match(bad.report.stopped[0].reason, /Platshållarna/);
  const tag = run([row('common.link', 'Se mer', 'See <b>more</b>', 'Se <b>mer</b>')]);
  assert.match(tag.report.stopped[0].reason, /Platshållarna/);
  const moved = run([row('common.hello', '{{name}}, hej', 'Hello {{name}}', 'Hej {{name}}')]);
  assert.equal(moved.report.sent.length, 1);
});

test('text som redan finns i PDH räknas inte som ändring', () => {
  const { report, targetOut, sourcesOut } = run([row('common.save', 'Spara', 'Save', 'Gammal')]);
  assert.deepEqual(report.alreadyInPdh, ['common.save']);
  assert.equal(report.sent.length, 0);
  assert.equal(targetOut, write(sv));
  assert.equal(sourcesOut, write(sources));
});

test('text som ändrats i PDH sedan importen skrivs över med varning', () => {
  const { report, targetOut } = run([row('common.save', 'Spara nu', 'Save', 'Gammal')]);
  assert.match(report.sent[0].warning, /ändrats i PDH/);
  assert.equal(report.sent[0].before, 'Spara');
  assert.equal(JSON.parse(targetOut).common.save, 'Spara nu');
});

test('oväntat format avbryter i stället för att skriva om filen', () => {
  const rows = [row('common.save', 'Spara nu', 'Save', 'Spara')];
  const reformatted = JSON.stringify(sv, null, 4) + '\n';
  assert.throws(() => run(rows, { rawTarget: reformatted }), FormatError);
  assert.throws(() => run(rows, { rawTarget: write(sv).replace(/\n/g, '\r\n') }), FormatError);
  assert.throws(() => run(rows, { rawTarget: JSON.stringify(sv) }), FormatError);
  assert.throws(() => run(rows, { rawSources: JSON.stringify(sources) }), FormatError);
});

test('svenska tecken lämnas som de är', () => {
  const { targetOut } = run([row('menu.home', 'Hemsidan åäö', 'Home', 'Hem')]);
  assert.ok(targetOut.includes('"Hjälp"'));
  assert.ok(targetOut.includes('"Hemsidan åäö"'));
});

test('PR-beskrivningen visar ändringar, varningar och stoppade texter', () => {
  const { report } = run([
    row('common.save', 'Spara | nu', 'Save', 'Gammal'),
    row('gone.key', 'Text', 'Text', 'Text'),
  ]);
  const body = renderPrBody(report);
  assert.ok(body.includes('Spara \\| nu'));
  assert.ok(body.includes('1 texter hade ändrats i PDH'));
  assert.ok(body.includes('`gone.key`'));
});

test('PR-beskrivningen kortas av innan GitHubs gräns', () => {
  const sent = Array.from({ length: 2000 }, (_, i) => ({
    key: `k.${i}`, en: 'e', before: 'b'.repeat(50), after: 'a'.repeat(50),
  }));
  const body = renderPrBody({ sent, stopped: [], alreadyInPdh: [] });
  assert.ok(body.length < 65536);
  assert.match(body, /till, se diffen/);
});
