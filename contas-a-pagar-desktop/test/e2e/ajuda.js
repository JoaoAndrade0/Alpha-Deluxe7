'use strict';
// Peças comuns dos testes com o programa aberto de verdade: servidor que imita a API do Claude,
// pasta compartilhada de mentira com os dados do caderno e a abertura do programa.
const { _electron: electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const CHAVE_DE_TESTE = 'sk-ant-api03-' + 'T'.repeat(40);

async function iniciarApiFalsa() {
  const pedidos = [];
  const estado = { resposta: {}, falha: null };
  const server = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', c => { corpo += c; });
    req.on('end', () => {
      const json = JSON.parse(corpo || '{}');
      pedidos.push({ url: req.url, headers: req.headers, body: json });
      res.setHeader('content-type', 'application/json');
      if (estado.falha) { res.statusCode = estado.falha.status; res.end(JSON.stringify({ type: 'error', error: { type: estado.falha.tipo, message: estado.falha.msg } })); return; }
      res.end(JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: json.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify(estado.resposta) }], usage: { input_tokens: 10, output_tokens: 10 }
      }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, pedidos, estado, base: 'http://127.0.0.1:' + server.address().port };
}

// Os dados do caderno (serviço do Thayvson), como se outro computador já tivesse criado.
function semearCaderno(raiz) {
  for (const d of ['servicos', 'compras', 'notas']) fs.mkdirSync(path.join(raiz, d), { recursive: true });
  const grava = (c, id, d) => fs.writeFileSync(path.join(raiz, c, id + '.json'), JSON.stringify(d));
  grava('servicos', 'thayvson', { nome: 'Serviço do Thayvson (CMD)', ordem: 1 });
  [['c1', 13960, 2, 6980], ['c2', 46528, 3, 15509], ['c3', 22852, 4, 5713], ['c4', 47794, 4, 11948]].forEach(([id, t, p, v], i) =>
    grava('compras', id, { servicoId: 'thayvson', descricao: '', totalCents: t, parcelas: p, parcelaCents: v, inicio: '2026-11', pagas: {}, ordem: i + 1 }));
  return grava;
}

async function criarAmbiente({ comChave = true, semear = true } = {}) {
  const api = await iniciarApiFalsa();
  const compartilhada = tmp('e2e-shared-');
  const raiz = path.join(compartilhada, 'ContasAPagar');
  const grava = semear ? semearCaderno(raiz) : null;
  const dadosDoPrograma = tmp('e2e-user-');
  const config = { dataDir: compartilhada, model: 'claude-opus-5-5' };
  if (comChave) config.apiKeyPlain = CHAVE_DE_TESTE;
  fs.writeFileSync(path.join(dadosDoPrograma, 'config.json'), JSON.stringify(config));
  const erros = [];
  const lancar = async (ud = dadosDoPrograma) => {
    // APP_EXE: testa o programa já empacotado em vez do código-fonte.
    const app = await electron.launch({
      executablePath: process.env.APP_EXE || require(path.join(ROOT, 'node_modules', 'electron')),
      args: process.env.APP_EXE ? ['--no-sandbox', '--disable-gpu'] : [ROOT, '--no-sandbox', '--disable-gpu'], cwd: ROOT,
      env: { ...process.env, CONTAS_USER_DATA: ud, ANTHROPIC_BASE_URL: api.base }
    });
    const janela = await app.firstWindow();
    janela.on('pageerror', e => erros.push('pageerror: ' + e.message));
    janela.on('console', m => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
    return { app, janela };
  };
  return { api, compartilhada, raiz, grava, dadosDoPrograma, lancar, erros, fechar: () => api.server.close() };
}

const passo = nome => console.log('ok - ' + nome);
const semNbsp = s => String(s).replace(/ /g, ' ');

module.exports = { ROOT, tmp, criarAmbiente, semearCaderno, passo, semNbsp, CHAVE_DE_TESTE };
