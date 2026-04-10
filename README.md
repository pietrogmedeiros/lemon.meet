# 🎙️ Vibe AI

> **SaaS de transcrição e insights inteligentes para reuniões do Google Meet**

Vibe AI é uma plataforma que automatiza a participação em reuniões do Google Meet através de um bot inteligente, realiza transcrição em tempo real usando Whisper API e gera insights acionáveis com GPT-4o.

## ✨ Funcionalidades

- 🤖 **Bot Automatizado**: Entra automaticamente em reuniões do Google Meet
- 🎤 **Transcrição em Tempo Real**: Transcrição precisa usando OpenAI Whisper API
- 📊 **Insights Inteligentes**: Análise de sentimento, qualidade comercial e contexto executivo
- 🔄 **WebSocket Real-Time**: Visualização de transcrição ao vivo durante a reunião
- 🌍 **Multilíngue**: Suporte para PT-BR, EN-US e ES
- 🌓 **Dark/Light Mode**: Interface adaptável com design moderno
- 🔐 **Autenticação Google**: Login seguro via OAuth do Google
- 📈 **Dashboard Intuitivo**: Gerenciamento fácil de todas as reuniões

## 🛠️ Tech Stack

### Frontend
- **React 18** com TypeScript
- **Vite** para build ultrarrápido
- **Tailwind CSS** para estilização
- **Lucide React** para ícones
- **i18next** para internacionalização
- **Socket.io Client** para WebSocket

### Backend
- **Node.js 20+** com Express
- **TypeScript** para type safety
- **Socket.io** para comunicação real-time
- **Puppeteer** para automação do Google Meet
- **OpenAI API** (Whisper + GPT-4o)

### Infraestrutura
- **Supabase** (PostgreSQL + Auth)
- **Docker** para containerização
- **pnpm** para gerenciamento de monorepo

## 🚀 Quick Start

### 1. Clone o repositório

```bash
git clone https://github.com/seu-usuario/vibe-ai.git
cd vibe-ai
```

### 2. Instale as dependências

```bash
npm install -g pnpm
pnpm install
```

### 3. Configure as variáveis de ambiente

```bash
cp .env.example .env
# Edite o .env com suas credenciais
```

### 4. Execute o projeto

**Opção A: Desenvolvimento Local**
```bash
pnpm dev
```

**Opção B: Docker (Recomendado)**
```bash
docker-compose up --build
```

### 5. Acesse a aplicação

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000

## 📖 Documentação Completa

Para instruções detalhadas de configuração, troubleshooting e deployment, consulte [instructions.md](./instructions.md).

## 🏗️ Arquitetura

```
┌─────────────────┐         ┌──────────────────┐
│                 │         │                  │
│  React Frontend │◄────────│  Express Backend │
│   (Port 5173)   │ Socket  │   (Port 3000)    │
│                 │  .io    │                  │
└─────────────────┘         └────────┬─────────┘
                                     │
                 ┌───────────────────┼──────────────────┐
                 │                   │                  │
         ┌───────▼─────┐    ┌────────▼────┐   ┌────────▼────┐
         │             │    │             │   │             │
         │  Supabase   │    │  Puppeteer  │   │  OpenAI API │
         │  (Auth+DB)  │    │  (Bot Meet) │   │ (Whisper+   │
         │             │    │             │   │   GPT-4o)   │
         └─────────────┘    └─────────────┘   └─────────────┘
```

## 📋 Status do Projeto

- ✅ **Fase 1**: Setup Inicial e Infraestrutura Base
- ⏳ **Fase 2**: Design System e Layout Base
- ⏳ **Fase 3**: Autenticação e i18n
- ⏳ **Fase 4**: Core do Bot - Automação Google Meet
- ⏳ **Fase 5**: Transcrição Real-Time e WebSocket
- ⏳ **Fase 6**: Dashboard e Insights com IA

## 🎨 Preview

*Screenshots serão adicionados nas próximas fases*

## 🧪 Testes

```bash
# Executar todos os testes
pnpm test

# Testes do backend
pnpm --filter @vibe-ai/server test

# Testes do frontend
pnpm --filter @vibe-ai/web test
```

## 📝 Scripts Disponíveis

```bash
pnpm dev              # Executar frontend + backend em paralelo
pnpm dev:web          # Apenas frontend
pnpm dev:server       # Apenas backend
pnpm build            # Build de produção
pnpm lint             # Lint em todos os pacotes
pnpm clean            # Limpar build e node_modules
```

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## ⚠️ Avisos Importantes

- **Custos**: OpenAI API tem custos variáveis. Whisper: ~$0.006/min de áudio
- **Privacidade**: Use apenas em reuniões onde você tem permissão
- **Google Meet**: O bot pode ser detectado. Use com responsabilidade
- **Rate Limiting**: API tem limite de 10 req/min por IP

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🙏 Agradecimentos

- [OpenAI](https://openai.com) pela API Whisper e GPT-4o
- [Supabase](https://supabase.com) pela infraestrutura de backend
- [Puppeteer](https://pptr.dev) pela automação de navegador
- Comunidade open-source por todas as bibliotecas incríveis

---

Desenvolvido com ❤️ por [Seu Nome]
