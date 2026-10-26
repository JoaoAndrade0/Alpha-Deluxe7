'use strict';
// Ponte entre a tela e o programa: banco de dados (pasta compartilhada), leitura de notas e guarda de arquivos.
// A tela nunca fala com o disco nem com a internet; tudo passa pelos canais fechados do preload.
(function () {
  const d = window.desktop;
  const C = (window.Contas = window.Contas || {});
  if (!d) { C.ponte = null; return; }

  const novoId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + Math.random().toString(16).slice(2));

  // Erros chegam como objeto simples { code, message }.
  const chamar = async (canal, ...args) => {
    const r = await d.invoke(canal, ...args);
    if (!r.ok) throw r.error;
    return r.value;
  };

  /* ---------- banco de dados ---------- */
  const assinaturas = new Map();
  // Cada carregamento da tela começa de um número diferente: assinaturas atrasadas de uma tela antiga nunca se confundem com as da nova.
  let proxima = Math.floor(Math.random() * 1e12) + 1;
  const instantaneo = docs => ({
    docs: docs.map(x => ({ id: x.id, exists: true, data: () => structuredClone(x.data) })),
    size: docs.length, empty: docs.length === 0
  });
  d.on('db:snapshot', (id, docs) => { const s = assinaturas.get(id); if (s) s.next(instantaneo(docs)); });
  d.on('db:error', (id, err) => { const s = assinaturas.get(id); if (s && s.error) s.error(err); });

  const doc = (colecao, id) => ({
    id, path: colecao + '/' + id,
    get: async () => {
      const data = await chamar('db:get', colecao, id);
      return { id, exists: !!data, data: () => (data ? structuredClone(data) : undefined) };
    },
    set: data => chamar('db:set', colecao, id, data),
    update: data => chamar('db:update', colecao, id, data),
    delete: () => chamar('db:delete', colecao, id)
  });
  const db = {
    collection: colecao => ({
      path: colecao,
      doc: id => doc(colecao, id || novoId()),
      get: async () => instantaneo(await chamar('db:list', colecao)),
      onSnapshot(next, error) {
        const id = proxima++;
        assinaturas.set(id, { next, error });
        chamar('db:subscribe', colecao, id).catch(err => { if (error) error(err); });
        return () => { assinaturas.delete(id); chamar('db:unsubscribe', id).catch(() => {}); };
      }
    }),
    doc: caminho => { const [colecao, id] = caminho.split('/'); return doc(colecao, id); }
  };

  /* ---------- arquivos e leitura de notas ---------- */
  const emBase64 = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject({ code: 'image_rejected', message: 'Não consegui ler o arquivo.' });
    r.readAsDataURL(blob);
  });

  // Manda as imagens da nota; o programa devolve os dados da compra já conferidos.
  // O cancelamento é registrado antes de qualquer espera: cancelar durante a preparação das imagens
  // também impede que o pedido (pago) seja enviado.
  async function lerNota(imagens, sinal) {
    const cancelado = () => ({ code: 'cancelled', message: 'Cancelado.' });
    if (sinal && sinal.aborted) throw cancelado();
    const reqId = novoId();
    let foiCancelado = false;
    const aoCancelar = () => { foiCancelado = true; chamar('nota:cancel', reqId).catch(() => {}); };
    if (sinal) sinal.addEventListener('abort', aoCancelar, { once: true });
    try {
      const images = await Promise.all(imagens.map(async b => ({ media_type: b.type || 'image/jpeg', data: await emBase64(b) })));
      if (foiCancelado || (sinal && sinal.aborted)) throw cancelado();
      return await chamar('nota:ler', { reqId, images });
    } finally { if (sinal) sinal.removeEventListener('abort', aoCancelar); }
  }

  // Guarda a foto ou o PDF original na pasta compartilhada e devolve o identificador.
  async function guardarArquivo(blob, tipo) {
    const { id } = await chamar('nota:save', { type: tipo || blob.type, data: await emBase64(blob) });
    return id;
  }

  C.ponte = { chamar, db, pronto: chamar('config:get').catch(() => null), aoReceber: d.on, lerNota, guardarArquivo };
})();
