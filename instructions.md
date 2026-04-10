# 🎙️ Vibe AI - Instruções de Setup

Vibe AI é um SaaS que entra em reuniões do Google Meet via bot automatizado, transcreve em tempo real usando Whisper API e gera insights inteligentes com GPT-4o.

## 📋 Pré-requisitos

- **Node.js**: >= 20.0.0
- **pnpm**: >= 8.0.0
- **Docker**: >= 24.0.0 (opcional, mas recomendado)
- **Docker Compose**: >= 2.0.0 (opcional)

## 🚀 Setup Inicial

### 1. Instalação de Dependências

```bash
# Instalar pnpm globalmente (caso não tenha)
npm install -g pnpm

# Instalar todas as dependências do monorepo
pnpm install
```

### 2. Configuração de Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env` na raiz do projeto:

```bash
cp .env.example .env
```

**Também copie para o frontend:**

```bash
cp web/.env.example web/.env
```

Preencha as seguintes variáveis obrigatórias:

#### **Supabase (Banco de Dados & Autenticação)**

1. Crie um projeto no [Supabase](https://supabase.com)
2. Vá em **Settings** → **API**
3. Copie as credenciais:

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6

**No arquivo `web/.env`** (frontend):

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**⚠️ Importante:** As variáveis do frontend devem começar com `VITE_` para serem expostas no build do Vite.IkpXVCJ9...
```

4. Configure o Google OAuth no Supabase:
   - Vá em **Authentication** → **Providers**
   - Habilite **Google**
   - Adicione suas credenciais do Google Cloud Console

#### **OpenAI API (Whisper & GPT-4o)**

1. Crie uma conta em [OpenAI Platform](https://platform.openai.com)
2. Vá em **API Keys** e crie uma nova chave
3. Adicione no `.env`:

```env
OPENAI_API_KEY=sk-proj-...
```

#### **Configurações do Servidor**

```env
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173
SOCKET_IO_CORS_ORIGIN=http://localhost:5173
```

#### **Configurações do Puppeteer**

```env
# Para desenvolvimento local (macOS/Linux)
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium  # ou caminho onde Chromium está instalado
PUPPETEER_HEADLESS=true

# Limites de recursos
MAX_CONCURRENT_MEETINGS=5
MEETING_TIMEOUT_MS=7200000  # 2 horas em milissegundos
```

### 3. Configuração do Banco de Dados (Supabase)

Execute as seguintes queries SQL no **SQL Editor** do Supabase para criar as tabelas necessárias:

```sql
-- Criar tabela de reuniões
CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  meet_link TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('recording', 'processing', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  transcription_url TEXT,
  insights JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Criar índices para performance
CREATE INDEX idx_meetings_user_id ON meetings(user_id);
CREATE INDEX idx_meetings_status ON meetings(status);
CREATE INDEX idx_meetings_created_at ON meetings(created_at DESC);

-- Habilitar Row Level Security (RLS)
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

-- Política: Usuários só podem ver suas próprias reuniões
CREATE POLICY "Users can view their own meetings"
  ON meetings
  FOR SELECT
  USING (auth.uid() = user_id);

-- Política: Usuários só podem inserir suas próprias reuniões
CREATE POLICY "Users can insert their own meetings"
  ON meetings
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Política: Usuários só podem atualizar suas próprias reuniões
CREATE POLICY "Users can update their own meetings"
  ON meetings
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Criar tabela de transcrições (chunks de texto)
CREATE TABLE transcript_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  speaker TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para transcrições
CREATE INDEX idx_transcript_chunks_meeting_id ON transcript_chunks(meeting_id);
CREATE INDEX idx_transcript_chunks_timestamp ON transcript_chunks(timestamp);

-- RLS para transcrições
ALTER TABLE transcript_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view transcripts of their meetings"
  ON transcript_chunks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = transcript_chunks.meeting_id
      AND meetings.user_id = auth.uid()
    )
  );
```

## 🏃 Executando o Projeto

### Opção 1: Desenvolvimento Local

#### Terminal 1 - Backend
```bash
pnpm dev:server
```

#### Terminal 2 - Frontend
```bash
pnpm dev:web
```

Acesse:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000
- **Health Check**: http://localhost:3000/health

### Opção 2: Docker (Recomendado para Puppeteer)

```bash
# Build e iniciar todos os serviços
docker-compose up --build

