# Miniverso

MVP para cadastrar miniaturas e planejar a organização de coleções em expositores.

## Executar localmente

Requer Node.js 18 ou superior.

```bash
npm install
npm run dev
```

Abra o endereço local mostrado pelo Vite. Para gerar uma versão de produção, use `npm run build`; para visualizá-la, use `npm run preview`.

## Login por código de e-mail

O login usa o Email OTP do Supabase Auth. Para ativá-lo:

1. Crie um projeto no [Supabase](https://supabase.com/).
2. Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` com a URL e a chave pública do projeto. Nunca use a chave `service_role` no site.
3. No painel do Supabase, abra **Authentication → Email Templates → Magic Link** e use `{{ .Token }}` no conteúdo do e-mail. Sem essa variável, o Supabase enviará um link em vez do código numérico.
4. Para produção, configure um provedor SMTP próprio no Supabase. O servidor de e-mail padrão é limitado a endereços autorizados da equipe.

Exemplo mínimo de conteúdo para o template:

```html
<h2>Seu código do Miniverso</h2>
<p>Digite este código para entrar:</p>
<p><strong>{{ .Token }}</strong></p>
```

A sessão é mantida pelo Supabase. As coleções continuam armazenadas localmente e são separadas pelo ID da conta no navegador; ainda não há sincronização entre dispositivos.

## Publicação no GitHub Pages

O workflow `.github/workflows/deploy-pages.yml` instala o Node.js e as dependências no próprio GitHub, gera a pasta `dist` e publica o site após cada envio para a branch `main`. Não é necessário ter Node.js instalado no computador para o deploy.

No repositório do GitHub, abra **Settings → Pages** e selecione **GitHub Actions** em **Source**. Depois envie os arquivos para a branch `main`; o andamento aparecerá na aba **Actions**.

## O que já funciona

- Cadastro, edição e exclusão de miniaturas, com foto, fabricante, veículo, modelo, escala, cor, condição e observações.
- Busca sem distinção de acentos e filtros por localização e fabricante.
- Criação e edição de vários expositores com linhas e colunas configuráveis.
- Planejamento por arrastar e soltar, troca de posição, remoção da vaga e rascunhos salvos automaticamente.
- Aplicação explícita do layout: somente ao confirmar a organização a localização real das miniaturas é atualizada.
- Persistência local no navegador. Fotos e registros ficam neste dispositivo e neste navegador; não há conta nem sincronização entre dispositivos.
- Validação e recuperação de referências inválidas ao carregar os dados, além de compressão e remoção de fotos.
- Campos opcionais de catálogo para código da peça, ano da edição, linha/categoria, série, número na série, tipo de roda, direção, tiragem e exclusividade.

Não há dados de demonstração pré-carregados. Comunidade, perfis, amigos e conquistas ficam para etapas futuras.

## Referências de catálogo

A avaliação detalhada e o estado de cada fonte ficam em [DATA_SOURCES.md](DATA_SOURCES.md).

O modelo dos campos de catálogo foi inspirado nos projetos [HotApi](https://github.com/twilm/HotApi) e [Hotwheels-Data](https://github.com/pvwnthem/Hotwheels-Data). Nenhum registro desses repositórios é distribuído com o projeto: as fontes não declaram uma licença de reutilização e os dados têm formatos diferentes entre os anos. O cadastro continua manual e aceita miniaturas de qualquer fabricante.

As coleções comunitárias [MINI GT](https://minigt.fandom.com/wiki/Full_Collection), [Kaido House](https://kaido-house-garage.fandom.com/wiki/Full_Collection) e [Matchbox](https://matchbox.fandom.com/wiki/Matchbox_Cars_Wiki) também serviram de referência para direção, data de lançamento, tiragem, exclusividade, números de catálogo e tipos de roda. Conteúdo da Fandom não é copiado nem carregado pelo aplicativo; uma futura importação deverá preservar a atribuição e a licença CC BY-SA indicada pelas comunidades.

A página de [coleções do Universo Hot Wheels](https://universohotwheels.com.br/colecoes/) é referência complementar em português para linhas e categorias como Premium, T-Hunt, Super T-Hunt, Car Culture e J-Imports. Preços e disponibilidade da loja não são tratados como dados permanentes do catálogo.
