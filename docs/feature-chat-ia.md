# Feature: Chat de IA por Reunião

## 📋 Visão Geral
Sistema de chat de IA dentro de cada reunião processada, permitindo perguntas contextuais sobre a transcrição.

**Limites:**
- 10 perguntas por reunião a cada 24 horas
- Respostas baseadas apenas na transcrição existente (sem reprocessamento)

## 🗄️ Estrutura do Banco de Dados

### Nova Tabela: `meeting_ai_chats`

```sql
CREATE TABLE meeting_ai_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT meeting_ai_chats_question_not_empty CHECK (char_length(trim(question)) > 0)
);

-- Índices para performance
CREATE INDEX idx_meeting_ai_chats_meeting_id ON meeting_ai_chats(meeting_id);
CREATE INDEX idx_meeting_ai_chats_user_id ON meeting_ai_chats(user_id);
CREATE INDEX idx_meeting_ai_chats_created_at ON meeting_ai_chats(created_at DESC);

-- RLS Policies
ALTER TABLE meeting_ai_chats ENABLE ROW LEVEL SECURITY;

-- Usuários podem ver apenas seus próprios chats
CREATE POLICY "Users can view their own chats"
  ON meeting_ai_chats
  FOR SELECT
  USING (auth.uid() = user_id);

-- Usuários podem inserir chats em reuniões que possuem
CREATE POLICY "Users can insert chats in their meetings"
  ON meeting_ai_chats
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = meeting_ai_chats.meeting_id
      AND meetings.user_id = auth.uid()
    )
  );
```

## 🔧 Backend

### 1. Novo Service: `MeetingChatService.ts`

**Responsabilidades:**
- Validar limite de perguntas (10 em 24h)
- Processar pergunta usando contexto da transcrição
- Salvar histórico no banco
- Gerenciar tokens/custos

**Métodos principais:**
```typescript
- checkRateLimit(meetingId: string, userId: string): Promise<boolean>
- getRemainingQuestions(meetingId: string, userId: string): Promise<number>
- generateAnswer(question: string, transcript: string): Promise<string>
- saveChatMessage(meetingId: string, userId: string, question: string, answer: string): Promise<void>
- getChatHistory(meetingId: string, userId: string): Promise<ChatMessage[]>
```

**Otimizações:**
- Limitar tamanho do contexto enviado para IA (máximo 10.000 tokens)
- Usar DeepSeek (mais barato que GPT-4)
- Comprimir transcrição se muito longa
- Cache de contexto por reunião

### 2. Novo Endpoint: `/api/meetings/:id/chat`

**POST** - Enviar nova pergunta
```typescript
Body: {
  question: string
}

Response: {
  success: boolean
  answer?: string
  remainingQuestions?: number
  error?: string
}
```

**GET** - Buscar histórico de chat
```typescript
Response: {
  success: boolean
  chats: Array<{
    id: string
    question: string
    answer: string
    created_at: string
  }>
  remainingQuestions: number
}
```

## 🎨 Frontend

### 1. Novo Componente: `MeetingChatTab.tsx`

**Estrutura:**
```tsx
- Header com contador de perguntas restantes
- Lista de mensagens (histórico)
- Input de pergunta com botão enviar
- Loading states
- Error handling
- Empty state (nenhuma pergunta ainda)
```

**Estados:**
```typescript
- chatHistory: ChatMessage[]
- question: string
- isLoading: boolean
- remainingQuestions: number
- error: string | null
```

### 2. Integração na `TranscricaoDetalhesPage.tsx`

- Adicionar nova aba "Chats de IA" (já existe visualmente)
- Renderizar `MeetingChatTab` quando aba selecionada
- Passar meeting_id e dados necessários

## 📊 Considerações de Custo

**DeepSeek Pricing:**
- Input: ~$0.14 / 1M tokens
- Output: ~$0.28 / 1M tokens

**Estimativa por pergunta:**
- Contexto (transcrição): ~2.000-5.000 tokens
- Pergunta: ~50-100 tokens
- Resposta: ~200-500 tokens
- **Custo médio: $0.001 - $0.002 por pergunta**
- **10 perguntas/reunião: ~$0.01 - $0.02**

**Otimizações de custo:**
1. Limitar contexto a trechos relevantes (future: embedding search)
2. Comprimir transcrições muito longas
3. Cache de respostas comuns
4. Limite de 10 perguntas/24h por reunião

## 🚀 Plano de Implementação

### Fase 1: Backend (Prioridade)
1. ✅ Criar migration SQL para tabela
2. ✅ Criar `MeetingChatService.ts`
3. ✅ Criar endpoints em `meetings.routes.ts`
4. ✅ Testes básicos

### Fase 2: Frontend
1. ✅ Criar componente `MeetingChatTab.tsx`
2. ✅ Integrar na página de detalhes
3. ✅ Estilização seguindo design system
4. ✅ Loading states e error handling

### Fase 3: Testes e Refinamento
1. ✅ Testar limite de perguntas
2. ✅ Testar qualidade das respostas
3. ✅ Ajustar prompts se necessário
4. ✅ Monitorar custos

## 🔒 Segurança e Validações

1. **Rate Limiting:**
   - 10 perguntas por reunião a cada 24h
   - Validar no backend (não confiar no frontend)

2. **Validações:**
   - Pergunta não pode estar vazia
   - Tamanho máximo da pergunta: 500 caracteres
   - Usuário deve ser dono da reunião
   - Reunião deve ter transcrição

3. **Proteções:**
   - RLS no Supabase
   - Sanitização de inputs
   - Rate limiting por IP (opcional)

## 📈 Métricas a Monitorar

1. Número de perguntas por usuário
2. Reuniões mais consultadas
3. Tempo de resposta
4. Custos de IA
5. Taxa de erros
6. Qualidade das respostas (feedback futuro)

## 🎯 Funcionalidades Futuras (v2)

1. **Busca Semântica:**
   - Embeddings da transcrição
   - Buscar apenas trechos relevantes
   - Reduzir custos e melhorar respostas

2. **Feedback:**
   - 👍 👎 nas respostas
   - Melhorar prompts baseado em feedback

3. **Sugestões de Perguntas:**
   - Perguntas comuns pré-definidas
   - Perguntas baseadas no conteúdo

4. **Exportar Chat:**
   - Download do histórico de perguntas
   - Compartilhar insights

5. **Análise de Sentimento:**
   - Detectar tom da pergunta
   - Ajustar tom da resposta
