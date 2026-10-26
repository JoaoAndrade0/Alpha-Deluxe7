'use strict';
// Envio de nota: escolher, arrastar ou colar a foto/PDF, ler pelo Claude e criar a compra.
(function () {
  const C = (window.Contas = window.Contas || {});
  const $ = s => document.querySelector(s);
  const MAX_IMAGENS = 5;

  let ctx = null; // { db, servicos, alvoEscolhido(), forcarAlvo(id) } entregue pela tela principal
  const fila = [];
  let rodando = false;

  const ehImagem = f => /^image\//.test(f.type);

  // Cria o serviço (se for novo) e a compra. Os identificadores ficam guardados no item: se algo falhar no meio e a
  // pessoa tentar de novo, o mesmo serviço e a mesma compra são regravados em vez de criar duplicatas.
  async function criarCompra(it, notaTipo) {
    if (!it.servicoId) {
      if (it.alvo === '__new__' || !ctx.servicos.has(it.alvo)) {
        it.servicoNovoId = it.servicoNovoId || ctx.db.collection('servicos').doc().id;
        await ctx.db.doc('servicos/' + it.servicoNovoId).set({ nome: it.info.fornecedor || 'Novo serviço', ordem: it.ordemServico = it.ordemServico || Date.now() });
        it.servicoId = it.servicoNovoId; ctx.forcarAlvo(it.servicoId);
      } else it.servicoId = it.alvo;
    }
    it.compraId = it.compraId || ctx.db.collection('compras').doc().id;
    const i = it.info;
    await ctx.db.doc('compras/' + it.compraId).set({
      servicoId: it.servicoId, descricao: i.descricao, totalCents: i.totalCents, parcelas: i.parcelas, parcelaCents: i.parcelaCents,
      inicio: i.inicio, pagas: {}, ordem: it.ordemCompra = it.ordemCompra || Date.now(), conferir: true, leitura: i.obs.join(' '),
      notaId: it.notaId, notaTipo, dataCompra: i.dataCompra, ancora: 'total'
    });
    return it.compraId;
  }

  function mostrarCompra(id) {
    const el = document.querySelector('[data-compra="' + CSS.escape(id) + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  function definirEstado(it, texto, cls, acoes) {
    it.li.className = 'up-item ' + cls;
    it.li.querySelector('.up-state').textContent = texto;
    it.li.querySelector('.up-actions').replaceChildren(...(acoes || []).map(([rotulo, fn]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'link'; b.textContent = rotulo; b.addEventListener('click', fn);
      return b;
    }));
  }

  function adicionar(arquivos) {
    if (!ctx) return;
    const alvo = ctx.alvoEscolhido();
    for (const arquivo of arquivos) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="up-name"></span><span class="up-state"></span><span class="up-actions"></span>';
      li.querySelector('.up-name').textContent = arquivo.name || 'imagem colada';
      $('#up-list').prepend(li);
      const it = { arquivo, alvo, li, ctl: null };
      if (!C.preparo.ehPdf(arquivo) && !ehImagem(arquivo)) {
        definirEstado(it, 'Formato não suportado. Envie JPG, PNG ou PDF.', 'err', [['Fechar', () => li.remove()]]);
        continue;
      }
      enfileirar(it);
    }
  }

  function enfileirar(it) {
    it.ctl = new AbortController();
    definirEstado(it, 'Na fila…', 'busy', [['Cancelar', () => it.ctl.abort()]]);
    fila.push(it);
    processarFila();
  }

  async function processarFila() {
    if (rodando) return;
    rodando = true;
    while (fila.length) await processar(fila.shift());
    rodando = false;
  }

  // Passo a passo, guardando o que já foi feito em "it": "Tentar de novo" continua de onde parou e não paga outra leitura.
  async function processar(it) {
    const sinal = it.ctl.signal, cancelar = [['Cancelar', () => it.ctl.abort()]];
    try {
      if (sinal.aborted) throw { code: 'cancelled' };
      const pdf = C.preparo.ehPdf(it.arquivo);
      if (!it.info) {
        definirEstado(it, 'Preparando o arquivo…', 'busy', cancelar);
        const prep = pdf ? await C.preparo.pdfParaImagens(it.arquivo, MAX_IMAGENS) : { imagens: [await C.preparo.paraJpeg(it.arquivo)], totalPaginas: 1 };
        it.paginas = prep.imagens.slice(0, MAX_IMAGENS);
        if (sinal.aborted) throw { code: 'cancelled' };
        definirEstado(it, 'Lendo a nota…', 'busy', cancelar);
        it.info = await C.ponte.lerNota(it.paginas, sinal);
        if (prep.totalPaginas > it.paginas.length) {
          it.info.obs.push('O PDF tem ' + prep.totalPaginas + ' páginas e li só as ' + it.paginas.length + ' primeiras. Confira o total.');
        }
      }
      definirEstado(it, 'Criando a compra…', 'busy');
      if (it.notaId === undefined) {
        try { it.notaId = await C.ponte.guardarArquivo(pdf ? it.arquivo : it.paginas[0], pdf ? 'application/pdf' : 'image/jpeg'); }
        catch (e) { it.notaId = ''; it.info.obs.push('O arquivo da nota não foi guardado.'); }
      }
      let id;
      try { id = await criarCompra(it, pdf ? 'pdf' : 'imagem'); }
      catch (e) { throw { code: 'sem_gravar', message: String((e && e.message) || e) }; }
      const info = it.info;
      const texto = info.totalCents
        ? 'Compra criada: ' + C.fmt(info.totalCents) + (info.parcelas > 1 ? ' em ' + info.parcelas + '× de ' + C.fmt(info.parcelaCents) : ' à vista') + (info.fornecedor ? ' · ' + info.fornecedor : '')
        : 'Compra criada, mas não encontrei o valor. Preencha o total e as parcelas.';
      definirEstado(it, texto, 'done', [['Ver compra', () => mostrarCompra(id)], ['Fechar', () => it.li.remove()]]);
    } catch (e) {
      if (e && e.code === 'cancelled') { it.li.remove(); return; }
      const abrir = e && C.PEDE_CONFIGURACAO.includes(e.code) && C.abrirConfiguracoes;
      definirEstado(it, C.mensagemDeNota(e), 'err', [
        ...(abrir ? [['Abrir configurações', () => C.abrirConfiguracoes()]] : []),
        ['Tentar de novo', () => enfileirar(it)],
        ['Fechar', () => it.li.remove()]
      ]);
    }
  }

  function iniciar(contexto) {
    ctx = contexto;
    const btn = $('#pick-btn'), pick = $('#pick'), area = $('#drop');
    btn.disabled = false;
    btn.addEventListener('click', () => pick.click());
    pick.addEventListener('change', () => { adicionar([...pick.files]); pick.value = ''; });
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('over'); });
    area.addEventListener('dragleave', () => area.classList.remove('over'));
    area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('over'); adicionar([...e.dataTransfer.files]); });
    document.addEventListener('paste', e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
      const arquivos = [...((e.clipboardData && e.clipboardData.files) || [])].filter(ehImagem);
      if (arquivos.length) adicionar(arquivos);
    });
  }

  C.envio = { iniciar };
})();
