'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../lib/exportar');
const M = require('../renderer/lib/meses');
const { ler } = require('./csv');

const HOJE = 2026 * 12 + 9; // outubro de 2026

const servico = (id, nome, ordem = 1) => ({ id, data: { nome, ordem } });
const compra = (id, dados) => ({ id, data: { servicoId: 's1', descricao: '', totalCents: 0, parcelas: 1, parcelaCents: 0, inicio: '2026-10', pagas: {}, ordem: 1, ...dados } });

test('os dados do caderno viram uma linha por parcela, na ordem dos meses', () => {
  const servicos = [servico('thayvson', 'Serviço do Thayvson (CMD)')];
  const compras = [['c1', 13960, 2, 6980], ['c2', 46528, 3, 15509], ['c3', 22852, 4, 5713], ['c4', 47794, 4, 11948]]
    .map(([id, t, p, v], i) => compra(id, { servicoId: 'thayvson', totalCents: t, parcelas: p, parcelaCents: v, inicio: '2026-11', ordem: i + 1 }));
  const { texto, linhas } = E.gerarCsv(servicos, compras, HOJE);
  assert.equal(linhas, 13);
  const tabela = ler(texto);
  assert.deepEqual(tabela[0], E.COLUNAS);
  assert.equal(tabela.length, 14);
  // novembro: as 4 compras, na ordem delas; a soma bate com o "Mês a mês" da tela (R$ 401,50)
  assert.deepEqual(tabela.slice(1, 5).map(l => [l[2], l[3], l[4], l[5], l[6]]), [
    ['1', '2', '11/2026', '69,80', '139,60'], ['1', '3', '11/2026', '155,09', '465,28'],
    ['1', '4', '11/2026', '57,13', '228,52'], ['1', '4', '11/2026', '119,48', '477,94']
  ]);
  const soma = tabela.slice(1, 5).reduce((s, l) => s + Number(l[5].replace(',', '.')), 0);
  assert.equal(soma.toFixed(2), '401.50');
  assert.deepEqual([...new Set(tabela.slice(1).map(l => l[4]))], ['11/2026', '12/2026', '01/2027', '02/2027']);
  assert.ok(texto.endsWith('\r\n'));
});

test('valores em reais saem sem decimais de ponto flutuante', () => {
  const casos = [[0, '0,00'], [5, '0,05'], [100, '1,00'], [1005, '10,05'], [123456, '1234,56'], [99999999999, '999999999,99']];
  for (const [cents, esperado] of casos) {
    const t = ler(E.gerarCsv([servico('s1', 'A')], [compra('c', { totalCents: cents, parcelaCents: cents })], HOJE).texto);
    assert.equal(t[1][5], esperado); assert.equal(t[1][6], esperado);
  }
});

test('situação: paga, atrasada ou em aberto', () => {
  const t = ler(E.gerarCsv([servico('s1', 'A')], [compra('c', { parcelas: 4, parcelaCents: 100, totalCents: 400, inicio: '2026-09', pagas: { 0: true, 3: true } })], HOJE).texto);
  assert.deepEqual(t.slice(1).map(l => [l[2], l[4], l[7]]), [['1', '09/2026', 'Paga'], ['2', '10/2026', 'Em aberto'], ['3', '11/2026', 'Em aberto'], ['4', '12/2026', 'Paga']]);
  const atrasada = ler(E.gerarCsv([servico('s1', 'A')], [compra('c', { parcelas: 2, parcelaCents: 100, totalCents: 200, inicio: '2026-08', pagas: { 1: true } })], HOJE).texto);
  assert.deepEqual(atrasada.slice(1).map(l => l[7]), ['Atrasada', 'Paga']);
});

test('data da compra e "a conferir"', () => {
  const t = ler(E.gerarCsv([servico('s1', 'A')], [
    compra('a', { dataCompra: '2026-10-20', conferir: true, ordem: 1 }),
    compra('b', { dataCompra: '2026-02-31', conferir: false, ordem: 2 }),
    compra('c', { dataCompra: 20261020, conferir: 'sim', ordem: 3 })
  ], HOJE).texto);
  assert.deepEqual(t.slice(1).map(l => [l[8], l[9]]), [['20/10/2026', 'Sim'], ['', 'Não'], ['', 'Não']]);
});

