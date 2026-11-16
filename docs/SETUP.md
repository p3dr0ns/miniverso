# Configuração e publicação

Este guia prepara o Miniverso para desenvolvimento local e publicação no Cloudflare Workers. O Worker entrega o frontend, processa a API e acessa o banco D1 na mesma origem.

## Pré-requisitos

- [Node.js 24 ou superior](https://nodejs.org/)
- Uma conta na [Cloudflare](https://dash.cloudflare.com/sign-up)
- Acesso a Workers e D1 nessa conta

## Desenvolvimento local

Na raiz do projeto, instale as dependências e gere a configuração privada:

```powershell
npm ci
npm run setup
```

O assistente cria `.dev.vars` com um `AUTH_SECRET` aleatório. Esse segredo participa da proteção das senhas e deve permanecer privado. O arquivo já está ignorado pelo Git.

Inicie a aplicação:

```powershell
npm run dev
```

Acesse `http://localhost:8787`. O comando gera o frontend, aplica as migrações no D1 local e inicia o Worker.

Os dados locais ficam em `.wrangler/` e são separados do ambiente publicado.

## Verificações

Antes de publicar, execute:

```powershell
npm test
npm run build
```

Os testes usam serviços locais e não alteram o banco remoto.

## Conectar a Cloudflare

Autentique o Wrangler pelo navegador:

```powershell
npm exec wrangler login
```

Confira a conta conectada:

```powershell
npm exec wrangler whoami
```

O arquivo `wrangler.json` define o Worker, a pasta de arquivos estáticos e o binding `AUTH_DB`. O comando de deploy confirma a conta, localiza ou cria o banco e atualiza o identificador local quando necessário.

## Publicar

Execute:

```powershell
npm run deploy
```

O processo:

1. valida a configuração local;
2. gera o frontend de produção;
3. localiza ou cria o banco D1;
4. aplica as migrações remotas;
5. envia o `AUTH_SECRET` como segredo do Worker;
6. publica o site e a API.

Ao final, o Wrangler mostra o endereço público do Worker. O GitHub Pages não é usado porque não executa a API nem oferece o banco D1 necessário à autenticação.

## Segurança

- Nunca adicione `.dev.vars` ao Git.
- Não use o prefixo `VITE_` em segredos; variáveis com esse prefixo podem ser incorporadas ao frontend.
- Preserve o mesmo `AUTH_SECRET` após criar usuários. Trocá-lo invalida a verificação das senhas existentes.
- Restrinja o acesso à conta Cloudflare e revise os tokens ativos periodicamente.
- Faça backup antes de alterar ou remover o banco D1 de produção.

## Solução de problemas

### `AUTH_SECRET` ausente ou inválido

Execute `npm run setup` novamente. O segredo precisa ter pelo menos 32 caracteres.

### Conta Cloudflare incorreta

Execute `npm exec wrangler logout`, autentique novamente e confirme com `npm exec wrangler whoami`.

### Banco D1 não encontrado

Confirme o binding `AUTH_DB` em `wrangler.json`. O deploy tenta localizar o banco pelo nome e pode criá-lo quando ainda não existe.

### Erro depois de uma atualização

Aplique as migrações e publique novamente com `npm run deploy`. Consulte os logs com:

```powershell
npm exec wrangler tail
```

## Referências

- [Cloudflare Workers com arquivos estáticos](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Segredos em Workers](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
