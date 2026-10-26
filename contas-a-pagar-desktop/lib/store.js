'use strict';
// Banco de dados em arquivos: cada serviço e cada compra é um arquivo JSON numa
// pasta que as pessoas já sincronizam (OneDrive, Google Drive, Dropbox).
// Um arquivo por registro evita que duas pessoas sobrescrevam o trabalho uma da outra.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const COLLECTIONS = ['servicos', 'compras'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DOC_RE = /^([A-Za-z0-9_-]{1,64})\.json$/;
const NOTA_EXT = ['jpg', 'png', 'webp', 'gif', 'pdf'];
const MAX_DOC_BYTES = 256 * 1024;
const POLL_MS = 15000;
const LOTE = 16; // arquivos lidos ao mesmo tempo (pastas sincronizadas na nuvem podem ser lentas)

// Roda fn em todos os itens, no máximo LOTE por vez, mantendo a ordem do resultado.
async function emLotes(itens, fn) {
  const saida = new Array(itens.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(LOTE, itens.length) }, async () => {
    while (proximo < itens.length) { const i = proximo++; saida[i] = await fn(itens[i], i); }
  }));
  return saida;
}

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

class Store extends EventEmitter {
  constructor(root) {
    super();
    this.root = root;
    this.queues = new Map();
    this.cache = new Map(); // arquivo -> { mtimeMs, size, data }: só relê o que mudou
  }

  // Se a pessoa escolheu a própria pasta de dados (ou uma pasta que já tem os dados), usa como está.
  // Caso contrário cria uma subpasta "ContasAPagar" para não misturar com outros arquivos.
  static resolveRoot(chosen) {
    const has = n => fs.existsSync(path.join(chosen, n));
    if (path.basename(chosen) === 'ContasAPagar' || (has('compras') && has('servicos'))) return chosen;
    return path.join(chosen, 'ContasAPagar');
  }

  async init() {
    for (const d of [...COLLECTIONS, 'notas']) await fsp.mkdir(path.join(this.root, d), { recursive: true });
  }

  dir(coll) {
    if (!COLLECTIONS.includes(coll)) throw fail('invalid_argument', 'Coleção inválida: ' + coll);
    return path.join(this.root, coll);
  }

  file(coll, id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw fail('invalid_argument', 'Identificador inválido.');
    return path.join(this.dir(coll), id + '.json');
  }

