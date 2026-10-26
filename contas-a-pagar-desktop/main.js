'use strict';

const { app, BrowserWindow, Menu, protocol, ipcMain, dialog, shell, safeStorage, nativeTheme } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const { Store } = require('./lib/store');
const { Config } = require('./lib/config');
const claude = require('./lib/claude');

// Para testes automáticos: permite apontar os dados do programa para outra pasta.
if (process.env.CONTAS_USER_DATA) app.setPath('userData', process.env.CONTAS_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const ORIGIN = 'app://local/';
const RENDERER_DIR = path.join(__dirname, 'renderer');
const PDFJS_DIR = path.join(__dirname, 'node_modules', 'pdfjs-dist');
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'"
].join('; ');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.woff2': 'font/woff2'
};
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const NOTA_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
const MAX_NOTA_BYTES = 25 * 1024 * 1024;

let config = null;
let store = null;
let win = null;
const subs = new Map(); // `${webContentsId}:${subId}` -> parar
const inflight = new Map(); // reqId -> AbortController

async function openStore() {
  if (!config.dataDir) { store = null; return; }
  try {
    const s = new Store(Store.resolveRoot(config.dataDir));
    await s.init();
    store = s;
  } catch (e) {
    store = null; // pasta apagada, sem permissão ou desconectada: a tela pede para escolher de novo
  }
}

function requireStore() {
  if (!store) { const e = new Error('Escolha a pasta de dados em Configurações.'); e.code = 'sem_pasta'; throw e; }
  return store;
}

function clearSubs(wcId) {
  for (const [k, stop] of subs) if (k.startsWith(wcId + ':')) { stop(); subs.delete(k); }
}

function viewOf() {
  return { ...config.publicView(), storeReady: !!store, root: store ? store.root : '', platform: process.platform, version: app.getVersion() };
}

// Todas as respostas voltam como { ok, value } ou { ok:false, error:{code,message} }.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const url = event.senderFrame ? event.senderFrame.url : '';
      if (!url.startsWith(ORIGIN)) throw Object.assign(new Error('Origem não permitida.'), { code: 'invalid_argument' });
      return { ok: true, value: await fn(event, ...args) };
    } catch (e) {
      return { ok: false, error: { code: (e && e.code) ? String(e.code) : 'upstream_error', message: String((e && e.message) || e) } };
    }
  });
}

function registerIpc() {
  handle('config:get', () => viewOf());
  handle('config:chooseDir', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Escolha a pasta compartilhada', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    config.setDataDir(r.filePaths[0]);
    await openStore();
    return viewOf();
  });
  handle('config:setKey', (e, key) => { config.setKey(key); return viewOf(); });
  handle('config:clearKey', () => { config.clearKey(); return viewOf(); });
  handle('config:setModel', (e, id) => { config.setModel(id); return viewOf(); });
  handle('config:testKey', async () => {
    await claude.testarChave({ apiKey: config.getKey(), model: config.model });
    return true;
  });
  handle('shell:open', (e, url) => { openExternal(url); return true; });
  handle('folder:open', () => { if (store) shell.openPath(store.root); return true; });

  handle('db:list', (e, coll) => requireStore().list(coll));
  handle('db:get', (e, coll, id) => requireStore().get(coll, id));
  handle('db:set', (e, coll, id, data) => requireStore().set(coll, id, data));
  handle('db:update', (e, coll, id, patch) => requireStore().update(coll, id, patch));
  handle('db:delete', (e, coll, id) => requireStore().delete(coll, id));
  handle('db:subscribe', async (e, coll, subId) => {
    const st = requireStore();
    const wc = e.sender;
    const key = wc.id + ':' + subId;
    if (subs.has(key)) return true;
    const push = async () => {
      if (wc.isDestroyed()) return;
      try { wc.send('db:snapshot', subId, await st.list(coll)); }
      catch (err) { if (!wc.isDestroyed()) wc.send('db:error', subId, { code: 'unavailable', message: String(err.message) }); }
    };
    subs.set(key, st.watch(coll, push));
    await push();
    return true;
  });
  handle('db:unsubscribe', (e, subId) => {
    const key = e.sender.id + ':' + subId;
    const stop = subs.get(key);
    if (stop) { stop(); subs.delete(key); }
    return true;
  });

  handle('nota:save', async (e, { type, data }) => {
    const ext = NOTA_EXT[type];
    if (!ext) throw Object.assign(new Error('Tipo de arquivo não suportado.'), { code: 'unsupported_type' });
    const buf = Buffer.from(String(data || ''), 'base64');
    if (!buf.length || buf.length > MAX_NOTA_BYTES) throw Object.assign(new Error('Arquivo vazio ou grande demais.'), { code: 'too_large' });
    return { id: await requireStore().saveNota(buf, ext) };
  });
  handle('nota:read', async (e, { reqId, prompt, images }) => {
    const key = config.getKey();
    if (!key) throw Object.assign(new Error('Informe a chave da API em Configurações.'), { code: 'sem_chave' });
    if (typeof prompt !== 'string' || !Array.isArray(images) || !images.length || images.length > 5) {
      throw Object.assign(new Error('Pedido inválido.'), { code: 'invalid_request' });
    }
    for (const i of images) {
      if (!i || !IMAGE_TYPES.has(i.media_type) || typeof i.data !== 'string') throw Object.assign(new Error('Imagem inválida.'), { code: 'image_rejected' });
    }
    const ctl = new AbortController();
    inflight.set(String(reqId), ctl);
    try {
      return await claude.lerNota({ apiKey: key, model: config.model, prompt, images, signal: ctl.signal });
    } finally {
      inflight.delete(String(reqId));
    }
  });
  handle('nota:cancel', (e, reqId) => { const c = inflight.get(String(reqId)); if (c) c.abort(); return true; });
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.origin + '/' === ORIGIN && u.pathname.startsWith('/_blob/')) {
      const f = store && store.notaPath(decodeURIComponent(u.pathname.slice('/_blob/'.length)));
      if (f) shell.openPath(f); // abre no visualizador de imagens ou PDF do sistema
    } else if (u.protocol === 'https:') {
      shell.openExternal(u.href);
    }
  } catch (e) { /* endereço inválido: ignora */ }
}

