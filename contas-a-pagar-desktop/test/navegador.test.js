'use strict';
// Os módulos de renderer/lib funcionam de dois jeitos: no Node (require) e na tela (script solto, sem require).
// Aqui carregamos do jeito da tela, como o navegador faz, e conferimos que o resultado é o mesmo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'renderer', 'lib');
function carregarComoNavegador() {
  const ctx = vm.createContext({ Intl, Date, Math, Number, String, Object, Array, Map, Set, RegExp, Error, isNaN, parseInt, parseFloat });
  for (const arq of ['meses', 'dinheiro', 'calculo', 'mensagens']) {
    vm.runInContext(fs.readFileSync(path.join(dir, arq + '.js'), 'utf8'), ctx, { filename: arq + '.js' });
  }
  return vm.runInContext('Contas', ctx);
}

test('carregados como scripts da tela, os módulos montam o espaço Contas completo', () => {
  const Contas = carregarComoNavegador();
  const esperadas = ['keyYm', 'ymKey', 'kLong', 'fmt', 'fmtNum', 'parseMoney', 'normCompra', 'totaisGerais', 'statusDoMes', 'mensagemDeNota', 'mensagemDeChave', 'PEDE_CONFIGURACAO', 'MAX_PARCELAS'];
  for (const nome of esperadas) assert.notEqual(typeof Contas[nome], 'undefined', 'faltou Contas.' + nome);
});

test('o resultado na tela é igual ao do Node', () => {
  const Contas = carregarComoNavegador();
  const NodeM = require('../renderer/lib/meses'), NodeD = require('../renderer/lib/dinheiro'), NodeC = require('../renderer/lib/calculo');
  assert.equal(Contas.parseMoney('1.311,31'), NodeD.parseMoney('1.311,31'));
  assert.equal(Contas.ymKey('2026-11'), NodeM.ymKey('2026-11'));
  const hoje = NodeM.ymKey('2026-10');
  const cru = { servicoId: 's', totalCents: 100, parcelas: 3, parcelaCents: 34, inicio: '2026-11' };
  const a = JSON.parse(JSON.stringify(Contas.normCompra(cru, hoje)));
  assert.deepEqual(a, JSON.parse(JSON.stringify(NodeC.normCompra(cru, hoje))));
});
