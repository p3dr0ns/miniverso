<div align="center">

# Miniverso

**Organize sua coleção de miniaturas e planeje cada espaço do seu expositor.**

[![Verificações](https://github.com/p3dr0ns/miniverso/actions/workflows/checks.yml/badge.svg)](https://github.com/p3dr0ns/miniverso/actions/workflows/checks.yml)
![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![Status](https://img.shields.io/badge/status-em%20desenvolvimento-6C5CE7)

</div>

O Miniverso é uma aplicação web para cadastrar miniaturas, pesquisar a coleção e montar virtualmente a disposição de cada peça em expositores personalizados. O projeto combina uma interface responsiva com autenticação própria e execução completa na infraestrutura da Cloudflare.

> O projeto está em desenvolvimento ativo. As coleções são armazenadas localmente no navegador e ainda não são sincronizadas entre dispositivos.

## Recursos

- Cadastro completo de miniaturas, incluindo foto, fabricante, veículo, modelo, escala, cor, condição e observações.
- Campos de catálogo para código da peça, edição, linha, série, rodas, direção, tiragem e exclusividade.
- Busca sem distinção de acentos e filtros por localização e fabricante.
- Criação de vários expositores com dimensões configuráveis.
- Organização por arrastar e soltar, troca de posições e salvamento automático de rascunhos.
- Confirmação explícita do layout antes de atualizar a localização real das miniaturas.
- Cadastro e login com senha protegida, sessões seguras e limitação de tentativas.
- Validação dos dados locais, recuperação de referências inválidas e compressão de imagens.

## Tecnologias

| Área | Tecnologias |
| --- | --- |
| Interface | JavaScript, CSS e Vite |
| API | Cloudflare Workers |
| Banco de dados | Cloudflare D1 |
| Autenticação | PBKDF2 e cookie `HttpOnly` |
| Qualidade | Node.js Test Runner e GitHub Actions |

## Executar localmente

Pré-requisito: [Node.js 24 ou superior](https://nodejs.org/).

```bash
git clone https://github.com/p3dr0ns/miniverso.git
cd miniverso
npm ci
npm run setup
npm run dev
```

Abra `http://localhost:8787`. O comando de desenvolvimento gera o frontend, aplica as migrações no banco D1 local e inicia o site junto com a API.

O guia [Configuração e publicação](docs/SETUP.md) explica como preparar o remetente, as variáveis privadas, a Cloudflare e o primeiro deploy.

## Comandos

| Comando | Finalidade |
| --- | --- |
| `npm run dev` | Gera e inicia a aplicação local completa |
| `npm test` | Executa os testes automatizados |
| `npm run build` | Gera o frontend de produção em `dist/` |
| `npm run setup` | Configura os segredos e o remetente local |
| `npm run deploy` | Aplica migrações e publica na Cloudflare |
| `npm run import:catalog` | Importa o catálogo de referência para o D1 remoto |

## Arquitetura

```text
Navegador
  ├─ interface e coleção local
  └─ /api/*
       └─ Cloudflare Worker
            └─ D1 (contas, sessões e catálogo)
```

O site e a API operam na mesma origem para proteger a sessão com cookies `HttpOnly`, `Secure` e `SameSite=Lax`. As senhas passam por derivação PBKDF2 com salt individual e um segredo mantido no servidor; nunca são armazenadas em texto puro. Tentativas de login são limitadas por conta e endereço IP.

## Persistência e privacidade

As miniaturas, fotos e organizações ficam no armazenamento do navegador, separadas pelo identificador da conta. A API mantém somente os dados necessários para autenticação. Limpar os dados do navegador ou trocar de dispositivo pode tornar a coleção local indisponível; a sincronização em nuvem faz parte da evolução futura do projeto.

Segredos ficam em `.dev.vars`, que é ignorado pelo Git, e não devem usar o prefixo `VITE_`. Consulte o guia de configuração antes de publicar ou migrar usuários.

## Qualidade e deploy

O workflow de integração contínua executa testes e build em cada push e pull request. Ele não publica o site. A aplicação requer a API e, por isso, o deploy é feito no Cloudflare Workers em vez do GitHub Pages.

Os testes cobrem cadastro, derivação de senhas, login, tentativas incorretas, sessões, logout, catálogo colaborativo e comportamento do cliente.

## Fontes de catálogo

O cadastro aceita miniaturas de qualquer fabricante. A análise das fontes, formatos e restrições de uso está documentada em [DATA_SOURCES.md](DATA_SOURCES.md). Dados de terceiros não são distribuídos sem uma licença de reutilização compatível.

## Roadmap

- Sincronização segura da coleção entre dispositivos.
- Perfis e recursos de comunidade.
- Compartilhamento de expositores e coleções.
- Evolução do catálogo de referência com atribuição e licenças adequadas.

## Contribuição

Sugestões e relatos de problemas são bem-vindos por meio das [issues](https://github.com/p3dr0ns/miniverso/issues). Antes de enviar uma alteração, execute:

```bash
npm test
npm run build
```

## Licença

O repositório ainda não possui uma licença de código aberto. Até que uma licença seja adicionada, todos os direitos permanecem reservados ao autor.
