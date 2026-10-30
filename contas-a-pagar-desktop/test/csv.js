'use strict';
// Leitor de CSV com ponto e vírgula, só para os testes: confere que o arquivo gerado volta ao que foi escrito.
const assert = require('node:assert/strict');

function ler(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ';') { linha.push(campo); campo = ''; }
    else if (ch === '\r' && texto[i + 1] === '\n') { linha.push(campo); linhas.push(linha); campo = ''; linha = []; i++; }
    else campo += ch;
  }
  assert.equal(aspas, false, 'aspas abertas no fim do arquivo');
  assert.equal(campo, '', 'o arquivo termina com quebra de linha');
  assert.deepEqual(linha, []);
  return linhas;
}

module.exports = { ler };
