'use strict';
// Acessibilidade e design: auditoria automática (axe-core, WCAG 2.1 AA) em vários estados e nos dois temas,
// navegação só pelo teclado, zoom de 200% e capturas de tela para conferência visual.
// Rodar: xvfb-run -a node test/e2e/acessibilidade.js   (OUT=pasta para guardar as capturas)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const { criarAmbiente, passo } = require('./ajuda');

const FIX = process.env.FIXTURES || __dirname;
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-'));
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const espera = ms => new Promise(r => setTimeout(r, ms));

async function auditar(win, nome, { plantar = false } = {}) {
  await win.evaluate(AXE);
  const r = await win.evaluate(async plantar => {
    let plantado = null;
    if (plantar) { plantado = document.createElement('img'); plantado.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; plantado.id = 'plantado'; document.querySelector('main').append(plantado); }
    const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations', 'passes'] });
    if (plantado) plantado.remove();
    return {
      passes: res.passes.length,
      violacoes: res.violations.map(v => ({ id: v.id, impacto: v.impact, ajuda: v.help, nos: v.nodes.length, exemplos: v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' :: ' + (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 220)) }))
    };
  }, plantar);
  assert.ok(r.passes > 20, 'a auditoria realmente rodou: ' + r.passes + ' regras verificadas');
  return r.violacoes.map(v => ({ ...v, estado: nome }));
}

