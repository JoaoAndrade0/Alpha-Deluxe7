'use strict';
// Teste de ponta a ponta: abre o programa de verdade (Electron) com uma pasta compartilhada de
// mentira e um servidor no lugar da API do Claude. Precisa de tela (no Linux: xvfb-run -a node test/e2e/run.js).
const { _electron: electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const FIX = process.env.FIXTURES || __dirname; // nota.png e nota.pdf
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-out-'));
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));

(async () => {
  // servidor que imita a API do Claude
  const requests = [];
  let answer = {};
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      requests.push({ url: req.url, headers: req.headers, body: json });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: json.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 10, output_tokens: 10 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  // pasta compartilhada com os dados que "outro computador" já criou
  const shared = tmp('e2e-shared-');
  const root = path.join(shared, 'ContasAPagar');
  for (const d of ['servicos', 'compras', 'notas']) fs.mkdirSync(path.join(root, d), { recursive: true });
  const w = (c, id, d) => fs.writeFileSync(path.join(root, c, id + '.json'), JSON.stringify(d));
  w('servicos', 'thayvson', { nome: 'Serviço do Thayvson (CMD)', ordem: 1 });
  [['c1', 13960, 2, 6980], ['c2', 46528, 3, 15509], ['c3', 22852, 4, 5713], ['c4', 47794, 4, 11948]].forEach(([id, t, p, v], i) =>
    w('compras', id, { servicoId: 'thayvson', descricao: '', totalCents: t, parcelas: p, parcelaCents: v, inicio: '2026-11', pagas: {}, ordem: i + 1 }));

  const userData = tmp('e2e-user-');
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ dataDir: shared, model: 'claude-opus-5-5', apiKeyPlain: 'sk-ant-teste-1234' }));

  // APP_EXE: testa o programa já empacotado (como será instalado) em vez do código-fonte.
  const launch = ud => electron.launch({
    executablePath: process.env.APP_EXE || require(path.join(ROOT, 'node_modules', 'electron')),
    args: process.env.APP_EXE ? ['--no-sandbox', '--disable-gpu'] : [ROOT, '--no-sandbox', '--disable-gpu'], cwd: ROOT,
    env: { ...process.env, CONTAS_USER_DATA: ud, ANTHROPIC_BASE_URL: base }
  });
  const errors = [];
  const watchErrors = win => {
    win.on('pageerror', e => errors.push('pageerror: ' + e.message));
    win.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  };
  const step = n => console.log('ok - ' + n);

  /* ---------- 1) abre com dados já existentes ---------- */
  let app = await launch(userData);
  let win = await app.firstWindow();
  watchErrors(win);
  await win.setViewportSize({ width: 1100, height: 1000 });
  await win.waitForSelector('.compra', { timeout: 20000 });
  await win.waitForFunction(() => !document.querySelector('#pick-btn').disabled, null, { timeout: 15000 });
  assert.equal(await win.textContent('#s-total'), 'R$ 1.311,31');
  assert.deepEqual(await win.$$eval('.m .amt', x => x.map(i => i.textContent.replace(/ /g, ' '))), ['R$ 401,50', 'R$ 401,50', 'R$ 331,70', 'R$ 176,61']);
  step('abre e mostra os dados da pasta compartilhada (total R$ 1.311,31 e 4 meses)');

  /* ---------- 2) marcar parcela grava no arquivo ---------- */
  await win.click('[data-compra=c1] .box[data-i="0"]');
  await win.waitForFunction(() => document.querySelector('[data-compra=c1] .box[data-i="0"]').getAttribute('aria-pressed') === 'true');
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'compras', 'c1.json'), 'utf8')).pagas, { 0: true });
  step('marcar parcela paga grava no arquivo da compra');

  /* ---------- 3) alteração feita por "outro computador" aparece sozinha ---------- */
  w('compras', 'externo1', { servicoId: 'thayvson', descricao: 'Compra de outro PC', totalCents: 10000, parcelas: 1, parcelaCents: 10000, inicio: '2026-11', pagas: {}, ordem: 99 });
  await win.waitForSelector('[data-compra=externo1]', { timeout: 8000 });
  step('compra criada por outro computador aparece sem recarregar');
  fs.unlinkSync(path.join(root, 'compras', 'externo1.json'));
  await win.waitForSelector('[data-compra=externo1]', { state: 'detached', timeout: 8000 });
  step('compra apagada por outro computador some sem recarregar');

  /* ---------- 4) enviar foto da nota ---------- */
  answer = { eh_comprovante: true, fornecedor: 'Casa do Pedreiro', descricao: 'cimento e argamassa', valor_total: 1234.56, parcelas: 3, valor_parcela: 411.52, data_compra: '2026-10-20', forma_pagamento: 'credito', confianca: 'alta', observacao: '' };
  await win.setInputFiles('#pick', path.join(FIX, 'nota.png'));
  await win.waitForSelector('.up-item.done', { timeout: 20000 });
  const stateTxt = await win.textContent('.up-item .up-state');
  assert.match(stateTxt.replace(/ /g, ' '), /Compra criada: R\$ 1\.234,56 em 3× de R\$ 411,52/);
  const req = requests.find(r => r.body.messages && /valor_total/.test(JSON.stringify(r.body.messages)));
  assert.ok(req, 'o servidor recebeu o pedido de leitura');
  assert.equal(req.headers['x-api-key'], 'sk-ant-teste-1234');
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.match(req.headers['anthropic-beta'] || '', /server-side-fallback-2026-07-01/);
  const block = req.body.messages[0].content[0];
  assert.equal(block.type, 'image'); assert.equal(block.source.media_type, 'image/jpeg');
  assert.ok(block.source.data.length > 1000, 'imagem em base64 enviada');
  const novas = fs.readdirSync(path.join(root, 'compras')).filter(f => !/^c\d\.json$/.test(f));
  assert.equal(novas.length, 1);
  const nova = JSON.parse(fs.readFileSync(path.join(root, 'compras', novas[0]), 'utf8'));
  assert.equal(nova.totalCents, 123456); assert.equal(nova.parcelas, 3); assert.equal(nova.conferir, true);
  assert.equal(nova.servicoId, 'thayvson'); assert.equal(nova.inicio, '2026-11');
  assert.equal(nova.descricao, 'Casa do Pedreiro · cimento e argamassa');
  assert.match(nova.notaId, /^[0-9a-f]{32}$/);
  assert.ok(fs.existsSync(path.join(root, 'notas', nova.notaId + '.jpg')), 'foto guardada na pasta compartilhada');
  step('foto da nota: lida pela API, compra criada, foto guardada na pasta');

  const status = await win.evaluate(id => fetch('/_blob/' + id).then(r => r.status + ' ' + r.headers.get('content-type')), nova.notaId);
  assert.equal(status, '200 image/jpeg');
  step('a foto guardada abre dentro do programa (/_blob)');

  await win.waitForSelector('.c-review:not([hidden])');
  await win.screenshot({ path: path.join(OUT, 'app-desktop.png'), fullPage: true });

  /* ---------- 5) enviar PDF (pdf.js local) ---------- */
  answer = { eh_comprovante: true, fornecedor: 'Loja PDF', descricao: 'ferragens', valor_total: 90, parcelas: null, valor_parcela: null, data_compra: null, forma_pagamento: 'pix', confianca: 'media', observacao: '' };
  const before = requests.length;
  await win.setInputFiles('#pick', path.join(FIX, 'nota.pdf'));
  await win.waitForFunction(() => document.querySelectorAll('.up-item.done').length >= 2, null, { timeout: 30000 }).catch(async e => {
    console.log('LISTA:', await win.evaluate(() => document.querySelector('#up-list').innerText));
    console.log('ERROS:', errors);
    throw e;
  });
  const pdfReq = requests[before];
  assert.equal(pdfReq.body.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.ok(fs.readdirSync(path.join(root, 'notas')).some(f => f.endsWith('.pdf')), 'PDF original guardado');
  step('PDF: convertido em imagem, lido, original guardado');

  /* ---------- 6) erros: chave inválida e nota que não é nota ---------- */
  answer = { eh_comprovante: false };
  await win.setInputFiles('#pick', path.join(FIX, 'nota.png'));
  await win.waitForSelector('.up-item.err', { timeout: 20000 });
  assert.match(await win.textContent('.up-item.err .up-state'), /não parece uma nota/);
  step('arquivo que não é nota mostra mensagem clara e não cria compra');

  /* ---------- 7) configurações ---------- */
  await win.click('#cfg-btn');
  await win.waitForSelector('dialog#cfg[open]');
  assert.match(await win.textContent('#cfg-keystatus'), /Chave salva \(…1234\)/);
  assert.equal(await win.$eval('#cfg-model', s => s.value), 'claude-opus-5-5');
  await win.selectOption('#cfg-model', 'claude-sonnet-5-5');
  await win.click('#cfg-testkey');
  await win.waitForFunction(() => /A chave funciona/.test(document.querySelector('#cfg-keystatus').textContent), null, { timeout: 15000 });
  const cfgOnDisk = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));
  assert.equal(cfgOnDisk.model, 'claude-sonnet-5-5');
  await win.screenshot({ path: path.join(OUT, 'app-settings.png') });
  step('configurações: chave testada e modelo salvo');
  await win.click('#cfg-close');

  assert.deepEqual(errors, [], 'sem erros no console: ' + errors.join(' | '));
  step('nenhum erro no console (inclui violações de segurança de conteúdo)');
  await app.close();

  /* ---------- 8) primeira vez: sem pasta escolhida ---------- */
  const fresh = tmp('e2e-fresh-');
  app = await launch(fresh);
  win = await app.firstWindow();
  await win.waitForSelector('dialog#cfg[open]', { timeout: 20000 });
  assert.equal(await win.textContent('#cfg-dir'), 'Nenhuma pasta escolhida');
  assert.equal(await win.$eval('#cfg-close', b => b.disabled), true);
  await win.keyboard.press('Escape');
  assert.equal(await win.$eval('dialog#cfg', d => d.open), true, 'Esc não fecha antes de escolher a pasta');
  await win.screenshot({ path: path.join(OUT, 'app-first-run.png') });
  step('primeira vez: pede a pasta e não deixa fechar sem escolher');
  await app.close();

  server.close();
  console.log('\nE2E OK. Imagens em ' + OUT);
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
