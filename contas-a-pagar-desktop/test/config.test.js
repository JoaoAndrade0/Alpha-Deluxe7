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
  c.setKey('  sk-ant-api03-ABCDEFGHIJKLMNOP1234  ');
  const raw = fs.readFileSync(f, 'utf8');
  assert.ok(!raw.includes('sk-ant-api03'), 'não pode estar em texto puro');
  assert.equal(new Config(f, fakeSafe).getKey(), 'sk-ant-api03-ABCDEFGHIJKLMNOP1234');
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
  c.setKey('sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx');
  assert.equal(new Config(f, null).getKey(), 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx');
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});

test('chave com formato errado é recusada e nada é gravado', () => {
  const f = tmp();
  const c = new Config(f, fakeSafe);
  for (const ruim of ['', 'abc', 'sk-ant-curta', 'chave-qualquer-com-mais-de-vinte-caracteres', null, undefined]) {
    assert.throws(() => c.setKey(ruim), e => e.code === 'chave_formato');
  }
  assert.equal(c.getKey(), '');
  assert.equal(c.keyStorage, '');
  assert.ok(!fs.existsSync(f) || !/apiKey/.test(fs.readFileSync(f, 'utf8')));
});

test('a tela é avisada de como a chave está guardada (sistema ou só arquivo)', () => {
  const chave = 'sk-ant-api03-' + 'b'.repeat(40);
  const a = new Config(tmp(), fakeSafe); a.setKey(chave);
  assert.equal(a.keyStorage, 'sistema'); assert.equal(a.publicView().keyStorage, 'sistema');
  const b = new Config(tmp(), { isEncryptionAvailable: () => false }); b.setKey(chave);
  assert.equal(b.keyStorage, 'arquivo'); assert.equal(b.publicView().keyStorage, 'arquivo');
  assert.ok(!JSON.stringify(b.publicView()).includes(chave), 'a chave inteira nunca vai para a tela');
});

test('arquivo de configuração corrompido não impede o programa de abrir', () => {
  const f = tmp();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '{isso nao e json');
  const c = new Config(f, fakeSafe);
  assert.equal(c.dataDir, ''); assert.equal(c.getKey(), '');
  c.setDataDir('/pasta');
  assert.equal(new Config(f, fakeSafe).dataDir, '/pasta');
});

test('chave criptografada que não abre mais (outro usuário do sistema) vira "sem chave"', () => {
  const f = tmp();
  const c = new Config(f, fakeSafe); c.setKey('sk-ant-api03-' + 'c'.repeat(40));
  const quebrado = new Config(f, { isEncryptionAvailable: () => true, decryptString: () => { throw new Error('não consigo decifrar'); } });
  assert.equal(quebrado.getKey(), ''); assert.equal(quebrado.publicView().hasKey, false);
});