(async () => {
  const amb = await criarAmbiente();
  const { app, janela: win } = await amb.lancar();
  await win.setViewportSize({ width: 1200, height: 900 });
  await win.waitForSelector('.compra');
  const achados = [];

  // Prova de que a auditoria funciona: uma imagem sem texto alternativo, plantada de propósito, precisa ser acusada.
  const prova = await auditar(win, 'prova', { plantar: true });
  assert.ok(prova.some(v => v.id === 'image-alt'), 'o axe deveria acusar a imagem sem alt plantada: ' + JSON.stringify(prova.map(v => v.id)));
  assert.equal(prova.length, 1, 'e só ela: ' + JSON.stringify(prova.map(v => v.id)));
  passo('a auditoria detecta uma violação plantada (imagem sem texto alternativo), então o "nenhuma violação" abaixo vale');

  // deixa a tela cheia de coisas: nota lida (com conferência), fila de envio com sucesso e erro
  amb.api.estado.resposta = { eh_comprovante: true, fornecedor: 'Casa do Pedreiro', descricao: 'cimento e argamassa', valor_total: 1234.56, parcelas: 3, valor_parcela: 411.52, data_compra: '2026-10-20', forma_pagamento: 'credito', confianca: 'baixa', observacao: 'O total estava parcialmente apagado.' };
  await win.setInputFiles('#pick', path.join(FIX, 'nota.png'));
  await win.waitForSelector('.up-item.done', { timeout: 20000 });
  amb.api.estado.resposta = { eh_comprovante: false };
  await win.setInputFiles('#pick', path.join(FIX, 'nota.png'));
  await win.waitForSelector('.up-item.err', { timeout: 20000 });
  await win.click('[data-compra=c1] .box[data-i="0"]');
  await espera(400);

  for (const tema of ['light', 'dark']) {
    await win.emulateMedia({ colorScheme: tema, reducedMotion: 'reduce' });
    await espera(200);
    await win.screenshot({ path: path.join(OUT, `tela-${tema}.png`), fullPage: true });
    achados.push(...await auditar(win, 'tela principal (' + tema + ')'));
    await win.click('#cfg-btn');
    await win.waitForSelector('dialog#cfg[open]');
    await win.screenshot({ path: path.join(OUT, `configuracoes-${tema}.png`) });
    achados.push(...await auditar(win, 'configurações (' + tema + ')'));
    await win.click('#cfg-close');
  }
  await win.emulateMedia({ colorScheme: 'light' });

  /* ---------- só pelo teclado ---------- */
  await win.reload(); await win.waitForSelector('.compra');
  await win.evaluate(() => document.activeElement && document.activeElement.blur());
  const paradas = [];
  for (let i = 0; i < 40; i++) {
    await win.keyboard.press('Tab');
    paradas.push(await win.evaluate(() => {
      const el = document.activeElement; if (!el || el === document.body) return null;
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      const rotulo = el.getAttribute('aria-label') || el.labels && el.labels[0] && el.labels[0].textContent.trim() || el.textContent.trim().slice(0, 30) || el.id || el.tagName;
      return { tag: el.tagName, rotulo, visivel: r.width > 0 && r.height > 0, anel: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 || (cs.boxShadow && cs.boxShadow !== 'none') };
    }));
  }
  const reais = paradas.filter(Boolean);
  assert.ok(reais.length >= 30, 'o Tab percorre os controles (' + reais.length + ' paradas)');
  const semAnel = reais.filter(p => !p.anel || !p.visivel);
  assert.deepEqual(semAnel, [], 'todo controle com foco mostra um anel visível: ' + JSON.stringify(semAnel.slice(0, 3)));
  passo('Tab percorre ' + reais.length + ' controles e todos mostram anel de foco visível');

  // marcar parcela com teclado (Espaço e Enter) e abrir/fechar configurações sem mouse
  await win.focus('[data-compra=c2] .box[data-i="1"]');
  await win.keyboard.press('Space');
  await espera(400);
  assert.equal(await win.getAttribute('[data-compra=c2] .box[data-i="1"]', 'aria-pressed'), 'true');
  await win.keyboard.press('Enter');
  await espera(400);
  assert.equal(await win.getAttribute('[data-compra=c2] .box[data-i="1"]', 'aria-pressed'), 'false');
  await win.focus('#cfg-btn'); await win.keyboard.press('Enter');
  await win.waitForSelector('dialog#cfg[open]');
  const focoNoDialogo = await win.evaluate(() => document.querySelector('dialog#cfg').contains(document.activeElement));
  assert.equal(focoNoDialogo, true, 'ao abrir as configurações o foco vai para dentro delas');
  await win.keyboard.press('Escape');
  assert.equal(await win.evaluate(() => document.querySelector('dialog#cfg').open), false, 'Esc fecha as configurações (quando a pasta já foi escolhida)');
  passo('parcela marcada e desmarcada com Espaço/Enter; configurações abrem com o foco dentro e fecham com Esc');

  /* ---------- zoom (texto maior) ---------- */
  for (const zoom of [1.5, 2]) {
    await app.evaluate(({ BrowserWindow }, z) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(z), zoom);
    await espera(400);
    const m = await win.evaluate(() => ({ rolagem: document.documentElement.scrollWidth - document.documentElement.clientWidth, largura: innerWidth }));
    assert.ok(m.rolagem <= 1, `zoom ${zoom * 100}%: não há rolagem horizontal (sobra ${m.rolagem}px, largura ${m.largura}px)`);
    await win.screenshot({ path: path.join(OUT, `zoom-${zoom * 100}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  passo('com zoom de 150% e 200% a tela não ganha rolagem horizontal');

  // contraste dos textos pequenos (muted) nos dois temas, calculado direto das cores finais
  const contrastes = await win.evaluate(() => {
    const lum = c => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const fundo = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return 'rgb(255,255,255)'; };
    const alvo = ['.eyebrow', '.fig .lab', '.when span', '.fld', '.pc small', '.muted', '.save', '.c-note', '.svc-figs', '.up-target'];
    return alvo.map(sel => { const el = document.querySelector(sel); if (!el) return null; const a = lum(getComputedStyle(el).color), b = lum(fundo(el)); return { sel, razao: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }; }).filter(Boolean);
  });
  for (const c of contrastes) assert.ok(c.razao >= 4.5, c.sel + ' tem contraste ' + c.razao.toFixed(2));
  passo('textos secundários têm contraste mínimo de ' + Math.min(...contrastes.map(c => c.razao)).toFixed(1) + ':1 (exigido 4,5:1)');

  /* ---------- estados vazios e primeira abertura ---------- */
  await app.close();
  const vazio = await criarAmbiente({ semear: false });
  const e1 = await vazio.lancar();
  await e1.janela.setViewportSize({ width: 1200, height: 900 });
  await e1.janela.waitForSelector('#empty:not([hidden])', { timeout: 20000 });
  await e1.janela.screenshot({ path: path.join(OUT, 'vazio-light.png'), fullPage: true });
  achados.push(...await auditar(e1.janela, 'sem nenhum serviço'));
  await e1.janela.emulateMedia({ colorScheme: 'dark' });
  await e1.janela.screenshot({ path: path.join(OUT, 'vazio-dark.png'), fullPage: true });
  await e1.app.close();

  const novo = await criarAmbiente({ semear: false, comChave: false });
  fs.writeFileSync(path.join(novo.dadosDoPrograma, 'config.json'), '{}');
  const e2 = await novo.lancar();
  await e2.janela.setViewportSize({ width: 1200, height: 900 });
  await e2.janela.waitForSelector('dialog#cfg[open]', { timeout: 20000 });
  await e2.janela.screenshot({ path: path.join(OUT, 'primeira-vez-light.png') });
  achados.push(...await auditar(e2.janela, 'primeira abertura (escolher pasta)'));
  await e2.janela.emulateMedia({ colorScheme: 'dark' });
  await e2.janela.screenshot({ path: path.join(OUT, 'primeira-vez-dark.png') });
  await e2.app.close();
  vazio.fechar(); novo.fechar(); amb.fechar();

  /* ---------- resultado da auditoria ---------- */
  fs.writeFileSync(path.join(OUT, 'axe.json'), JSON.stringify(achados, null, 2));
  if (achados.length) {
    console.log('\nAXE: ' + achados.length + ' problema(s):');
    for (const a of achados) console.log(` - [${a.impacto}] ${a.id} (${a.estado}, ${a.nos} elemento(s)): ${a.ajuda}\n     ${a.exemplos.join('\n     ')}`);
    process.exit(1);
  }
  passo('axe-core (WCAG 2.1 AA + boas práticas): nenhuma violação em 8 estados (principal, configurações, vazio e primeira abertura, nos dois temas)');
  console.log('\nACESSIBILIDADE OK. Capturas em ' + OUT);
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
