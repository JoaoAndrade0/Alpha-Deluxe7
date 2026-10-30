'use strict';
// A ponte da tela (renderer/ponte.js) carregada num ambiente simulado: cancelar a leitura de uma nota
// precisa funcionar também enquanto as imagens ainda estão sendo preparadas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function carregar() {
  const chamadas = [];
  const ouvintes = {};
  const sandbox = {
    window: { desktop: { invoke: async (canal, ...args) => { chamadas.push([canal, ...args]); return { ok: true, value: canal === 'nota:ler' ? { totalCents: 100 } : true }; }, on: (c, f) => { ouvintes[c] = f; } } },
    crypto: { randomUUID: (() => { let n = 0; return () => 'id-' + (++n) + '-aaaa-bbbb-cccc-dddddddddddd'; })() },
    structuredClone, setTimeout, Promise, Map, Object, String, Error,
    FileReader: class { readAsDataURL(blob) { setTimeout(() => this.onload && ((this.result = 'data:' + (blob.type || '') + ';base64,QUJD'), this.onload()), blob.atraso || 0); } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ponte.js'), 'utf8'), sandbox);
  return { ponte: sandbox.window.Contas.ponte, chamadas, ouvintes };
}
const imagem = (atraso = 0) => ({ type: 'image/jpeg', atraso });
const plano = x => JSON.parse(JSON.stringify(x)); // objetos criados dentro do ambiente simulado têm outro "prototype"
const chamadasDaNota = chamadas => chamadas.filter(c => c[0] !== 'config:get'); // a ponte já pergunta a configuração ao carregar

test('lerNota: envia as imagens em base64 e devolve o resultado do programa', async () => {
  const { ponte, chamadas } = carregar();
  const r = await ponte.lerNota([imagem(), imagem()]);
  assert.deepEqual(plano(r), { totalCents: 100 });
  const [canal, pedido] = chamadas.find(c => c[0] === 'nota:ler');
  assert.equal(canal, 'nota:ler');
  assert.equal(pedido.images.length, 2);
  assert.deepEqual(plano(pedido.images[0]), { media_type: 'image/jpeg', data: 'QUJD' });
  assert.match(pedido.reqId, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(Object.keys(pedido).sort(), ['images', 'reqId'], 'a tela só envia imagens: nenhum texto de pedido');
});

test('cancelar ANTES de começar não envia nada', async () => {
  const { ponte, chamadas } = carregar();
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(ponte.lerNota([imagem()], ctl.signal), { code: 'cancelled' });
  assert.equal(chamadasDaNota(chamadas).length, 0);
});

test('cancelar ENQUANTO as imagens são preparadas não envia o pedido pago', async () => {
  const { ponte, chamadas } = carregar();
  const ctl = new AbortController();
  const p = ponte.lerNota([imagem(60), imagem(120)], ctl.signal);
  setTimeout(() => ctl.abort(), 30); // a conversão ainda está em andamento
  await assert.rejects(p, { code: 'cancelled' });
  assert.equal(chamadas.some(c => c[0] === 'nota:ler'), false, 'o pedido ao Claude não pode sair');
  assert.equal(chamadas.some(c => c[0] === 'nota:cancel'), true, 'o programa é avisado do cancelamento');
});

test('depois de terminar, cancelar não faz mais nada (o ouvinte foi removido)', async () => {
  const { ponte, chamadas } = carregar();
  const ctl = new AbortController();
  await ponte.lerNota([imagem()], ctl.signal);
  ctl.abort();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(chamadas.filter(c => c[0] === 'nota:cancel').length, 0);
});

test('exportar planilha: pede ao programa sem mandar nada (nem caminho) e devolve o resultado', async () => {
  const { ponte, chamadas } = carregar();
  const r = await ponte.exportarPlanilha();
  assert.equal(r, true);
  assert.deepEqual(chamadas.filter(c => c[0] === 'export:csv'), [['export:csv']], 'a tela não manda argumento nenhum: quem escolhe o lugar é o programa');
});
