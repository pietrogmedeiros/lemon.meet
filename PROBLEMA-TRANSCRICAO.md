# 🔴 PROBLEMA: Transcrições não estão sendo geradas

## Diagnóstico Realizado

### ❌ Problemas Identificados

1. **Variáveis de ambiente faltando no .env local:**
   - `SERVER_URL` - não configurada (necessária para webhook do MeetingBaas)
   - `MEETINGBAAS_API_KEY` - não configurada (necessária para enviar bots)

2. **Banco de dados vazio:**
   - 0 reuniões registradas
   - 0 integrações de calendário
   - Usuário `24996e51-83ce-416c-8c81-6b1dd6bdb07e` não tem reuniões

3. **Fluxo esperado não está acontecendo:**
   - Extensão deveria chamar `POST /api/meetings/start`
   - Isso cria reunião no banco e envia bot via MeetingBaas
   - Bot entra na reunião
   - Quando reunião termina, webhook recebe transcrição
   - Sistema gera insights

## Possíveis Causas

### 1. Servidor de Produção Não Está Rodando
- Verificar se o servidor no Railway está online
- URL esperada: `https://vibe-aiserver-production.up.railway.app`

### 2. Variáveis de Ambiente Não Configuradas no Railway
As seguintes variáveis DEVEM estar configuradas no Railway:
```env
# Essencial para receber webhooks do MeetingBaas
SERVER_URL=https://vibe-aiserver-production.up.railway.app

# Essencial para enviar bots para reuniões
MEETINGBAAS_API_KEY=sua-chave-aqui

# Já configuradas (verificar se estão no Railway)
SUPABASE_URL=https://fzphfdvlsvxqrpwpmfuv.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
```

### 3. Extensão Não Está Funcionando
- Usuário pode não estar autenticado na extensão
- Extensão pode não estar chamando o endpoint correto
- Pode estar apontando para URL errada do servidor

### 4. Webhook do MeetingBaas Não Está Configurado
- No dashboard do MeetingBaas, o webhook deve apontar para:
  `https://vibe-aiserver-production.up.railway.app/api/meetingbaas/webhook`

## Soluções

### ✅ Passo 1: Verificar Railway
1. Acessar dashboard do Railway
2. Verificar se o servidor está rodando (status: deployed)
3. Verificar logs para erros

### ✅ Passo 2: Configurar Variáveis no Railway
Adicionar/verificar estas variáveis no painel de Variables do Railway:
```
SERVER_URL=https://vibe-aiserver-production.up.railway.app
MEETINGBAAS_API_KEY=<sua-chave-do-meetingbaas>
```

### ✅ Passo 3: Verificar MeetingBaas Dashboard
1. Login em https://app.meetingbaas.com
2. Ir em Settings → Webhooks
3. Confirmar que a URL do webhook está correta:
   - `https://vibe-aiserver-production.up.railway.app/api/meetingbaas/webhook`

### ✅ Passo 4: Testar o Fluxo Completo
1. Fazer logout e login novamente na extensão
2. Entrar em uma reunião de teste no Google Meet
3. Clicar no botão da extensão para enviar o bot
4. Aceitar o bot na reunião
5. Falar algo e aguardar alguns minutos
6. Remover o bot
7. Verificar se a transcrição aparece no painel

### ✅ Passo 5: Verificar Logs do Servidor
```bash
# No Railway, ver logs em tempo real
# Procurar por:
# - "Meeting started via MeetingBaas"
# - "[MeetingBaas webhook] event=..."
# - Erros relacionados a MEETINGBAAS_API_KEY
```

## Como Pedir ao Usuário Para Testar

Envie esta mensagem ao usuário:

---

Olá! Identifiquei que não há reuniões registradas no sistema para sua conta. Isso pode acontecer por alguns motivos:

**Para usar a extensão corretamente:**
1. Certifique-se de estar logado na extensão com seu email
2. Entre em uma reunião do Google Meet
3. Clique no ícone da extensão Lemon Meet
4. Clique em "Iniciar Gravação"
5. Aceite o bot quando ele entrar na reunião
6. Ao final, clique em "Parar Gravação"

**Se o problema persistir:**
- Qual é o email que você está usando na extensão?
- Você vê alguma mensagem de erro quando clica em "Iniciar Gravação"?
- O bot aparece na lista de participantes da reunião?

---

## Próximos Passos para o Desenvolvedor

1. **URGENTE**: Adicionar `SERVER_URL` e `MEETINGBAAS_API_KEY` no Railway
2. Verificar se o servidor está rodando no Railway
3. Adicionar logs mais detalhados no endpoint `/api/meetings/start`
4. Criar endpoint de health check para validar configurações:
   - `GET /api/health` → retorna status das variáveis essenciais
5. Adicionar tratamento de erro mais específico quando variáveis faltam
