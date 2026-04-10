# 🚀 Guia de Setup do Supabase - Vibe AI

## 📋 Ordem de Execução

Execute os scripts nesta ordem:

1. ✅ **supabase-setup.sql** - Cria tabelas, índices e políticas RLS
2. ✅ **supabase-create-user.sql** - Cria usuário de teste (opcional)

---

## 🎯 Passo a Passo Completo

### **1️⃣ Acesse o Supabase Dashboard**

```
https://supabase.com/dashboard
```

- Faça login ou crie uma conta
- Clique em **"New Project"** ou selecione um projeto existente
- Anote: **Project URL** e **API Keys** (você já configurou no .env)

---

### **2️⃣ Execute o Script Principal**

1. No dashboard, vá em: **SQL Editor** (menu lateral)
2. Clique em **"New Query"**
3. Abra o arquivo `supabase-setup.sql`
4. **Copie TODO o conteúdo** e cole no editor
5. Clique em **"Run"** (▶️)
6. Aguarde mensagem de sucesso: ✅ "Success. No rows returned"

**O que foi criado:**
- ✅ Tabela `meetings`
- ✅ 4 índices para performance
- ✅ 4 políticas RLS (segurança)
- ✅ Trigger automático para `updated_at`

---

### **3️⃣ Configure Authentication**

#### **Habilitar Email/Senha:**

1. Vá em: **Authentication** → **Providers** (menu lateral)
2. Encontre **Email** na lista
3. Certifique-se que está **habilitado** (toggle verde)
4. **Para testes**, desabilite **"Confirm email"**:
   - Clique em **Settings** (dentro de Authentication)
   - Em **Auth Providers**, expanda **Email**
   - Desmarque: ☐ **"Enable email confirmations"**
   - Clique em **Save**

#### **Habilitar Google OAuth (Opcional - para futura configuração):**

1. Ainda em **Providers**, encontre **Google**
2. Clique para expandir
3. Você vai precisar:
   - **Client ID** do Google Cloud Console
   - **Client Secret** do Google Cloud Console
4. Por enquanto, pode pular esta etapa

---

### **4️⃣ Criar Usuário de Teste**

#### **Método 1 - Via SQL (Recomendado para testes):**

1. No **SQL Editor**, clique em **"New Query"**
2. Abra o arquivo `supabase-create-user.sql`
3. **IMPORTANTE**: Edite as linhas 21-22:
   ```sql
   user_email text := 'teste@vibeai.com';  -- ← Seu email
   user_password text := '123456';          -- ← Sua senha
   ```
4. Copie TODO o script e cole no editor
5. Clique em **"Run"** (▶️)
6. Veja a mensagem de sucesso com o **User ID** criado

#### **Método 2 - Via Interface (Mais simples):**

1. Vá em: **Authentication** → **Users**
2. Clique em **"Add User"**
3. Preencha:
   - **Email**: `teste@vibeai.com`
   - **Password**: `123456` (mínimo 6 caracteres)
   - ☑️ **Auto Confirm User** (marque)
4. Clique em **"Create User"**
5. **Anote o User ID** (você vai precisar para testes)

#### **Método 3 - Via Frontend (Produção):**

1. Acesse http://localhost:5173/login
2. Clique em **"Não tem conta? Cadastre-se"**
3. Preencha email e senha
4. Clique em **"Criar Conta"**
5. Faça login imediatamente

---

### **5️⃣ Verificar Setup**

Execute estas queries no SQL Editor para verificar:

```sql
-- 1. Verificar tabela meetings
SELECT COUNT(*) as total_columns
FROM information_schema.columns
WHERE table_name = 'meetings';
-- Deve retornar: 10 colunas

-- 2. Verificar políticas RLS
SELECT COUNT(*) as total_policies
FROM pg_policies
WHERE tablename = 'meetings';
-- Deve retornar: 4 políticas

-- 3. Verificar usuários criados
SELECT email, email_confirmed_at IS NOT NULL as confirmed
FROM auth.users;
-- Deve mostrar seu usuário teste
```

---

### **6️⃣ Criar Reunião de Teste (Opcional)**

Para testar o dashboard com dados reais:

1. No **SQL Editor**, execute:

```sql
-- Substitua 'teste@vibeai.com' pelo seu email
INSERT INTO meetings (
  user_id,
  meet_link,
  status,
  started_at,
  ended_at,
  transcript,
  insights
)
SELECT 
  u.id,
  'https://meet.google.com/abc-defg-hij',
  'completed',
  NOW() - INTERVAL '1 hour',
  NOW(),
  'Esta é uma transcrição de teste...',
  '{
    "sentiment": "positive",
    "commercialQuality": 8,
    "executiveContext": "Reunião produtiva com cliente interessado.",
    "closingProbability": 75,
    "followUp": ["Enviar proposta"],
    "keyTopics": ["Preços", "Integração"],
    "actionItems": ["Preparar demonstração"]
  }'::jsonb
FROM auth.users u
WHERE u.email = 'teste@vibeai.com'
LIMIT 1;
```

---

## ✅ Checklist Final

Antes de testar o frontend, confirme:

- [ ] Tabela `meetings` criada
- [ ] Políticas RLS habilitadas
- [ ] Provider Email habilitado
- [ ] Email confirmation desabilitado (para testes)
- [ ] Usuário de teste criado
- [ ] (Opcional) Reunião de teste inserida

---

## 🧪 Teste o Sistema

1. Acesse: http://localhost:5173/login
2. Faça login com: `teste@vibeai.com` / `123456`
3. Você deve ver o **Dashboard** vazio (ou com reunião de teste)
4. ✅ **Tudo funcionando!**

---

## 🐛 Troubleshooting

### ❌ "Error: relation meetings does not exist"
**Solução**: Execute o `supabase-setup.sql` novamente

### ❌ "Error: new row violates row-level security policy"
**Solução**: Verifique se as políticas RLS foram criadas:
```sql
SELECT * FROM pg_policies WHERE tablename = 'meetings';
```

### ❌ "Invalid login credentials"
**Solução**: 
1. Verifique se o usuário foi criado: `SELECT * FROM auth.users;`
2. Confirme o email manualmente: 
   ```sql
   UPDATE auth.users 
   SET email_confirmed_at = NOW() 
   WHERE email = 'teste@vibeai.com';
   ```

### ❌ "Email confirmations enabled"
**Solução**: Vá em Authentication → Settings → Desabilite "Email Confirmation"

---

## 🔗 Links Úteis

- **Supabase Dashboard**: https://supabase.com/dashboard
- **Supabase Docs**: https://supabase.com/docs
- **SQL Editor**: Dashboard → SQL Editor
- **Auth Settings**: Dashboard → Authentication → Settings
- **RLS Policies**: Dashboard → Authentication → Policies

---

## 📝 Próximos Passos

Após o setup:

1. ✅ **Testar Login** no frontend
2. ✅ **Adicionar OpenAI API Key** no `server/.env`
3. ✅ **Testar Bot** entrando em reunião real
4. ✅ **Configurar Google OAuth** (quando necessário)

---

## 🎉 Pronto!

Seu banco de dados está configurado e pronto para uso!

Se tiver problemas, verifique os logs do backend com:
```bash
cd /Users/pietro_medeiros/Downloads/Vibe-AI
pnpm dev
```

E procure por erros relacionados ao Supabase.
