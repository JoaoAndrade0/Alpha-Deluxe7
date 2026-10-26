'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMoney, fmt, fmtNum, MAX_CENTS } = require('../renderer/lib/dinheiro');

// gerador simples e repetível, para testes com muitos valores sem depender de sorte
const sementeFixa = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

test('entende o jeito brasileiro e o americano de escrever valores', () => {
  const casos = [
    ['69,80', 6980], ['1.311,31', 131131], ['R$ 1.234,56', 123456], ['R$ 1.234,56', 123456], ['1,234.56', 123456],
    ['12.5', 1250], ['1.234', 123400], ['1.234.567', 123456700], ['1234', 123400], ['0,5', 50], ['0', 0], ['', 0], ['   ', 0],
    ['155,09', 15509], ['  57,13  ', 5713], ['1234,5', 123450], ['999.999.999,99', 99999999999]
  ];
  for (const [entrada, centavos] of casos) assert.equal(parseMoney(entrada), centavos, JSON.stringify(entrada));
});

test('recusa o que não dá para ter certeza (devolve NaN)', () => {
  for (const ruim of ['-3', 'abc', '1e5', '69,805', '1.2.3,4', '12,3,4', '1,2.3', '--1', '10 reais', '١٢٣', '1.234.56', '9999999999', '1.000.000.000,00', '0x10', 'NaN', 'Infinity', '1,', ',', '.', '1..2', '1,234,56', '1.234.56', '1.5.5']) {
    assert.ok(Number.isNaN(parseMoney(ruim)), 'deveria recusar ' + JSON.stringify(ruim) + ' mas deu ' + parseMoney(ruim));
  }
});

test('null e undefined viram zero; objetos viram NaN sem quebrar', () => {
  assert.equal(parseMoney(null), 0);
  assert.equal(parseMoney(undefined), 0);
  assert.ok(Number.isNaN(parseMoney({})));
  assert.ok(Number.isNaN(parseMoney([1, 2])));
  assert.ok(Number.isNaN(parseMoney([5])));
  assert.ok(Number.isNaN(parseMoney(true)));
  assert.equal(parseMoney(12.5), 1250);
  assert.ok(Number.isNaN(parseMoney(-1)));
  assert.ok(Number.isNaN(parseMoney(Infinity)));
  assert.ok(Number.isNaN(parseMoney(1e21)));
});

test('escrever e ler de volta devolve o mesmo valor (20 mil valores)', () => {
  const rnd = sementeFixa(42);
  for (let i = 0; i < 20000; i++) {
    const c = Math.floor(rnd() * (i % 3 === 0 ? 100000 : MAX_CENTS + 1));
    assert.equal(parseMoney(fmtNum(c)), c, 'fmtNum ' + c);
    assert.equal(parseMoney(fmt(c)), c, 'fmt ' + c);
  }
});

test('texto aleatório nunca quebra: ou é NaN ou é inteiro dentro do limite', () => {
  const rnd = sementeFixa(7);
  const alfabeto = '0123456789.,- R$e+abc \t';
  for (let i = 0; i < 30000; i++) {
    let s = '';
    for (let j = 0, n = Math.floor(rnd() * 14); j < n; j++) s += alfabeto[Math.floor(rnd() * alfabeto.length)];
    const v = parseMoney(s);
    assert.ok(Number.isNaN(v) || (Number.isInteger(v) && v >= 0 && v <= MAX_CENTS), JSON.stringify(s) + ' -> ' + v);
  }
});

test('formatação em reais', () => {
  assert.equal(fmt(131131).replace(/ /g, ' '), 'R$ 1.311,31');
  assert.equal(fmtNum(6980), '69,80');
  assert.equal(fmt(0).replace(/ /g, ' '), 'R$ 0,00');
});
