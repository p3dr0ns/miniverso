# Miniverso

MVP para cadastrar miniaturas e planejar a organização de coleções em expositores.

## Executar localmente

Requer Node.js 24 ou superior. O login usa uma API própria em Cloudflare Workers, banco D1 e entrega de e-mails pelo Brevo.

```bash
npm ci
npm run setup
npm run dev
```

Abra o endereço local mostrado no terminal. O comando prepara o banco local, gera o frontend e inicia o site junto com a API. O passo a passo das contas, do remetente e da publicação está em [docs/SETUP.md](docs/SETUP.md).

## Login por código de e-mail

O servidor gera um código aleatório de 8 dígitos, envia o e-mail pronto e verifica o código. Ele expira em 10 minutos, pode ser usado uma vez e é bloqueado após 5 tentativas incorretas. O banco guarda um HMAC do código, nunca o código em texto puro.

Após a confirmação, o servidor cria uma sessão de até 7 dias com cookie `HttpOnly`, `Secure` e `SameSite=Lax`. O segredo da sessão fica fora do JavaScript do navegador. Sair da conta revoga a sessão no banco.

Há um intervalo de 60 segundos entre envios e limites por hora: 5 por e-mail, 20 por IP e 100 no projeto. O serviço de entrega também tem suas próprias cotas. O site informa o tempo de espera retornado pela API e bloqueia novos pedidos durante esse período.

O comando `npm run setup` pede o remetente e a chave Brevo, gera o segredo de autenticação e salva a configuração em `.dev.vars`, ignorado pelo Git. Esses valores pertencem somente ao servidor e nunca devem receber o prefixo `VITE_`. O texto do e-mail é definido no código do servidor, sem modelos externos ou links de confirmação para configurar.

As coleções continuam armazenadas localmente e são separadas pelo ID da conta no navegador; ainda não há sincronização entre dispositivos.

## Publicação

O site e a API devem funcionar na mesma origem para utilizar cookies seguros. Publique com `npm run deploy` após concluir a [configuração inicial](docs/SETUP.md). O comando configura o banco, aplica as migrações e publica o frontend junto com a API em Cloudflare Workers.

GitHub Pages hospeda apenas arquivos estáticos e não executa esta API. O workflow `.github/workflows/checks.yml` verifica os testes e o build sem publicar uma interface separada do servidor.

## Dados da versão anterior

A autenticação própria cria IDs novos e mantém esses IDs estáveis nos próximos acessos. Ela não importa as contas anteriores. Além disso, mudar de domínio muda o armazenamento local acessível pelo navegador. As coleções salvas no endereço antigo não são transferidas automaticamente: planeje sua cópia antes de migrar usuários ou retirar o site antigo do ar. Nenhum dado do endereço anterior é apagado por esta implementação.

## Verificação

`npm test` exercita emissão, confirmação, expiração, tentativas, concorrência, sessão, logout e cotas com D1 local e entrega de e-mail simulada. Os testes não enviam e-mails reais. `npm run build` gera a interface de produção.

## O que já funciona

- Cadastro, edição e exclusão de miniaturas, com foto, fabricante, veículo, modelo, escala, cor, condição e observações.
- Busca sem distinção de acentos e filtros por localização e fabricante.
- Criação e edição de vários expositores com linhas e colunas configuráveis.
- Planejamento por arrastar e soltar, troca de posição, remoção da vaga e rascunhos salvos automaticamente.
- Aplicação explícita do layout: somente ao confirmar a organização a localização real das miniaturas é atualizada.
- Persistência local no navegador, separada por conta. Fotos e registros ficam neste dispositivo e neste navegador; não há sincronização entre dispositivos.
- Validação e recuperação de referências inválidas ao carregar os dados, além de compressão e remoção de fotos.
- Campos opcionais de catálogo para código da peça, ano da edição, linha/categoria, série, número na série, tipo de roda, direção, tiragem e exclusividade.

Não há dados de demonstração pré-carregados. Comunidade, perfis, amigos e conquistas ficam para etapas futuras.

## Referências de catálogo

A avaliação detalhada e o estado de cada fonte ficam em [DATA_SOURCES.md](DATA_SOURCES.md).

O modelo dos campos de catálogo foi inspirado nos projetos [HotApi](https://github.com/twilm/HotApi) e [Hotwheels-Data](https://github.com/pvwnthem/Hotwheels-Data). Nenhum registro desses repositórios é distribuído com o projeto: as fontes não declaram uma licença de reutilização e os dados têm formatos diferentes entre os anos. O cadastro continua manual e aceita miniaturas de qualquer fabricante.

As coleções comunitárias [MINI GT](https://minigt.fandom.com/wiki/Full_Collection), [Kaido House](https://kaido-house-garage.fandom.com/wiki/Full_Collection) e [Matchbox](https://matchbox.fandom.com/wiki/Matchbox_Cars_Wiki) também serviram de referência para direção, data de lançamento, tiragem, exclusividade, números de catálogo e tipos de roda. Conteúdo da Fandom não é copiado nem carregado pelo aplicativo; uma futura importação deverá preservar a atribuição e a licença CC BY-SA indicada pelas comunidades.

A página de [coleções do Universo Hot Wheels](https://universohotwheels.com.br/colecoes/) é referência complementar em português para linhas e categorias como Premium, T-Hunt, Super T-Hunt, Car Culture e J-Imports. Preços e disponibilidade da loja não são tratados como dados permanentes do catálogo.