# Ou em modo detached (background)
docker-compose up -d --build

# Ver logs
docker-compose logs -f server

# Parar serviços
docker-compose down
```

## 📁 Estrutura do Projeto

```
vibe-ai/
├── web/                          # Frontend React + Vite
│   ├── src/
│   │   ├── components/           # Componentes React
│   │   │   ├── layout/           # Sidebar, TopNavBar, MainLayout
│   │   │   └── ui/               # Card, Button, Badge
│   │   ├── contexts/             # ThemeContext, AuthContext
│   │   ├── pages/                # Dashboard, ActiveMeeting, Insights
│   │   ├── hooks/                # useTranscriptionSocket, etc
│   │   ├── lib/                  # Utilitários
│   │   ├── locales/              # Traduções i18n (pt-BR, en-US, es)
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css             # Tailwind + Design System
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── server/                       # Backend Node.js + Express
│   ├── src/
│   │   ├── config/               # Supabase, Socket.io
│   │   ├── middleware/           # auth.middleware.ts
│   │   ├── routes/               # meetings.routes.ts
│   │   ├── services/             # MeetBotService, WhisperService, GPTInsightsService
│   │   ├── types/                # TypeScript interfaces
│   │   └── server.ts             # Entry point
│   ├── package.json
│   ├── Dockerfile
│   └── tsconfig.json
│
├── pnpm-workspace.yaml           # Configuração do monorepo
├── docker-compose.yml            # Orquestração Docker
├── .env.example                  # Template de variáveis de ambiente
└── instructions.md               # Este arquivo
```

## 🎨 Design System

### Paleta de Cores (Dark Mode - Padrão)

- **Background**: `#0a0a0a` (com padrão de pontos)
- **Surface**: `#171717`
- **Surface Container**: `#1a1a1a`
- **Border**: `#262626`
- **Border Ghost**: `rgba(255, 255, 255, 0.08)`
- **Primary**: `#8B5CF6` (roxo/violeta)
- **Accent Orange**: `#FB923C`
- **Accent Green**: `#10B981`
- **Text Primary**: `#ffffff`
- **Text Secondary**: `#a3a3a3`
- **Text Tertiary**: `#737373`

### Classes Utilitárias Tailwind

```tsx
// Card com borda sutil
<div className="surface-container p-6">
  Conteúdo
</div>

// Borda fantasma
<div className="ghost-border">
  Elemento com borda sutil
</div>

// Botão primary
<button className="primary-dim px-4 py-2 rounded-lg">
  Botão
</button>
```

## 🧪 Scripts Disponíveis

```bash
# Desenvolvimento (paralelo: frontend + backend)
pnpm dev

# Desenvolvimento isolado
pnpm dev:web        # Apenas frontend
pnpm dev:server     # Apenas backend

# Build de produção
pnpm build          # Build frontend + backend

# Testes
pnpm test           # Executar todos os testes

# Linting
pnpm lint           # Lint em todos os pacotes

# Limpeza
pnpm clean          # Remove dist/ e node_modules/
```

## 🐳 Comandos Docker Úteis

```bash
# Build sem cache
docker-compose build --no-cache

# Ver logs de um serviço específico
docker-compose logs -f server

# Entrar no container
docker-compose exec server sh

# Verificar status dos containers
docker-compose ps

# Remover volumes e reiniciar do zero
docker-compose down -v
docker-compose up --build
```

## 🔧 Troubleshooting

### Puppeteer não encontra Chromium

**Problema**: `Error: Could not find Chromium`

**Solução (macOS)**:
```bash
# Instalar Chromium via Homebrew
brew install chromium

# Atualizar .env com o caminho correto
PUPPETEER_EXECUTABLE_PATH=/opt/homebrew/bin/chromium
```

