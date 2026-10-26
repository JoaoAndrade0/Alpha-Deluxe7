'use strict';

const { app, BrowserWindow, Menu, protocol, ipcMain, dialog, shell, safeStorage, nativeTheme } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const { Store } = require('./lib/store');
const { Config } = require('./lib/config');
const claude = require('./lib/claude');
const nota = require('./lib/nota');
const V = require('./lib/validar');
const { criarLimitador } = require('./lib/limites');
const M = require('./renderer/lib/meses');

app.setAppUserModelId('br.com.alphadeluxe7.contasapagar');
// Sem rede em segundo plano do Chromium (atualização de componentes, relatórios de falha, listas de segurança):
// o programa só se conecta à internet quando você envia uma nota para o Claude ler.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('no-pings');
// Para testes automáticos: permite apontar os dados do programa para outra pasta.
if (process.env.CONTAS_USER_DATA) app.setPath('userData', process.env.CONTAS_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const ORIGIN = 'app://local/';
const RENDERER_DIR = path.join(__dirname, 'renderer');
const PDFJS_DIR = path.join(__dirname, 'node_modules', 'pdfjs-dist');
const HOSTS_EXTERNOS = new Set(['console.anthropic.com']); // único site que o programa abre no navegador
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'"
].join('; ');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream'
};
const SEGURANCA_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer'
};

let config = null;
let store = null;
let win = null;
const limitador = criarLimitador({ simultaneas: 2, max: 30, janelaMs: 10 * 60 * 1000 });
const subs = new Map(); // `${webContentsId}:${assinatura}` -> função que para de observar
const emAndamento = new Map(); // pedido -> AbortController

// Abre (e prepara) a pasta de dados. Só devolve se der certo.
async function abrirPasta(dir) {
  try {
    const s = new Store(Store.resolveRoot(dir));
    await s.init();
    return s;
  } catch (e) {
    throw Object.assign(new Error('Não consegui abrir essa pasta. Escolha uma pasta onde você pode criar arquivos.'), { code: 'sem_pasta' });
  }
}

async function openStore() {
  store = null;
  if (!config.dataDir) return;
  try { store = await abrirPasta(config.dataDir); } catch (e) { /* pasta apagada, sem permissão ou desconectada: a tela pede para escolher de novo */ }
}

function requireStore() {
  if (!store) { const e = new Error('Escolha a pasta de dados em Configurações.'); e.code = 'sem_pasta'; return Promise.reject(e); }
  return Promise.resolve(store);
}

function clearSubs(wcId) {
  for (const [k, stop] of subs) if (k.startsWith(wcId + ':')) { stop(); subs.delete(k); }
}

function viewOf() {
  return { ...config.publicView(), storeReady: !!store, root: store ? store.root : '', platform: process.platform, version: app.getVersion() };
}

// Só a tela do próprio programa (quadro principal da nossa janela) pode usar o IPC.
function origemConfiavel(event) {
  const f = event.senderFrame;
  return !!(f && f.parent === null && f.url.startsWith(ORIGIN) && win && event.sender === win.webContents);
}

// Todas as respostas voltam como { ok, value } ou { ok:false, error:{code,message} }.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (!origemConfiavel(event)) throw Object.assign(new Error('Origem não permitida.'), { code: 'invalid_argument' });
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
    const novo = await abrirPasta(r.filePaths[0]); // se não abrir, a pasta que já funcionava continua valendo
    config.setDataDir(r.filePaths[0]);
    store = novo;
    return viewOf();
  });
  handle('config:setKey', (e, key) => { config.setKey(key); return viewOf(); });
  handle('config:clearKey', () => { config.clearKey(); return viewOf(); });
  handle('config:setModel', (e, id) => { config.setModel(id); return viewOf(); });
  handle('config:testKey', async () => {
    const liberar = limitador.iniciar(); // o teste também gasta uma chamada paga: entra na mesma conta
    try { await claude.testarChave({ apiKey: config.getKey(), model: config.model }); } finally { liberar(); }
    return true;
  });
  handle('shell:open', (e, url) => { openExternal(url); return true; });
  handle('folder:open', () => { if (store) shell.openPath(store.root); return true; });

  handle('db:list', async (e, coll) => (await requireStore()).list(V.colecao(coll)));
  handle('db:get', async (e, coll, id) => (await requireStore()).get(V.colecao(coll), V.id(id)));
  handle('db:set', async (e, coll, id, data) => (await requireStore()).set(V.colecao(coll), V.id(id), V.objeto(data)));
  handle('db:update', async (e, coll, id, patch) => (await requireStore()).update(V.colecao(coll), V.id(id), V.objeto(patch)));
  handle('db:delete', async (e, coll, id) => (await requireStore()).delete(V.colecao(coll), V.id(id)));
  handle('db:subscribe', async (e, coll, subId) => {
    const st = await requireStore();
    V.colecao(coll); V.numeroDeAssinatura(subId);
    const wc = e.sender;
    const key = wc.id + ':' + subId;
    if (subs.has(key)) return true;
    let ultima = 0;
    const push = async () => {
      if (wc.isDestroyed()) return;
      const minha = ++ultima; // se duas leituras se cruzarem, só a mais nova é enviada (a antiga nunca sobrescreve a nova)
      try {
        const docs = await st.list(coll);
        if (minha === ultima && !wc.isDestroyed()) wc.send('db:snapshot', subId, docs);
      } catch (err) { if (!wc.isDestroyed()) wc.send('db:error', subId, { code: 'unavailable', message: String(err.message) }); }
    };
    subs.set(key, st.watch(coll, push));
    await push();
    return true;
  });
  handle('db:unsubscribe', (e, subId) => {
    const key = e.sender.id + ':' + V.numeroDeAssinatura(subId);
    const stop = subs.get(key);
    if (stop) { stop(); subs.delete(key); }
    return true;
  });

  handle('nota:save', async (e, arquivo) => {
    const { ext, buf } = V.arquivoDeNota(arquivo);
    return { id: await (await requireStore()).saveNota(buf, ext) };
  });
  // A tela só envia as imagens: o texto do pedido e a conferência da resposta ficam aqui.
  handle('nota:ler', async (e, pedido) => {
    V.objeto(pedido);
    const reqId = V.idDePedido(pedido.reqId);
    const images = V.imagens(pedido.images);
    const key = config.getKey();
    if (!key) throw Object.assign(new Error('Informe a chave da API em Configurações.'), { code: 'sem_chave' });
    const liberar = limitador.iniciar();
    const ctl = new AbortController();
    emAndamento.set(reqId, ctl);
    try {
      const bruto = await claude.lerNota({ apiKey: key, model: config.model, prompt: nota.prompt(M.hojeStr()), images, signal: ctl.signal });
      return nota.interpretar(bruto, M.chaveAtual());
    } finally {
      emAndamento.delete(reqId);
      liberar();
    }
  });
  handle('nota:cancel', (e, reqId) => { const c = emAndamento.get(V.idDePedido(reqId)); if (c) c.abort(); return true; });
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.origin + '/' === ORIGIN && u.pathname.startsWith('/_blob/')) {
      const f = store && store.notaPath(decodeURIComponent(u.pathname.slice('/_blob/'.length)));
      if (f) shell.openPath(f); // abre no visualizador de imagens ou PDF do sistema
    } else if (u.protocol === 'https:' && HOSTS_EXTERNOS.has(u.hostname)) {
      shell.openExternal(u.href);
    }
  } catch (e) { /* endereço inválido: ignora */ }
}

