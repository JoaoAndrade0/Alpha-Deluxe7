'use strict';
// Planilha (CSV) com uma linha por parcela, para mandar ao contador.
// O arquivo é montado aqui, no processo principal, a partir do que está na pasta compartilhada: a tela não participa.

const C = require('../renderer/lib/calculo');
const M = require('../renderer/lib/meses');
const { limpar } = require('./nota');

const SEP = ';'; // o Excel em português espera ponto e vírgula, e vírgula como decimal
const FIM_DE_LINHA = '\r\n';
const COLUNAS = [
  'Serviço', 'Compra', 'Nº da parcela', 'Total de parcelas', 'Mês', 'Valor da parcela (R$)',
  'Total da compra (R$)', 'Situação', 'Data da compra', 'A conferir'
];

// Uma planilha executa como fórmula o texto que começa com = + - ou @. Os nomes e descrições podem vir de uma
// nota lida por máquina (inclusive texto escondido nela), então esses textos ganham um apóstrofo na frente e
// aparecem como texto comum. Quebras de linha e caracteres invisíveis também saem.
function texto(valor, max) {
  const s = limpar(String(valor == null ? '' : valor), max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// Campo do CSV: entre aspas quando tem separador ou aspas.
function campo(s) {
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// 1234,56 (sem separador de milhar, para o Excel ler como número). Só conta com inteiros, nunca com decimais.
const reais = cents => Math.floor(cents / 100) + ',' + String(cents % 100).padStart(2, '0');
const dataBr = iso => (M.dataValida(iso) ? iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
const mesBr = k => String(k % 12 + 1).padStart(2, '0') + '/' + Math.floor(k / 12);

// servicos e compras: as listas de { id, data } da pasta de dados. Só entram compras cujo serviço existe,
// como no resumo da tela. As linhas saem em ordem de mês, depois serviço e compra, como na tela.
function gerarCsv(servicos, compras, chaveHoje) {
  const nomes = new Map();
  const ordemServico = new Map();
  for (const s of servicos) {
    const n = C.normServico(s.data);
    nomes.set(s.id, n.nome);
    ordemServico.set(s.id, n.ordem);
  }
  const linhas = [];
  for (const doc of compras) {
    const c = C.normCompra(doc.data, chaveHoje);
    if (!nomes.has(c.servicoId)) continue;
    const k0 = M.ymKey(c.inicio);
    for (let i = 0; i < c.parcelas; i++) {
      linhas.push({ k: k0 + i, servico: c.servicoId, compraId: doc.id, ordemCompra: c.ordem, i, c });
    }
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  linhas.sort((a, b) =>
    (a.k - b.k) || (ordemServico.get(a.servico) - ordemServico.get(b.servico)) || cmp(a.servico, b.servico) ||
    (a.ordemCompra - b.ordemCompra) || cmp(a.compraId, b.compraId) || (a.i - b.i));

  const saida = [COLUNAS.map(campo).join(SEP)];
  for (const l of linhas) {
    const c = l.c;
    const situacao = C.estaPaga(c, l.i) ? 'Paga' : (l.k < chaveHoje ? 'Atrasada' : 'Em aberto');
    saida.push([
      texto(nomes.get(l.servico), 80), texto(c.descricao, 120), String(l.i + 1), String(c.parcelas), mesBr(l.k),
      reais(c.parcelaCents), reais(c.totalCents), situacao, dataBr(c.dataCompra), c.conferir ? 'Sim' : 'Não'
    ].map(campo).join(SEP));
  }
  return { texto: saida.join(FIM_DE_LINHA) + FIM_DE_LINHA, linhas: linhas.length };
}

// O Excel só reconhece acentos de um CSV em UTF-8 quando o arquivo começa com esta marca (BOM).
const comBom = csv => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf8')]);

module.exports = { gerarCsv, comBom, COLUNAS, SEP };
