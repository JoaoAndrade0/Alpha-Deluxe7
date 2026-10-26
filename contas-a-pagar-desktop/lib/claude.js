'use strict';
// Leitura de notas pela API do Claude (SDK oficial). Recebe as imagens da nota e devolve o JSON lido.

const Anthropic = require('@anthropic-ai/sdk');

// Estes dois modelos aceitam o reenvio automático para outro modelo quando uma
// requisição é recusada pelos filtros de segurança. O Haiku 5.5 não tem esse reenvio.
const WITH_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function makeClient(apiKey, opcoes = {}) {
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 180000, ...opcoes });
}

// Aceita o JSON puro, dentro de um bloco ``` ou cercado por uma frase.
function extractJson(text) {
  const s = String(text || '').trim();
  const tries = [s];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) tries.push(fence[1].trim());
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(s.slice(a, b + 1));
  for (const t of tries) {
    try { return JSON.parse(t); } catch (e) { /* tenta o próximo */ }
  }
  throw fail('invalid_json', 'A resposta não veio em JSON.');
}

function mapError(e, signal) {
  if (e && e.code && !(e instanceof Anthropic.APIError)) return e; // já é um dos nossos
  if ((signal && signal.aborted) || e instanceof Anthropic.APIUserAbortError) return fail('cancelled', 'Cancelado.');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return fail('chave_invalida', 'A chave da API não foi aceita.');
  if (e instanceof Anthropic.RateLimitError) return fail('rate_limited', 'Limite de uso atingido.');
  if (e instanceof Anthropic.APIConnectionError) return fail('sem_internet', 'Sem conexão com a internet.');
  if (e instanceof Anthropic.BadRequestError) {
    // A API não tem um código próprio para saldo esgotado: ele vem como erro 400 com esta mensagem.
    if (/credit balance|billing/i.test(String(e.message))) return fail('sem_saldo', 'Sem saldo na conta da API.');
    if (/image/i.test(String(e.message))) return fail('image_rejected', 'A imagem não foi aceita.');
    return fail('invalid_request', String(e.message));
  }
  if (e instanceof Anthropic.APIError) return fail('upstream_error', String(e.message));
  return fail('upstream_error', String((e && e.message) || e));
}

function textOf(response) {
  return (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// images: [{media_type, data(base64)}]
async function lerNota({ apiKey, model, prompt, images, signal, client }) {
  if (!client && !apiKey) throw fail('sem_chave', 'Falta a chave da API.');
  const c = client || makeClient(apiKey);
  const content = [
    ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } })),
    { type: 'text', text: prompt }
  ];
  const body = { model, max_tokens: 16000, messages: [{ role: 'user', content }] };
  try {
    const response = WITH_FALLBACK.has(model)
      ? await c.beta.messages.create({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
      : await c.messages.create(body, { signal });
    if (response.stop_reason === 'refusal') throw fail('refused', 'O Claude recusou ler este arquivo.');
    return extractJson(textOf(response));
  } catch (e) {
    throw mapError(e, signal);
  }
}

// Chamada mínima só para saber se a chave funciona.
async function testarChave({ apiKey, model, client }) {
  if (!client && !apiKey) throw fail('sem_chave', 'Falta a chave da API.');
  // O teste é só para saber se a chave abre a porta: resposta rápida, sem tentativas repetidas.
  const c = client || makeClient(apiKey, { maxRetries: 0, timeout: 30000 });
  try {
    await c.messages.create({ model, max_tokens: 64, messages: [{ role: 'user', content: 'Responda apenas: ok' }] });
    return true;
  } catch (e) {
    throw mapError(e);
  }
}

module.exports = { lerNota, testarChave, extractJson, mapError, WITH_FALLBACK };
