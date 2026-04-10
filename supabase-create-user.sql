-- ========================================
-- CRIAR USUÁRIO DE TESTE NO SUPABASE
-- ========================================
-- Execute este script DEPOIS do supabase-setup.sql
-- Dashboard > SQL Editor > New Query > Cole e Execute
-- ========================================

-- ========================================
-- OPÇÃO 1: CRIAR USUÁRIO DIRETAMENTE (MÉTODO AVANÇADO)
-- ========================================
-- ⚠️  ATENÇÃO: Este método cria usuário sem confirmação de email
-- Ideal para desenvolvimento/testes

-- IMPORTANTE: Substitua os valores abaixo:
-- • 'teste@vibeai.com' pelo email desejado
-- • '123456' pela senha desejada (mínimo 6 caracteres)

DO $$
DECLARE
  new_user_id uuid;
  user_email text := 'teste@vibeai.com';
  user_password text := '123456';
BEGIN
  -- Insere usuário diretamente na tabela auth.users
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    user_email,
    crypt(user_password, gen_salt('bf')), -- Hash da senha
    NOW(), -- Email já confirmado
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
  )
  RETURNING id INTO new_user_id;

  -- Insere identidade do usuário
  INSERT INTO auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    new_user_id::text,
    new_user_id,
    format('{"sub":"%s","email":"%s","email_verified":true,"phone_verified":false,"sub":"%s"}', new_user_id::text, user_email, new_user_id::text)::jsonb,
    'email',
    NOW(),
    NOW(),
    NOW()
  );

  -- Exibe informações do usuário criado
  RAISE NOTICE '✅ Usuário criado com sucesso!';
  RAISE NOTICE 'Email: %', user_email;
  RAISE NOTICE 'Senha: %', user_password;
  RAISE NOTICE 'User ID: %', new_user_id;
  
END $$;

-- ========================================
-- OPÇÃO 2: MÉTODO RECOMENDADO (VIA INTERFACE)
-- ========================================
-- Este é o método mais seguro e recomendado
-- Não requer SQL, mas é mais manual:

/*
1. Vá para: Dashboard > Authentication > Users
2. Clique em "Add User" (ou "Invite User")
3. Preencha:
   - Email: teste@vibeai.com
   - Password: SuaSenhaSegura123
   - Auto Confirm User: ✅ (marque para não precisar confirmar email)
4. Clique em "Create User"

OU

Use o frontend do Vibe AI:
1. Acesse http://localhost:5173/login
2. Clique em "Não tem conta? Cadastre-se"
3. Preencha email e senha
4. Clique em "Criar Conta"
5. Se "Email confirmation" estiver desabilitado, pode fazer login imediatamente
*/

-- ========================================
-- VERIFICAR USUÁRIOS CRIADOS
-- ========================================

-- Lista todos os usuários (execute após criar)
SELECT 
  id as user_id,
  email,
  email_confirmed_at,
  created_at,
  last_sign_in_at,
  CASE 
    WHEN email_confirmed_at IS NOT NULL THEN '✅ Confirmado'
    ELSE '⏳ Aguardando confirmação'
  END as status
FROM auth.users
ORDER BY created_at DESC;

-- ========================================
-- COMANDOS ÚTEIS
-- ========================================

-- Ver detalhes de um usuário específico
-- SELECT * FROM auth.users WHERE email = 'teste@vibeai.com';

-- Confirmar email de um usuário manualmente
-- UPDATE auth.users 
-- SET email_confirmed_at = NOW() 
-- WHERE email = 'teste@vibeai.com';

-- Alterar senha de um usuário
-- UPDATE auth.users 
-- SET encrypted_password = crypt('nova_senha_123', gen_salt('bf'))
-- WHERE email = 'teste@vibeai.com';

-- Deletar usuário (CUIDADO! Deleta também todas suas reuniões por CASCADE)
-- DELETE FROM auth.users WHERE email = 'teste@vibeai.com';

-- ========================================
-- DESABILITAR CONFIRMAÇÃO DE EMAIL (PARA TESTES)
-- ========================================
-- Execute este comando para permitir login sem confirmar email

/*
1. Vá em: Dashboard > Authentication > Settings
2. Procure "Email Confirmation"
3. Desmarque "Enable email confirmations"
4. Salve

OU use SQL:
UPDATE auth.config 
SET raw_app_meta_data = jsonb_set(
  raw_app_meta_data, 
  '{email_confirm_required}', 
  'false'
);
*/

-- ========================================
-- CRIAR REUNIÃO DE TESTE PARA O USUÁRIO
-- ========================================
-- Execute DEPOIS de criar o usuário
-- Substitua 'teste@vibeai.com' pelo email do usuário criado

/*
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
  NOW() - INTERVAL '2 hours',
  NOW() - INTERVAL '1 hour',
  'Cliente: Olá, gostaria de entender melhor como funciona o produto.

Vendedor: Claro! Nosso sistema permite transcrever reuniões do Google Meet automaticamente e gerar insights inteligentes usando IA.

Cliente: Interessante! Qual o custo mensal?

Vendedor: Temos planos a partir de R$ 99/mês com até 10 horas de transcrição.

Cliente: Perfeito! Vou conversar com minha equipe e retorno essa semana.

Vendedor: Ótimo! Vou enviar uma proposta por email. Podemos agendar um follow-up para sexta-feira?

Cliente: Pode ser! Aguardo a proposta.',
  '{
    "sentiment": "positive",
    "commercialQuality": 8,
    "executiveContext": "Reunião comercial produtiva. Cliente demonstrou interesse no produto e solicitou proposta. Sinalização positiva para fechamento na próxima semana.",
    "closingProbability": 75,
    "followUp": [
      "Enviar proposta comercial por email",
      "Agendar follow-up para sexta-feira",
      "Preparar apresentação sobre ROI"
    ],
    "keyTopics": [
      "Funcionalidades do produto",
      "Preços e planos",
      "Integração com Google Meet",
      "ROI para equipe"
    ],
    "actionItems": [
      "Elaborar proposta comercial personalizada",
      "Calcular economia de tempo para o cliente",
      "Preparar caso de sucesso similar"
    ]
  }'::jsonb
FROM auth.users u
WHERE u.email = 'teste@vibeai.com'
LIMIT 1;
*/

-- ========================================
-- PRONTO! ✅
-- ========================================
-- Agora você pode:
-- 1. Fazer login no frontend com o email/senha criados
-- 2. Testar o sistema completo
-- 3. Ver a reunião de teste no dashboard
-- ========================================
