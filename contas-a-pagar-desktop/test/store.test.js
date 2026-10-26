'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, deepMerge } = require('../lib/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'contas-'));
const wait = ms => new Promise(r => setTimeout(r, ms));

test('resolveRoot cria subpasta, mas reaproveita pasta de dados existente', () => {
  const a = tmp();
  assert.equal(Store.resolveRoot(a), path.join(a, 'ContasAPagar'));
  fs.mkdirSync(path.join(a, 'ContasAPagar'));
  assert.equal(Store.resolveRoot(path.join(a, 'ContasAPagar')), path.join(a, 'ContasAPagar'));
  const b = tmp();
  fs.mkdirSync(path.join(b, 'compras')); fs.mkdirSync(path.join(b, 'servicos'));
  assert.equal(Store.resolveRoot(b), b);
});

test('set, get, list, update com mescla profunda e delete', async () => {
  const s = new Store(path.join(tmp(), 'ContasAPagar'));
  await s.init();
  await s.set('compras', 'c1', { totalCents: 100, pagas: { 0: true } });
  await s.set('compras', 'c2', { totalCents: 200, pagas: {} });
  await s.update('compras', 'c1', { pagas: { 1: true }, conferir: false });
  assert.deepEqual(await s.get('compras', 'c1'), { totalCents: 100, pagas: { 0: true, 1: true }, conferir: false });
  assert.deepEqual((await s.list('compras')).map(d => d.id), ['c1', 'c2']);
  await s.delete('compras', 'c1');
  await s.delete('compras', 'c1'); // idempotente
  assert.deepEqual((await s.list('compras')).map(d => d.id), ['c2']);
  assert.equal(await s.get('compras', 'nao-existe'), null);
});

test('update em registro inexistente falha com invalid_argument', async () => {
  const s = new Store(tmp()); await s.init();
  await assert.rejects(s.update('compras', 'x', { a: 1 }), { code: 'invalid_argument' });
});

test('rejeita coleção, identificador e corpo inválidos (sem escapar da pasta)', async () => {
  const s = new Store(tmp()); await s.init();
  await assert.rejects(s.set('../fora', 'a', {}), { code: 'invalid_argument' });
  await assert.rejects(s.set('compras', '../../etc/passwd', {}), { code: 'invalid_argument' });
  await assert.rejects(s.set('compras', 'a.b', {}), { code: 'invalid_argument' });
  await assert.rejects(s.set('compras', 'a', [1]), { code: 'invalid_argument' });
  await assert.rejects(s.set('compras', 'a', { x: 'y'.repeat(300 * 1024) }), { code: 'invalid_argument' });
});

test('list ignora temporários, cópias de conflito e arquivos quebrados', async () => {
  const root = tmp(); const s = new Store(root); await s.init();
  await s.set('compras', 'ok', { a: 1 });
  const dir = path.join(root, 'compras');
  fs.writeFileSync(path.join(dir, 'ok (cópia em conflito).json'), '{"a":2}');
  fs.writeFileSync(path.join(dir, '.ok.json.1234.tmp'), '{"a":3}');
  fs.writeFileSync(path.join(dir, 'quebrado.json'), '{nao e json');
  fs.writeFileSync(path.join(dir, 'lista.json'), '[1,2]');
  assert.deepEqual((await s.list('compras')).map(d => d.id), ['ok']);
});

test('atualizações simultâneas do mesmo registro não se perdem', async () => {
  const s = new Store(tmp()); await s.init();
  await s.set('compras', 'c', { pagas: {} });
  await Promise.all([0, 1, 2, 3, 4, 5].map(i => s.update('compras', 'c', { pagas: { [i]: true } })));
  assert.deepEqual(Object.keys((await s.get('compras', 'c')).pagas).sort(), ['0', '1', '2', '3', '4', '5']);
});

test('deepMerge ignora chaves perigosas', () => {
  const out = deepMerge({}, JSON.parse('{"__proto__":{"x":1},"ok":1}'));
  assert.equal(({}).x, undefined);
  assert.equal(out.ok, 1);
});

test('watch avisa em escrita própria e em arquivo criado por fora (outro computador)', async () => {
  const root = tmp(); const s = new Store(root); await s.init();
  let n = 0;
  const stop = s.watch('compras', () => n++);
  await wait(100);
  await s.set('compras', 'a', { v: 1 });
  await wait(300);
  assert.ok(n >= 1, 'escrita própria');
  const before = n;
  fs.writeFileSync(path.join(root, 'compras', 'externo.json'), '{"v":2}');
  await wait(600);
  assert.ok(n > before, 'arquivo externo');
  stop();
  const after = n;
  await s.set('compras', 'b', { v: 3 });
  await wait(300);
  assert.equal(n, after, 'depois de parar não avisa mais');
});

test('notas: salva, localiza por id e recusa tipo ou id inválido', async () => {
  const s = new Store(tmp()); await s.init();
  const id = await s.saveNota(Buffer.from('%PDF-fake'), 'pdf');
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.ok(s.notaPath(id).endsWith(id + '.pdf'));
  assert.equal(s.notaPath('../x'), null);
  assert.equal(s.notaPath('0'.repeat(32)), null);
  await assert.rejects(s.saveNota(Buffer.from('x'), 'exe'), { code: 'unsupported_type' });
});
