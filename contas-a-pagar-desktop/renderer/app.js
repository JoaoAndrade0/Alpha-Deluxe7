(async function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const MES_L = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmt = c => brl.format(c / 100);
  const fmtNum = c => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const now = new Date();
  const curKey = now.getFullYear() * 12 + now.getMonth();
  const keyYm = k => Math.floor(k / 12) + '-' + String(k % 12 + 1).padStart(2, '0');
  const ymKey = ym => { const m = /^(\d{4})-(\d{2})$/.exec(ym || ''); return m ? (+m[1]) * 12 + (+m[2] - 1) : NaN; };
  const kShort = k => MES[k % 12] + '/' + String(Math.floor(k / 12)).slice(-2);
  const kLong = k => MES_L[k % 12] + ' de ' + Math.floor(k / 12);

  function parseMoney(s) {
    s = String(s).replace(/R\$|\s/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
  }

  const int = v => Math.max(0, Math.round(Number(v)) || 0);
  const normServico = d => ({ nome: String(d.nome || ''), ordem: Number(d.ordem) || 0 });
  const normCompra = d => ({
    servicoId: String(d.servicoId || ''),
    descricao: String(d.descricao || ''),
    totalCents: int(d.totalCents),
    parcelas: Math.min(60, Math.max(1, Math.round(Number(d.parcelas)) || 1)),
    parcelaCents: int(d.parcelaCents),
    inicio: isNaN(ymKey(d.inicio)) ? keyYm(curKey) : d.inicio,
    pagas: d.pagas && typeof d.pagas === 'object' ? d.pagas : {},
    ordem: Number(d.ordem) || 0,
    conferir: d.conferir === true,
    leitura: String(d.leitura || ''),
    notaId: /^[A-Za-z0-9_-]{8,64}$/.test(d.notaId || '') ? d.notaId : '',
    notaTipo: d.notaTipo === 'pdf' ? 'pdf' : 'imagem',
    dataCompra: /^\d{4}-\d{2}-\d{2}$/.test(d.dataCompra || '') ? d.dataCompra : ''
  });
  const byOrdem = (a, b) => a[1].ordem - b[1].ordem || (a[0] < b[0] ? -1 : 1);

  const servicos = new Map(), compras = new Map();
  const ready = { s: false, c: false };
  let db = null, readOnly = false, loaded = false, inflight = 0, failed = false, focusReq = null, forcedTarget = '';

  /* ---------- status e gravação ---------- */
  function setStatus() {
    const el = $('#save');
    let txt = 'Tudo salvo', bad = false;
    if (!db) txt = 'Sem conexão com o armazenamento';
    else if (readOnly) txt = 'Somente leitura';
    else if (inflight) txt = 'Salvando…';
    else if (failed) { txt = 'Não foi possível salvar. Tente de novo.'; bad = true; }
    else if (!loaded) txt = 'Carregando…';
    el.textContent = txt;
    el.classList.toggle('bad', bad);
  }
  function track(p) {
    inflight++; setStatus();
    return p.then(() => { failed = false; }, () => { failed = true; }).finally(() => { inflight--; setStatus(); });
  }
  const chain = new Map();
  function patch(coll, id, p) {
    const path = coll + '/' + id;
    const prev = chain.get(path) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => db.doc(path).update(p));
    chain.set(path, next);
    return track(next);
  }

  /* ---------- cálculos ---------- */
  function stats() {
    const months = new Map();
    let total = 0, paid = 0;
    for (const c of compras.values()) {
      if (!servicos.has(c.servicoId)) continue;
      const k0 = ymKey(c.inicio);
      for (let i = 0; i < c.parcelas; i++) {
        const m = months.get(k0 + i) || { due: 0, paid: 0 };
        m.due += c.parcelaCents; total += c.parcelaCents;
        if (c.pagas[i]) { m.paid += c.parcelaCents; paid += c.parcelaCents; }
        months.set(k0 + i, m);
      }
    }
    return { months, total, paid };
  }
  function svcStats(id) {
    let total = 0, paid = 0;
    for (const c of compras.values()) if (c.servicoId === id) {
      for (let i = 0; i < c.parcelas; i++) { total += c.parcelaCents; if (c.pagas[i]) paid += c.parcelaCents; }
    }
    return { total, paid };
  }

  /* ---------- resumo e meses ---------- */
  function renderSummary() {
    const { months, total, paid } = stats();
    $('#s-total').textContent = fmt(total);
    $('#s-paid').textContent = fmt(paid);
    $('#s-left').textContent = fmt(total - paid);
    const pct = total ? Math.round(paid / total * 100) : 0;
    $('#s-bar').style.width = pct + '%';
    $('#s-meter').setAttribute('aria-valuenow', pct);
    $('#s-cap').textContent = total ? pct + '% pago · ainda faltam ' + fmt(total - paid) : 'Nenhuma parcela lançada ainda.';

    const ul = $('#months');
    const keys = [...months.keys()];
    if (!keys.length) {
      ul.innerHTML = '<li class="m-empty">Os meses aparecem aqui quando você lançar a primeira compra parcelada.</li>';
      return;
    }
    const lo = Math.min(...keys), hi = Math.max(...keys);
    const max = Math.max(...[...months.values()].map(m => m.due)) || 1;
    let html = '';
    for (let k = lo; k <= hi; k++) {
      const m = months.get(k) || { due: 0, paid: 0 };
      const left = m.due - m.paid;
      let st, cls;
      if (!m.due) { st = 'Sem parcelas'; cls = 'none'; }
      else if (!left) { st = '✓ Pago'; cls = 'ok'; }
      else if (k < curKey) { st = 'Atrasado · falta ' + fmt(left); cls = 'late'; }
      else if (m.paid) { st = 'Falta ' + fmt(left); cls = 'part'; }
      else { st = 'Em aberto'; cls = 'open'; }
      html += '<li class="m' + (k === curKey ? ' now' : '') + '">' +
        '<div class="when"><b>' + (k - lo + 1) + 'º mês</b><span>' + kLong(k) + (k === curKey ? ' · este mês' : '') + '</span></div>' +
        '<div class="bar"><span class="due" style="width:' + (m.due / max * 100) + '%"><b style="width:' + (m.due ? m.paid / m.due * 100 : 0) + '%"></b></span></div>' +
        '<div class="amt">' + fmt(m.due) + '</div>' +
        '<div class="st ' + cls + '">' + st + '</div></li>';
    }
    ul.innerHTML = html;
  }

  /* ---------- nós de serviço e compra ---------- */
  const sNodes = new Map();
  const setVal = (el, v, force) => { if ((force || document.activeElement !== el) && el.value !== v) el.value = v; };

  function buildOptions(sel, ym) {
    const k = ymKey(ym);
    const lo = Math.min(curKey - 24, k), hi = Math.max(curKey + 48, k);
    const frag = document.createDocumentFragment();
    for (let x = lo; x <= hi; x++) {
      const o = document.createElement('option');
      o.value = keyYm(x); o.textContent = MES[x % 12] + '/' + Math.floor(x / 12); frag.append(o);
    }
    sel.replaceChildren(frag);
  }

  function buildServico(id) {
    const el = document.createElement('article');
    el.className = 'svc'; el.dataset.servico = id;
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
      el, nodes: new Map(), figsHtml: '',
      name: el.querySelector('.svc-name'), figs: el.querySelector('.svc-figs'),
      list: el.querySelector('.compras'), none: el.querySelector('.svc-empty')
    };
  }

  function buildCompra(id) {
    const el = document.createElement('div');
    el.className = 'compra'; el.dataset.compra = id;
    el.innerHTML =
      '<div class="c-top">' +
        '<strong class="c-title"></strong>' +
        '<input class="plain c-desc" data-f="desc" placeholder="Descrição (opcional)" aria-label="Descrição da compra" maxlength="120" autocomplete="off">' +
      '</div>' +
      '<div class="c-review" hidden>' +
        '<a class="thumb" target="_blank" rel="noopener" hidden><img alt="Nota enviada"></a>' +
        '<div class="rv-text"><strong>Lido da nota. Confira antes de pagar.</strong><span class="rv-note"></span></div>' +
        '<button class="btn ghost sm" type="button" data-act="ok-compra">Está certo</button>' +
      '</div>' +
      '<div class="fields">' +
        '<label class="fld">Total<span class="money"><i>R$</i><input data-f="total" inputmode="decimal" autocomplete="off"></span></label>' +
        '<label class="fld">Parcelas<input data-f="parcelas" type="number" inputmode="numeric" min="1" max="60" step="1"></label>' +
        '<label class="fld">Valor da parcela<span class="money"><i>R$</i><input data-f="parcela" inputmode="decimal" autocomplete="off"></span></label>' +
        '<label class="fld">1ª parcela em<select data-f="inicio"></select></label>' +
      '</div>' +
      '<div class="boxes" role="group" aria-label="Parcelas pagas"></div>' +
      '<div class="c-foot"><span><span class="c-sum"></span> <span class="c-note"></span></span>' +
        '<span class="c-links"><a class="link nota-link" target="_blank" rel="noopener" hidden>Ver nota</a>' +
        '<button class="link danger" type="button" data-act="del-compra">Excluir compra</button></span></div>';
    const n = {
      review: el.querySelector('.c-review'), thumb: el.querySelector('.thumb'), thumbImg: el.querySelector('.thumb img'),
      rvNote: el.querySelector('.rv-note'), notaLink: el.querySelector('.nota-link'),
      el,
      title: el.querySelector('.c-title'), desc: el.querySelector('[data-f=desc]'),
      total: el.querySelector('[data-f=total]'), parcelas: el.querySelector('[data-f=parcelas]'),
      parcela: el.querySelector('[data-f=parcela]'), inicio: el.querySelector('[data-f=inicio]'),
      boxes: el.querySelector('.boxes'), sum: el.querySelector('.c-sum'), note: el.querySelector('.c-note')
    };
    buildOptions(n.inicio, keyYm(curKey));
    return n;
  }

  const CHECK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>';

  function updCompra(n, c, force) {
    n.title.textContent = c.parcelas + '× de ' + fmt(c.parcelaCents);
    setVal(n.desc, c.descricao, force);
    setVal(n.total, fmtNum(c.totalCents), force);
    setVal(n.parcelas, String(c.parcelas), force);
    setVal(n.parcela, fmtNum(c.parcelaCents), force);
    if (force || document.activeElement !== n.inicio) {
      if (!n.inicio.querySelector('option[value="' + c.inicio + '"]')) buildOptions(n.inicio, c.inicio);
      n.inicio.value = c.inicio;
    }
    const k0 = ymKey(c.inicio);
    while (n.boxes.children.length > c.parcelas) n.boxes.lastElementChild.remove();
    while (n.boxes.children.length < c.parcelas) {
      const i = n.boxes.children.length;
      const w = document.createElement('div');
      w.className = 'pc';
      w.innerHTML = '<button type="button" class="box" data-i="' + i + '">' + CHECK + '</button><small></small>';
      n.boxes.append(w);
    }
    let paidN = 0;
    [...n.boxes.children].forEach((w, i) => {
      const b = w.firstElementChild, k = k0 + i, paid = !!c.pagas[i];
      if (paid) paidN++;
      b.setAttribute('aria-pressed', paid ? 'true' : 'false');
      b.classList.toggle('late', !paid && k < curKey);
      const lbl = 'Parcela ' + (i + 1) + ' de ' + c.parcelas + ', ' + kLong(k) + ', ' + fmt(c.parcelaCents) + ': ' + (paid ? 'paga' : 'em aberto');
      b.setAttribute('aria-label', lbl); b.title = lbl;
      b.disabled = readOnly;
      w.lastElementChild.textContent = kShort(k);
    });
    const left = c.parcelaCents * (c.parcelas - paidN), sum = c.parcelaCents * c.parcelas;
    n.sum.textContent = paidN === c.parcelas ? 'Quitada · ' + paidN + ' de ' + c.parcelas + ' pagas' : paidN + ' de ' + c.parcelas + ' pagas · falta ' + fmt(left);
    const notes = [];
    if (c.dataCompra) notes.push('compra em ' + c.dataCompra.split('-').reverse().join('/'));
    if (c.totalCents && sum !== c.totalCents) notes.push('as parcelas somam ' + fmt(sum) + ' (total informado ' + fmt(c.totalCents) + ')');
    n.note.textContent = notes.length ? '· ' + notes.join(' · ') : '';
    const href = c.notaId ? '/_blob/' + c.notaId : '';
    n.review.hidden = !c.conferir;
    n.rvNote.textContent = c.leitura;
    n.thumb.hidden = !(c.conferir && href && c.notaTipo === 'imagem');
    if (href && n.thumb.getAttribute('href') !== href) { n.thumb.href = href; n.thumbImg.src = href; }
    n.notaLink.hidden = !href;
    if (href) { n.notaLink.href = href; n.notaLink.textContent = c.notaTipo === 'pdf' ? 'Abrir PDF' : 'Ver nota'; }
    n.el.querySelectorAll('input,select').forEach(x => { x.disabled = readOnly; });
  }

  function updServico(n, id, s) {
    setVal(n.name, s.nome);
    n.name.disabled = readOnly;
    const st = svcStats(id);
    const html = '<span>Total <b>' + fmt(st.total) + '</b></span><span>Pago <b>' + fmt(st.paid) + '</b></span><span>Falta <b>' + fmt(st.total - st.paid) + '</b></span>';
    if (html !== n.figsHtml) { n.figs.innerHTML = html; n.figsHtml = html; }
    const mine = [...compras].filter(([, c]) => c.servicoId === id).sort(byOrdem);
    for (const cid of [...n.nodes.keys()]) {
      const c = compras.get(cid);
      if (!c || c.servicoId !== id) { n.nodes.get(cid).el.remove(); n.nodes.delete(cid); }
    }
    mine.forEach(([cid, c], i) => {
      let cn = n.nodes.get(cid);
      if (!cn) {
        cn = buildCompra(cid); n.nodes.set(cid, cn);
        if (focusReq && focusReq.id === cid) { const f = cn.total; focusReq = null; setTimeout(() => { f.focus(); f.select(); }, 30); }
      }
      if (n.list.children[i] !== cn.el) n.list.insertBefore(cn.el, n.list.children[i] || null);
      updCompra(cn, c);
    });
    n.none.hidden = mine.length > 0;
  }

  function syncAll() {
    if (!ready.s || !ready.c) return;
    if (!loaded) { loaded = true; const l = $('#loading'); if (l) l.remove(); setStatus(); }
    const wrap = $('#servicos');
    const list = [...servicos].sort(byOrdem);
    for (const [id, n] of sNodes) if (!servicos.has(id)) { n.el.remove(); sNodes.delete(id); }
    list.forEach(([id, s], i) => {
      let n = sNodes.get(id);
      if (!n) {
        n = buildServico(id); sNodes.set(id, n);
        if (focusReq && focusReq.id === id) { const f = n.name; focusReq = null; setTimeout(() => { f.focus(); f.select(); }, 30); }
      }
      if (wrap.children[i] !== n.el) wrap.insertBefore(n.el, wrap.children[i] || null);
      updServico(n, id, s);
    });
    $('#empty').hidden = servicos.size > 0;
    refreshTargets(list);
    renderSummary();
  }

  /* ---------- alvo do envio de nota ---------- */
  const TARGET_KEY = 'contas:alvo';
  function lastTarget() { try { return localStorage.getItem(TARGET_KEY) || ''; } catch (e) { return ''; } }
  function refreshTargets(list) {
    const sel = $('#up-servico');
    const sig = list.map(([id, s]) => id + ':' + s.nome).join('|');
    if (sel.dataset.sig === sig) return;
    const prev = sel.value && sel.dataset.sig !== undefined ? sel.value : lastTarget();
    sel.dataset.sig = sig;
    const opts = list.map(([id, s]) => { const o = document.createElement('option'); o.value = id; o.textContent = s.nome; return o; });
    const nw = document.createElement('option'); nw.value = '__new__'; nw.textContent = 'Novo serviço (nome da loja)';
    sel.replaceChildren(...opts, nw);
    const has = v => v && [...sel.options].some(o => o.value === v);
    const want = has(forcedTarget) ? forcedTarget : prev;
    if (has(forcedTarget)) forcedTarget = '';
    sel.value = has(want) ? want : (list.length ? list[0][0] : '__new__');
  }
  $('#up-servico').addEventListener('change', e => { try { localStorage.setItem(TARGET_KEY, e.target.value); } catch (err) { /* sem armazenamento local */ } });
  let timer = 0;
  const schedule = () => { if (!timer) timer = setTimeout(() => { timer = 0; syncAll(); }, 16); };

  /* ---------- ações ---------- */
  function addServico() {
    const ref = db.collection('servicos').doc();
    focusReq = { id: ref.id };
    track(ref.set({ nome: 'Novo serviço', ordem: Date.now() }));
  }
  function addCompra(sid) {
    const ref = db.collection('compras').doc();
    focusReq = { id: ref.id };
    track(ref.set({ servicoId: sid, descricao: '', totalCents: 0, parcelas: 1, parcelaCents: 0, inicio: keyYm(curKey), pagas: {}, ordem: Date.now() }));
  }
  function delCompra(id) { track(db.doc('compras/' + id).delete()); }
  function delServico(id) {
    const ids = [...compras].filter(([, c]) => c.servicoId === id).map(([k]) => k);
    track((async () => {
      for (const cid of ids) await db.doc('compras/' + cid).delete();
      await db.doc('servicos/' + id).delete();
    })());
  }

  let armed = null, armedTimer = 0;
  function disarm() {
    clearTimeout(armedTimer);
    document.querySelectorAll('.armed').forEach(b => { b.textContent = b.dataset.orig; b.classList.remove('armed'); });
    armed = null;
  }
  function confirmTwice(btn, key, text, fn) {
    if (armed === key) { disarm(); fn(); return; }
    disarm();
    armed = key; btn.dataset.orig = btn.textContent; btn.textContent = text; btn.classList.add('armed');
    armedTimer = setTimeout(disarm, 4000);
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !db || readOnly) return;
    if (armed && !b.classList.contains('armed')) disarm();
    const cEl = b.closest('[data-compra]'), sEl = b.closest('[data-servico]');
    if (b.classList.contains('box')) {
      const id = cEl.dataset.compra, c = compras.get(id), i = +b.dataset.i;
      if (c) patch('compras', id, { pagas: { [i]: !c.pagas[i] } });
      return;
    }
    switch (b.dataset.act) {
      case 'add-servico': addServico(); break;
      case 'add-compra': addCompra(sEl.dataset.servico); break;
      case 'ok-compra': patch('compras', cEl.dataset.compra, { conferir: false }); break;
      case 'del-compra': confirmTwice(b, 'c' + cEl.dataset.compra, 'Confirmar exclusão', () => delCompra(cEl.dataset.compra)); break;
      case 'del-servico': {
        const sid = sEl.dataset.servico, n = [...compras.values()].filter(c => c.servicoId === sid).length;
        confirmTwice(b, 's' + sid, n ? 'Confirmar: apagar serviço e ' + n + (n === 1 ? ' compra' : ' compras') : 'Confirmar exclusão', () => delServico(sid));
        break;
      }
    }
  });

  const root = $('#servicos');
  root.addEventListener('change', e => {
    const t = e.target, f = t.dataset.f;
    if (!f || !db || readOnly) return;
    if (f === 'snome') {
      const s = servicos.get(t.closest('[data-servico]').dataset.servico);
      const v = t.value.trim() || 'Serviço sem nome';
      t.value = v;
      if (s && s.nome !== v) patch('servicos', t.closest('[data-servico]').dataset.servico, { nome: v });
      return;
    }
    const id = t.closest('[data-compra]').dataset.compra, c = compras.get(id);
    if (!c) return;
    const revert = () => { updCompra(sNodeFor(c).nodes.get(id), c, true); };
    let p = null;
    if (f === 'desc') p = { descricao: t.value.trim() };
    else if (f === 'total') {
      const v = parseMoney(t.value); if (isNaN(v)) return revert();
      t.value = fmtNum(v); p = { totalCents: v, parcelaCents: Math.round(v / c.parcelas) };
    } else if (f === 'parcelas') {
      const n = Math.round(Number(t.value)); if (!(n >= 1 && n <= 60)) return revert();
      p = { parcelas: n, parcelaCents: Math.round(c.totalCents / n) };
    } else if (f === 'parcela') {
      const v = parseMoney(t.value); if (isNaN(v)) return revert();
      t.value = fmtNum(v); p = { parcelaCents: v };
    } else if (f === 'inicio') p = { inicio: t.value };
    if (!p) return;
    for (const k of Object.keys(p)) if (p[k] === c[k]) delete p[k];
    if (Object.keys(p).length) patch('compras', id, p);
  });
  const sNodeFor = c => sNodes.get(c.servicoId);
  root.addEventListener('focusout', () => schedule());

  /* ---------- envio de nota ---------- */
  let sampleFn = null, assetsApi = null, imgLimits = null;
  const pad2 = n => String(n).padStart(2, '0');
  const todayStr = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());

  const PROMPT = () => [
    'Você lê notas fiscais, cupons, comprovantes de cartão, recibos e boletos brasileiros a partir de foto ou PDF e extrai dados para um controle de contas a pagar.',
    'Hoje é ' + todayStr + '. As imagens anexadas mostram UMA única compra (podem ser várias páginas ou fotos dela).',
    'Responda somente com um objeto JSON neste formato:',
    '{"eh_comprovante": true|false, "fornecedor": texto|null, "descricao": texto|null, "valor_total": número|null, "parcelas": inteiro|null, "valor_parcela": número|null, "data_compra": "AAAA-MM-DD"|null, "forma_pagamento": "credito"|"debito"|"pix"|"boleto"|"dinheiro"|"outro"|null, "confianca": "alta"|"media"|"baixa", "observacao": texto}',
    'Regras:',
    '- Valores em reais, como número com ponto decimal (1234.56). Os documentos usam o formato brasileiro (1.234,56).',
    '- valor_total é o total da compra inteira, nunca o valor de uma parcela. Procure por TOTAL, VALOR A PAGAR, TOTAL DA COMPRA.',
    '- parcelas é o número de parcelas do cartão de crédito (por exemplo "3x de R$ 155,09", "PARCELADO 3X", "03 PARC"). Use 1 quando a nota indica à vista, débito, pix, dinheiro ou boleto. Use null só se a compra foi no crédito e o número de parcelas não aparece.',
    '- valor_parcela é o valor de cada parcela, se aparecer.',
    '- fornecedor é o nome da loja ou prestador. descricao diz o que foi comprado, em até 60 caracteres.',
    '- forma_pagamento: credito, debito, pix, boleto, dinheiro ou outro; null se não aparecer.',
    '- confianca: alta, media ou baixa, conforme a legibilidade.',
    '- Nunca invente dados. Se algo não estiver legível, use null e explique em observacao, em uma frase curta em português. Se tudo estiver claro, observacao fica vazia.',
    '- Se o arquivo não for nota, cupom, comprovante ou recibo, use eh_comprovante false.'
  ].join('\n');

  const clean = (v, max) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  function num(v) {
    if (typeof v === 'number') return isFinite(v) && v >= 0 ? v : null;
    if (typeof v === 'string') { const c = parseMoney(v); return isNaN(c) ? null : c / 100; }
    return null;
  }
  function interpret(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw { code: 'invalid_json' };
    if (d.eh_comprovante === false) throw { code: 'nao_nota' };
    const obs = [];
    const forma = clean(d.forma_pagamento, 20);
    let n = Math.round(Number(d.parcelas));
    if (!(n >= 1 && n <= 60)) {
      n = 1;
      if (forma === 'credito' || forma === '') obs.push('O número de parcelas não aparece na nota. Considerei pagamento à vista; ajuste se foi parcelado.');
    }
    const tot = num(d.valor_total), par = num(d.valor_parcela);
    let totalC = tot == null ? null : Math.round(tot * 100);
    let parC = par == null ? null : Math.round(par * 100);
    if (totalC == null && parC != null) totalC = parC * n;
    if (parC == null && totalC != null) parC = Math.round(totalC / n);
    if (totalC == null) { totalC = 0; parC = 0; obs.push('Não encontrei o valor na nota. Preencha o total e as parcelas.'); }
    else if (n === 1) parC = totalC;
    else if (Math.abs(parC * n - totalC) > n) obs.push('O valor da parcela não bate com o total. Confira os dois.');
    const ds = typeof d.data_compra === 'string' ? d.data_compra : '';
    const dok = /^(20\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(ds);
    const k0 = (dok ? ymKey(ds.slice(0, 7)) : curKey) + 1;
    if (n > 1) obs.push('A 1ª parcela foi colocada no mês seguinte à compra.');
    if (d.confianca === 'baixa') obs.push('A leitura teve baixa confiança.');
    const extra = clean(d.observacao, 240);
    if (extra) obs.unshift(extra);
    const fornecedor = clean(d.fornecedor, 60);
    const descricao = [fornecedor, clean(d.descricao, 80)].filter(Boolean).join(' · ').slice(0, 120);
    return { fornecedor, descricao, totalCents: totalC, parcelas: n, parcelaCents: parC, inicio: keyYm(k0), dataCompra: dok ? ds : '', obs };
  }

  function loadImg(file) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); res(im); };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('img')); };
      im.src = u;
    });
  }
  function canvasJpeg(src, w, h, maxSide) {
    const s = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('blob')), 'image/jpeg', 0.82));
  }
  async function toJpeg(file) {
    try {
      let src;
      try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = await loadImg(file); }
      return await canvasJpeg(src, src.naturalWidth || src.width, src.naturalHeight || src.height, 2200);
    } catch (e) { throw { code: 'img' }; }
  }

  // O leitor de PDF (pdf.js) vem junto com o programa e é servido pelo próprio app.
  const PDFJS = '/vendor/pdfjs/';
  let pdfjsLoad = null;
  function loadPdfjs() {
    if (!pdfjsLoad) {
      pdfjsLoad = import(PDFJS + 'pdf.min.mjs')
        .then(lib => { lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs'; return lib; })
        .catch(e => { pdfjsLoad = null; throw e; });
    }
    return pdfjsLoad;
  }
  async function pdfToImages(file) {
    try {
      const lib = await loadPdfjs();
      const task = lib.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        isEvalSupported: false, // não executa código embutido no PDF
        cMapUrl: PDFJS + 'cmaps/', cMapPacked: true,
        standardFontDataUrl: PDFJS + 'standard_fonts/',
        wasmUrl: PDFJS + 'wasm/'
      });
      const pdf = await task.promise;
      const out = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 2, imgLimits.maxCount); i++) {
        const page = await pdf.getPage(i);
        const v0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(4, 2000 / Math.max(v0.width, v0.height)) });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvas: c, canvasContext: g, viewport: vp }).promise;
        out.push(await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('blob')), 'image/jpeg', 0.82)));
      }
      await task.destroy();
      return out;
    } catch (e) { console.error('Falha ao abrir o PDF:', e); throw { code: 'pdf' }; }
  }

  function msgFor(e) {
    switch (e && e.code) {
      case 'sem_chave': return 'Falta a chave da API do Claude. Cole a chave em Configurações.';
      case 'chave_invalida': return 'A chave da API não foi aceita. Confira em Configurações.';
      case 'sem_saldo': return 'A conta da API está sem saldo. Adicione créditos em console.anthropic.com.';
      case 'sem_internet': return 'Sem conexão com a internet. Confira a rede e tente de novo.';
      case 'sem_pasta': return 'Escolha a pasta de dados em Configurações.';
      case 'not_granted': return 'Você não permitiu que o Claude leia a nota. Permita e tente de novo.';
      case 'sampling_disabled': case 'capability_disabled': case 'capability_removed': case 'not_declared': case 'images_unavailable':
        return 'A leitura automática não está disponível nesta conta.';
      case 'rate_limited': return 'Muitas leituras em pouco tempo. Espere um pouco e tente de novo.';
      case 'session_expired': return 'Sua sessão expirou. Entre de novo no Claude e tente outra vez.';
      case 'image_rejected': case 'img': return 'Não consegui abrir essa imagem. Envie JPG, PNG ou PDF.';
      case 'pdf': return 'Não consegui abrir o PDF. Envie uma foto ou um print da nota.';
      case 'nao_nota': return 'Isso não parece uma nota, cupom ou comprovante.';
      case 'invalid_json': case 'empty_completion': case 'refused': return 'Não consegui ler essa nota. Tente uma foto mais nítida, de frente e com a nota inteira.';
      default: return 'Não foi possível ler essa nota agora. Tente de novo.';
    }
  }

  async function createFromNota(target, info, notaId, notaTipo) {
    let sid = target;
    if (sid === '__new__' || !servicos.has(sid)) {
      const sref = db.collection('servicos').doc();
      await sref.set({ nome: info.fornecedor || 'Novo serviço', ordem: Date.now() });
      sid = sref.id; forcedTarget = sid;
    }
    const ref = db.collection('compras').doc();
    await ref.set({
      servicoId: sid, descricao: info.descricao, totalCents: info.totalCents, parcelas: info.parcelas, parcelaCents: info.parcelaCents,
      inicio: info.inicio, pagas: {}, ordem: Date.now(), conferir: true, leitura: info.obs.join(' '),
      notaId, notaTipo, dataCompra: info.dataCompra
    });
    return ref.id;
  }

  function showCompra(id) {
    const el = document.querySelector('[data-compra="' + id + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  const upList = $('#up-list'), queue = [];
  let running = false;
  function setState(it, text, cls, actions) {
    it.li.className = 'up-item ' + cls;
    it.li.querySelector('.up-state').textContent = text;
    it.li.querySelector('.up-actions').replaceChildren(...(actions || []).map(([label, fn]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'link'; b.textContent = label; b.addEventListener('click', fn);
      return b;
    }));
  }
  const isPdfFile = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');

  function addFiles(files) {
    if (!sampleFn || !imgLimits || readOnly) return;
    const target = $('#up-servico').value;
    for (const file of files) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="up-name"></span><span class="up-state"></span><span class="up-actions"></span>';
      li.querySelector('.up-name').textContent = file.name || 'imagem colada';
      upList.prepend(li);
      const it = { file, target, li, ctl: null };
      if (!isPdfFile(file) && !/^image\//.test(file.type)) {
        setState(it, 'Formato não suportado. Envie JPG, PNG ou PDF.', 'err', [['Fechar', () => li.remove()]]);
        continue;
      }
      enqueue(it);
    }
  }
  function enqueue(it) {
    it.ctl = new AbortController();
    setState(it, 'Na fila…', 'busy', [['Cancelar', () => it.ctl.abort()]]);
    queue.push(it);
    runQueue();
  }
  async function runQueue() {
    if (running) return;
    running = true;
    while (queue.length) await processItem(queue.shift());
    running = false;
  }
  async function processItem(it) {
    const sig = it.ctl.signal, cancel = [['Cancelar', () => it.ctl.abort()]];
    try {
      if (sig.aborted) throw { code: 'cancelled' };
      setState(it, 'Preparando o arquivo…', 'busy', cancel);
      const pdf = isPdfFile(it.file);
      const pages = (pdf ? await pdfToImages(it.file) : [await toJpeg(it.file)]).slice(0, imgLimits.maxCount);
      if (sig.aborted) throw { code: 'cancelled' };
      setState(it, 'Lendo a nota…', 'busy', cancel);
      const info = interpret(await sampleFn.json(PROMPT(), { images: pages, modelTier: 'default', signal: sig }));
      setState(it, 'Criando a compra…', 'busy');
      let notaId = '';
      if (assetsApi) {
        try { notaId = (await assetsApi.upload(pdf ? it.file : pages[0], pdf ? { type: 'application/pdf' } : undefined)).id; }
        catch (e) { info.obs.push('O arquivo da nota não foi guardado.'); }
      }
      const id = await createFromNota(it.target, info, notaId, pdf ? 'pdf' : 'imagem');
      const txt = info.totalCents
        ? 'Compra criada: ' + fmt(info.totalCents) + (info.parcelas > 1 ? ' em ' + info.parcelas + '× de ' + fmt(info.parcelaCents) : ' à vista') + (info.fornecedor ? ' · ' + info.fornecedor : '')
        : 'Compra criada, mas não encontrei o valor. Preencha o total e as parcelas.';
      setState(it, txt, 'done', [['Ver compra', () => showCompra(id)], ['Fechar', () => it.li.remove()]]);
    } catch (e) {
      if (e && e.code === 'cancelled') { it.li.remove(); return; }
      const needsSetup = e && ['sem_chave', 'chave_invalida', 'sem_pasta'].includes(e.code);
      setState(it, msgFor(e), 'err', [
        ...(needsSetup && window.openSettings ? [['Abrir configurações', () => window.openSettings()]] : []),
        ['Tentar de novo', () => enqueue(it)],
        ['Fechar', () => it.li.remove()]
      ]);
    }
  }

  async function initUploader(claude) {
    const text = $('#drop-text'), btn = $('#pick-btn'), pick = $('#pick'), drop = $('#drop');
    try {
      sampleFn = claude ? await claude.use('sample') : null;
      const lim = sampleFn ? await sampleFn.limits() : null;
      imgLimits = lim && lim.images ? lim.images : null;
      assetsApi = claude ? await claude.use('assets') : null;
    } catch (e) { sampleFn = null; }
    if (!sampleFn || !imgLimits) {
      text.textContent = 'A leitura automática de notas não está disponível aqui. Use "+ Adicionar compra" dentro de um serviço.';
      btn.hidden = true;
      return;
    }
    btn.disabled = false;
    btn.addEventListener('click', () => pick.click());
    pick.addEventListener('change', () => { addFiles([...pick.files]); pick.value = ''; });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
    document.addEventListener('paste', e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
      const fs = [...((e.clipboardData && e.clipboardData.files) || [])].filter(f => /^image\//.test(f.type));
      if (fs.length) addFiles(fs);
    });
  }

  /* ---------- conexão ---------- */
  setStatus();
  const claude = window.claude;
  try {
    db = claude ? await claude.use('db') : null;
    const user = claude ? await claude.use('user') : null;
    if (user) { const w = await user.can('data.write'); readOnly = w === false; }
  } catch (err) { db = null; }
  document.body.classList.toggle('ro', readOnly);

  if (!db) {
    const l = $('#loading'); if (l) l.remove();
    const nt = $('#notice');
    nt.textContent = 'Escolha a pasta de dados em Configurações para começar. É a pasta compartilhada onde ficam as contas.';
    nt.hidden = false;
    $('#months').innerHTML = '<li class="m-empty">Sem dados para mostrar.</li>';
    $('#s-cap').textContent = 'Sem dados para mostrar.';
    document.querySelectorAll('[data-act]').forEach(b => { b.hidden = true; });
    $('#uploader').hidden = true;
    setStatus();
    return;
  }
  setStatus();
  const onErr = e => {
    const nt = $('#notice');
    nt.textContent = e && e.code === 'revoked' ? 'O acesso a esta página mudou. Recarregue para continuar.' : 'Não foi possível carregar as contas agora. Recarregue a página.';
    nt.hidden = false;
  };
  db.collection('servicos').onSnapshot(snap => {
    servicos.clear(); snap.docs.forEach(d => servicos.set(d.id, normServico(d.data() || {})));
    ready.s = true; schedule();
  }, onErr);
  db.collection('compras').onSnapshot(snap => {
    compras.clear(); snap.docs.forEach(d => compras.set(d.id, normCompra(d.data() || {})));
    ready.c = true; schedule();
  }, onErr);
  initUploader(claude);
})();
