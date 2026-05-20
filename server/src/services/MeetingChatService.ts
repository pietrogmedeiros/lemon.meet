// ============================================================
// MeetingChatService.ts — Chat de IA por reunião
// ============================================================

import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { supabase } from '../config/supabase.js';
import { getAccessibleMemberIds } from '../utils/teamAccess.js';

// DeepSeek usa a mesma interface do OpenAI SDK
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

const RATE_LIMIT = 10; // 10 perguntas por reunião a cada 24h
const RATE_LIMIT_WINDOW_HOURS = 24;
const MAX_QUESTION_LENGTH = 500;
const MAX_CONTEXT_TOKENS = 10000; // ~7500 palavras
const HISTORY_PAIRS_FOR_CONTEXT = 4; // últimas 4 trocas Q&A no contexto multi-turn

export interface MeetingContext {
  title: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  participantEmails: string[] | null;
  ownerName: string | null;
  insights: Record<string, unknown> | null;
}

export interface ChatMessage {
  id: string;
  meeting_id: string;
  user_id: string;
  question: string;
  answer: string;
  tokens_used: number;
  created_at: string;
}

export interface TranscriptSegment {
  text: string;
  start_seconds: number;
  end_seconds: number;
  speaker: string | null;
  sequence: number;
}

export class MeetingChatService {
  /**
   * Verifica se o usuário atingiu o limite de perguntas para a reunião
   */
  async checkRateLimit(meetingId: string, userId: string): Promise<boolean> {
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - RATE_LIMIT_WINDOW_HOURS);

      const { count, error } = await supabase
        .from('meeting_ai_chats')
        .select('id', { count: 'exact', head: true })
        .eq('meeting_id', meetingId)
        .eq('user_id', userId)
        .gte('created_at', cutoffTime.toISOString());

      if (error) {
        logger.error('Error checking rate limit:', error);
        throw error;
      }

      const hasReachedLimit = (count ?? 0) >= RATE_LIMIT;
      
      if (hasReachedLimit) {
        logger.warn(`Rate limit reached for user ${userId} on meeting ${meetingId}`);
      }

