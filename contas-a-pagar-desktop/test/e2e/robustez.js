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

  assert.deepEqual(amb.erros.concat(amb2.erros), [], 'sem erros no console');
  amb.fechar(); amb2.fechar();
  console.log('\nROBUSTEZ OK.');
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
