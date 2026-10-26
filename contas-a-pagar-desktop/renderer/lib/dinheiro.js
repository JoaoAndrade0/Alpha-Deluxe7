'use strict';
// Dinheiro sempre em centavos inteiros, para nunca acumular erro de arredondamento.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Contas = root.Contas || {}; Object.assign(root.Contas, factory()); }
})(globalThis, function () {
  const MAX_CENTS = 99999999999; // R$ 999.999.999,99
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const fmt = c => brl.format(c / 100);
  const fmtNum = c => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Lê o que a pessoa digita ("69,80", "1.311,31", "R$ 1.234,56", "12.5") e devolve centavos.
  // Devolve NaN quando não dá para ter certeza (negativo, letras, mais de 2 casas, valor gigante, formato misturado).
  function parseMoney(input) {
    if (input === null || input === undefined) return 0;
    if (typeof input !== 'string' && typeof input !== 'number') return NaN;
    if (typeof input === 'number' && !Number.isFinite(input)) return NaN;
    const s = String(input).replace(/R\$|\s/g, '');
    if (s === '') return 0;
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    let dec = null;
    if (lc >= 0 && ld >= 0) dec = lc > ld ? ',' : '.'; // o último separador é o decimal
    else if (lc >= 0) dec = ',';
    else if (ld >= 0) dec = /^\d{1,3}(\.\d{3})+$/.test(s) ? null : '.'; // 1.234 = mil duzentos e trinta e quatro
    let inteiro = s, frac = '';
    if (dec) {
      const i = s.lastIndexOf(dec);
      inteiro = s.slice(0, i); frac = s.slice(i + 1);
      if (inteiro.includes(dec) || !/^\d{1,2}$/.test(frac)) return NaN; // "1,234,56", "1," e 3 casas decimais não valem
    }
    // Separadores só valem como milhar se formarem grupos de 3 dígitos (1.234.567); "1.2.3" é lixo.
    if (/[.,]/.test(inteiro) && !/^\d{1,3}([.,]\d{3})+$/.test(inteiro)) return NaN;
    inteiro = inteiro.replace(/[.,]/g, '');
    if (inteiro.length > 9) return NaN;
    const cents = parseInt(inteiro || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
    return cents <= MAX_CENTS ? cents : NaN;
  }

  return { MAX_CENTS, fmt, fmtNum, parseMoney };
});