  async list(coll) {
    const dir = this.dir(coll);
    let names;
    try { names = await fsp.readdir(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const arquivos = names.map(n => ({ n, m: DOC_RE.exec(n) })).filter(x => x.m); // ignora temporários e cópias de conflito
    const lidos = await emLotes(arquivos, async ({ n, m }) => {
      const f = path.join(dir, n);
      try {
        const st = await fsp.stat(f);
        const guardado = this.cache.get(f);
        if (guardado && guardado.mtimeMs === st.mtimeMs && guardado.size === st.size) return { id: m[1], data: guardado.data };
        const data = JSON.parse(await fsp.readFile(f, 'utf8'));
        if (!isPlain(data)) return null;
        this.cache.set(f, { mtimeMs: st.mtimeMs, size: st.size, data });
        return { id: m[1], data };
      } catch (e) { return null; /* arquivo ainda sincronizando ou ilegível: aparece no próximo ciclo */ }
    });
    const vivos = new Set(arquivos.map(a => path.join(dir, a.n)));
    for (const f of this.cache.keys()) if (path.dirname(f) === dir && !vivos.has(f)) this.cache.delete(f);
    const docs = lidos.filter(Boolean);
    docs.sort((a, b) => (a.id < b.id ? -1 : 1));
    return docs;
  }

  async get(coll, id) {
    try {
      const data = JSON.parse(await fsp.readFile(this.file(coll, id), 'utf8'));
      return isPlain(data) ? data : null;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      if (e instanceof SyntaxError) return null;
      throw e;
    }
  }

  // Um registro por vez: leituras e gravações do mesmo arquivo nunca se misturam dentro do programa.
  _serial(key, fn) {
    const prev = this.queues.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.queues.set(key, next);
    next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key); }).catch(() => {});
    return next;
  }

  async _write(file, data) {
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text) > MAX_DOC_BYTES) throw fail('invalid_argument', 'Registro grande demais.');
    this.cache.delete(file);
    const tmp = path.join(path.dirname(file), '.' + path.basename(file) + '.' + crypto.randomBytes(4).toString('hex') + '.tmp');
    await fsp.writeFile(tmp, text, 'utf8');
    try { await fsp.rename(tmp, file); } catch (e) { await fsp.unlink(tmp).catch(() => {}); throw e; }
  }

  set(coll, id, data) {
    if (!isPlain(data)) return Promise.reject(fail('invalid_argument', 'O registro precisa ser um objeto.'));
    return this._serial(coll + '/' + id, async () => {
      await this._write(this.file(coll, id), data);
      this.emit('change', coll);
    });
  }

  update(coll, id, patch) {
    if (!isPlain(patch)) return Promise.reject(fail('invalid_argument', 'A alteração precisa ser um objeto.'));
    return this._serial(coll + '/' + id, async () => {
      const cur = await this.get(coll, id);
      if (!cur) throw fail('invalid_argument', 'Esse registro não existe mais.');
      await this._write(this.file(coll, id), deepMerge(cur, patch));
      this.emit('change', coll);
    });
  }

  delete(coll, id) {
    return this._serial(coll + '/' + id, async () => {
      this.cache.delete(this.file(coll, id));
      try { await fsp.unlink(this.file(coll, id)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      this.emit('change', coll);
    });
  }

  // Avisa quando a coleção muda: por escrita deste programa, por sincronização de outro computador
  // (fs.watch) ou, como garantia, por verificação periódica.
  watch(coll, cb) {
    const dir = this.dir(coll);
    let sig = null, timer = null, watcher = null, stopped = false;
    const check = async force => {
      if (stopped) return;
      const s = await this._signature(dir);
      if (force || s !== sig) { sig = s; if (!stopped) cb(); }
    };
    const soon = force => { clearTimeout(timer); timer = setTimeout(() => check(force), force ? 20 : 150); };
    try { watcher = fs.watch(dir, { persistent: false }, () => soon(false)); watcher.on('error', () => {}); } catch (e) { /* só a verificação periódica */ }
    const poll = setInterval(() => check(false), POLL_MS);
    if (poll.unref) poll.unref();
    const own = c => { if (c === coll) soon(true); };
    this.on('change', own);
    this._signature(dir).then(s => { if (sig === null) sig = s; });
    return () => {
      stopped = true;
      clearTimeout(timer); clearInterval(poll);
      this.off('change', own);
      if (watcher) watcher.close();
    };
  }

  async _signature(dir) {
    let names;
    try { names = await fsp.readdir(dir); } catch (e) { return 'ausente'; }
    const docs = names.filter(n => DOC_RE.test(n)).sort();
    const partes = await emLotes(docs, async n => {
      try { const st = await fsp.stat(path.join(dir, n)); return n + ':' + st.mtimeMs + ':' + st.size; } catch (e) { return ''; /* sumiu no meio */ }
    });
    return partes.filter(Boolean).join('|');
  }

  // Arquivos das notas (foto ou PDF original), guardados na própria pasta compartilhada.
  async saveNota(buffer, ext) {
    if (!NOTA_EXT.includes(ext)) throw fail('unsupported_type', 'Tipo de arquivo não suportado.');
    const id = crypto.randomBytes(16).toString('hex');
    await this._write_raw(path.join(this.root, 'notas', id + '.' + ext), buffer);
    return id;
  }

  async _write_raw(file, buffer) {
    const tmp = path.join(path.dirname(file), '.' + path.basename(file) + '.tmp');
    await fsp.writeFile(tmp, buffer);
    await fsp.rename(tmp, file);
  }

  notaPath(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    for (const ext of NOTA_EXT) {
      const f = path.join(this.root, 'notas', id + '.' + ext);
      if (fs.existsSync(f)) return f;
    }
    return null;
  }
}

module.exports = { Store, COLLECTIONS, NOTA_EXT, deepMerge };
