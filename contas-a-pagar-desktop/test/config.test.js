'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Config, DEFAULT_MODEL } = require('../lib/config');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')), 'config.json');
const fakeSafe = {
  isEncryptionAvailable: () => true,
  encryptString: s => Buffer.from('ENC:' + s),
  decryptString: b => b.toString().replace(/^ENC:/, '')
};

test('padrões e persistência', () => {
  const f = tmp();
  const c = new Config(f, fakeSafe);
  assert.equal(c.dataDir, '');
  assert.equal(c.model, DEFAULT_MODEL);
  c.setDataDir('/pasta'); c.setModel('claude-sonnet-5-5');
  const d = new Config(f, fakeSafe);
  assert.equal(d.dataDir, '/pasta');
  assert.equal(d.model, 'claude-sonnet-5-5');
  assert.throws(() => d.setModel('gpt-x'));
});

test('a chave é guardada criptografada e só o final aparece na tela', () => {
  const f = tmp();
  const c = new Config(f, fakeSafe);
  c.setKey('  sk-ant-api03-ABCDEFGH1234  ');
  const raw = fs.readFileSync(f, 'utf8');
  assert.ok(!raw.includes('sk-ant-api03'), 'não pode estar em texto puro');
  assert.equal(new Config(f, fakeSafe).getKey(), 'sk-ant-api03-ABCDEFGH1234');
  const v = c.publicView();
  assert.equal(v.hasKey, true);
  assert.equal(v.keyHint, '…1234');
  assert.ok(!JSON.stringify(v).includes('sk-ant'));
  c.clearKey();
  assert.equal(c.getKey(), '');
  assert.throws(() => c.setKey('   '));
});

test('sem criptografia disponível, guarda a chave com permissão restrita', () => {
  const f = tmp();
  const c = new Config(f, { isEncryptionAvailable: () => false });
  c.setKey('sk-ant-x');
  assert.equal(new Config(f, null).getKey(), 'sk-ant-x');
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});
