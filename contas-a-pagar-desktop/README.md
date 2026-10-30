# Contas a Pagar (programa para computador)

Controle das compras parceladas no cartão da empresa. Funciona no Windows e no Mac, e vários computadores
usam os mesmos dados ao mesmo tempo.

- Cada **serviço** tem suas **compras**; cada compra tem **parcelas** que você marca como pagas.
- O resumo mostra o total, quanto já foi pago, quanto falta e **o valor de cada mês**.
- **Enviar nota**: você escolhe a foto (ou o PDF) da nota e o programa lê o valor e as parcelas e já cria a compra.
  A compra nasce marcada como "Lido da nota. Confira antes de pagar", com a miniatura da nota.
- **Exportar planilha**: um arquivo CSV com uma linha por parcela, para mandar ao contador (veja abaixo).

Relatório completo do projeto (estrutura, design, segurança e testes): [docs/RELATORIO.md](docs/RELATORIO.md).

## Instalar

1. No GitHub do projeto, abra **Actions > Contas a Pagar - testes e instaladores**, entre na execução mais recente
   (com ✓ verde) e baixe o arquivo em **Artifacts**: `instalador-windows` ou `instalador-mac`.
   Quando existir uma publicação em **Releases**, baixe de lá (inclui o `SHA256SUMS.txt` para conferir o download).
2. **Windows**: abra `ContasAPagar-Instalador-….exe`. Como o instalador não tem assinatura paga, o Windows pode mostrar
   "O Windows protegeu o computador": clique em **Mais informações** e depois em **Executar assim mesmo**.
3. **Mac**: abra o `.dmg` (arm64 para Macs com chip Apple, x64 para os Intel) e arraste o programa para Aplicativos.
   Se o Mac bloquear, clique com o botão direito no programa e escolha **Abrir**.

Para atualizar, instale a versão nova por cima. Os dados não se perdem: ficam na pasta compartilhada, não no programa.

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
Por segurança, o programa não faz mais de 30 leituras em 10 minutos.

## Como as contas são calculadas

- O valor que você **digitou por último** (total ou parcela) é o que manda. Se digitou a parcela do cartão
  (155,09) e depois mudou para 3 parcelas, o total vira 465,27 e a parcela continua 155,09. Se digitou o total
  (465,28), a parcela é o total dividido pelas parcelas; a diferença de centavos aparece como aviso.
- Parcelas de compra no crédito entram a partir do **mês seguinte** à compra. Pix, débito e dinheiro entram no
  mês da compra. Dá para ajustar em "1ª parcela em".
- Meses anteriores ao atual, com parcela em aberto, aparecem como "Atrasado".

## Planilha para o contador

Em **Mês a mês**, o botão **Exportar planilha** pergunta onde salvar e grava `contas-a-pagar-AAAA-MM-DD.csv`
(o botão só aparece quando há parcelas lançadas). O arquivo tem **uma linha por parcela**, em ordem de mês:

`Serviço; Compra; Nº da parcela; Total de parcelas; Mês; Valor da parcela (R$); Total da compra (R$); Situação; Data da compra; A conferir`

- **Situação** é Paga, Em aberto ou Atrasada (parcela de mês anterior ao atual que não foi paga). **A conferir** é "Sim" para
  compras lidas de uma nota que ninguém marcou como "Está certo".
- O formato é o brasileiro: campos separados por ponto e vírgula, vírgula nos centavos (`1234,56`) e acentos em UTF-8.
  Foi pensado para o Excel em português e para o Google Planilhas com localidade Brasil. Não testei num Excel de verdade;
  o que está testado é que o arquivo volta exatamente igual ao que foi escrito. Se o Excel estiver em inglês, importe o
  arquivo escolhendo ponto e vírgula como separador e o português do Brasil como localidade, senão `1234,56` pode ser lido como 123456.
