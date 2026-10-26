'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarLimitador } = require('../lib/limites');

test('limita leituras ao mesmo tempo e libera ao terminar', () => {
  const l = criarLimitador({ simultaneas: 2, max: 100 });
  const a = l.iniciar(), b = l.iniciar();
  assert.throws(() => l.iniciar(), { code: 'rate_limited' });
  assert.equal(l.ativas, 2);
  a(); a(); // liberar duas vezes não libera duas vagas
  assert.equal(l.ativas, 1);
  const c = l.iniciar();
  assert.throws(() => l.iniciar(), { code: 'rate_limited' });
  b(); c();
  assert.equal(l.ativas, 0);
});

test('teto por período: depois da janela, volta a liberar', () => {
  let agora = 1000;
  const l = criarLimitador({ simultaneas: 5, max: 3, janelaMs: 60000, agora: () => agora });
  for (let i = 0; i < 3; i++) l.iniciar()();
  assert.throws(() => l.iniciar(), { code: 'rate_limited' });
  agora += 59999;
  assert.throws(() => l.iniciar(), { code: 'rate_limited' });
  agora += 2;
  l.iniciar()();
  assert.equal(l.usadas, 1);
});

test('uma tentativa recusada não gasta cota', () => {
  const l = criarLimitador({ simultaneas: 1, max: 5 });
  const a = l.iniciar();
  for (let i = 0; i < 10; i++) assert.throws(() => l.iniciar(), { code: 'rate_limited' });
  assert.equal(l.usadas, 1);
  a();
});
