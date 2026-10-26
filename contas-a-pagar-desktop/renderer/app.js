'use strict';
// Tela principal: mostra serviços, compras e meses, e grava cada alteração na pasta compartilhada.
// As regras de cálculo ficam em lib/ (testadas à parte); aqui só se desenha e se reage a cliques.
(async function () {
  const C = window.Contas;
  const { fmt, fmtNum, parseMoney, keyYm, ymKey, kShort, kLong, kOpcao } = C;
  const $ = s => document.querySelector(s);
  const hoje = C.chaveAtual();

  const servicos = new Map(), compras = new Map();
  const pronto = { s: false, c: false };
  let db = null, carregado = false, gravando = 0, falhou = false, foco = null, alvoForcado = '';

  /* ---------- situação e gravação ---------- */
  function mostrarSituacao() {
    const el = $('#save');
    let texto = 'Tudo salvo', ruim = false;
    if (!db) texto = 'Escolha a pasta de dados';
    else if (gravando) texto = 'Salvando…';
    else if (falhou) { texto = 'Não foi possível salvar. Tente de novo.'; ruim = true; }
    else if (!carregado) texto = 'Carregando…';
    el.textContent = texto;
    el.classList.toggle('bad', ruim);
  }
  function acompanhar(promessa) {
    gravando++; mostrarSituacao();
    return promessa.then(() => { falhou = false; }, () => { falhou = true; }).finally(() => { gravando--; mostrarSituacao(); });
  }
  // Edições ainda sendo gravadas ficam "por cima" do que veio do disco. Assim, a próxima edição (e os valores que
  // ela calcula, como a parcela a partir do total) sempre enxerga as anteriores, mesmo digitando muito rápido.
  const pendentes = new Map(); // "compras/id" -> { n: gravações em andamento, mudanca }
  const colecaoLocal = c => (c === 'compras' ? compras : servicos);
  function sobrepor(colecao, id, objeto) {
    const p = pendentes.get(colecao + '/' + id);
    if (!p) return objeto;
    for (const k of Object.keys(p.mudanca)) objeto[k] = k === 'pagas' ? { ...objeto.pagas, ...p.mudanca.pagas } : p.mudanca[k];
    return objeto;
  }
  async function recarregarDoDisco() { // depois de uma gravação que falhou, volta ao que realmente está no disco
    try {
      const [s, c] = await Promise.all([db.collection('servicos').get(), db.collection('compras').get()]);
      servicos.clear(); s.docs.forEach(d => servicos.set(d.id, C.normServico(d.data() || {})));
      compras.clear(); c.docs.forEach(d => compras.set(d.id, sobrepor('compras', d.id, C.normCompra(d.data() || {}, hoje))));
      agendar();
    } catch (e) { /* sem acesso à pasta: o aviso de falha já está na tela */ }
  }
  const filas = new Map(); // uma gravação por vez em cada registro, na ordem em que a pessoa agiu
  function alterar(colecao, id, mudanca) {
    const caminho = colecao + '/' + id;
    const p = pendentes.get(caminho) || { n: 0, mudanca: {} };
    p.n++;
    for (const k of Object.keys(mudanca)) p.mudanca[k] = k === 'pagas' ? { ...p.mudanca.pagas, ...mudanca.pagas } : mudanca[k];
    pendentes.set(caminho, p);
    const atual = colecaoLocal(colecao).get(id);
    if (atual) { sobrepor(colecao, id, atual); agendar(); } // a tela já mostra o resultado, sem esperar o disco
    const anterior = filas.get(caminho) || Promise.resolve();
    const proxima = anterior.catch(() => {}).then(() => db.doc(caminho).update(mudanca));
    filas.set(caminho, proxima);
    const fim = () => { p.n--; if (p.n === 0) pendentes.delete(caminho); };
    proxima.then(fim, () => { fim(); recarregarDoDisco(); });
    return acompanhar(proxima);
  }

  /* ---------- resumo e meses ---------- */
  const ROTULO_STATUS = {
    none: () => 'Sem parcelas', ok: () => '✓ Pago', open: () => 'Em aberto',
    late: falta => 'Atrasado · falta ' + fmt(falta), part: falta => 'Falta ' + fmt(falta)
  };

  function desenharResumo() {
    const { meses, total, pago } = C.totaisGerais(servicos, compras);
    $('#s-total').textContent = fmt(total);
    $('#s-paid').textContent = fmt(pago);
    $('#s-left').textContent = fmt(total - pago);
    const pct = total ? Math.round(pago / total * 100) : 0;
    $('#s-bar').style.width = pct + '%';
    $('#s-meter').setAttribute('aria-valuenow', pct);
    $('#s-cap').textContent = total ? pct + '% pago · ainda faltam ' + fmt(total - pago) : 'Nenhuma parcela lançada ainda.';

    const lista = $('#months');
    const chaves = [...meses.keys()];
    if (!chaves.length) {
      lista.innerHTML = '<li class="m-empty">Os meses aparecem aqui quando você lançar a primeira compra parcelada.</li>';
      return;
    }
    const lo = Math.min(...chaves), hi = Math.max(...chaves);
    const maior = Math.max(...[...meses.values()].map(m => m.due)) || 1;
    let html = '';
    for (let k = lo; k <= hi; k++) {
      const m = meses.get(k) || { due: 0, paid: 0 };
      const st = C.statusDoMes(m, k, hoje);
      html += '<li class="m' + (k === hoje ? ' now' : '') + '">' +
        '<div class="when"><b>' + (k - lo + 1) + 'º mês</b><span>' + kLong(k) + (k === hoje ? ' · este mês' : '') + '</span></div>' +
        '<div class="bar" aria-hidden="true"><span class="due" data-w="' + (m.due / maior * 100) + '"><b data-w="' + (m.due ? m.paid / m.due * 100 : 0) + '"></b></span></div>' +
        '<div class="amt">' + fmt(m.due) + '</div>' +
        '<div class="st ' + st.cls + '">' + ROTULO_STATUS[st.cls](st.falta) + '</div></li>';
    }
    lista.innerHTML = html;
    // Larguras das barras pelo CSSOM: assim a política de segurança não precisa liberar estilo dentro do HTML.
    lista.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
  }

  /* ---------- serviços e compras ---------- */
  const nosServico = new Map();
  const definir = (el, valor, forcar) => { if ((forcar || document.activeElement !== el) && el.value !== valor) el.value = valor; };

  function montarOpcoesDeMes(seletor, ym) {
    const k = ymKey(ym);
    const lo = Math.min(hoje - 24, k), hi = Math.max(hoje + 48, k);
    const frag = document.createDocumentFragment();
    for (let x = lo; x <= hi; x++) {
      const o = document.createElement('option');
      o.value = keyYm(x); o.textContent = kOpcao(x); frag.append(o);
    }
    seletor.replaceChildren(frag);
  }

  function montarServico() {
    const el = document.createElement('article');
    el.className = 'svc';
    el.innerHTML =
      '<div class="svc-head">' +
        '<input class="plain svc-name" data-f="snome" aria-label="Nome do serviço" maxlength="80" autocomplete="off">' +
        '<div class="svc-figs"></div>' +
      '</div>' +
      '<p class="svc-empty" hidden>Nenhuma compra neste serviço ainda.</p>' +
      '<div class="compras"></div>' +
      '<div class="svc-foot">' +
        '<button class="btn ghost" type="button" data-act="add-compra">+ Adicionar compra</button>' +
        '<button class="link danger" type="button" data-act="del-servico">Excluir serviço</button>' +
      '</div>';
    return {
      el, nos: new Map(), figs: '',
      nome: el.querySelector('.svc-name'), totais: el.querySelector('.svc-figs'),
      lista: el.querySelector('.compras'), vazio: el.querySelector('.svc-empty')
    };
  }

  function montarCompra() {
    const el = document.createElement('div');
    el.className = 'compra';
    el.innerHTML =
      '<div class="c-top">' +
        '<strong class="c-title"></strong>' +
        '<input class="plain c-desc" data-f="desc" placeholder="Descrição (opcional)" aria-label="Descrição da compra" maxlength="120" autocomplete="off">' +
      '</div>' +
      '<div class="c-review" hidden>' +
        '<a class="thumb" target="_blank" rel="noopener" hidden><img alt="Foto da nota enviada"></a>' +
        '<div class="rv-text"><strong>Lido da nota. Confira antes de pagar.</strong><span class="rv-note"></span></div>' +
        '<button class="btn ghost sm" type="button" data-act="ok-compra">Está certo</button>' +
      '</div>' +
      '<div class="fields">' +
        '<label class="fld">Total<span class="money"><i aria-hidden="true">R$</i><input data-f="total" inputmode="decimal" autocomplete="off"></span></label>' +
        '<label class="fld">Parcelas<input data-f="parcelas" type="number" inputmode="numeric" min="1" max="60" step="1"></label>' +
        '<label class="fld">Valor da parcela<span class="money"><i aria-hidden="true">R$</i><input data-f="parcela" inputmode="decimal" autocomplete="off"></span></label>' +
        '<label class="fld">1ª parcela em<select data-f="inicio"></select></label>' +
      '</div>' +
      '<div class="boxes" role="group" aria-label="Parcelas pagas"></div>' +
      '<div class="c-foot"><span><span class="c-sum"></span> <span class="c-note"></span></span>' +
        '<span class="c-links"><a class="link nota-link" target="_blank" rel="noopener" hidden>Ver nota</a>' +
        '<button class="link danger" type="button" data-act="del-compra">Excluir compra</button></span></div>';
    const n = {
      el,
      revisao: el.querySelector('.c-review'), miniatura: el.querySelector('.thumb'), imagem: el.querySelector('.thumb img'),
      avisoLeitura: el.querySelector('.rv-note'), verNota: el.querySelector('.nota-link'),
      titulo: el.querySelector('.c-title'), desc: el.querySelector('[data-f=desc]'),
      total: el.querySelector('[data-f=total]'), parcelas: el.querySelector('[data-f=parcelas]'),
      parcela: el.querySelector('[data-f=parcela]'), inicio: el.querySelector('[data-f=inicio]'),
      caixas: el.querySelector('.boxes'), soma: el.querySelector('.c-sum'), nota: el.querySelector('.c-note')
    };
    montarOpcoesDeMes(n.inicio, keyYm(hoje));
    return n;
  }

  const CHECK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>';

  function atualizarCompra(n, c, forcar) {
    n.titulo.textContent = c.parcelas + '× de ' + fmt(c.parcelaCents);
    definir(n.desc, c.descricao, forcar);
    definir(n.total, fmtNum(c.totalCents), forcar);
    definir(n.parcelas, String(c.parcelas), forcar);
    definir(n.parcela, fmtNum(c.parcelaCents), forcar);
    if (forcar || document.activeElement !== n.inicio) {
      if (![...n.inicio.options].some(o => o.value === c.inicio)) montarOpcoesDeMes(n.inicio, c.inicio);
      n.inicio.value = c.inicio;
    }
    const k0 = ymKey(c.inicio);
    while (n.caixas.children.length > c.parcelas) n.caixas.lastElementChild.remove();
    while (n.caixas.children.length < c.parcelas) {
      const i = n.caixas.children.length;
      const w = document.createElement('div');
      w.className = 'pc';
      w.innerHTML = '<button type="button" class="box" data-i="' + i + '">' + CHECK + '</button><small></small>';
      n.caixas.append(w);
    }
    [...n.caixas.children].forEach((w, i) => {
      const b = w.firstElementChild, k = k0 + i, paga = C.estaPaga(c, i);
      b.setAttribute('aria-pressed', paga ? 'true' : 'false');
      b.classList.toggle('late', !paga && k < hoje);
      const rotulo = 'Parcela ' + (i + 1) + ' de ' + c.parcelas + ', ' + kLong(k) + ', ' + fmt(c.parcelaCents) + ': ' + (paga ? 'paga' : 'em aberto');
      b.setAttribute('aria-label', rotulo); b.title = rotulo;
      w.lastElementChild.textContent = kShort(k);
    });
    const r = C.resumoCompra(c);
    n.soma.textContent = r.quitada ? 'Quitada · ' + r.pagas + ' de ' + c.parcelas + ' pagas' : r.pagas + ' de ' + c.parcelas + ' pagas · falta ' + fmt(r.falta);
    const avisos = [];
    if (c.dataCompra) avisos.push('compra em ' + c.dataCompra.split('-').reverse().join('/'));
    if (c.totalCents && r.soma !== c.totalCents) avisos.push('as parcelas somam ' + fmt(r.soma) + ' (total informado ' + fmt(c.totalCents) + ')');
    n.nota.textContent = avisos.length ? '· ' + avisos.join(' · ') : '';
    const href = c.notaId ? '/_blob/' + c.notaId : '';
    n.revisao.hidden = !c.conferir;
    n.avisoLeitura.textContent = c.leitura;
    n.miniatura.hidden = !(c.conferir && href && c.notaTipo === 'imagem');
    if (href && n.miniatura.getAttribute('href') !== href) { n.miniatura.href = href; n.imagem.src = href; }
    n.verNota.hidden = !href;
    if (href) { n.verNota.href = href; n.verNota.textContent = c.notaTipo === 'pdf' ? 'Abrir PDF' : 'Ver nota'; }
  }

  function pedirFoco(el) { setTimeout(() => { el.focus(); if (el.select) el.select(); }, 30); }

  function atualizarServico(n, id, s) {
    definir(n.nome, s.nome);
    const t = C.totaisServico(compras, id);
    const html = '<span>Total <b>' + fmt(t.total) + '</b></span><span>Pago <b>' + fmt(t.pago) + '</b></span><span>Falta <b>' + fmt(t.total - t.pago) + '</b></span>';
    if (html !== n.figs) { n.totais.innerHTML = html; n.figs = html; }
    const minhas = [...compras].filter(([, c]) => c.servicoId === id).sort(C.porOrdem);
    for (const cid of [...n.nos.keys()]) {
      const c = compras.get(cid);
      if (!c || c.servicoId !== id) { n.nos.get(cid).el.remove(); n.nos.delete(cid); }
    }
    minhas.forEach(([cid, c], i) => {
      let cn = n.nos.get(cid);
      if (!cn) {
        cn = montarCompra(); cn.el.dataset.compra = cid; n.nos.set(cid, cn);
        if (foco && foco.id === cid) { const alvo = cn.total; foco = null; pedirFoco(alvo); }
      }
      if (n.lista.children[i] !== cn.el) n.lista.insertBefore(cn.el, n.lista.children[i] || null);
      atualizarCompra(cn, c);
    });
    n.vazio.hidden = minhas.length > 0;
  }

  function sincronizar() {
    if (!pronto.s || !pronto.c) return;
    if (!carregado) { carregado = true; const l = $('#loading'); if (l) l.remove(); mostrarSituacao(); }
    const area = $('#servicos');
    const ordenados = [...servicos].sort(C.porOrdem);
    for (const [id, n] of nosServico) if (!servicos.has(id)) { n.el.remove(); nosServico.delete(id); }
    ordenados.forEach(([id, s], i) => {
      let n = nosServico.get(id);
      if (!n) {
        n = montarServico(); n.el.dataset.servico = id; nosServico.set(id, n);
        if (foco && foco.id === id) { const alvo = n.nome; foco = null; pedirFoco(alvo); }
      }
      if (area.children[i] !== n.el) area.insertBefore(n.el, area.children[i] || null);
      atualizarServico(n, id, s);
    });
    $('#empty').hidden = servicos.size > 0;
    atualizarAlvos(ordenados);
    desenharResumo();
  }
  let agendado = 0;
  const agendar = () => { if (!agendado) agendado = setTimeout(() => { agendado = 0; sincronizar(); }, 16); };

  /* ---------- serviço de destino das notas ---------- */
  const CHAVE_ALVO = 'contas:alvo';
  const ultimoAlvo = () => { try { return localStorage.getItem(CHAVE_ALVO) || ''; } catch (e) { return ''; } };
  function atualizarAlvos(lista) {
    const sel = $('#up-servico');
    const assinatura = lista.map(([id, s]) => id + ':' + s.nome).join('|');
    if (sel.dataset.sig === assinatura) return;
    const anterior = sel.value && sel.dataset.sig !== undefined ? sel.value : ultimoAlvo();
    sel.dataset.sig = assinatura;
    const opcoes = lista.map(([id, s]) => { const o = document.createElement('option'); o.value = id; o.textContent = s.nome; return o; });
    const novo = document.createElement('option'); novo.value = '__new__'; novo.textContent = 'Novo serviço (nome da loja)';
    sel.replaceChildren(...opcoes, novo);
    const existe = v => v && [...sel.options].some(o => o.value === v);
    const quer = existe(alvoForcado) ? alvoForcado : anterior;
    if (existe(alvoForcado)) alvoForcado = '';
    sel.value = existe(quer) ? quer : (lista.length ? lista[0][0] : '__new__');
  }
  $('#up-servico').addEventListener('change', e => { try { localStorage.setItem(CHAVE_ALVO, e.target.value); } catch (err) { /* sem armazenamento local */ } });

  /* ---------- ações ---------- */
  function criarServico() {
    const ref = db.collection('servicos').doc();
    foco = { id: ref.id };
    acompanhar(ref.set({ nome: 'Novo serviço', ordem: Date.now() }));
  }
  function criarCompra(servicoId) {
    const ref = db.collection('compras').doc();
    foco = { id: ref.id };
    acompanhar(ref.set({ servicoId, descricao: '', totalCents: 0, parcelas: 1, parcelaCents: 0, inicio: keyYm(hoje), pagas: {}, ordem: Date.now() }));
  }
  const excluirCompra = id => acompanhar(db.doc('compras/' + id).delete());
  function excluirServico(id) {
    const filhas = [...compras].filter(([, c]) => c.servicoId === id).map(([k]) => k);
    acompanhar((async () => {
      for (const cid of filhas) await db.doc('compras/' + cid).delete();
      await db.doc('servicos/' + id).delete();
    })());
  }

  // Excluir pede um segundo clique (por 4 segundos) para evitar acidentes.
  let armado = null, relogioArmado = 0;
  function desarmar() {
    clearTimeout(relogioArmado);
    document.querySelectorAll('.armed').forEach(b => { b.textContent = b.dataset.orig; b.classList.remove('armed'); });
    armado = null;
  }
  function confirmarComSegundoClique(botao, chave, texto, acao) {
    if (armado === chave) { desarmar(); acao(); return; }
    desarmar();
    armado = chave; botao.dataset.orig = botao.textContent; botao.textContent = texto; botao.classList.add('armed');
    relogioArmado = setTimeout(desarmar, 4000);
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !db) return;
    if (armado && !b.classList.contains('armed')) desarmar();
    const cEl = b.closest('[data-compra]'), sEl = b.closest('[data-servico]');
    if (b.classList.contains('box') && cEl) {
      const id = cEl.dataset.compra, c = compras.get(id), i = Number(b.dataset.i);
      if (c) alterar('compras', id, { pagas: { [i]: !C.estaPaga(c, i) } });
      return;
    }
    switch (b.dataset.act) {
      case 'add-servico': criarServico(); break;
      case 'add-compra': if (sEl) criarCompra(sEl.dataset.servico); break;
      case 'ok-compra': if (cEl) alterar('compras', cEl.dataset.compra, { conferir: false }); break;
      case 'del-compra': if (cEl) confirmarComSegundoClique(b, 'c' + cEl.dataset.compra, 'Confirmar exclusão', () => excluirCompra(cEl.dataset.compra)); break;
      case 'del-servico': if (sEl) {
        const sid = sEl.dataset.servico, n = [...compras.values()].filter(c => c.servicoId === sid).length;
        confirmarComSegundoClique(b, 's' + sid, n ? 'Confirmar: apagar serviço e ' + n + (n === 1 ? ' compra' : ' compras') : 'Confirmar exclusão', () => excluirServico(sid));
      } break;
    }
  });

  const area = $('#servicos');
  area.addEventListener('change', e => {
    const t = e.target, f = t.dataset.f;
    if (!f || !db) return;
    if (f === 'snome') {
      const sid = t.closest('[data-servico]').dataset.servico, s = servicos.get(sid);
      const v = t.value.trim() || 'Serviço sem nome';
      t.value = v;
      if (s && s.nome !== v) alterar('servicos', sid, { nome: v });
      return;
    }
    const cid = t.closest('[data-compra]').dataset.compra, c = compras.get(cid);
    if (!c) return;
    const desfazer = () => { const no = nosServico.get(c.servicoId); if (no && no.nos.get(cid)) atualizarCompra(no.nos.get(cid), c, true); };
    let mudanca = null;
    if (f === 'desc') mudanca = { descricao: t.value.trim() };
    else if (f === 'total') {
      const v = parseMoney(t.value); if (Number.isNaN(v)) return desfazer();
      t.value = fmtNum(v); mudanca = C.aplicarEdicao(c, 'total', v);
    } else if (f === 'parcelas') {
      const n = Number(t.value); if (!(Number.isInteger(n) && n >= 1 && n <= C.MAX_PARCELAS)) return desfazer();
      mudanca = C.aplicarEdicao(c, 'parcelas', n);
    } else if (f === 'parcela') {
      const v = parseMoney(t.value); if (Number.isNaN(v)) return desfazer();
      t.value = fmtNum(v); mudanca = C.aplicarEdicao(c, 'parcela', v);
    } else if (f === 'inicio') mudanca = { inicio: t.value };
    if (!mudanca) return;
    for (const k of Object.keys(mudanca)) if (mudanca[k] === c[k]) delete mudanca[k]; // só grava o que mudou
    if (Object.keys(mudanca).length) alterar('compras', cid, mudanca);
  });
  area.addEventListener('focusout', () => agendar());

  /* ---------- conexão com a pasta de dados ---------- */
  mostrarSituacao();
  const cfg = C.ponte ? await C.ponte.pronto : null;
  db = cfg && cfg.storeReady ? C.ponte.db : null;

  if (!db) {
    const l = $('#loading'); if (l) l.remove();
    const aviso = $('#notice');
    aviso.textContent = 'Escolha a pasta de dados em Configurações para começar. É a pasta compartilhada onde ficam as contas.';
    aviso.hidden = false;
    $('#months').innerHTML = '<li class="m-empty">Sem dados para mostrar.</li>';
    $('#s-cap').textContent = 'Sem dados para mostrar.';
    document.querySelectorAll('[data-act]').forEach(b => { b.hidden = true; });
    $('#uploader').hidden = true;
    mostrarSituacao();
    return;
  }
  mostrarSituacao();
  const aoFalhar = () => {
    const aviso = $('#notice');
    aviso.textContent = 'Não foi possível ler a pasta de dados agora. Confira se ela está acessível e reinicie o programa.';
    aviso.hidden = false;
  };
  db.collection('servicos').onSnapshot(snap => {
    servicos.clear(); snap.docs.forEach(d => servicos.set(d.id, sobrepor('servicos', d.id, C.normServico(d.data() || {}))));
    pronto.s = true; agendar();
  }, aoFalhar);
  db.collection('compras').onSnapshot(snap => {
    compras.clear(); snap.docs.forEach(d => compras.set(d.id, sobrepor('compras', d.id, C.normCompra(d.data() || {}, hoje))));
    pronto.c = true; agendar();
  }, aoFalhar);

  C.envio.iniciar({
    db, servicos,
    alvoEscolhido: () => $('#up-servico').value,
    forcarAlvo: id => { alvoForcado = id; }
  });
})();