async function fileResponse(file, extraHeaders) {
  const body = await fsp.readFile(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return new Response(body, { headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extraHeaders } });
}

function registerProtocol() {
  protocol.handle('app', async request => {
    try {
      const u = new URL(request.url);
      let p = decodeURIComponent(u.pathname);
      if (p === '/') p = '/index.html';
      if (p.startsWith('/_blob/')) {
        const f = store && store.notaPath(p.slice('/_blob/'.length));
        return f ? await fileResponse(f, { 'Cache-Control': 'private, max-age=3600' }) : new Response('Nota não encontrada.', { status: 404 });
      }
      if (p.startsWith('/vendor/pdfjs/')) {
        const rel = path.normalize(p.slice('/vendor/pdfjs/'.length));
        const sub = rel.split(path.sep)[0];
        const base = ['cmaps', 'standard_fonts', 'wasm'].includes(sub) ? PDFJS_DIR : path.join(PDFJS_DIR, 'build');
        const f = path.join(base, rel);
        if (!f.startsWith(base + path.sep)) return new Response('Proibido.', { status: 403 });
        return await fileResponse(f);
      }
      const f = path.join(RENDERER_DIR, path.normalize(p));
      if (!f.startsWith(RENDERER_DIR + path.sep)) return new Response('Proibido.', { status: 403 });
      return await fileResponse(f, f.endsWith('.html') ? { 'Content-Security-Policy': CSP } : {});
    } catch (e) {
      return new Response('Não encontrado.', { status: 404 });
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 880, minWidth: 900, minHeight: 600, show: false, title: 'Contas a Pagar',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e111f' : '#f3f5fb',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  win.once('ready-to-show', () => win.show());
  const wc = win.webContents;
  wc.on('did-start-loading', () => clearSubs(wc.id)); // recarregar a tela descarta os avisos antigos
  wc.on('destroyed', () => clearSubs(wc.id));
  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); openExternal(url); } });
  win.loadURL(ORIGIN + 'index.html');
}

function buildMenu() {
  const mac = process.platform === 'darwin';
  const template = [
    ...(mac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Configurações…', accelerator: 'CmdOrCtrl+,', click: () => win && win.webContents.send('menu:settings') },
        { label: 'Abrir pasta de dados', click: () => { if (store) shell.openPath(store.root); } },
        { type: 'separator' },
        mac ? { role: 'close', label: 'Fechar janela' } : { role: 'quit', label: 'Sair' }
      ]
    },
    { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Exibir',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools' }])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    config = new Config(path.join(app.getPath('userData'), 'config.json'), safeStorage);
    await openStore();
    registerProtocol();
    registerIpc();
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
