'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../lib/validar');

const falha = (fn, code) => assert.throws(fn, e => e.code === code, code);

test('coleção e identificador', () => {
  assert.equal(V.colecao('compras'), 'compras');
  assert.equal(V.colecao('servicos'), 'servicos');
  for (const ruim of ['notas', '../compras', 'compras/x', '', null, undefined, 5, {}, ['compras'], '__proto__', 'constructor']) falha(() => V.colecao(ruim), 'invalid_argument');
  assert.equal(V.id('c1'), 'c1');
  assert.equal(V.id('a-B_9'), 'a-B_9');
  for (const ruim of ['', '.', '..', '../x', 'a/b', 'a.b', 'a b', 'x'.repeat(65), null, undefined, 5, {}, '\u0000', 'a\nb']) falha(() => V.id(ruim), 'invalid_argument');
});

test('números de assinatura e pedidos', () => {
  assert.equal(V.numeroDeAssinatura(3), 3);
  for (const ruim of [0, -1, 1.5, NaN, Infinity, '3', null, 2 ** 60]) falha(() => V.numeroDeAssinatura(ruim), 'invalid_argument');
  assert.equal(V.idDePedido('abc123'), 'abc123');
  for (const ruim of ['', 'a/b', 5, null, 'x'.repeat(65)]) falha(() => V.idDePedido(ruim), 'invalid_argument');
});

test('objeto: recusa lista, nulo e texto', () => {
  assert.deepEqual(V.objeto({ a: 1 }), { a: 1 });
  for (const ruim of [null, undefined, [], [1], 'x', 5, true]) falha(() => V.objeto(ruim), 'invalid_argument');
});

test('imagens: quantidade, tipo e tamanho', () => {
  const ok = { media_type: 'image/jpeg', data: 'QUJD' };
  assert.deepEqual(V.imagens([ok]), [ok]);
  assert.equal(V.imagens([ok, ok, ok, ok, ok]).length, 5);
  falha(() => V.imagens([ok, ok, ok, ok, ok, ok]), 'image_rejected');
  for (const ruim of [[], null, 'x', {}, [null], [{ media_type: 'image/svg+xml', data: 'QUJD' }], [{ media_type: 'application/pdf', data: 'QUJD' }], [{ media_type: 'image/jpeg', data: '' }], [{ media_type: 'image/jpeg', data: 5 }], [{ media_type: 'image/jpeg' }], [{ media_type: 'image/jpeg', data: 'A'.repeat(V.MAX_ARQUIVO_BYTES * 2) }]]) {
    falha(() => V.imagens(ruim), 'image_rejected');
  }
  assert.deepEqual(Object.keys(V.imagens([{ ...ok, extra: 'x' }])[0]), ['media_type', 'data'], 'campos a mais são descartados');
});

test('arquivo da nota: só os tipos permitidos e com tamanho', () => {
  const pdf = V.arquivoDeNota({ type: 'application/pdf', data: Buffer.from('%PDF-1.4').toString('base64') });
  assert.equal(pdf.ext, 'pdf'); assert.equal(pdf.buf.toString(), '%PDF-1.4');
  assert.equal(V.arquivoDeNota({ type: 'image/jpeg', data: 'QUJD' }).ext, 'jpg');
  for (const tipo of ['text/html', 'application/x-msdownload', 'image/svg+xml', '', null, undefined, 5, '__proto__', 'constructor', 'toString']) falha(() => V.arquivoDeNota({ type: tipo, data: 'QUJD' }), 'unsupported_type');
  for (const dado of ['', null, undefined, 5, 'A'.repeat(V.MAX_ARQUIVO_BYTES * 2)]) falha(() => V.arquivoDeNota({ type: 'image/png', data: dado }), 'too_large');
  falha(() => V.arquivoDeNota(null), 'invalid_argument');
});

test('chave da API: só o formato sk-ant-', () => {
  const boa = 'sk-ant-api03-' + 'a'.repeat(40);
  assert.equal(V.chave('  ' + boa + '\n'), boa);
  for (const ruim of ['', 'abc', 'sk-ant-', 'sk-ant-curta', 'sk-openai-' + 'a'.repeat(40), boa + ' x', boa + '\n' + boa, 'sk-ant-' + 'a'.repeat(400), null, undefined]) falha(() => V.chave(ruim), 'chave_formato');
});