async function fileResponse(file, extraHeaders) {
  const body = await fsp.readFile(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return new Response(body, { headers: { 'Content-Type': type, ...SEGURANCA_HEADERS, ...extraHeaders } });
}

const negado = status => new Response(status === 404 ? 'Não encontrado.' : 'Proibido.', { status, headers: SEGURANCA_HEADERS });

// Resolve um caminho pedido dentro de uma pasta base, recusando qualquer tentativa de sair dela.
function dentroDe(base, pedido) {
  if (pedido.includes('\0')) return null;
  const alvo = path.resolve(base, '.' + path.sep + pedido.replace(/^[/\\]+/, ''));
  const rel = path.relative(base, alvo);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? alvo : null;
}

const PDFJS_ARQUIVOS = new Set(['pdf.min.mjs', 'pdf.worker.min.mjs']);
const PDFJS_PASTAS = { cmaps: /\.bcmap$/, standard_fonts: /\.(pfb|ttf)$/, wasm: /\.(wasm|js)$/ };

function registerProtocol() {
  protocol.handle('app', async request => {
    try {
      const u = new URL(request.url);
      let p = decodeURIComponent(u.pathname);
      if (p === '/') p = '/index.html';
      if (p.startsWith('/_blob/')) {
        const f = store && store.notaPath(p.slice('/_blob/'.length));
        return f ? await fileResponse(f, { 'Cache-Control': 'private, max-age=3600' }) : negado(404);
      }
      if (p.startsWith('/vendor/pdfjs/')) {
        const rel = p.slice('/vendor/pdfjs/'.length);
        const [pasta, ...resto] = rel.split('/');
        let f = null;
        if (PDFJS_ARQUIVOS.has(rel)) f = dentroDe(path.join(PDFJS_DIR, 'build'), rel);
        else if (PDFJS_PASTAS[pasta] && resto.length === 1 && PDFJS_PASTAS[pasta].test(resto[0])) f = dentroDe(path.join(PDFJS_DIR, pasta), resto[0]);
        return f ? await fileResponse(f) : negado(404);
      }
      const f = dentroDe(RENDERER_DIR, p);
      if (!f) return negado(403);
      return await fileResponse(f, f.endsWith('.html') ? { 'Content-Security-Policy': CSP } : {});
    } catch (e) {
      return negado(404);
    }
  });
}

// Nenhuma permissão do navegador (câmera, localização, notificações...) é concedida a ninguém.
function fecharPermissoes(ses) {
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
}

app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', e => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  const trava = (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); openExternal(url); } };
  wc.on('will-navigate', trava);
  wc.on('will-redirect', trava);
});

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 880, minWidth: 900, minHeight: 600, show: false, title: 'Contas a Pagar',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e111f' : '#f3f5fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, spellcheck: false, devTools: !app.isPackaged
    }
  });
  win.once('ready-to-show', () => win.show());
  const wc = win.webContents;
  wc.on('did-start-loading', () => clearSubs(wc.id)); // recarregar a tela descarta os avisos antigos
  wc.on('destroyed', () => clearSubs(wc.id));
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
    fecharPermissoes(require('electron').session.defaultSession);
    await openStore();
    registerProtocol();
    registerIpc();
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
