# Contas a Pagar (programa para computador)

Controle das compras parceladas no cartão da empresa. Funciona no Windows e no Mac, e vários computadores
usam os mesmos dados ao mesmo tempo.

- Cada **serviço** tem suas **compras**; cada compra tem **parcelas** que você marca como pagas.
- O resumo mostra o total, quanto já foi pago, quanto falta e **o valor de cada mês**.
- **Enviar nota**: você escolhe a foto (ou o PDF) da nota e o programa lê o valor e as parcelas e já cria a compra.
  A compra nasce marcada como "Lido da nota. Confira antes de pagar", com a miniatura da nota.

## Instalar

1. No GitHub do projeto, abra **Actions > Contas a Pagar - gerar instaladores** e baixe o instalador
   (ou, se existir, baixe em **Releases**).
2. **Windows**: abra `ContasAPagar-Instalador-….exe`. Como o instalador não tem assinatura paga, o Windows pode mostrar
   "O Windows protegeu o computador": clique em **Mais informações** e depois em **Executar assim mesmo**.
3. **Mac**: abra o `.dmg` e arraste o programa para Aplicativos. Se o Mac bloquear, clique com o botão direito no
   programa e escolha **Abrir**. (A versão do Mac ainda não foi testada em um Mac de verdade.)

Para atualizar, instale a versão nova por cima. Os dados não se perdem.

## Primeira vez em cada computador

O programa abre pedindo duas coisas, em **Configurações**:

1. **Pasta de dados**: escolha uma pasta que os computadores já sincronizam (OneDrive, Google Drive ou Dropbox).
   Todos escolhem a **mesma pasta compartilhada**. O programa cria dentro dela a subpasta `ContasAPagar`.
   Quando alguém altera algo, a mudança aparece nos outros computadores assim que o serviço de sincronização
   entregar o arquivo (em geral, segundos).
2. **Chave da API do Claude** (só para ler notas): crie uma conta em console.anthropic.com, adicione créditos,
   crie uma chave em *Settings > API Keys* e cole no programa. A chave fica guardada só naquele computador,
   criptografada pelo sistema, e nunca vai para a pasta compartilhada. Cada pessoa que for enviar notas
   precisa informar uma chave (pode ser a mesma). Sem a chave, tudo funciona, só não há leitura automática.

O modelo padrão é o **Claude Opus 5.5**, o mais preciso. Em Configurações dá para trocar por um mais barato.
A leitura é cobrada na conta da Anthropic, em geral poucos centavos de dólar por nota.

## Dados e segurança

- Os dados ficam em arquivos na pasta compartilhada: `servicos/`, `compras/` e `notas/` (fotos e PDFs originais).
  Cada compra é um arquivo, então duas pessoas editando compras diferentes nunca se atrapalham. Se duas pessoas
  editarem **a mesma compra no mesmo instante**, vale a última gravação.
- O histórico de versões do OneDrive, do Google Drive ou do Dropbox serve de **backup**.
- Ao enviar uma nota, a imagem é enviada para a API do Claude (Anthropic) para ser lida. Nada mais sai do computador.

## Para quem for mexer no código

```
npm ci
npm start            # abre o programa
npm test             # testes do núcleo (pasta de dados, configurações, leitura de notas)
npx electron-builder --publish never   # gera o instalador do sistema em que estiver rodando
```

- `lib/store.js`: dados em arquivos. `lib/claude.js`: leitura de notas com o SDK oficial. `lib/config.js`: configurações.
- `main.js` / `preload.js`: janela e ponte segura. `renderer/`: a tela. `renderer/shim.js` liga a tela à pasta e à API.
- Teste completo com o programa aberto de verdade (precisa de tela virtual no Linux e do pacote `playwright`):
  `xvfb-run -a node test/e2e/run.js`. Para testar o programa já empacotado, defina `APP_EXE`.
