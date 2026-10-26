'use strict';
// Roda todos os testes completos (com o programa aberto de verdade), um por vez, e resume o resultado.
// Linux: xvfb-run -a node test/e2e/todos.js     (OUT=pasta para as capturas de tela)
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-todos-'));
fs.mkdirSync(OUT, { recursive: true });
const suites = [
  ['funcional', 'uso normal: dados, parcelas, outro computador, foto, PDF, erros, configurações'],
  ['seguranca', 'ataques: IPC, protocolo, política de conteúdo, navegação, permissões, chave, limite'],
  ['robustez', 'dados hostis, 300 compras, edição simultânea, exclusões'],
  ['acessibilidade', 'axe-core, teclado, zoom, contraste e capturas dos dois temas']
];

const resumo = [];
for (const [nome, descricao] of suites) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, nome + '.js')], {
    stdio: 'inherit', env: { ...process.env, OUT: path.join(OUT, nome), FIXTURES: process.env.FIXTURES || __dirname }
  });
  resumo.push({ nome, descricao, ok: r.status === 0, segundos: ((Date.now() - t0) / 1000).toFixed(0) });
  if (r.status !== 0 && !process.env.CONTINUAR) break;
}
console.log('\n=== Resumo dos testes completos ===');
for (const r of resumo) console.log((r.ok ? 'PASSOU  ' : 'FALHOU  ') + r.nome.padEnd(15) + r.segundos.padStart(4) + ' s  ' + r.descricao);
fs.writeFileSync(path.join(OUT, 'resumo.json'), JSON.stringify(resumo, null, 2));
process.exit(resumo.length === suites.length && resumo.every(r => r.ok) ? 0 : 1);