- Nomes e descrições que começam com `=`, `+`, `-` ou `@` ganham um apóstrofo na frente. Uma nota com texto escondido
  não consegue colocar uma fórmula na planilha do seu contador.
- Só entram as compras que aparecem na tela (as de um serviço apagado ficam de fora). Quem escolhe onde gravar é você, na janela do
  sistema; a tela do programa não consegue gravar em outro lugar.

## Dados e segurança

- Os dados ficam em arquivos na pasta compartilhada: `servicos/`, `compras/` e `notas/` (fotos e PDFs originais).
  Cada compra é um arquivo, então duas pessoas editando compras diferentes nunca se atrapalham. Se duas pessoas
  editarem **a mesma compra no mesmo instante**, vale a última gravação.
- O histórico de versões do OneDrive, do Google Drive ou do Dropbox serve de **backup**.
- Ao enviar uma nota, a imagem é enviada para a API do Claude (Anthropic) para ser lida. Nada mais sai do computador.
  O programa não baixa nada ao abrir (fontes e leitor de PDF vêm dentro dele) e não faz conexões em segundo plano.
- Quem tem acesso à pasta compartilhada pode ler e alterar tudo. Dê acesso só a quem deve ter.
- Detalhes, ameaças consideradas e riscos que restam: [docs/RELATORIO.md](docs/RELATORIO.md#segurança).

## Para quem for mexer no código

```
npm ci
npm start                 # abre o programa
npm test                  # 95 testes de unidade
npm run test:cobertura    # os mesmos, com a cobertura de linhas e ramos
npm run test:e2e          # com o programa aberto de verdade (Linux: precisa de xvfb); roda 4 baterias
npm run audit             # dependências sem falhas conhecidas de gravidade alta
npx electron-builder --publish never   # gera o instalador do sistema em que estiver rodando
```

```
main.js, preload.js        janela, protocolo seguro app://, canais de comunicação (IPC)
lib/                       processo principal: store (dados em arquivos), config, claude (SDK oficial),
                           nota (pedido e conferência da leitura), exportar (planilha CSV), validar (argumentos do IPC), limites
renderer/                  a tela (HTML, CSS e scripts sem bundler)
  lib/                     regras puras, usadas pela tela e pelo processo principal: dinheiro, meses, calculo, mensagens
  ponte.js                 única porta da tela para dados, leitura de notas e arquivos
  preparo.js               foto -> JPEG; PDF -> imagens (pdf.js embutido)
  envio.js, app.js         envio de nota e tela principal; configuracoes.js
test/*.test.js             testes de unidade
test/e2e/                  funcional, segurança, robustez e acessibilidade com o programa aberto
test/smoke/                teste de fumaça do programa já empacotado (roda no Windows e no Mac, no GitHub)
```

- A tela não tem acesso a Node, ao disco nem à internet. O pedido ao Claude e a conferência da resposta ficam no
  processo principal; a tela só envia imagens.
- Regras de segurança do pacote ("fuses" do Electron): não roda como Node, ignora `NODE_OPTIONS` e depuração,
  só carrega o `app.asar` e confere a integridade dele.
- Variáveis `ANTHROPIC_BASE_URL` (aponta a API para outro endereço) e `CONTAS_USER_DATA` (outra pasta de configuração)
  existem para os testes e também valem no programa instalado; só afetam quem já controla o computador.
- Para publicar em Releases: crie uma tag `contas-v1.0.0`. O GitHub Actions testa, gera os instaladores e publica
  com o `SHA256SUMS.txt`.

## Limitações conhecidas

- Instaladores sem assinatura paga (avisos do Windows e do Mac). A versão do Mac foi testada só pelo GitHub
  (abre, lê a pasta e fecha); ninguém usou num Mac de verdade ainda.
- PDFs com imagens em formato JPEG 2000 não foram testados.
- Notas fotografadas muito de longe ou cupons térmicos longos podem sair ilegíveis para o Claude. A compra nasce
  sempre marcada para conferir.
- Não há atualização automática.
