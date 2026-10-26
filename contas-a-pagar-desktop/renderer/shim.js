'use strict';
// Liga a tela ao programa: oferece à tela as mesmas funções que ela usava dentro do Claude
// (banco de dados, leitura de imagem e guarda de arquivos), mas feitas pela pasta de dados
// e pela API do Claude deste computador.
(function () {
  const d = window.desktop;
  if (!d) return;

  const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + Math.random().toString(16).slice(2));
  const call = async (channel, ...args) => {
    const r = await d.invoke(channel, ...args);
    if (!r.ok) throw r.error; // objeto simples { code, message }
    return r.value;
  };
  window.desktopCall = call;

  /* ---------- banco de dados ---------- */
  const subs = new Map();
  let nextSub = 1;
  const snap = docs => ({
    docs: docs.map(x => ({ id: x.id, exists: true, data: () => structuredClone(x.data) })),
    size: docs.length,
    empty: docs.length === 0
  });
  d.on('db:snapshot', (subId, docs) => { const s = subs.get(subId); if (s) s.next(snap(docs)); });
  d.on('db:error', (subId, err) => { const s = subs.get(subId); if (s && s.error) s.error(err); });

  const docRef = (coll, id) => ({
    id, path: coll + '/' + id,
    get: async () => {
      const data = await call('db:get', coll, id);
      return { id, exists: !!data, data: () => (data ? structuredClone(data) : undefined) };
    },
    set: data => call('db:set', coll, id, data),
    update: data => call('db:update', coll, id, data),
    delete: () => call('db:delete', coll, id)
  });
  const db = {
    collection: coll => ({
      path: coll,
      doc: id => docRef(coll, id || newId()),
      add: async data => { const r = docRef(coll, newId()); await r.set(data); return r; },
      onSnapshot(next, error) {
        const subId = nextSub++;
        subs.set(subId, { next, error });
        call('db:subscribe', coll, subId).catch(err => { if (error) error(err); });
        return () => { subs.delete(subId); call('db:unsubscribe', subId).catch(() => {}); };
      }
    }),
    doc: path => { const [coll, id] = path.split('/'); return docRef(coll, id); }
  };

  /* ---------- leitura de notas pelo Claude ---------- */
  const toB64 = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ media_type: blob.type || 'image/jpeg', data: String(r.result).split(',')[1] || '' });
    r.onerror = () => reject({ code: 'image_rejected', message: 'Não consegui ler a imagem.' });
    r.readAsDataURL(blob);
  });
  const sample = Object.assign(async () => { throw { code: 'invalid_request', message: 'Use sample.json.' }; }, {
    limits: async () => ({
      maxPromptBytes: 262144,
      images: { maxCount: 5, maxInputBytes: 20 * 1024 * 1024, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] }
    }),
    json: async (prompt, opts = {}) => {
      if (opts.signal && opts.signal.aborted) throw { code: 'cancelled', message: 'Cancelado.' };
      const images = await Promise.all([].concat(opts.images || []).map(toB64));
      const reqId = newId();
      const onAbort = () => call('nota:cancel', reqId).catch(() => {});
      if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
      try { return await call('nota:read', { reqId, prompt, images }); }
      finally { if (opts.signal) opts.signal.removeEventListener('abort', onAbort); }
    }
  });

  /* ---------- arquivos das notas ---------- */
  const assets = {
    upload: async (blob, options) => {
      const b = await toB64(blob);
      const type = (options && options.type) || blob.type;
      const { id } = await call('nota:save', { type, data: b.data });
      return { id, url: '/_blob/' + id, sizeBytes: blob.size, contentType: type };
    }
  };

  /* ---------- pessoas: aqui todos podem editar ---------- */
  const user = { can: async () => true, isOwner: async () => true, canEdit: async () => true };

  const ready = call('config:get').catch(() => null);
  window.claude = {
    use: async name => {
      const cfg = await ready;
      switch (name) {
        case 'db': return cfg && cfg.storeReady ? db : null;
        case 'user': return user;
        case 'sample': return sample;
        case 'assets': return assets;
        default: return null;
      }
    }
  };
})();
