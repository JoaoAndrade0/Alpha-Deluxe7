'use strict';
// Textos de erro mostrados na tela. Um só lugar, para ficar fácil de revisar e de testar.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Contas = root.Contas || {}; Object.assign(root.Contas, factory()); }
})(globalThis, function () {
  const ERROS_DE_NOTA = {
    sem_chave: 'Falta a chave da API do Claude. Cole a chave em Configurações.',
    chave_invalida: 'A chave da API não foi aceita. Confira em Configurações.',
    sem_saldo: 'A conta da API está sem saldo. Adicione créditos em console.anthropic.com.',
    sem_internet: 'Sem conexão com a internet. Confira a rede e tente de novo.',
    sem_pasta: 'Escolha a pasta de dados em Configurações.',
    rate_limited: 'Muitas leituras em pouco tempo. Espere um pouco e tente de novo.',
    image_rejected: 'Não consegui abrir essa imagem. Envie JPG, PNG ou PDF.',
    img: 'Não consegui abrir essa imagem. Envie JPG, PNG ou PDF.',
    too_large: 'Esse arquivo é grande demais. Envie uma foto menor ou um PDF mais leve.',
    pdf: 'Não consegui abrir o PDF. Envie uma foto ou um print da nota.',
    sem_gravar: 'Li a nota, mas não consegui salvar a compra na pasta de dados. Confira a pasta e tente de novo: a nota não será lida (nem cobrada) outra vez.',
    nao_nota: 'Isso não parece uma nota, cupom ou comprovante.',
    invalid_json: 'Não consegui ler essa nota. Tente uma foto mais nítida, de frente e com a nota inteira.',
    refused: 'Não consegui ler essa nota. Tente uma foto mais nítida, de frente e com a nota inteira.',
    empty_completion: 'Não consegui ler essa nota. Tente uma foto mais nítida, de frente e com a nota inteira.'
  };
  const PADRAO_NOTA = 'Não foi possível ler essa nota agora. Tente de novo.';
  const mensagemDeNota = e => (e && Object.prototype.hasOwnProperty.call(ERROS_DE_NOTA, e.code) ? ERROS_DE_NOTA[e.code] : PADRAO_NOTA);

  // Erros que se resolvem em Configurações (a tela oferece o botão para abrir).
  const PEDE_CONFIGURACAO = ['sem_chave', 'chave_invalida', 'sem_pasta'];

  const ERROS_DE_CHAVE = {
    chave_invalida: 'A chave não foi aceita. Confira se copiou inteira.',
    chave_formato: 'Isso não parece uma chave da API do Claude. Ela começa com sk-ant-.',
    sem_saldo: 'A chave é válida, mas a conta da API está sem saldo. Adicione créditos em console.anthropic.com.',
    rate_limited: 'Limite de uso atingido. Tente de novo em instantes.',
    sem_internet: 'Sem conexão com a internet.'
  };
  const mensagemDeChave = (e, padrao) => (e && Object.prototype.hasOwnProperty.call(ERROS_DE_CHAVE, e.code) ? ERROS_DE_CHAVE[e.code] : padrao);

  return { mensagemDeNota, mensagemDeChave, PEDE_CONFIGURACAO };
});
