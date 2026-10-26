'use strict';
// Trava de segurança contra gasto sem querer: poucas leituras ao mesmo tempo e um teto por período.
// Se algo na tela entrar em laço, a conta da API não vira uma surpresa.

function criarLimitador({ simultaneas = 2, max = 30, janelaMs = 10 * 60 * 1000, agora = Date.now } = {}) {
  const marcas = [];
  let ativas = 0;
  return {
    // Devolve a função que libera a vaga, ou lança rate_limited.
    iniciar() {
      const t = agora();
      while (marcas.length && t - marcas[0] > janelaMs) marcas.shift();
      if (ativas >= simultaneas || marcas.length >= max) {
        const e = new Error('Muitas leituras em pouco tempo.');
        e.code = 'rate_limited';
        throw e;
      }
      marcas.push(t);
      ativas++;
      let liberada = false;
      return () => { if (!liberada) { liberada = true; ativas--; } };
    },
    get ativas() { return ativas; },
    get usadas() { return marcas.length; }
  };
}

module.exports = { criarLimitador };
