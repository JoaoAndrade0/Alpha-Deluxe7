'use strict';
// Meses como número inteiro (ano * 12 + mês) para somar e comparar sem erro, e seus rótulos em português.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Contas = root.Contas || {}; Object.assign(root.Contas, factory()); }
})(globalThis, function () {
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const ANO_MIN = 2000, ANO_MAX = 2100; // limites sensatos: dados fora disso são tratados como inválidos

  const chaveAtual = (agora = new Date()) => agora.getFullYear() * 12 + agora.getMonth();
  const keyYm = k => Math.floor(k / 12) + '-' + String(k % 12 + 1).padStart(2, '0');
  const ymKey = ym => {
    const m = /^(\d{4})-(\d{2})$/.exec(typeof ym === 'string' ? ym : '');
    if (!m) return NaN;
    const ano = +m[1], mes = +m[2];
    return ano >= ANO_MIN && ano <= ANO_MAX && mes >= 1 && mes <= 12 ? ano * 12 + (mes - 1) : NaN;
  };
  const kShort = k => MES[k % 12] + '/' + String(Math.floor(k / 12)).slice(-2);
  const kLong = k => MES_L[k % 12] + ' de ' + Math.floor(k / 12);
  const kOpcao = k => MES[k % 12] + '/' + Math.floor(k / 12);
  const hojeStr = (agora = new Date()) =>
    agora.getFullYear() + '-' + String(agora.getMonth() + 1).padStart(2, '0') + '-' + String(agora.getDate()).padStart(2, '0');

  // Data AAAA-MM-DD que existe de verdade no calendário (recusa 31/02, mês 13, ano fora do intervalo).
  const dataValida = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!m) return false;
    const ano = +m[1], mes = +m[2], dia = +m[3];
    if (ano < ANO_MIN || ano > ANO_MAX || mes < 1 || mes > 12 || dia < 1) return false;
    return dia <= new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  };

  return { MES, MES_L, ANO_MIN, ANO_MAX, chaveAtual, keyYm, ymKey, kShort, kLong, kOpcao, hojeStr, dataValida };
});
