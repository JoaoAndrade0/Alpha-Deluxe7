'use strict';
// Teste de fumaça do programa já empacotado (o mesmo que vai ser instalado), em qualquer sistema.
// Abre o programa, conecta pela porta de depuração do Chromium (que continua valendo mesmo com os "fuses"
// de segurança ligados) e confere que a tela carregou, leu a pasta de dados e está isolada.
//
// Uso: node test/smoke/empacotado.js "<caminho do executável>"
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');

const exe = process.argv[2] || process.env.APP_EXE;
if (!exe || !fs.existsSync(exe)) { console.error('Informe o caminho do executável. Recebido: ' + exe); process.exit(2); }
const SAIDA = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-out-'));
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const espera = ms => new Promise(r => setTimeout(r, ms));

const portaLivre = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  s.on('error', rej);
});

async function aguardar(url, ms) {
  const fim = Date.now() + ms;
  let ultimo;
  while (Date.now() < fim) {
    try { const r = await fetch(url); if (r.ok) return r; } catch (e) { ultimo = e; }
    await espera(500);
  }
  throw new Error('O programa não abriu a tempo: ' + (ultimo && ultimo.message));
}

function encerrar(filho) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(filho.pid), '/T', '/F'], { stdio: 'ignore' });
    else filho.kill('SIGKILL');
  } catch (e) { /* já encerrou */ }
}

(async () => {
  const compartilhada = tmp('smoke-shared-');
  const raiz = path.join(compartilhada, 'ContasAPagar');
  for (const d of ['servicos', 'compras', 'notas']) fs.mkdirSync(path.join(raiz, d), { recursive: true });
  const grava = (c, id, d) => fs.writeFileSync(path.join(raiz, c, id + '.json'), JSON.stringify(d));
  grava('servicos', 'thayvson', { nome: 'Serviço do Thayvson (CMD)', ordem: 1 });
  [['c1', 13960, 2, 6980], ['c2', 46528, 3, 15509], ['c3', 22852, 4, 5713], ['c4', 47794, 4, 11948]].forEach(([id, t, p, v], i) =>
    grava('compras', id, { servicoId: 'thayvson', descricao: '', totalCents: t, parcelas: p, parcelaCents: v, inicio: '2026-11', pagas: {}, ordem: i + 1 }));
  const dadosDoPrograma = tmp('smoke-user-');
  fs.writeFileSync(path.join(dadosDoPrograma, 'config.json'), JSON.stringify({ dataDir: compartilhada }));

  const porta = await portaLivre();
  const args = ['--remote-debugging-port=' + porta, '--disable-gpu'];
  if (process.env.SMOKE_NO_SANDBOX) args.push('--no-sandbox'); // só em Linux como administrador (CI de contêiner)
  const filho = spawn(exe, args, { env: { ...process.env, CONTAS_USER_DATA: dadosDoPrograma }, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  filho.stdout.on('data', d => { saida += d; }); filho.stderr.on('data', d => { saida += d; });
  filho.on('exit', code => { if (code) console.log('O programa terminou com código ' + code); });

  let pagina = null;
  const erros = [];
  const mensagens = [];
  try {
    await aguardar('http://127.0.0.1:' + porta + '/json/version', 60000);
    const browser = await chromium.connectOverCDP('http://127.0.0.1:' + porta);
    for (let i = 0; i < 60 && !pagina; i++) {
      pagina = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://local/'));
      if (!pagina) await espera(500);
    }
    assert.ok(pagina, 'a janela do programa abriu (app://local/)');
    pagina.on('pageerror', e => erros.push(e.message));
    pagina.on('console', m => { mensagens.push(m.type() + ': ' + m.text()); if (m.type() === 'error') erros.push(m.text()); });
    await pagina.reload();
    await pagina.waitForSelector('.compra', { timeout: 30000 });
    assert.equal((await pagina.textContent('#s-total')).replace(/ /g, ' '), 'R$ 1.311,31');
    console.log('ok - o programa empacotado abre e mostra os dados da pasta (R$ 1.311,31)');

    const isolamento = await pagina.evaluate(() => ({
      require: typeof window.require, process: typeof window.process, Buffer: typeof window.Buffer,
      desktop: typeof window.desktop, canais: Object.keys(window.desktop || {}).sort().join(',')
    }));
    assert.deepEqual(isolamento, { require: 'undefined', process: 'undefined', Buffer: 'undefined', desktop: 'object', canais: 'invoke,on' });
    console.log('ok - a tela não enxerga Node (require, process, Buffer) e só tem a ponte fechada');

    const versao = await pagina.evaluate(async () => (await window.Contas.ponte.chamar('config:get')).version);
    assert.match(versao, /^\d+\.\d+\.\d+$/);
    console.log('ok - versão ' + versao + ' no ' + process.platform);
    await pagina.screenshot({ path: path.join(SAIDA, 'smoke-' + process.platform + '.png') });
    assert.deepEqual(erros, [], 'sem erros no console: ' + erros.join(' | '));
    console.log('ok - sem erros no console');
    await browser.close();
  } catch (e) {
    console.error('FALHOU:', e && e.message ? e.message : e);
    if (pagina) {
      try {
        console.error('--- o que a tela mostra ---\n' + await pagina.evaluate(() => document.body.innerText.slice(0, 700)));
        console.error('--- estado ---\n' + JSON.stringify(await pagina.evaluate(async () => ({
          url: location.href, config: window.Contas && window.Contas.ponte ? await window.Contas.ponte.chamar('config:get').catch(x => ({ erro: x })) : 'sem ponte',
          compras: document.querySelectorAll('[data-compra]').length, status: document.querySelector('#save') && document.querySelector('#save').textContent
        }))));
      } catch (x) { console.error('(não foi possível ler a tela: ' + x.message + ')'); }
    }
    console.error('--- console da tela ---\n' + mensagens.join('\n').slice(-2000) + '\n--- erros ---\n' + erros.join('\n'));
    console.error('--- saída do programa ---\n' + saida.slice(-3000));
    encerrar(filho);
    process.exit(1);
  }
  encerrar(filho);
  console.log('Teste de fumaça OK.');
})();
