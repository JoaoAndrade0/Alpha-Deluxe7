'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Anthropic = require('@anthropic-ai/sdk');
const { lerNota, testarChave, extractJson, mapError } = require('../lib/claude');

const IMGS = [{ media_type: 'image/jpeg', data: 'AAAA' }];
const reply = (text, extra = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }], ...extra });
function fakeClient(fn) {
  const calls = [];
  const rec = kind => async (body, opts) => { calls.push({ kind, body, opts }); return fn(body, kind); };
  return { calls, messages: { create: rec('std') }, beta: { messages: { create: rec('beta') } } };
}

test('extractJson aceita JSON puro, em bloco de código e cercado por texto', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('Segue: {"a":3} pronto.'), { a: 3 });
  assert.throws(() => extractJson('sem json'), { code: 'invalid_json' });
});

test('Opus 5.5: envia imagem em base64, texto e reenvio automático por recusa', async () => {
  const c = fakeClient(() => reply('{"valor_total": 10}'));
  const out = await lerNota({ apiKey: 'k', model: 'claude-opus-5-5', prompt: 'leia', images: IMGS, client: c });
  assert.deepEqual(out, { valor_total: 10 });
  const call = c.calls[0];
  assert.equal(call.kind, 'beta');
  assert.deepEqual(call.body.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(call.body.fallbacks, 'default');
  assert.equal(call.body.model, 'claude-opus-5-5');
  assert.equal(call.body.thinking, undefined, 'o pensamento não pode ser desligado neste modelo');
  assert.equal(call.body.temperature, undefined);
  const content = call.body.messages[0].content;
  assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
  assert.deepEqual(content[1], { type: 'text', text: 'leia' });
});

test('Haiku 5.5 não usa reenvio automático', async () => {
  const c = fakeClient(() => reply('{"ok":true}'));
  await lerNota({ model: 'claude-haiku-5-5', prompt: 'p', images: IMGS, client: c });
  assert.equal(c.calls[0].kind, 'std');
  assert.equal(c.calls[0].body.fallbacks, undefined);
});

test('recusa e resposta fora do formato viram erros claros', async () => {
  const refuse = fakeClient(() => reply('', { stop_reason: 'refusal' }));
  await assert.rejects(lerNota({ model: 'claude-opus-5-5', prompt: 'p', images: IMGS, client: refuse }), { code: 'refused' });
  const junk = fakeClient(() => reply('não sei'));
  await assert.rejects(lerNota({ model: 'claude-opus-5-5', prompt: 'p', images: IMGS, client: junk }), { code: 'invalid_json' });
  await assert.rejects(lerNota({ model: 'claude-opus-5-5', prompt: 'p', images: IMGS }), { code: 'sem_chave' });
});

test('mapeia erros da API para códigos que a tela entende', () => {
  const h = new Headers();
  const mk = (Cls, status, msg) => new Cls(status, { type: 'error', error: { type: 'x', message: msg } }, msg, h);
  assert.equal(mapError(mk(Anthropic.AuthenticationError, 401, 'invalid x-api-key')).code, 'chave_invalida');
  assert.equal(mapError(mk(Anthropic.RateLimitError, 429, 'slow down')).code, 'rate_limited');
  assert.equal(mapError(mk(Anthropic.BadRequestError, 400, 'Your credit balance is too low')).code, 'sem_saldo');
  assert.equal(mapError(mk(Anthropic.BadRequestError, 400, 'Could not process image')).code, 'image_rejected');
  assert.equal(mapError(mk(Anthropic.InternalServerError, 500, 'boom')).code, 'upstream_error');
  assert.equal(mapError(new Anthropic.APIConnectionError({ message: 'x' })).code, 'sem_internet');
  const ctl = new AbortController(); ctl.abort();
  assert.equal(mapError(new Error('x'), ctl.signal).code, 'cancelled');
});

test('testarChave: sucesso e chave inválida', async () => {
  const ok = fakeClient(() => reply('ok'));
  assert.equal(await testarChave({ model: 'claude-opus-5-5', client: ok }), true);
  const h = new Headers();
  const bad = fakeClient(() => { throw new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', h); });
  await assert.rejects(testarChave({ model: 'claude-opus-5-5', client: bad }), { code: 'chave_invalida' });
});

// ---- SDK de verdade, contra um servidor local: confere o que realmente sai pela rede ----
const http = require('node:http');
function servidorLocal(resposta) {
  const pedidos = [];
  const server = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', c => { corpo += c; });
    req.on('end', () => {
      pedidos.push({ metodo: req.method, url: req.url, headers: req.headers, body: JSON.parse(corpo || '{}') });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(resposta));
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, pedidos, base: 'http://127.0.0.1:' + server.address().port })));
}
const mensagem = texto => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'm', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: texto }], usage: { input_tokens: 1, output_tokens: 1 } });

