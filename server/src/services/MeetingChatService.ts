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
   * Gera resposta usando IA com contexto da transcrição
   */
  async generateAnswer(question: string, transcript: string, meetingId: string, segments?: TranscriptSegment[]): Promise<{ answer: string; tokensUsed: number }> {
    try {
      if (!question || question.trim().length === 0) {
        throw new Error('Question cannot be empty');
      }

      if (question.length > MAX_QUESTION_LENGTH) {
        throw new Error(`Question too long (max ${MAX_QUESTION_LENGTH} characters)`);
      }

      if (!transcript || transcript.trim().length === 0) {
        throw new Error('Transcript is empty');
      }

      logger.info(`Generating answer for meeting ${meetingId}, question length: ${question.length}`);

      // Se tiver segmentos estruturados, usar formato com timestamps
      let contextTranscript: string;
      let hasTimestamps = false;
      
      if (segments && segments.length > 0) {
        contextTranscript = this.formatSegmentsWithTimestamps(segments);
        hasTimestamps = true;
        logger.info(`[MeetingChat] ✅ Usando ${segments.length} segmentos COM TIMESTAMPS`);
        logger.info(`[MeetingChat] 📝 Exemplo do contexto: ${contextTranscript.substring(0, 200)}...`);
      } else {
        contextTranscript = this.compressTranscript(transcript);
        logger.warn(`[MeetingChat] ⚠️  SEM segmentos - usando transcrição completa SEM timestamps`);
      }

      const systemPrompt = `Você é um assistente de IA especializado em analisar reuniões de vendas e negócios.

Sua função é responder perguntas sobre uma reunião específica com base EXCLUSIVAMENTE na transcrição fornecida.

${hasTimestamps ? `ATENÇÃO: A transcrição contém timestamps [MM:SS] no início de cada fala. Você DEVE incluir esses timestamps nas suas respostas.

FORMATO OBRIGATÓRIO COM TIMESTAMPS:
Cada bullet point DEVE começar com o timestamp em negrito seguido de hífen:

• **10:23** - Descrição do que foi dito nesse momento
• **15:45** - Outra informação com dados específicos

EXEMPLO DE RESPOSTA CORRETA:
Pergunta: "Quando falaram sobre preço?"
Resposta:
**O preço foi discutido em 2 momentos:**

• **10:23** - Cliente perguntou sobre valores, mencionou orçamento de R$ 50 mil
• **25:17** - Vendedor apresentou proposta de R$ 15.000/mês com desconto de 10%

FORMATO INCORRETO (NÃO FAÇA ASSIM):
• Mencionou R$ 15.000/mês - 10:23 ❌
• Cliente perguntou sobre valores 10:23 ❌
• 10:23 Cliente perguntou ❌

FORMATO CORRETO (FAÇA ASSIM):
• **10:23** - Cliente perguntou sobre valores ✅
` : `FORMATO DE RESPOSTA:
Organize em tópicos com bullet points quando houver múltiplas informações.
`}

REGRAS IMPORTANTES:
• Responda APENAS com base na transcrição fornecida
• Se a informação não estiver na transcrição, diga: "❌ Essa informação não foi mencionada nesta reunião"
• Seja específico com dados: nomes, valores, datas, números exatos
• Use negrito para destacar informações-chave
• Máximo 5-6 tópicos por resposta
• Use emojis ocasionalmente (✅ ⚠️ 💰 📅 👤 🕐)

Seja um analista preciso e orientado a dados.`;

      const userPrompt = `Transcrição da reunião${hasTimestamps ? ' (com timestamps [MM:SS])' : ''}:

${contextTranscript}

---

Pergunta: "${question}"

Analise a transcrição e responda de forma estruturada e assertiva${hasTimestamps ? ', incluindo timestamps quando mencionar momentos específicos' : ''}:`;

      // Chama DeepSeek
      const response = await deepseek.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });

      const answer = response.choices[0]?.message?.content?.trim();

      if (!answer) {
        throw new Error('No answer generated by AI');
      }

      const tokensUsed = response.usage?.total_tokens ?? 0;

      logger.info(`Answer generated successfully for meeting ${meetingId}, tokens used: ${tokensUsed}`);

      return { answer, tokensUsed };

    } catch (error: any) {
      logger.error('Error generating answer:', error);
      throw error;
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