      return hasReachedLimit;

    } catch (error) {
      logger.error('Error in checkRateLimit:', error);
      throw error;
    }
  }

  /**
   * Retorna o número de perguntas restantes para a reunião
   */
  async getRemainingQuestions(meetingId: string, userId: string): Promise<number> {
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - RATE_LIMIT_WINDOW_HOURS);

      const { count, error } = await supabase
        .from('meeting_ai_chats')
        .select('id', { count: 'exact', head: true })
        .eq('meeting_id', meetingId)
        .eq('user_id', userId)
        .gte('created_at', cutoffTime.toISOString());

      if (error) {
        logger.error('Error getting remaining questions:', error);
        throw error;
      }

      const used = count ?? 0;
      const remaining = Math.max(0, RATE_LIMIT - used);

      return remaining;

    } catch (error) {
      logger.error('Error in getRemainingQuestions:', error);
      throw error;
    }
  }

  /**
   * Comprime transcrição se muito longa para caber no limite de tokens
   */
  private compressTranscript(transcript: string): string {
    // Aproximação: 1 token ~= 0.75 palavras em português
    const estimatedTokens = (transcript.split(/\s+/).length / 0.75);
    
    if (estimatedTokens <= MAX_CONTEXT_TOKENS) {
      return transcript;
    }

    // Comprimir pegando apenas os primeiros N caracteres que cabem
    const targetChars = Math.floor(MAX_CONTEXT_TOKENS * 0.75 * 5); // ~5 chars por palavra
    const compressed = transcript.substring(0, targetChars);
    
    logger.info(`Transcript compressed from ${transcript.length} to ${compressed.length} chars`);
    
    return compressed + '\n\n[... transcrição truncada devido ao tamanho ...]';
  }

  /**
   * Formata segundos em MM:SS
   */
  private formatTimestamp(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Formata segmentos com timestamps para contexto da IA
   */
  private formatSegmentsWithTimestamps(segments: TranscriptSegment[]): string {
    return segments.map(seg => {
      const timestamp = this.formatTimestamp(seg.start_seconds);
      const speaker = seg.speaker ? `${seg.speaker}` : 'Speaker';
      return `[${timestamp}] ${speaker}: ${seg.text}`;
    }).join('\n');
  }

  /**
   * Formata insights estruturados em texto legível pra IA usar como contexto.
   * Suporta os 3 frameworks (BANT, SPIN, CS) + payloads legados sem framework.
   */
  private formatInsightsForContext(insights: Record<string, unknown> | null): string {
    if (!insights || typeof insights !== 'object') return '(sem insights estruturados disponíveis)';

    const i = insights as any;
    const framework = i.framework ?? 'bant';
    const lines: string[] = [`Framework: ${String(framework).toUpperCase()}`];

    if (i.executiveContext) lines.push(`Resumo executivo: ${i.executiveContext}`);
    if (i.sentiment) lines.push(`Sentimento: ${i.sentiment}`);

    if (framework === 'cs') {
      if (i.healthScore !== undefined) lines.push(`Health Score: ${i.healthScore}/100`);
      if (i.churnRisk) lines.push(`Risco de churn: ${i.churnRisk}${i.churnRiskEvidence ? ` — ${i.churnRiskEvidence}` : ''}`);
      if (i.satisfactionScore !== undefined) lines.push(`Satisfação: ${i.satisfactionScore}/10`);
      if (Array.isArray(i.escalationFlags) && i.escalationFlags.length > 0) {
        const flags = i.escalationFlags.map((f: any) => `[${f.severity}] ${f.description}`).join('; ');
        lines.push(`Momentos críticos: ${flags}`);
      }
    } else {
      // Sales (BANT ou SPIN)
      if (i.commercialQuality !== undefined) lines.push(`Qualidade comercial: ${i.commercialQuality}/10`);
      if (i.closingProbability !== undefined) lines.push(`Probabilidade de fechamento: ${i.closingProbability}%`);
      if (i.bantScore) {
        const b = i.bantScore;
        lines.push(`BANT: Budget ${b.budget?.score ?? '?'}/10, Authority ${b.authority?.score ?? '?'}/10, Need ${b.need?.score ?? '?'}/10, Timeline ${b.timeline?.score ?? '?'}/10`);
      }
      if (i.spinScore) {
        const s = i.spinScore;
        lines.push(`SPIN: Situation ${s.situation?.score ?? '?'}/10, Problem ${s.problem?.score ?? '?'}/10, Implication ${s.implication?.score ?? '?'}/10, Need-payoff ${s.needPayoff?.score ?? '?'}/10`);
      }
    }

    if (Array.isArray(i.keyTopics) && i.keyTopics.length > 0) {
      lines.push(`Tópicos principais: ${i.keyTopics.join(', ')}`);
    }
    if (Array.isArray(i.actionItems) && i.actionItems.length > 0) {
      lines.push(`Action items já identificados: ${i.actionItems.slice(0, 6).join('; ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Formata metadados da reunião pra contexto da IA.
   */
  private formatMeetingMetadata(ctx: MeetingContext | null): string {
    if (!ctx) return '(metadados indisponíveis)';
    const parts: string[] = [];
    if (ctx.title) parts.push(`Título: ${ctx.title}`);
    if (ctx.startedAt) {
      const d = new Date(ctx.startedAt);
      parts.push(`Data: ${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
    }
    if (typeof ctx.durationSeconds === 'number' && ctx.durationSeconds > 0) {
      parts.push(`Duração: ${Math.round(ctx.durationSeconds / 60)} min`);
    } else if (ctx.startedAt && ctx.endedAt) {
      const dur = Math.round((new Date(ctx.endedAt).getTime() - new Date(ctx.startedAt).getTime()) / 60000);
      if (dur > 0) parts.push(`Duração: ${dur} min`);
    }
    if (ctx.ownerName) parts.push(`Conduzida por: ${ctx.ownerName}`);
    if (ctx.participantEmails && ctx.participantEmails.length > 0) {
      parts.push(`Participantes: ${ctx.participantEmails.join(', ')}`);
    }
    return parts.length > 0 ? parts.join('\n') : '(metadados indisponíveis)';
  }

  /**
   * Gera resposta usando IA com contexto rico: transcrição + insights + metadados + histórico da conversa.
   */
  async generateAnswer(opts: {
    question: string;
    transcript: string;
    meetingId: string;
    segments?: TranscriptSegment[];
    meetingContext?: MeetingContext | null;
    conversationHistory?: ChatMessage[];
  }): Promise<{ answer: string; tokensUsed: number }> {
    try {
      const { question, transcript, meetingId, segments, meetingContext, conversationHistory } = opts;

      if (!question || question.trim().length === 0) {
        throw new Error('Question cannot be empty');
      }

      if (question.length > MAX_QUESTION_LENGTH) {
        throw new Error(`Question too long (max ${MAX_QUESTION_LENGTH} characters)`);
      }

      if (!transcript || transcript.trim().length === 0) {
        throw new Error('Transcript is empty');
      }

      logger.info(`[MeetingChat] Generating answer for ${meetingId}, q.len=${question.length}, history=${conversationHistory?.length ?? 0}, hasInsights=${!!meetingContext?.insights}`);

      // Transcrição: com timestamps se houver segments, senão truncada
      let contextTranscript: string;
      let hasTimestamps = false;

      if (segments && segments.length > 0) {
        contextTranscript = this.formatSegmentsWithTimestamps(segments);
        hasTimestamps = true;
      } else {
        contextTranscript = this.compressTranscript(transcript);
      }

      const metadataBlock = this.formatMeetingMetadata(meetingContext ?? null);
      const insightsBlock = this.formatInsightsForContext(meetingContext?.insights ?? null);

      const systemPrompt = `Você é um analista sênior de reuniões comerciais e de Customer Success. Sua missão NÃO é só extrair dados — é gerar valor real pro usuário: conectar pontos, identificar riscos não óbvios, sugerir próximos passos concretos, e antecipar perguntas que o usuário deveria estar fazendo.

## CONTEXTO DA REUNIÃO

### Metadados
${metadataBlock}

### Análise prévia (insights gerados automaticamente após a reunião)
${insightsBlock}

### Transcrição${hasTimestamps ? ' (com timestamps [MM:SS] no início de cada fala)' : ''}
${contextTranscript}

## DIRETRIZES DE RESPOSTA

### Estilo
- Português brasileiro, tom de analista profissional — direto, sem rodeios.
- Use **negrito** pra destacar nomes próprios, valores, datas, decisões.
- Use markdown leve: listas quando ajudar, parágrafos quando narrativa for melhor. Sem forçar bullets em tudo.
- Tamanho proporcional à pergunta: resposta curta pra pergunta simples; resposta detalhada pra pergunta analítica.
- Emojis raros e funcionais (✅ ⚠️ 💡 💰 📅 🎯 📧). Nunca decorativos.

### Timestamps
${hasTimestamps
  ? '- Inclua **[MM:SS]** em negrito SOMENTE quando citar um momento específico ("o cliente disse X em **[12:34]**"). Não force timestamp em tudo. Em resumos e drafts de mensagem, geralmente NÃO use.'
  : '- Não há timestamps disponíveis nesta transcrição.'}

### Conteúdo
- Cite **evidências concretas** da transcrição (números, nomes, valores, frases).
- **Conecte** a transcrição com os insights estruturados quando fizer sentido (ex: "isso reforça o BANT Need 8/10" ou "alinha com o Health Score 72").
- Se a pergunta pedir um draft (email, mensagem, próximo passo), entregue o texto pronto pra copiar — sem placeholders tipo "[nome do cliente]".
- Se a pergunta for genérica ("resume", "o que aconteceu"), seja completo mas conciso (sem repetir tudo).

### Assertividade
- **Afirme** o que está na transcrição. Evite "talvez", "acredito que", "parece".
- Se a informação não estiver, diga "Não foi mencionado nesta reunião" — sem rodeios.
- Se houver ambiguidade real, mostre as duas leituras possíveis.

### Proatividade — OBRIGATÓRIO
Ao final de TODA resposta, adicione uma seção curta (1-3 frases) com este header exato:

**💡 Observação proativa**

Conteúdo da observação: um insight que o usuário NÃO perguntou mas é relevante pro contexto. Exemplos: um risco não óbvio que aparece na fala, uma oportunidade de upsell/cross-sell, um momento de objeção mal endereçada, uma ação crítica pra próxima semana, um padrão entre essa reunião e a análise prévia.

Se realmente não houver nada útil pra adicionar, OMITA a seção (não escreva "nenhuma observação"). Mas o default é incluir.

Comece a responder diretamente, sem cabeçalho repetindo a pergunta.`;

      // Multi-turn: monta messages com histórico (últimas N trocas) + pergunta atual
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPrompt },
      ];

      const recentHistory = (conversationHistory ?? []).slice(-HISTORY_PAIRS_FOR_CONTEXT);
      for (const turn of recentHistory) {
        if (turn.question) messages.push({ role: 'user', content: turn.question });
        if (turn.answer) messages.push({ role: 'assistant', content: turn.answer });
      }

      messages.push({ role: 'user', content: question });

      const response = await deepseek.chat.completions.create({
        model: 'deepseek-chat',
        messages,
        temperature: 0.35,
        max_tokens: 2000,
      });

      const answer = response.choices[0]?.message?.content?.trim();

      if (!answer) {
        throw new Error('No answer generated by AI');
      }

      const tokensUsed = response.usage?.total_tokens ?? 0;

      logger.info(`[MeetingChat] Answer generated for ${meetingId}, tokens=${tokensUsed}`);

      return { answer, tokensUsed };

    } catch (error: any) {
      logger.error('Error generating answer:', error);
      throw error;
    }
  }

  /**
   * Busca metadados da reunião + nome do dono pra contexto da IA.
   */
  async getMeetingContext(meetingId: string): Promise<MeetingContext | null> {
    try {
      const { data: meeting, error } = await supabase
        .from('meetings')
        .select('title, started_at, ended_at, duration_seconds, participant_emails, insights, user_id')
        .eq('id', meetingId)
        .single();

      if (error || !meeting) return null;

      let ownerName: string | null = null;
      try {
        const { data: profile } = await supabase.auth.admin.getUserById(meeting.user_id);
        ownerName = profile?.user?.user_metadata?.full_name ?? profile?.user?.user_metadata?.name ?? profile?.user?.email ?? null;
      } catch {
        // ignore — owner name é nice-to-have
      }

      return {
        title: meeting.title ?? null,
        startedAt: meeting.started_at ?? null,
        endedAt: meeting.ended_at ?? null,
        durationSeconds: meeting.duration_seconds ?? null,
        participantEmails: (meeting.participant_emails as string[] | null) ?? null,
        ownerName,
        insights: (meeting.insights as Record<string, unknown> | null) ?? null,
      };
    } catch (err) {
      logger.error('Error fetching meeting context:', err);
      return null;
    }
  }

  /**
   * Salva mensagem do chat no banco de dados
   */
  async saveChatMessage(
    meetingId: string,
    userId: string,
    question: string,
    answer: string,
    tokensUsed: number
  ): Promise<ChatMessage> {
    try {
      const { data, error } = await supabase
        .from('meeting_ai_chats')
        .insert({
          meeting_id: meetingId,
          user_id: userId,
          question: question.trim(),
          answer: answer.trim(),
          tokens_used: tokensUsed,
        })
        .select()
        .single();

      if (error) {
        logger.error('Error saving chat message:', error);
        throw error;
      }

      logger.info(`Chat message saved for meeting ${meetingId}`);

      return data as ChatMessage;

    } catch (error) {
      logger.error('Error in saveChatMessage:', error);
      throw error;
    }
  }

  /**
   * Busca histórico de chat de uma reunião
   */
  async getChatHistory(meetingId: string, userId: string): Promise<ChatMessage[]> {
    try {
      const { data, error } = await supabase
        .from('meeting_ai_chats')
        .select('*')
        .eq('meeting_id', meetingId)
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Error fetching chat history:', error);
        throw error;
      }

      return (data as ChatMessage[]) ?? [];

    } catch (error) {
      logger.error('Error in getChatHistory:', error);
      throw error;
    }
  }

  /**
   * Verifica se usuário tem acesso à reunião
   */
  async verifyMeetingAccess(meetingId: string, userId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('user_id')
        .eq('id', meetingId)
        .single();

      if (error || !data) {
        logger.warn(`Meeting not found: ${meetingId}`);
        return false;
      }

      // Busca IDs de membros acessíveis (inclui membros do time)
      const accessibleMemberIds = await getAccessibleMemberIds(userId);
      
      // Verifica se o dono da reunião está na lista de membros acessíveis
      const hasAccess = accessibleMemberIds.includes(data.user_id);
      
      logger.info(`Access check for meeting ${meetingId}: user ${userId} -> owner ${data.user_id} -> hasAccess: ${hasAccess}`);
      
      return hasAccess;

    } catch (error) {
      logger.error('Error verifying meeting access:', error);
      return false;
    }
  }

  /**
   * Busca transcrição da reunião
   */
  async getMeetingTranscript(meetingId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('transcript')
        .eq('id', meetingId)
        .single();

      if (error || !data) {
        return null;
      }

      return data.transcript;

    } catch (error) {
      logger.error('Error fetching meeting transcript:', error);
      return null;
    }
  }

  /**
   * Busca segmentos estruturados da transcrição com timestamps
   */
  async getMeetingSegments(meetingId: string): Promise<TranscriptSegment[]> {
    try {
      logger.info(`[MeetingChat] Buscando segmentos para meeting ${meetingId}...`);
      
      const { data, error } = await supabase
        .from('transcript_segments')
        .select('text, start_seconds, end_seconds, speaker, sequence')
        .eq('meeting_id', meetingId)
        .order('sequence', { ascending: true });

      if (error) {
        logger.error('[MeetingChat] ❌ Erro ao buscar segmentos:', error);
        return [];
      }

      if (!data || data.length === 0) {
        logger.warn(`[MeetingChat] ⚠️  Nenhum segmento encontrado para meeting ${meetingId}`);
        return [];
      }

      logger.info(`[MeetingChat] ✅ ${data.length} segmentos encontrados para meeting ${meetingId}`);
      logger.info(`[MeetingChat] 📊 Primeiro segmento: [${this.formatTimestamp(data[0].start_seconds)}] ${data[0].speaker}: ${data[0].text.substring(0, 50)}...`);
      
      return (data as TranscriptSegment[]) ?? [];

    } catch (error) {
      logger.error('[MeetingChat] ❌ Exceção ao buscar segmentos:', error);
      return [];
    }
  }
}

export const meetingChatService = new MeetingChatService();