test('pela rede: Opus 5.5 vai ao endpoint beta com a chave, o cabeçalho de reenvio e sem parâmetros removidos', async () => {
  const s = await servidorLocal(mensagem('{"ok":true}'));
  const antes = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = s.base;
  try {
    const out = await lerNota({ apiKey: 'sk-ant-api03-' + 'k'.repeat(40), model: 'claude-opus-5-5', prompt: 'leia', images: IMGS });
    assert.deepEqual(out, { ok: true });
    const p = s.pedidos[0];
    assert.equal(p.metodo, 'POST');
    assert.equal(p.url, '/v1/messages?beta=true');
    assert.equal(p.headers['x-api-key'], 'sk-ant-api03-' + 'k'.repeat(40));
    assert.equal(p.headers['anthropic-version'], '2023-06-01');
    assert.match(p.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(p.body.fallbacks, 'default');
    for (const proibido of ['temperature', 'top_p', 'top_k', 'thinking', 'budget_tokens', 'tool_choice']) assert.equal(p.body[proibido], undefined, proibido + ' não pode ser enviado a este modelo');
    assert.equal(p.body.max_tokens, 16000);
    assert.equal(p.body.messages.length, 1);
    assert.ok(!JSON.stringify(p.headers).includes('authorization'), 'a chave vai só em x-api-key');
  } finally { if (antes === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = antes; s.server.close(); }
});

test('pela rede: Haiku 5.5 usa o endpoint comum, sem reenvio automático', async () => {
  const s = await servidorLocal(mensagem('{"ok":1}'));
  const antes = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = s.base;
  try {
    await lerNota({ apiKey: 'sk-ant-api03-' + 'k'.repeat(40), model: 'claude-haiku-5-5', prompt: 'leia', images: IMGS });
    const p = s.pedidos[0];
    assert.equal(p.url, '/v1/messages');
    assert.equal(p.headers['anthropic-beta'], undefined);
    assert.equal(p.body.fallbacks, undefined);
  } finally { if (antes === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = antes; s.server.close(); }
});

test('cancelar no meio devolve "cancelled" e não deixa o pedido pendurado', async () => {
  const server = http.createServer(() => { /* nunca responde */ });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const antes = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + server.address().port;
  const ctl = new AbortController();
  try {
    const p = lerNota({ apiKey: 'sk-ant-api03-' + 'k'.repeat(40), model: 'claude-haiku-5-5', prompt: 'leia', images: IMGS, signal: ctl.signal });
    setTimeout(() => ctl.abort(), 150);
    await assert.rejects(p, { code: 'cancelled' });
  } finally { if (antes === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = antes; server.closeAllConnections(); server.close(); }
});

test('erros desconhecidos e já classificados passam como devem', () => {
  assert.equal(mapError(new Error('boom')).code, 'upstream_error');
  const nosso = Object.assign(new Error('x'), { code: 'sem_chave' });
  assert.equal(mapError(nosso), nosso);
  assert.equal(mapError('texto').code, 'upstream_error');
  const h = new Headers();
  assert.equal(mapError(new Anthropic.PermissionDeniedError(403, {}, 'negado', h)).code, 'chave_invalida');
});
