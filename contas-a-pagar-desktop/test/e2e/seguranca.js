'use strict';
// Testes de segurança com o programa aberto de verdade. Cada passo tenta fazer algo que NÃO deve funcionar.
// Rodar: xvfb-run -a node test/e2e/seguranca.js
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { criarAmbiente, passo, CHAVE_DE_TESTE } = require('./ajuda');

const FIX = process.env.FIXTURES || __dirname;

(async () => {
  const amb = await criarAmbiente();
  const { app, janela: win } = await amb.lancar();
  await win.waitForSelector('.compra', { timeout: 20000 });
  const chamar = (canal, ...args) => win.evaluate(async ([c, a]) => { try { return { ok: true, v: await window.Contas.ponte.chamar(c, ...a) }; } catch (e) { return { ok: false, code: e.code, message: e.message }; } }, [canal, args]);

  /* ---------- 1) isolamento da tela ---------- */
  const iso = await win.evaluate(() => ({
    require: typeof require, process: typeof process, Buffer: typeof Buffer, module: typeof module, global: typeof global,
    dirname: typeof __dirname, electron: typeof window.electron, ipc: typeof window.ipcRenderer,
    ponte: Object.keys(window.desktop).sort().join(',')
  }));
  assert.deepEqual(iso, { require: 'undefined', process: 'undefined', Buffer: 'undefined', module: 'undefined', global: 'undefined', dirname: 'undefined', electron: 'undefined', ipc: 'undefined', ponte: 'invoke,on' });
  const canalInventado = await win.evaluate(() => window.desktop.invoke('shell:exec', 'calc').then(() => 'passou', e => String(e.message)));
  assert.match(canalInventado, /Canal não permitido/);
  const escuta = await win.evaluate(() => { let n = 0; window.desktop.on('app:segredo', () => n++); return n; });
  assert.equal(escuta, 0);
  passo('a tela não enxerga Node nem Electron, e só tem a ponte fechada (canal inventado é recusado)');

  /* ---------- 2) argumentos maliciosos pelo IPC ---------- */
  const ruins = [
    ['db:list', ['notas']], ['db:list', ['../..']], ['db:get', ['compras', '../../config']], ['db:get', ['compras', 'a.b']],
    ['db:set', ['compras', '../x', {}]], ['db:set', ['compras', 'ok', []]], ['db:set', ['compras', 'ok', 'texto']],
    ['db:update', ['servicos', '', {}]], ['db:delete', ['compras', '..']], ['db:subscribe', ['compras', -1]], ['db:subscribe', ['notas', 1]],
    ['db:set', ['compras', 'grande', { x: 'y'.repeat(300 * 1024) }]]
  ];
  for (const [canal, args] of ruins) {
    const r = await chamar(canal, ...args);
    assert.equal(r.ok, false, canal + ' ' + JSON.stringify(args).slice(0, 60) + ' deveria ser recusado');
    assert.equal(r.code, 'invalid_argument', canal + ': ' + r.code);
  }
  const notaRuim = await chamar('nota:save', { type: 'text/html', data: 'PGgxPmhhY2tlZDwvaDE+' });
  assert.equal(notaRuim.code, 'unsupported_type');
  assert.equal((await chamar('nota:save', { type: 'image/png', data: '' })).code, 'too_large');
  assert.equal((await chamar('nota:ler', { reqId: 'x', images: [{ media_type: 'text/html', data: 'QUJD' }] })).code, 'image_rejected');
  assert.equal((await chamar('nota:ler', { reqId: '../x', images: [] })).code, 'invalid_argument');
  assert.equal((await chamar('config:setKey', 'chave-qualquer-que-nao-e-da-anthropic-123456')).code, 'chave_formato');
  assert.equal((await chamar('config:setModel', 'gpt-4')).ok, false);
  assert.equal((await chamar('shell:open', 'file:///etc/passwd')).ok, true, 'a chamada é aceita, mas nada é aberto (veja o passo 4)');
  assert.deepEqual(fs.readdirSync(path.join(amb.raiz, 'compras')).filter(f => !/^c\d\.json$/.test(f)), [], 'nada indevido foi gravado na pasta');
  assert.equal(fs.readdirSync(path.join(amb.raiz, 'notas')).length, 0, 'nenhum arquivo indevido em notas/');
  passo('argumentos maliciosos pelo IPC (pasta fora da lista, id com ../, tipo errado, tamanho excessivo) são recusados e nada é gravado');

  /* ---------- 3) tentativas de sair da pasta do programa pelo protocolo app:// ---------- */
  const segredoNaPasta = path.join(amb.compartilhada, 'segredo.txt');
  fs.writeFileSync(segredoNaPasta, 'SEGREDO');
  const caminhos = [
    '/../main.js', '/..%2fmain.js', '/%2e%2e/main.js', '/..%2f..%2fpackage.json', '/lib/store.js', '/main.js', '/package.json', '/config.json',
    '/_blob/..%2f..%2fsegredo', '/_blob/../../segredo', '/_blob/ContasAPagar', '/_blob/' + 'a'.repeat(100),
    '/vendor/pdfjs/..%2f..%2fpackage.json', '/vendor/pdfjs/cmaps/..%2f..%2fpackage.json', '/vendor/pdfjs/package.json', '/vendor/pdfjs/build/pdf.mjs',
    '/vendor/pdfjs/cmaps/x.js', '/vendor/pdfjs/wasm/..%2fpackage.json', '/fonts/..%2f..%2fmain.js', '/%00', '/index.html%00.png', '/%E0%A4%A'
  ];
  const respostas = await win.evaluate(async lista => Promise.all(lista.map(async p => {
    try { const r = await fetch('app://local' + p); const t = await r.text(); return { p, status: r.status, vazou: /require\(|SEGREDO|"scripts"|"build"/.test(t) }; }
    catch (e) { return { p, status: 'erro' }; }
  })), caminhos);
  for (const r of respostas) {
    assert.ok(!r.vazou, 'vazou conteúdo em ' + r.p);
    assert.ok(r.status !== 200, r.p + ' respondeu 200');
  }
  passo(respostas.length + ' tentativas de ler arquivos fora do permitido pelo protocolo app:// (inclui ../, %2e%2e, %00, pdf.js e notas) falharam');

  // uma "nota" que na verdade é HTML/SVG/executável não é servida; foto de verdade sai com nosniff
  fs.writeFileSync(path.join(amb.raiz, 'notas', 'abcdef123456.html'), '<script>window.__pwned=1</script>');
  fs.writeFileSync(path.join(amb.raiz, 'notas', 'abcdef123457.svg'), '<svg onload="window.__pwned=1"/>');
  fs.writeFileSync(path.join(amb.raiz, 'notas', 'abcdef123458.jpg'), '<script>window.__pwned=1</script>');
  const notas = await win.evaluate(async () => Promise.all(['abcdef123456', 'abcdef123457', 'abcdef123458'].map(async id => {
    const r = await fetch('/_blob/' + id); return { status: r.status, tipo: r.headers.get('content-type'), nosniff: r.headers.get('x-content-type-options') };
  })));
  assert.equal(notas[0].status, 404); assert.equal(notas[1].status, 404);
  assert.deepEqual(notas[2], { status: 200, tipo: 'image/jpeg', nosniff: 'nosniff' });
  assert.equal(await win.evaluate(() => window.__pwned), undefined);
  passo('arquivo .html e .svg dentro de notas/ não é servido; um .jpg disfarçado sai como imagem com nosniff e não executa');

  /* ---------- 4) política de conteúdo, navegação e janelas ---------- */
  const csp = await win.evaluate(async () => (await fetch('/index.html')).headers.get('content-security-policy'));
  for (const regra of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "font-src 'self'", "connect-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'"]) {
    assert.ok(csp.includes(regra), 'falta na política: ' + regra);
  }
  assert.ok(!/unsafe-inline|unsafe-eval|https?:\/\/|\*/.test(csp), 'a política não pode liberar inline, eval nem endereços externos: ' + csp);
  const violacoes = await win.evaluate(async () => {
    const v = [];
    document.addEventListener('securitypolicyviolation', e => v.push(e.violatedDirective));
    // O Playwright roda código pelo protocolo de depuração, que ignora a regra de eval; por isso o teste usa
    // setTimeout com texto, que o próprio navegador executa depois e que a política precisa barrar.
    setTimeout('window.__timer = 1', 0);
    const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.body.append(s);
    const e = document.createElement('script'); e.src = 'https://example.com/x.js'; document.body.append(e);
    const i = document.createElement('img'); i.src = 'https://example.com/p.png'; document.body.append(i);
    const d = document.createElement('div'); d.innerHTML = '<img src=x onerror="window.__onerror=1">'; document.body.append(d);
    const f = document.createElement('iframe'); f.src = 'https://example.com'; document.body.append(f);
    let fetchOk = true; try { await fetch('https://example.com/'); } catch (err) { fetchOk = false; }
    await new Promise(r => setTimeout(r, 400));
    return { v, fetchOk, inline: window.__inline, onerror: window.__onerror, timer: window.__timer };
  });
  assert.equal(violacoes.timer, undefined, 'código em texto (equivalente a eval) não pode executar');
  assert.equal(violacoes.inline, undefined); assert.equal(violacoes.onerror, undefined); assert.equal(violacoes.fetchOk, false);
  for (const diretiva of ['script-src', 'img-src', 'frame-src', 'connect-src']) assert.ok(violacoes.v.some(x => x.startsWith(diretiva)), 'sem violação de ' + diretiva + ': ' + violacoes.v);
  passo('a política de conteúdo bloqueia eval, script em linha, script/imagem/quadro/fetch externos e onerror injetado');

  await app.evaluate(({ shell }) => { global.__abertos = []; shell.openExternal = async u => { global.__abertos.push(u); }; shell.openPath = async p => { global.__abertos.push('path:' + p); return ''; }; });
  const janelasAntes = app.windows().length;
  const nav = await win.evaluate(async () => {
    const tentativas = ['https://example.com/', 'https://console.anthropic.com.evil.example/', 'http://console.anthropic.com/', 'file:///etc/passwd', 'javascript:window.__js=1', 'ftp://example.com/x', 'https://console.anthropic.com/settings/keys'];
    const r = [];
    for (const u of tentativas) { const w = window.open(u); r.push([u, w === null]); }
    return r;
  });
  await new Promise(r => setTimeout(r, 500));
  assert.ok(nav.every(([, nulo]) => nulo), 'window.open nunca devolve uma janela nova');
  assert.equal(app.windows().length, janelasAntes, 'nenhuma janela nova foi aberta');
  let abertos = await app.evaluate(() => global.__abertos);
  assert.deepEqual(abertos, ['https://console.anthropic.com/settings/keys'], 'só o console da Anthropic abre no navegador: ' + JSON.stringify(abertos));
  await win.evaluate(() => { location.href = 'https://example.com/'; });
  await new Promise(r => setTimeout(r, 700));
  assert.ok(win.url().startsWith('app://local/'), 'a janela principal não sai do programa: ' + win.url());
  abertos = await app.evaluate(() => global.__abertos);
  assert.ok(!abertos.some(u => u.includes('example.com')), 'nenhum site estranho foi aberto');
  passo('window.open e mudança de endereço para sites externos, file:// e javascript: não abrem nada; só console.anthropic.com vai ao navegador');

  /* ---------- 5) permissões do navegador ---------- */
  const perm = await win.evaluate(async () => {
    const geo = await new Promise(res => navigator.geolocation.getCurrentPosition(() => res('permitido'), e => res('negado:' + e.code), { timeout: 3000 }));
    const notif = await Notification.requestPermission();
    let cam = 'permitido';
    try { await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); } catch (e) { cam = 'negado:' + e.name; }
    let clip = 'permitido';
    try { await navigator.clipboard.readText(); } catch (e) { clip = 'negado:' + e.name; }
    return { geo, notif, cam, clip };
  });
  assert.equal(perm.geo.startsWith('negado'), true, perm.geo);
  assert.notEqual(perm.notif, 'granted');
  assert.equal(perm.cam.startsWith('negado'), true, perm.cam);
  assert.equal(perm.clip.startsWith('negado'), true, perm.clip);
  passo('localização, notificações, câmera, microfone e leitura da área de transferência são negados');
  await win.reload(); await win.waitForSelector('.compra');

  /* ---------- 6) a chave nunca chega à tela nem a arquivos indevidos ---------- */
  const cfgNaTela = JSON.stringify((await chamar('config:get')).v);
  assert.ok(!cfgNaTela.includes(CHAVE_DE_TESTE) && !cfgNaTela.includes('TTTTTTTT'), 'a chave apareceu na resposta da configuração');
  assert.match(cfgNaTela, /"hasKey":true/);
  const pedidosAntes = amb.api.pedidos.length;
  amb.api.estado.resposta = { eh_comprovante: true, valor_total: 10, parcelas: 1, forma_pagamento: 'pix' };
  const b64 = fs.readFileSync(path.join(FIX, 'nota.png')).toString('base64');
  const ler = () => chamar('nota:ler', { reqId: 'r' + Math.random().toString(36).slice(2, 9), images: [{ media_type: 'image/png', data: b64 }] });
  const unico = await ler();
  assert.equal(unico.ok, true);
  assert.equal(amb.api.pedidos[pedidosAntes].headers['x-api-key'], CHAVE_DE_TESTE, 'a chave foi usada, só pelo processo principal');
  const prompt = amb.api.pedidos[pedidosAntes].body.messages[0].content.find(c => c.type === 'text').text;
  assert.match(prompt, /Hoje é \d{4}-\d{2}-\d{2}/);
  for (const p of ['/etc/passwd', 'ContasAPagar', 'sk-ant']) assert.ok(!prompt.includes(p), 'o pedido ao Claude não deve conter ' + p);
  const tudoNaPasta = [];
  (function varre(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? varre(path.join(d, f.name)) : tudoNaPasta.push(path.join(d, f.name)); })(amb.compartilhada);
  for (const f of tudoNaPasta) if (!/\.(jpg|png|pdf|gif|webp)$/.test(f)) assert.ok(!fs.readFileSync(f, 'utf8').includes(CHAVE_DE_TESTE), 'a chave foi parar em ' + f);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(amb.dadosDoPrograma, 'config.json')).mode & 0o777, 0o600, 'config.json só para o usuário');
  passo('a chave fica só no processo principal: não vai para a tela, para a pasta compartilhada nem para o texto do pedido; config.json com permissão 600');

  /* ---------- 7) limite de leituras (proteção contra gasto sem querer) ---------- */
  let primeiraRecusa = -1;
  for (let i = 2; i <= 35; i++) { const r = await ler(); if (!r.ok) { primeiraRecusa = i; assert.equal(r.code, 'rate_limited'); break; } }
  assert.equal(primeiraRecusa, 31, 'a leitura 31 em 10 minutos deve ser recusada (foi ' + primeiraRecusa + ')');
  const gastos = amb.api.pedidos.length - pedidosAntes;
  assert.equal(gastos, 30, 'a API recebeu exatamente 30 pedidos, não mais');
  passo('depois de 30 leituras em 10 minutos o programa recusa as seguintes e a API não recebe mais nada');

  /* ---------- 8) erros da API chegam traduzidos, sem vazar detalhes ---------- */
  await app.close();
  const amb2 = await criarAmbiente({ comChave: true });
  const seg = await amb2.lancar();
  await seg.janela.waitForSelector('.compra');
  const chamar2 = (canal, ...args) => seg.janela.evaluate(async ([c, a]) => { try { return { ok: true, v: await window.Contas.ponte.chamar(c, ...a) }; } catch (e) { return { ok: false, code: e.code, message: e.message }; } }, [canal, args]);
  const img = [{ media_type: 'image/png', data: b64 }];
  for (const [status, tipo, msg, esperado] of [[401, 'authentication_error', 'invalid x-api-key SEGREDO-INTERNO', 'chave_invalida'], [429, 'rate_limit_error', 'slow down', 'rate_limited'], [400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API', 'sem_saldo']]) {
    amb2.api.estado.falha = { status, tipo, msg };
    const r = await chamar2('nota:ler', { reqId: 'e' + status, images: img });
    assert.equal(r.code, esperado, status + ' -> ' + r.code);
  }
  amb2.api.estado.falha = null;
  await seg.app.close();
  amb2.fechar();
  passo('erros 401, 429 e saldo esgotado da API viram códigos claros para a tela');

  // Os únicos erros permitidos são os bloqueios que os próprios ataques do passo 4 provocaram de propósito.
  const inesperados = amb.erros.filter(e => !/Content Security Policy|Failed to load resource|ERR_BLOCKED|Refused to|Not allowed to load local resource/.test(e));
  assert.deepEqual(inesperados, [], 'erros inesperados no console: ' + inesperados.join(' | '));
  assert.ok(amb.erros.length >= 4, 'o navegador registrou os bloqueios dos ataques (' + amb.erros.length + ')');
  amb.fechar();
  console.log('\nSEGURANÇA OK.');
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
