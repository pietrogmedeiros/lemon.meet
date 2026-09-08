# Verificação do app no Google OAuth — o que submeter

**Por que existe:** `calendar.events` é escopo **sensível**. Sem verificação, quem
conecta a agenda vê o aviso de "app não verificado" e existe teto de usuários
para o app. Hoje são 19 agendas conectadas; o teto ainda não incomoda, mas ele
chega.

**Nada disso se resolve com código.** O que dependia de nós era a política de
privacidade, feita em 08/09/2026 (seção 7, "Dados do Google").

---

## Escopos a declarar (TODOS — omitir um é recusa)

| escopo | classificação | onde é pedido |
|---|---|---|
| `https://www.googleapis.com/auth/calendar.events` | **sensível** | `server/src/routes/calendar.routes.ts` |
| `https://www.googleapis.com/auth/drive.file` | não sensível | `server/src/routes/gdrive.routes.ts` |
| `openid`, `email`, `profile` | não sensíveis | login com Google (Supabase e app Mac) |

---

## Justificativa — `calendar.events`

**O que o app faz com esse escopo, em uma frase:** lê os eventos da agenda do
usuário para descobrir quando cada reunião começa e qual é o link da
videoconferência, e adiciona o assistente de gravação como convidado nos eventos
que o próprio usuário organiza.

**Por que é necessário:** o produto grava e transcreve reuniões. Sem ler a
agenda, não há como saber que existe uma reunião às 9h, qual o link dela, e
enviar o assistente no horário — o usuário teria de colar o link manualmente
antes de cada reunião, o que anula a proposta do produto.

**Por que não serve um escopo mais restrito:** `calendar.readonly` cobriria a
leitura, mas não permite adicionar o assistente como convidado. Esse convite é o
que faz o Google Meet admitir o assistente automaticamente; sem ele, alguém
precisa clicar em "admitir" em toda reunião, e medimos que isso derruba cerca de
um terço das gravações. `calendar.events` é o menor escopo que cobre os dois
usos.

**O que NÃO fazemos:** não criamos eventos, não apagamos eventos, não alteramos
horário, título ou descrição, e não mexemos em eventos organizados por outras
pessoas — o Google, aliás, só permite alterar convidados de evento próprio.

**Dados retidos:** título, horário e link da videoconferência, apenas para
reuniões que o usuário optou por gravar. Não guardamos a agenda inteira.

---

## Justificativa — `drive.file`

Salva na pasta escolhida pelo usuário os arquivos que o **próprio Lemon.meet
cria** (resumo e insights da reunião). É o escopo por arquivo: não dá acesso a
nada que o app não tenha criado. Ativado por ação do usuário e desligável nas
configurações.

---

## Roteiro do vídeo de demonstração

O vídeo precisa mostrar o fluxo COMPLETO, começando pela tela de consentimento e
terminando no uso real do dado. Sem cortes no meio do OAuth.

1. Abrir `https://lemon-meet.web.app` **deslogado** e mostrar a URL na barra.
2. Entrar na conta.
3. Ir em Integrações → conectar Google Agenda.
4. **Mostrar a tela de consentimento do Google por inteiro**, com o nome do app,
   e a lista de permissões pedidas legível.
5. Autorizar e voltar ao app.
6. Mostrar a agenda carregada dentro do produto (uso real do escopo).
7. Mostrar um evento com o assistente na lista de convidados — é a justificativa
   do escopo de escrita, e o revisor precisa ver isso acontecendo.
8. Mostrar onde o usuário **desconecta** a integração.

⚠️ Lição da revisão da Apple, que vale aqui: gravação que começa no meio, sem
mostrar a URL e a tela de permissão inteira, volta como pendência.

---

## O que depende do Pietro

- [ ] Verificar a propriedade do domínio no Google Search Console (mesmo domínio
      declarado na tela de consentimento).
- [ ] Conferir na tela de consentimento: nome do app, logotipo, e-mail de
      suporte, link da política de privacidade e dos termos.
- [ ] Gravar o vídeo pelo roteiro acima e publicar (YouTube não listado serve).
- [ ] Submeter no Verification Center e responder às pendências.

**Prazo típico:** semanas, com idas e vindas. Começar cedo é a única forma de
não descobrir o teto de usuários no pior momento.

**Referências:**
- https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- https://support.google.com/cloud/answer/13463073
- https://developers.google.com/terms/api-services-user-data-policy
