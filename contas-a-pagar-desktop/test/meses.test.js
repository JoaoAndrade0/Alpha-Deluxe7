'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../renderer/lib/meses');

test('mês vira número e volta, sem perder nada', () => {
  for (let ano = 2000; ano <= 2100; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      const ym = ano + '-' + String(mes).padStart(2, '0');
      assert.equal(M.keyYm(M.ymKey(ym)), ym);
    }
  }
  assert.equal(M.ymKey('2026-11') - M.ymKey('2026-10'), 1);
  assert.equal(M.ymKey('2027-01') - M.ymKey('2026-12'), 1);
});

test('ymKey recusa mês inexistente, ano fora do intervalo e formato errado', () => {
  for (const ruim of ['2026-13', '2026-00', '1999-12', '2101-01', '9999-01', '2026-1', '26-01', '2026/01', '', null, undefined, 202601, {}, [], '2026-01-01', ' 2026-01']) {
    assert.ok(Number.isNaN(M.ymKey(ruim)), 'deveria recusar ' + JSON.stringify(ruim));
  }
});

test('dataValida confere o calendário de verdade', () => {
  for (const ok of ['2026-10-20', '2028-02-29', '2000-01-01', '2100-12-31']) assert.equal(M.dataValida(ok), true, ok);
  for (const ruim of ['2026-02-31', '2027-02-29', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', '1999-12-31', '2101-01-01', '2026-1-1', '', null, 20261020, '2026-10-20T00:00']) {
    assert.equal(M.dataValida(ruim), false, String(ruim));
  }
});

test('rótulos em português', () => {
  const k = M.ymKey('2026-11');
  assert.equal(M.kShort(k), 'nov/26');
  assert.equal(M.kLong(k), 'novembro de 2026');
  assert.equal(M.kOpcao(k), 'nov/2026');
  assert.equal(M.kLong(M.ymKey('2027-03')), 'março de 2027');
});

test('mês e dia de hoje a partir de uma data dada', () => {
  const d = new Date(2026, 9, 26); // 26/10/2026 (mês 9 = outubro)
  assert.equal(M.chaveAtual(d), M.ymKey('2026-10'));
  assert.equal(M.hojeStr(d), '2026-10-26');
});