**Solução (Linux)**:
```bash
# Ubuntu/Debian
sudo apt-get install chromium-browser

# Atualizar .env
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

**Solução (Docker)**: Não é necessário, Chromium já está incluído na imagem.

### Erro de permissão Socket.io CORS

**Problema**: `Access to XMLHttpRequest has been blocked by CORS policy`

**Solução**: Verifique se `SOCKET_IO_CORS_ORIGIN` no `.env` corresponde à URL do frontend:
```env
SOCKET_IO_CORS_ORIGIN=http://localhost:5173
```

### Erro de autenticação Supabase

**Problema**: `Invalid or expired token`

**Solução**: 
1. Verifique se `SUPABASE_URL` e `SUPABASE_ANON_KEY` estão corretos
2. Confirme que o Google OAuth está configurado corretamente no Supabase
3. Limpe o cache do navegador e faça login novamente

### Shared memory error no Docker

**Problema**: `Error: Failed to launch the browser process`

**Solução**: O `docker-compose.yml` já inclui `shm_size: 2gb`. Se o erro persistir, aumente para 4gb:
```yaml
shm_size: 4gb
```

### OpenAI API rate limit

**Problema**: `Rate limit exceeded`
x] **Fase 2**: Design System e Layout Base
- [xlução**: 
1. Verifique se sua conta OpenAI tem créditos
2. Reduza `MAX_CONCURRENT_MEETINGS` no `.env`
3. Implemente batching de requisições (já implementado na Fase 5)

## 🚦 Roadmap de Implementação

- [x] **Fase 1**: Setup Inicial e Infraestrutura Base
- [ ] **Fase 2**: Design System e Layout Base
- [ ] **Fase 3**: Autenticação e i18n
- [ ] **Fase 4**: Core do Bot - Automação Google Meet
- [ ] **Fase 5**: Transcrição Real-Time e WebSocket
- [ ] **Fase 6**: Dashboard, Listagem e Insights com IA

## 📚 Recursos Adicionais

- [Documentação Supabase](https://supabase.com/docs)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Puppeteer Documentation](https://pptr.dev/)
- [Socket.io Documentation](https://socket.io/docs/v4/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Vite Documentation](https://vitejs.dev/)

## 🤝 Suporte

Para dúvidas ou problemas:
1. Verifique a seção de **Troubleshooting** acima
2. Consulte os logs: `docker-compose logs -f` ou `pnpm dev:server`
3. Verifique se todas as variáveis de ambiente estão configuradas

## 📝 Notas Importantes
3 Completa ✅ | Pronto para implementação do Bot Google Meet (Fase 4).

## 🎨 Funcionalidades Implementadas (Fases 1-3)

### ✅ Autenticação
- Login com Google OAuth via Supabase
- AuthContext gerenciando sessão do usuário
- Rotas protegidas (redirecionamento automático)
- Logout funcional com confirmação

### ✅ Internacionalização
- 3 idiomas suportados: PT-BR (padrão), EN-US, ES
- Seletor de idioma com bandeiras na TopNavBar
- Traduções completas da interface
- Persistência de idioma no localStorage
- Helper de formatação de data:
  - DD-MM-AAAA (PT-BR e ES)
  - MM-DD-YYYY (EN-US)

### ✅ Design System
- Dark/Light mode com toggle funcional
- Paleta de cores baseada nos screenshots
- Componentes UI: Card, Button, Badge (todos traduzidos)
- Layout completo: Sidebar, TopNavBar, MainLayout
- Background animado com padrão de pontos

### ✅ Páginas
- LoginPage (autenticação Google)
- DashboardPage (listagem de reuniões mockadas)
- Sistema de rotas com React Router

---

**Status Atual**: Fase 3
- **Custos OpenAI**: Whisper cobra ~$0.006 por minuto de áudio. GPT-4o tem custo variável por tokens.
- **Rate Limiting**: O servidor tem rate limit de 10 req/min por IP para prevenir abuso.
- **Segurança**: Nunca commite o arquivo `.env`. Use `.env.example` como template.
- **Google Meet Bot**: O bot pode ser detectado pelo Google. Use com responsabilidade e apenas em reuniões onde você tem permissão.
- **Formato de Data**: O projeto força globalmente o padrão DD-MM-AAAA (Brasil).

---

**Status Atual**: Fase 1 Completa ✅ | Pronto para desenvolvimento das próximas fases.
