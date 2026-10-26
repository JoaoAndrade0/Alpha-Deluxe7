'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../renderer/lib/meses');
const C = require('../renderer/lib/calculo');

const HOJE = M.ymKey('2026-10');

// As quatro compras do caderno (serviço do Thayvson), todas começando em nov/2026.
function caderno() {
  const servicos = new Map([['thayvson', C.normServico({ nome: 'Serviço do Thayvson (CMD)', ordem: 1 })]]);
  const compras = new Map();
  [['c1', 13960, 2, 6980], ['c2', 46528, 3, 15509], ['c3', 22852, 4, 5713], ['c4', 47794, 4, 11948]].forEach(([id, t, p, v], i) =>
    compras.set(id, C.normCompra({ servicoId: 'thayvson', totalCents: t, parcelas: p, parcelaCents: v, inicio: '2026-11', ordem: i + 1 }, HOJE)));
  return { servicos, compras };
}

test('o caderno bate: 401,50 + 401,50 + 331,70 + 176,61 = 1.311,31', () => {
  const { servicos, compras } = caderno();
  const g = C.totaisGerais(servicos, compras);
  assert.equal(g.total, 131131);
  assert.equal(g.pago, 0);
  const k0 = M.ymKey('2026-11');
  assert.deepEqual([0, 1, 2, 3].map(i => g.meses.get(k0 + i).due), [40150, 40150, 33170, 17661]);
  assert.equal(g.meses.size, 4);
});

test('marcar parcelas pagas move os totais do mês e o geral', () => {
  const { servicos, compras } = caderno();
  compras.get('c1').pagas = { 0: true };
  compras.get('c2').pagas = { 0: true, 1: true };
  const g = C.totaisGerais(servicos, compras);
  const k0 = M.ymKey('2026-11');
  assert.equal(g.pago, 6980 + 15509 * 2);
  assert.equal(g.meses.get(k0).paid, 6980 + 15509);
  assert.equal(g.meses.get(k0 + 1).paid, 15509);
  const t = C.totaisServico(compras, 'thayvson');
  assert.deepEqual(t, { total: 131131, pago: 6980 + 15509 * 2 });
});

test('só conta como paga a parcela marcada com true (texto "false" não vale)', () => {
  const c = C.normCompra({ parcelas: 3, parcelaCents: 100, pagas: { 0: true, 1: 'false', 2: 1 } }, HOJE);
  assert.equal(C.contarPagas(c), 1);
  assert.deepEqual(C.resumoCompra(c), { pagas: 1, quitada: false, falta: 200, soma: 300 });
  assert.equal(C.resumoCompra(C.normCompra({ parcelas: 2, parcelaCents: 50, pagas: { 0: true, 1: true } }, HOJE)).quitada, true);
});

test('compra de serviço que não existe mais não entra no total', () => {
  const { servicos, compras } = caderno();
  compras.set('orfa', C.normCompra({ servicoId: 'apagado', totalCents: 9999, parcelas: 1, parcelaCents: 9999, inicio: '2026-11' }, HOJE));
  assert.equal(C.totaisGerais(servicos, compras).total, 131131);
});

test('situação do mês: sem parcelas, pago, atrasado, parcial e em aberto', () => {
  assert.deepEqual(C.statusDoMes({ due: 0, paid: 0 }, HOJE, HOJE), { cls: 'none', falta: 0 });
  assert.deepEqual(C.statusDoMes({ due: 100, paid: 100 }, HOJE - 3, HOJE), { cls: 'ok', falta: 0 });
  assert.deepEqual(C.statusDoMes({ due: 100, paid: 40 }, HOJE - 1, HOJE), { cls: 'late', falta: 60 });
  assert.deepEqual(C.statusDoMes({ due: 100, paid: 0 }, HOJE - 1, HOJE), { cls: 'late', falta: 100 });
  assert.deepEqual(C.statusDoMes({ due: 100, paid: 40 }, HOJE, HOJE), { cls: 'part', falta: 60 });
  assert.deepEqual(C.statusDoMes({ due: 100, paid: 0 }, HOJE + 1, HOJE), { cls: 'open', falta: 100 });
});

test('registros hostis ou quebrados são corrigidos ao ler do disco', () => {
  const hostil = C.normCompra({
    servicoId: 'x'.repeat(500), descricao: '<img src=x onerror=alert(1)>'.repeat(50), totalCents: -5, parcelas: 1e9, parcelaCents: 1e30,
    inicio: '9999-99', pagas: [true, true], ordem: 'abc', conferir: 'sim', leitura: 'y'.repeat(5000), notaId: '../../etc/passwd',
    notaTipo: 'exe', dataCompra: '2026-02-31'
  }, HOJE);
  assert.equal(hostil.servicoId.length, 64);
  assert.equal(hostil.descricao.length, 120);
  assert.equal(hostil.totalCents, 0);
  assert.equal(hostil.parcelas, C.MAX_PARCELAS);
  assert.equal(hostil.parcelaCents, 99999999999);
  assert.equal(hostil.inicio, M.keyYm(HOJE));
  assert.deepEqual(hostil.pagas, {});
  assert.equal(hostil.ordem, 0);
  assert.equal(hostil.conferir, false);
  assert.equal(hostil.leitura.length, 600);
  assert.equal(hostil.notaId, '');
  assert.equal(hostil.notaTipo, 'imagem');
  assert.equal(hostil.dataCompra, '');
  // entradas que nem são objeto
  for (const lixo of [null, undefined, 5, 'texto', [], true]) {
    const c = C.normCompra(lixo, HOJE);
    assert.equal(c.parcelas, 1); assert.equal(c.totalCents, 0); assert.equal(c.inicio, M.keyYm(HOJE));
  }
  assert.deepEqual(C.normServico(null), { nome: '', ordem: 0 });
  assert.equal(C.normServico({ nome: 'n'.repeat(500) }).nome.length, 80);
});

test('ordenação por ordem, com desempate pelo identificador', () => {
  const m = new Map([['b', { ordem: 2 }], ['a', { ordem: 2 }], ['c', { ordem: 1 }]]);
  assert.deepEqual([...m].sort(C.porOrdem).map(([id]) => id), ['c', 'a', 'b']);
});