test('compras de um serviço que não existe ficam de fora, como no resumo da tela', () => {
  const r = E.gerarCsv([servico('s1', 'A')], [compra('a', {}), compra('b', { servicoId: 'apagado' }), compra('c', { servicoId: '' })], HOJE);
  assert.equal(r.linhas, 1);
  assert.equal(ler(r.texto).length, 2);
  assert.equal(E.gerarCsv([], [compra('a', {})], HOJE).linhas, 0);
  assert.deepEqual(ler(E.gerarCsv([], [], HOJE).texto), [E.COLUNAS]);
});

test('texto que uma planilha executaria como fórmula ganha um apóstrofo na frente', () => {
  const perigosos = ['=HYPERLINK("http://x.example","clique")', '+55 11 99999', '-2+3', '@SUM(A1:A9)', '  =1+1', '=cmd|\' /C calc\'!A0'];
  for (const p of perigosos) {
    const t = ler(E.gerarCsv([servico('s1', p)], [compra('c', { descricao: p })], HOJE).texto);
    assert.match(t[1][0], /^'/, 'serviço: ' + p);
    assert.match(t[1][1], /^'/, 'descrição: ' + p);
    assert.equal(t[1][0].slice(1), p.replace(/\s+/g, ' ').trim(), 'o resto do texto continua igual');
  }
  // texto comum não muda
  const normal = ler(E.gerarCsv([servico('s1', 'Casa do Pedreiro')], [compra('c', { descricao: 'cimento 50kg - saco' })], HOJE).texto);
  assert.equal(normal[1][0], 'Casa do Pedreiro'); assert.equal(normal[1][1], 'cimento 50kg - saco');
});

test('quebras de linha, tabulação e marcas invisíveis não passam para o arquivo', () => {
  const car = n => String.fromCharCode(n);
  const sujo = ['a', '\r\n', 'b', '\n', 'c', '\t', 'd', car(0x202e), 'e', car(0x2028), 'f', car(0x200b), 'g', car(0xfeff), 'h', car(0)].join('');
  const { texto, linhas } = E.gerarCsv([servico('s1', sujo)], [compra('c', { descricao: sujo })], HOJE);
  assert.equal(linhas, 1);
  const t = ler(texto);
  assert.equal(t.length, 2, 'uma única linha de dados');
  assert.equal(t[1][0], 'a b c d e f g h'); assert.equal(t[1][1], 'a b c d e f g h');
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(texto));
});

test('ponto e vírgula e aspas no texto ficam entre aspas e voltam iguais', () => {
  const t = ler(E.gerarCsv([servico('s1', 'Loja; "Boa Vista"')], [compra('c', { descricao: 'tinta; 18L; "branca"' })], HOJE).texto);
  assert.equal(t[1].length, E.COLUNAS.length);
  assert.equal(t[1][0], 'Loja; "Boa Vista"'); assert.equal(t[1][1], 'tinta; 18L; "branca"');
});

test('dados hostis na pasta são normalizados: limites de parcelas, tipos e meses', () => {
  const compras = [
    compra('a', { parcelas: 9999, parcelaCents: 1, totalCents: 1 }),
    compra('b', { parcelas: -4, parcelaCents: -50, totalCents: 'abc', ordem: 2 }),
    compra('c', { inicio: 'ontem', ordem: 3 }),
    compra('d', { descricao: { x: 1 }, pagas: 'sim', ordem: 4 }),
    { id: 'e', data: null }, { id: 'f', data: [1, 2] }, { id: 'g', data: 'texto' }
  ];
  const r = E.gerarCsv([servico('s1', 'A'), { id: 's2', data: null }], compras, HOJE);
  const t = ler(r.texto);
  assert.equal(r.linhas, 60 + 1 + 1 + 1, 'no máximo 60 parcelas por compra; compras sem serviço válido ficam de fora');
  assert.equal(t.length, r.linhas + 1);
  const b = t.filter(l => l[1] === '' && l[3] === '1' && l[5] === '0,00');
  assert.ok(b.length >= 1, 'valores negativos e texto viram zero');
  const c = t.find(l => l[4] === '10/2026'); assert.ok(c, 'início inválido cai no mês de hoje');
});

test('com marca de ordem de bytes para o Excel reconhecer os acentos', () => {
  const { texto } = E.gerarCsv([servico('s1', 'Serviço de pintura')], [compra('c', {})], HOJE);
  const buf = E.comBom(texto);
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(buf.subarray(3).toString('utf8'), texto);
  assert.match(buf.subarray(3).toString('utf8'), /Serviço de pintura/);
  assert.ok(buf.length > texto.length, 'os acentos ocupam mais de um byte');
});

test('o arquivo não carrega nada além das colunas combinadas (nada de caminhos, chaves ou identificadores)', () => {
  const { texto } = E.gerarCsv([servico('segredo-id-123', 'Loja')], [compra('compra-id-456', { servicoId: 'segredo-id-123', notaId: 'abcdef1234567890', leitura: 'texto interno da leitura', conferir: true })], HOJE);
  for (const proibido of ['segredo-id-123', 'compra-id-456', 'abcdef1234567890', 'texto interno']) assert.ok(!texto.includes(proibido), proibido);
});

test('ordem: mês, depois serviço (pela ordem dele) e compra', () => {
  const t = ler(E.gerarCsv(
    [servico('b', 'Segundo', 2), servico('a', 'Primeiro', 1)],
    [compra('x', { servicoId: 'b', inicio: '2026-10', ordem: 1 }), compra('y', { servicoId: 'a', inicio: '2026-11', ordem: 1, parcelas: 2, parcelaCents: 1, totalCents: 2 }), compra('z', { servicoId: 'a', inicio: '2026-10', ordem: 5 })],
    HOJE).texto);
  assert.deepEqual(t.slice(1).map(l => [l[4], l[0]]), [['10/2026', 'Primeiro'], ['10/2026', 'Segundo'], ['11/2026', 'Primeiro'], ['12/2026', 'Primeiro']]);
});

test('aleatório: 3 mil conjuntos de dados maldosos sempre dão um CSV válido e sem fórmulas', () => {
  let semente = 12345;
  const aleatorio = () => { semente = (semente * 1664525 + 1013904223) >>> 0; return semente / 4294967296; };
  const pega = lista => lista[Math.floor(aleatorio() * lista.length)];
  const car = n => String.fromCharCode(n);
  const pedacos = ['=', '+', '-', '@', ';', '"', '\n', '\r', '\t', 'abc', ' ', car(0x202e), car(0x2028), 'Ç', "'", '=HYPERLINK("x")', '|', '0', '\\'];
  const texto = () => Array.from({ length: Math.floor(aleatorio() * 12) }, () => pega(pedacos)).join('');
  const valor = () => pega([0, 1, 5, 99, 100000, 99999999999, 1e30, -7, NaN, null, undefined, 'abc', '12', [], {}, true, 2.5]);
  for (let n = 0; n < 3000; n++) {
    const servicos = Array.from({ length: 1 + Math.floor(aleatorio() * 3) }, (_, i) => ({ id: 's' + i, data: pega([{ nome: texto(), ordem: valor() }, { nome: valor() }, null, 'x', []]) }));
    const compras = Array.from({ length: Math.floor(aleatorio() * 6) }, (_, i) => ({
      id: 'c' + i,
      data: pega([{ servicoId: 's' + Math.floor(aleatorio() * 4), descricao: texto(), totalCents: valor(), parcelas: valor(), parcelaCents: valor(), inicio: pega(['2026-10', '2000-01', '2100-12', '1999-12', '2026-13', texto(), null]), pagas: pega([{ 0: true }, {}, 'x', null, [true]]), ordem: valor(), dataCompra: pega(['2026-10-20', texto(), null, 5]), conferir: pega([true, false, 'sim', null]) }, null, 'x', []])
    }));
    const r = E.gerarCsv(servicos, compras, HOJE);
    const t = ler(r.texto);
    assert.equal(t.length, r.linhas + 1);
    assert.ok(r.linhas <= compras.length * 60);
    for (const l of t.slice(1)) {
      assert.equal(l.length, E.COLUNAS.length);
      assert.ok(!/^[=+\-@\t\r]/.test(l[0]) && !/^[=+\-@\t\r]/.test(l[1]), 'fórmula: ' + JSON.stringify([l[0], l[1]]));
      assert.ok(!/[\r\n]/.test(l[0] + l[1]));
      assert.match(l[2], /^\d+$/); assert.match(l[3], /^\d+$/);
      assert.match(l[4], /^\d{2}\/\d{4}$/);
      assert.match(l[5], /^\d+,\d{2}$/); assert.match(l[6], /^\d+,\d{2}$/);
      assert.ok(['Paga', 'Atrasada', 'Em aberto'].includes(l[7]));
      assert.match(l[8], /^(\d{2}\/\d{2}\/\d{4})?$/);
      assert.ok(['Sim', 'Não'].includes(l[9]));
    }
  }
  assert.equal(M.chaveAtual(new Date(2026, 9, 5)), HOJE);
});
