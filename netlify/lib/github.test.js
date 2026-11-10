import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { parsePrivateKey } from './github.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
// GitHub ger nyckeln som PKCS#1 ("BEGIN RSA PRIVATE KEY").
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
const body = pem.split('\n').slice(1, -2).join('');

const works = (value) => assert.equal(parsePrivateKey(value).asymmetricKeyType, 'rsa');

test('en korrekt inklistrad .pem-fil fungerar', () => {
  works(pem);
  works(privateKey.export({ type: 'pkcs8', format: 'pem' }));
});

test('vanliga fel vid inklistring rättas', () => {
  works(`"${pem}"`);
  works(`'${pem.trim()}'`);
  works(pem.replace(/\n/g, '\\n'));
  works(pem.replace(/\n/g, '\r\n'));
  works(pem.replace(/\n/g, ' '));
  works(pem.replace(/\n/g, ''));
  works(`  ${pem}  \n\n`);
  works(Buffer.from(pem).toString('base64'));
});

test('felet beskriver formen men visar aldrig nyckeln', () => {
  const broken = pem.replace(/-----END RSA PRIVATE KEY-----/, '');
  assert.throws(() => parsePrivateKey(broken), (err) => {
    assert.match(err.message, /ingen END-rad/);
    assert.match(err.message, /BEGIN-rad "RSA PRIVATE KEY"/);
    assert.ok(!err.message.includes(body.slice(10, 30)));
    return true;
  });
});

test('fel sorts nyckel ger ett begripligt fel', () => {
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => parsePrivateKey(pub), /är inte en privat nyckel/);
  assert.throws(() => parsePrivateKey('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----'), /fel nyckelformat/);
  assert.throws(() => parsePrivateKey(''), /0 tecken, ingen BEGIN-rad/);
  assert.throws(() => parsePrivateKey('Iv1.0123456789abcdef'), /ingen BEGIN-rad/);
});
