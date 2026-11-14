# Colocar o login próprio no ar

O Miniverso gera e confere os códigos no seu próprio servidor. A Cloudflare hospeda o site, o servidor e o banco de autenticação. O Brevo entrega os e-mails. Cada serviço tem seus limites e condições; o envio não é ilimitado.

## 1. Preparar o envio de e-mail

1. Crie ou entre na sua conta em [Brevo](https://www.brevo.com/).
2. Na área de remetentes, adicione o endereço que enviará os códigos e conclua a verificação desse endereço.
3. Na área de SMTP e API, crie uma **chave de API**. O sistema usa a API, portanto escolha a chave de API, e não a senha SMTP.
4. Mantenha a chave com você: ela será informada no terminal local. A chave não deve ser colada na conversa nem no código público.

O Brevo pode exigir a validação da conta ou a autenticação de um domínio para aprovar os envios. Para endereços de provedores gratuitos, pode substituir o remetente por um endereço técnico próprio. Confira as [regras de remetentes do Brevo](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders).

## 2. Configurar no computador

Instale uma versão LTS do [Node.js](https://nodejs.org/) igual ou superior a 24. Depois abra o terminal do VS Code na pasta do projeto e execute:

```powershell
npm ci
npm run setup
```

O assistente pede a chave de API e o endereço do remetente confirmado. A chave fica oculta durante a digitação. Ele gera o segredo da autenticação e salva as configurações em `.dev.vars`, que está ignorado pelo Git.

Ao executar o assistente outra vez, ele preserva o segredo existente. Para alterar a chave ou o remetente:

```powershell
npm run setup -- --edit
```

Para conferir se o remetente está ativo no Brevo sem enviar um e-mail:

```powershell
npm run setup -- --check
```

## 3. Testar no computador

```powershell
npm run dev
```

O comando gera o site, prepara o banco local e inicia tudo em `http://localhost:8787`. Abra esse endereço, informe seu e-mail e solicite um código. O envio usa a conta real do Brevo e consome sua cota de e-mails. Digite os oito números recebidos no site. O código expira em dez minutos.

Os dados de autenticação do teste ficam no banco local. Eles são separados do banco publicado.

## 4. Conectar a hospedagem

Crie uma conta na [Cloudflare](https://dash.cloudflare.com/sign-up). No terminal do projeto, execute:

```powershell
npm exec wrangler login
```

Conclua a autorização no navegador. Ela permite que o comando de publicação use Workers e D1 na sua conta.

## 5. Publicar

Antes da mudança de endereço, faça uma cópia das coleções que já existem no navegador do site antigo. Coleções e fotos continuam locais: um endereço novo não consegue ler os dados salvos pelo GitHub Pages, e as contas antigas não são migradas automaticamente.

```powershell
npm run deploy
```

O comando confere o login na Cloudflare, gera o site, cria ou reutiliza o banco de autenticação, aplica as migrações e publica o servidor com os segredos na mesma versão. Se houver mais de uma conta, ele pede que você escolha a conta correta.

Ao terminar, a Cloudflare informa o novo endereço HTTPS do Miniverso. Abra esse endereço para fazer o teste de acesso. A interface e a API precisam funcionar juntas nesse endereço; o GitHub Pages sozinho não executa o servidor de autenticação.

## Quando algo não funcionar

- **Falta configurar uma variável:** execute `npm run setup`.
- **Remetente não ativo:** confirme o endereço no painel do Brevo; depois execute `npm run setup -- --check`.
- **Conta Cloudflare não conectada:** execute `npm exec wrangler login` novamente.
- **Envio temporariamente bloqueado:** aguarde o tempo mostrado pelo site. Além dos limites do Miniverso, o provedor de e-mail mantém suas próprias cotas.
- **Alterei uma credencial:** execute `npm run setup -- --edit` e depois `npm run deploy` para atualizar o servidor publicado.

Referências: [Workers com arquivos estáticos](https://developers.cloudflare.com/workers/static-assets/), [banco D1](https://developers.cloudflare.com/d1/), [segredos em Workers](https://developers.cloudflare.com/workers/configuration/secrets/), [API de envio do Brevo](https://developers.brevo.com/reference/send-transac-email).
