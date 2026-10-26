'use strict';
// Robustez: dados estragados ou maliciosos na pasta compartilhada, muitos registros, edição ao mesmo tempo que
// outro computador altera a mesma compra, e exclusões. Rodar: xvfb-run -a node test/e2e/robustez.js
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { criarAmbiente, passo, semNbsp } = require('./ajuda');

const espera = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const amb = await criarAmbiente();
  const { grava, raiz } = amb;
  const dir = c => path.join(raiz, c);

  /* ---------- dados hostis e quebrados já presentes na pasta ao abrir ---------- */
  grava('servicos', 'hostil', { nome: '<script>window.__pwned=2</script>' + 'A'.repeat(500), ordem: 2 });
  grava('compras', 'h1', {
    servicoId: 'hostil', descricao: '<img src=x onerror="window.__pwned=1">' + 'B'.repeat(300), totalCents: -5, parcelas: 1e9, parcelaCents: 1e30,
    inicio: '9999-99', pagas: [true, true], ordem: 'abc', conferir: true, leitura: '<b>negrito</b><script>window.__pwned=3</script>', notaId: '../../x', notaTipo: 'exe', dataCompra: '2026-02-31'
  });
  grava('compras', 'h2', { servicoId: 'hostil', descricao: 'extremo', totalCents: 99999999999, parcelas: 60, parcelaCents: 99999999999, inicio: '2026-11', pagas: { 0: 'false', 1: true }, ordem: 5 });
  grava('compras', 'h3', { servicoId: 'hostil', descricao: 'RTL ‮ txet e emoji 😀', totalCents: 100, parcelas: 2, parcelaCents: 50, inicio: '2026-11', pagas: {}, ordem: 6 });
  grava('compras', 'enorme', { servicoId: 'hostil', descricao: 'x'.repeat(300 * 1024), totalCents: 1, parcelas: 1, parcelaCents: 1, inicio: '2026-11', pagas: {}, ordem: 7 });
  fs.writeFileSync(path.join(dir('compras'), 'quebrado.json'), '{nao e json');
  fs.writeFileSync(path.join(dir('compras'), 'lista.json'), '[1,2,3]');
  fs.writeFileSync(path.join(dir('compras'), 'c1 (cópia em conflito de Maria).json'), JSON.stringify({ servicoId: 'thayvson', totalCents: 999999, parcelas: 1, parcelaCents: 999999, inicio: '2026-11' }));
  fs.writeFileSync(path.join(dir('compras'), '.c1.json.abcd.tmp'), '{}');
  fs.writeFileSync(path.join(dir('servicos'), 'sem-extensao'), '{}');

  const { app, janela: win } = await amb.lancar();
  const t0 = Date.now();
  await win.waitForSelector('[data-compra=h1]', { timeout: 20000 });
  assert.equal(await win.evaluate(() => window.__pwned), undefined, 'nenhum código dos dados foi executado');
  assert.equal(await win.locator('[data-compra=h1] .box').count(), 60, 'parcelas absurdas são limitadas a 60');
  const desc = await win.inputValue('[data-compra=h1] .c-desc');
  assert.equal(desc.length, 120); assert.ok(desc.startsWith('<img src=x onerror='), 'o texto aparece literal, sem virar HTML');
  assert.equal(await win.locator('[data-compra=h1] img[alt]').count() <= 1, true);
  assert.ok(await win.locator('.svc-name').nth(1).inputValue().then(v => v.length <= 80 && v.startsWith('<script>')));
  assert.match(await win.textContent('[data-compra=h1] .rv-note'), /<b>negrito<\/b>/, 'observação aparece como texto puro');
  const corpo = semNbsp(await win.evaluate(() => document.body.innerText));
  assert.ok(!/NaN|undefined|Infinity|\[object/.test(corpo), 'a tela não mostra NaN, undefined nem Infinity');
  assert.ok(!(await win.locator('[data-compra="c1 (cópia em conflito de Maria)"]').count()), 'cópia de conflito do serviço de sincronização é ignorada');
  assert.equal(await win.locator('[data-compra=h2] .box[aria-pressed=true]').count(), 1, 'só a parcela marcada com true conta como paga ("false" em texto não)');
  assert.equal(await win.locator('[data-compra]').count(), 4 + 4, 'compras válidas: 4 do caderno + h1, h2, h3, enorme');
  const carga = Date.now() - t0;
  assert.ok(carga < 15000, 'carregou em ' + carga + ' ms');
  passo('dados hostis ou quebrados (HTML, script, números absurdos, JSON inválido, 300 KB, cópia de conflito) não executam nada, não quebram a tela e são limitados');

  // continua usável: marcar uma parcela, excluir pelo clique duplo
  await win.click('[data-compra=h3] .box[data-i="0"]');
  await espera(400);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir('compras'), 'h3.json'), 'utf8')).pagas, { 0: true });
  passo('depois de carregar dados estranhos, o programa continua gravando normalmente');

  /* ---------- edição ao mesmo tempo que outro computador ---------- */
  await win.click('[data-compra=c1] .c-desc');
  await win.keyboard.type('Cimento da obra');
  // enquanto a pessoa digita (campo ainda em edição), outro computador altera a mesma compra
  const c1 = JSON.parse(fs.readFileSync(path.join(dir('compras'), 'c1.json'), 'utf8'));
  fs.writeFileSync(path.join(dir('compras'), 'c1.json'), JSON.stringify({ ...c1, pagas: { 1: true }, conferir: false }));
  await espera(1500);
  assert.equal(await win.inputValue('[data-compra=c1] .c-desc'), 'Cimento da obra', 'o que a pessoa digitava não foi apagado pela mudança externa');
  await win.keyboard.press('Enter');
  await espera(500);
  const depois = JSON.parse(fs.readFileSync(path.join(dir('compras'), 'c1.json'), 'utf8'));
  assert.equal(depois.descricao, 'Cimento da obra');
  assert.deepEqual(depois.pagas, { 1: true }, 'a mudança do outro computador também foi mantida');
  assert.equal(await win.locator('[data-compra=c1] .box[aria-pressed=true]').count(), 1);
  passo('editar uma compra enquanto outro computador a altera: nada se perde, nem o que foi digitado nem o que veio de fora');

  /* ---------- exclusões ---------- */
  await win.click('[data-compra=h3] [data-act=del-compra]');
  assert.equal(fs.existsSync(path.join(dir('compras'), 'h3.json')), true, 'o primeiro clique só pede confirmação');
  assert.match(await win.textContent('[data-compra=h3] [data-act=del-compra]'), /Confirmar exclusão/);
  await win.click('[data-compra=h3] [data-act=del-compra]');
  await espera(500);
  assert.equal(fs.existsSync(path.join(dir('compras'), 'h3.json')), false);
  const svcHostil = win.locator('.svc').nth(1);
  await svcHostil.locator('[data-act=del-servico]').click();
  assert.match(await svcHostil.locator('[data-act=del-servico]').textContent(), /apagar serviço e 3 compras/);
  await svcHostil.locator('[data-act=del-servico]').click();
  await espera(800);
  assert.equal(fs.existsSync(path.join(dir('servicos'), 'hostil.json')), false);
  for (const id of ['h1', 'h2', 'enorme']) assert.equal(fs.existsSync(path.join(dir('compras'), id + '.json')), false, id + ' deveria ter sido apagada junto');
  assert.equal(fs.existsSync(path.join(dir('compras'), 'c1.json')), true, 'compras de outros serviços ficam');
  passo('excluir pede um segundo clique; excluir um serviço apaga só as compras dele');
  await app.close();

  /* ---------- muitos registros ---------- */
  const amb2 = await criarAmbiente();
  for (let i = 0; i < 300; i++) amb2.grava('compras', 'm' + i, { servicoId: 'thayvson', descricao: 'Compra ' + i, totalCents: 120000, parcelas: 12, parcelaCents: 10000, inicio: '2026-11', pagas: { 0: true, 1: i % 2 === 0 }, ordem: 100 + i });
  const g = await amb2.lancar();
  const t1 = Date.now();
  await g.janela.waitForFunction(() => document.querySelectorAll('[data-compra]').length >= 304, null, { timeout: 60000 });
  const abrir = Date.now() - t1;
  assert.ok(abrir < 20000, '304 compras (3.600 parcelas) abriram em ' + abrir + ' ms');
  assert.equal(semNbsp(await g.janela.textContent('#s-total')), 'R$ 361.311,31'.replace('361.311,31', '361.311,31'));
  const t2 = Date.now();
  await g.janela.click('[data-compra=m150] .box[data-i="5"]');
  await g.janela.waitForFunction(() => document.querySelector('[data-compra=m150] .box[data-i="5"]').getAttribute('aria-pressed') === 'true');
  const clique = Date.now() - t2;
  assert.ok(clique < 3000, 'marcar uma parcela com 304 compras na tela levou ' + clique + ' ms');
  passo('300 compras com 12 parcelas: abre em ' + (abrir / 1000).toFixed(1) + ' s e marcar uma parcela responde em ' + clique + ' ms');
  await g.app.close();

  /* ---------- pasta que não dá para abrir, e o que foi criado sobrevive a fechar e abrir ---------- */
  const ruim = await criarAmbiente({ semear: false });
  const arquivo = path.join(ruim.compartilhada, 'isto-e-um-arquivo.txt');
  fs.writeFileSync(arquivo, 'x');
  fs.writeFileSync(path.join(ruim.dadosDoPrograma, 'config.json'), JSON.stringify({ dataDir: arquivo }));
  const r1 = await ruim.lancar();
  await r1.janela.waitForSelector('dialog#cfg[open]', { timeout: 20000 });
  assert.match(await r1.janela.textContent('#cfg-dir'), /não consegui abrir esta pasta/);
  assert.equal(await r1.janela.$eval('#cfg-close', b => b.disabled), true, 'não deixa fechar sem uma pasta que funcione');
  assert.ok(await r1.janela.isVisible('#notice'), 'a tela explica o que fazer');
  assert.equal(await r1.janela.isVisible('#uploader'), false, 'sem pasta, o envio de nota fica escondido');
  await r1.app.close();
  passo('pasta escolhida que não abre (é um arquivo): o programa explica, bloqueia o envio de nota e não deixa fechar as configurações');

  const dur = await criarAmbiente({ semear: false });
  const d1 = await dur.lancar();
  await d1.janela.waitForSelector('#empty:not([hidden])', { timeout: 20000 });
  await d1.janela.click('.sec-head [data-act=add-servico]');
  await d1.janela.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('svc-name'));
  await d1.janela.keyboard.type('Obra da Maria');
  await d1.janela.keyboard.press('Enter');
  await d1.janela.click('.svc [data-act=add-compra]');
  await d1.janela.waitForFunction(() => document.activeElement && document.activeElement.dataset.f === 'total');
  await d1.janela.keyboard.type('900');
  await d1.janela.keyboard.press('Tab');
  await d1.janela.keyboard.type('3');
  await d1.janela.keyboard.press('Enter');
  await d1.janela.click('.compra .box[data-i="0"]');
  await espera(600);
  await d1.app.close();
  const d2 = await dur.lancar(); // fecha e abre de novo, como no dia seguinte
  await d2.janela.waitForSelector('.compra', { timeout: 20000 });
  assert.equal(await d2.janela.inputValue('.svc-name'), 'Obra da Maria');
  assert.equal(await d2.janela.inputValue('.compra [data-f=total]'), '900,00');
  assert.equal(await d2.janela.inputValue('.compra [data-f=parcela]'), '300,00', 'a parcela foi calculada: 900 ÷ 3');
  assert.equal(await d2.janela.locator('.compra .box[aria-pressed=true]').count(), 1);
  assert.equal(semNbsp(await d2.janela.textContent('#s-paid')), 'R$ 300,00');
  await d2.app.close();
  passo('serviço, compra, valor, parcelas e parcela paga criados só pelo teclado continuam lá depois de fechar e abrir o programa');

  /* ---------- digitar a parcela primeiro: o que foi digitado nunca é apagado por um cálculo ---------- */
  const calc = await criarAmbiente({ semear: false });
  const c1p = await calc.lancar();
  await c1p.janela.waitForSelector('#empty:not([hidden])', { timeout: 20000 });
  await c1p.janela.click('.sec-head [data-act=add-servico]');
  await c1p.janela.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('svc-name'));
  await c1p.janela.keyboard.press('Enter');
  await c1p.janela.click('.svc [data-act=add-compra]');
  await c1p.janela.waitForFunction(() => document.activeElement && document.activeElement.dataset.f === 'total');
  await c1p.janela.fill('.compra [data-f=parcela]', '155,09'); await c1p.janela.press('.compra [data-f=parcela]', 'Enter');
  await c1p.janela.waitForFunction(() => document.querySelector('.compra [data-f=total]').value === '155,09');
  await c1p.janela.fill('.compra [data-f=parcelas]', '3'); await c1p.janela.press('.compra [data-f=parcelas]', 'Enter');
  await c1p.janela.waitForFunction(() => document.querySelector('.compra [data-f=total]').value === '465,27');
  assert.equal(await c1p.janela.inputValue('.compra [data-f=parcela]'), '155,09', 'a parcela digitada continua 155,09');
  assert.equal(await c1p.janela.locator('.compra .box').count(), 3);
  await c1p.janela.fill('.compra [data-f=total]', '465,28'); await c1p.janela.press('.compra [data-f=total]', 'Enter');
  await c1p.janela.waitForFunction(() => /as parcelas somam/.test(document.querySelector('.compra .c-note').textContent));
  assert.equal(await c1p.janela.inputValue('.compra [data-f=parcela]'), '155,09', 'refazer o total recalcula a parcela: 465,28 ÷ 3');
  assert.match(semNbsp(await c1p.janela.textContent('.compra .c-note')), /as parcelas somam R\$ 465,27 \(total informado R\$ 465,28\)/, 'a diferença de 1 centavo é avisada');
  await c1p.app.close();
  passo('digitar a parcela primeiro e depois o número de parcelas: o total acompanha, a parcela digitada fica, e a diferença de centavos é avisada');

  /* ---------- trocar de pasta: se a nova não abre, a antiga continua valendo ---------- */
  const troca = await criarAmbiente();
  const tr = await troca.lancar();
  await tr.janela.waitForSelector('.compra', { timeout: 20000 });
  const arquivoRuim = path.join(troca.compartilhada, 'nao-e-pasta.txt'); fs.writeFileSync(arquivoRuim, 'x');
  const pastaBoa = path.join(require('os').tmpdir(), 'e2e-nova-' + Date.now()); fs.mkdirSync(pastaBoa);
  await tr.app.evaluate(({ dialog }, caminho) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [caminho] }); }, arquivoRuim);
  await tr.janela.click('#cfg-btn');
  await tr.janela.click('#cfg-pick');
  await tr.janela.waitForFunction(() => /Não foi possível abrir a pasta/.test(document.querySelector('#cfg-dir').textContent));
  assert.equal(JSON.parse(fs.readFileSync(path.join(troca.dadosDoPrograma, 'config.json'), 'utf8')).dataDir, troca.compartilhada, 'a pasta que funcionava continua guardada');
  assert.equal(await tr.janela.$eval('#cfg-close', b => b.disabled), false, 'a antiga ainda funciona, então dá para fechar');
  await tr.janela.click('#cfg-close');
  assert.equal(semNbsp(await tr.janela.textContent('#s-total')), 'R$ 1.311,31', 'os dados continuam na tela');
  await tr.app.evaluate(({ dialog }, caminho) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [caminho] }); }, pastaBoa);
  await tr.janela.click('#cfg-btn');
  await tr.janela.click('#cfg-pick');
  await tr.janela.waitForSelector('#empty:not([hidden])', { timeout: 20000 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(troca.dadosDoPrograma, 'config.json'), 'utf8')).dataDir, pastaBoa);
  assert.ok(fs.existsSync(path.join(pastaBoa, 'ContasAPagar', 'compras')), 'a nova pasta foi preparada');
  await tr.app.close();
  passo('trocar para uma pasta que não abre mantém a antiga; trocar para uma boa recarrega a tela já com a nova');

  /* ---------- "tentar de novo" depois de falhar ao salvar: sem duplicar serviço, nota nem leitura paga ---------- */
  const rt = await criarAmbiente({ semear: false });
  const rr = await rt.lancar();
  await rr.janela.waitForSelector('#empty:not([hidden])', { timeout: 20000 });
  rt.api.estado.resposta = { eh_comprovante: true, fornecedor: 'Loja Nova', descricao: 'tinta', valor_total: 300, parcelas: 2, forma_pagamento: 'credito', data_compra: '2026-10-20' };
  const comprasDir = path.join(rt.raiz, 'compras');
  fs.renameSync(comprasDir, comprasDir + '.fora'); fs.writeFileSync(comprasDir, 'bloqueado'); // a gravação das compras vai falhar
  await rr.janela.setInputFiles('#pick', path.join(process.env.FIXTURES || __dirname, 'nota.png'));
  await rr.janela.waitForSelector('.up-item.err', { timeout: 20000 });
  assert.match(await rr.janela.textContent('.up-item.err .up-state'), /não consegui salvar a compra/);
  fs.unlinkSync(comprasDir); fs.renameSync(comprasDir + '.fora', comprasDir); // a pasta volta
  await rr.janela.click('.up-item.err >> text=Tentar de novo');
  await rr.janela.waitForSelector('.up-item.done', { timeout: 20000 });
  const leituras = rt.api.pedidos.filter(p => p.body.messages && JSON.stringify(p.body.messages).includes('valor_total')).length;
  assert.equal(leituras, 1, 'a nota foi lida (e cobrada) uma vez só: ' + leituras);
  assert.equal(fs.readdirSync(path.join(rt.raiz, 'servicos')).filter(f => f.endsWith('.json')).length, 1, 'um serviço só, sem duplicata');
  assert.equal(fs.readdirSync(comprasDir).filter(f => f.endsWith('.json')).length, 1, 'uma compra só');
  assert.equal(fs.readdirSync(path.join(rt.raiz, 'notas')).length, 1, 'o arquivo da nota foi guardado uma vez só');
  await rr.app.close();
  passo('falhou ao salvar e a pessoa tentou de novo: a nota não foi lida outra vez, e não sobrou serviço, compra nem arquivo duplicado');

  const esperados = /Content Security Policy|Failed to load resource|ENOTDIR|unavailable|Não foi possível/;
  const todos = amb.erros.concat(amb2.erros, ruim.erros, dur.erros, calc.erros, troca.erros, rt.erros);
  assert.deepEqual(todos.filter(e => !esperados.test(e)), [], 'sem erros inesperados no console');
  ruim.fechar(); dur.fechar(); calc.fechar(); troca.fechar(); rt.fechar();
  amb.fechar(); amb2.fechar();
  console.log('\nROBUSTEZ OK.');
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
