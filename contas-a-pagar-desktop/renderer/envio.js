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

  async function criarCompra(alvo, info, notaId, notaTipo) {
    let servicoId = alvo;
    if (servicoId === '__new__' || !ctx.servicos.has(servicoId)) {
      const ref = ctx.db.collection('servicos').doc();
      await ref.set({ nome: info.fornecedor || 'Novo serviço', ordem: Date.now() });
      servicoId = ref.id; ctx.forcarAlvo(servicoId);
    }
    const ref = ctx.db.collection('compras').doc();
    await ref.set({
      servicoId, descricao: info.descricao, totalCents: info.totalCents, parcelas: info.parcelas, parcelaCents: info.parcelaCents,
      inicio: info.inicio, pagas: {}, ordem: Date.now(), conferir: true, leitura: info.obs.join(' '),
      notaId, notaTipo, dataCompra: info.dataCompra
    });
    return ref.id;
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

  async function processar(it) {
    const sinal = it.ctl.signal, cancelar = [['Cancelar', () => it.ctl.abort()]];
    try {
      if (sinal.aborted) throw { code: 'cancelled' };
      definirEstado(it, 'Preparando o arquivo…', 'busy', cancelar);
      const pdf = C.preparo.ehPdf(it.arquivo);
      const paginas = (pdf ? await C.preparo.pdfParaImagens(it.arquivo, MAX_IMAGENS) : [await C.preparo.paraJpeg(it.arquivo)]).slice(0, MAX_IMAGENS);
      if (sinal.aborted) throw { code: 'cancelled' };
      definirEstado(it, 'Lendo a nota…', 'busy', cancelar);
      const info = await C.ponte.lerNota(paginas, sinal);
      definirEstado(it, 'Criando a compra…', 'busy');
      let notaId = '';
      try { notaId = await C.ponte.guardarArquivo(pdf ? it.arquivo : paginas[0], pdf ? 'application/pdf' : 'image/jpeg'); }
      catch (e) { info.obs.push('O arquivo da nota não foi guardado.'); }
      const id = await criarCompra(it.alvo, info, notaId, pdf ? 'pdf' : 'imagem');
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
