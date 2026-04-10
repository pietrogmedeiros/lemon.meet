<div align="center">

  [![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)](https://react.dev)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
  [![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38BDF8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com)
  [![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o-412991?style=flat-square&logo=openai)](https://openai.com)

  <p><strong>Plataforma inteligente de análise de reuniões do Google Meet</strong><br/>
  Transcrições automáticas, diagnóstico de qualidade e insights acionáveis gerados por IA.</p>
</div>

---

## ✨ Funcionalidades

| Recurso | Descrição |
|---|---|
| 🔐 **Google OAuth** | Login seguro com conta Google via Supabase Auth |
| 📋 **Dashboard** | Visão geral de todas as reuniões com status e Meet Score |
| 🗂️ **Reuniões** | Grade de cards com filtro por status e score de qualidade |
| 🤖 **Agente 1** | Estrutura da reunião: participantes, empresas e pontos-chave |
| 📝 **Agente 2** | Resumo executivo completo em Markdown |
| 📊 **Agente 3** | Avaliação detalhada da reunião com Meet Score (0–10) |
| 📧 **Agente 4** | Diagnóstico formatado para e-mail com score visual e ações imediatas |
| 📈 **Insights** | Análise agregada: ranking de qualidade, empresas, responsáveis e tendências |
| 🌍 **Multilíngue** | Interface em PT-BR, EN-US e ES |

---

## 🤖 Agentes de IA

O Lemon.meet processa cada reunião com 4 agentes especializados:

```
Reunião Transcrita
      │
      ├── Agente 1 ──► Estrutura (participantes, empresas, tópicos)
      ├── Agente 2 ──► Resumo executivo em texto
      ├── Agente 3 ──► Avaliação qualitativa + Meet Score /10
      └── Agente 4 ──► Diagnóstico completo para e-mail
                        (score visual, decisões, análise de deal, ações)
```

### Meet Score
Cada reunião recebe uma nota de **0 a 10** baseada em critérios comerciais e de condução:
- ≥ 8 → Alta qualidade 🟢
- 5–7 → Qualidade média 🟡
- < 5 → Necessita atenção 🔴

---

## 🛠️ Tech Stack

### Frontend
- **React 18** + TypeScript
- **Vite 5** — build ultrarrápido
- **Tailwind CSS v3** — design system customizado com cores Lemon.meet
- **React Router v6** — navegação SPA
- **i18next** — internacionalização (PT-BR / EN-US / ES)
- **Lucide React** — ícones

### Backend
- **Node.js 20+** + Express + TypeScript
- **Supabase** — PostgreSQL + Auth (Google OAuth)
- **Puppeteer** — automação do Google Meet
- **OpenAI API** — Whisper (transcrição) + GPT-4o (agentes)
- **Socket.io** — comunicação em tempo real

### Infraestrutura
- **Supabase** — banco de dados e autenticação
- **Docker** + Docker Compose
- **pnpm** — monorepo

---

## 🚀 Quick Start

### Pré-requisitos
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Conta Supabase
- Chave de API OpenAI

### 1. Clone o repositório

```bash
git clone https://github.com/pietrogmedeiros/lemon.meet.git
cd lemon.meet
```

### 2. Instale as dependências

```bash
pnpm install
```

### 3. Configure as variáveis de ambiente

```bash
# Raiz do projeto
cp .env.example .env

# Frontend
cp web/.env.example web/.env
```

Edite `web/.env`:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-anon-key
VITE_API_URL=http://localhost:3000
```

Edite `.env` (backend):

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_KEY=sua-service-role-key
OPENAI_API_KEY=sk-...
PORT=3000
```

### 4. Configure o Supabase

Execute os scripts SQL no Supabase SQL Editor:

```bash
# 1. Criar tabelas
supabase-setup.sql

# 2. Criar usuário de serviço
supabase-create-user.sql
```

Consulte [SUPABASE_SETUP_GUIDE.md](./SUPABASE_SETUP_GUIDE.md) para instruções detalhadas.

### 5. Execute o projeto

```bash
# Desenvolvimento (frontend + backend em paralelo)
pnpm dev

# Ou com Docker
docker-compose up --build
```

### 6. Acesse

| Serviço | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3000 |

---

## 📁 Estrutura do Projeto

```
lemon.meet/
├── web/                        # Frontend React
│   ├── src/
│   │   ├── pages/
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── MeetingsPage.tsx
│   │   │   ├── TranscricaoDetalhesPage.tsx
│   │   │   └── InsightsPage.tsx
│   │   ├── components/
│   │   │   ├── layout/         # Sidebar, TopNavBar, MainLayout
│   │   │   └── ui/             # Button, Card, Badge
│   │   ├── contexts/           # AuthContext, ThemeContext
│   │   └── locales/            # pt-BR, en-US, es
│   └── public/
│       ├── logo.png            # Ícone Lemon
│       └── lemon.meet.png      # Logo completo
│
├── server/                     # Backend Node.js
│   └── src/
│       ├── routes/
│       ├── services/           # AudioCapture, Bot, Transcription
│       └── config/             # Supabase, Socket
│
├── docker-compose.yml
├── supabase-setup.sql
└── SUPABASE_SETUP_GUIDE.md
```

---

## 📝 Scripts Disponíveis

```bash
pnpm dev              # Frontend + backend em paralelo
pnpm dev:web          # Apenas frontend (porta 5173)
pnpm dev:server       # Apenas backend (porta 3000)
pnpm build            # Build de produção
pnpm lint             # Lint em todos os pacotes
```

---

## 📄 Licença

MIT © [Pietro Medeiros](https://github.com/pietrogmedeiros)

## 🙏 Agradecimentos

- [OpenAI](https://openai.com) pela API Whisper e GPT-4o
- [Supabase](https://supabase.com) pela infraestrutura de backend
- [Puppeteer](https://pptr.dev) pela automação de navegador
- Comunidade open-source por todas as bibliotecas incríveis

---

Desenvolvido com ❤️ por [Pietro Medeiros](https://github.com/pietrogmedeiros)
