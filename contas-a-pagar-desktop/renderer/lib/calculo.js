'use strict';
// Regras do controle: normaliza registros vindos da pasta compartilhada e calcula totais por mês e por serviço.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./meses'), require('./dinheiro'));
  else { root.Contas = root.Contas || {}; Object.assign(root.Contas, factory(root.Contas, root.Contas)); }
})(globalThis, function (M, D) {
  const MAX_PARCELAS = 60;
  const inteiro = v => Math.min(D.MAX_CENTS, Math.max(0, Math.round(Number(v)) || 0));
  const texto = (v, max) => String(v == null ? '' : v).slice(0, max);
  const objetoSimples = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  // Tudo que vem do disco é tratado como não confiável: tipos, tamanhos e intervalos são forçados aqui.
  const normServico = d => ({ nome: texto(d && d.nome, 80), ordem: Number(d && d.ordem) || 0 });

  const normCompra = (d, chaveHoje) => {
    d = objetoSimples(d) ? d : {};
    return {
      servicoId: texto(d.servicoId, 64),
      descricao: texto(d.descricao, 120),
      totalCents: inteiro(d.totalCents),
      parcelas: Math.min(MAX_PARCELAS, Math.max(1, Math.round(Number(d.parcelas)) || 1)),
      parcelaCents: inteiro(d.parcelaCents),
      inicio: isNaN(M.ymKey(d.inicio)) ? M.keyYm(chaveHoje) : d.inicio,
      pagas: objetoSimples(d.pagas) ? d.pagas : {},
      ordem: Number(d.ordem) || 0,
      conferir: d.conferir === true,
      leitura: texto(d.leitura, 600),
      notaId: /^[A-Za-z0-9_-]{8,64}$/.test(d.notaId || '') ? d.notaId : '',
      notaTipo: d.notaTipo === 'pdf' ? 'pdf' : 'imagem',
      dataCompra: M.dataValida(d.dataCompra) ? d.dataCompra : ''
    };
  };

  const porOrdem = (a, b) => (a[1].ordem - b[1].ordem) || (a[0] < b[0] ? -1 : 1);
  const estaPaga = (c, i) => c.pagas[i] === true;

  function contarPagas(c) {
    let n = 0;
    for (let i = 0; i < c.parcelas; i++) if (estaPaga(c, i)) n++;
    return n;
  }

  // Resumo de uma compra: quantas parcelas pagas, quanto falta e se a soma das parcelas bate com o total.
  function resumoCompra(c) {
    const pagas = contarPagas(c);
    return {
      pagas, quitada: pagas === c.parcelas,
      falta: c.parcelaCents * (c.parcelas - pagas),
      soma: c.parcelaCents * c.parcelas
    };
  }

  // Totais gerais e por mês (só compras cujo serviço existe).
  function totaisGerais(servicos, compras) {
    const meses = new Map();
    let total = 0, pago = 0;
    for (const c of compras.values()) {
      if (!servicos.has(c.servicoId)) continue;
      const k0 = M.ymKey(c.inicio);
      for (let i = 0; i < c.parcelas; i++) {
        const m = meses.get(k0 + i) || { due: 0, paid: 0 };
        m.due += c.parcelaCents; total += c.parcelaCents;
        if (estaPaga(c, i)) { m.paid += c.parcelaCents; pago += c.parcelaCents; }
        meses.set(k0 + i, m);
      }
    }
    return { meses, total, pago };
  }

  function totaisServico(compras, servicoId) {
    let total = 0, pago = 0;
    for (const c of compras.values()) {
      if (c.servicoId !== servicoId) continue;
      for (let i = 0; i < c.parcelas; i++) { total += c.parcelaCents; if (estaPaga(c, i)) pago += c.parcelaCents; }
    }
    return { total, pago };
  }

  // Situação de um mês: sem parcelas, pago, atrasado, parcial ou em aberto.
  function statusDoMes(m, k, chaveHoje) {
    const falta = m.due - m.paid;
    if (!m.due) return { cls: 'none', falta: 0 };
    if (!falta) return { cls: 'ok', falta: 0 };
    if (k < chaveHoje) return { cls: 'late', falta };
    if (m.paid) return { cls: 'part', falta };
    return { cls: 'open', falta };
  }

  return { MAX_PARCELAS, normServico, normCompra, porOrdem, estaPaga, contarPagas, resumoCompra, totaisGerais, totaisServico, statusDoMes };
});
