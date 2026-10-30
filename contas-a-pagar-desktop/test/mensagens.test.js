'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mensagemDeNota, mensagemDeChave, mensagemDeExportacao, PEDE_CONFIGURACAO } = require('../renderer/lib/mensagens');

test('todo erro que o envio de nota pode gerar tem texto próprio, em português e sem jargão', () => {
  const codigos = ['sem_chave', 'chave_invalida', 'sem_saldo', 'sem_internet', 'sem_pasta', 'rate_limited', 'image_rejected', 'img', 'too_large', 'sem_gravar', 'pdf', 'nao_nota', 'invalid_json', 'refused', 'empty_completion'];
  const vistos = new Set();
  for (const code of codigos) {
    const t = mensagemDeNota({ code });
    assert.ok(t && t.length > 15, code);
    assert.ok(!/undefined|\[object|Error|sampling|upstream/i.test(t), code + ': ' + t);
    vistos.add(t);
  }
  assert.ok(vistos.size >= 10, 'textos diferentes para problemas diferentes');
});

test('códigos desconhecidos, nulos e perigosos caem na mensagem padrão', () => {
  const padrao = mensagemDeNota({ code: 'qualquer_coisa' });
  for (const e of [null, undefined, {}, { code: null }, { code: '__proto__' }, { code: 'constructor' }, { code: 'toString' }, 'texto', 42]) {
    assert.equal(mensagemDeNota(e), padrao, JSON.stringify(e));
  }
});

test('erros que mandam abrir as configurações', () => {
  assert.deepEqual([...PEDE_CONFIGURACAO].sort(), ['chave_invalida', 'sem_chave', 'sem_pasta']);
});

test('mensagens da chave', () => {
  assert.match(mensagemDeChave({ code: 'chave_formato' }, 'x'), /sk-ant-/);
  assert.match(mensagemDeChave({ code: 'sem_saldo' }, 'x'), /saldo/);
  assert.equal(mensagemDeChave({ code: 'outro' }, 'padrão'), 'padrão');
  assert.equal(mensagemDeChave({ code: '__proto__' }, 'padrão'), 'padrão');
});

test('mensagens da exportação para planilha', () => {
  assert.match(mensagemDeExportacao({ code: 'sem_pasta' }), /pasta de dados/);
  assert.match(mensagemDeExportacao({ code: 'sem_gravar_planilha' }), /outra pasta/);
  const padrao = mensagemDeExportacao(null);
  assert.match(padrao, /exportar/);
  for (const e of [undefined, {}, { code: '__proto__' }, { code: 'constructor' }, { code: 'toString' }, 'texto', 42, { code: 'upstream_error', message: 'EACCES: /home/x/segredo' }]) {
    assert.equal(mensagemDeExportacao(e), padrao, JSON.stringify(e));
  }
});
