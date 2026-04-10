import OpenAI from 'openai';
import { logger } from '../utils/logger';
import { supabase } from '../config/supabase';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export interface MeetingInsights {
  sentiment: 'positive' | 'neutral' | 'negative';
  commercialQuality: number; // 0-10
  executiveContext: string;
  closingProbability: number; // 0-100%
  followUp: string[];
  keyTopics: string[];
  actionItems: string[];
  participants?: number;
  duration?: number;
}

export class InsightsService {
  /**
   * Gera insights usando GPT-4o a partir da transcrição
   */
  async generateInsights(transcript: string, meetingId: string): Promise<MeetingInsights> {
    try {
      logger.info(`Generating insights for meeting ${meetingId}`);

      if (!transcript || transcript.trim().length === 0) {
        throw new Error('Transcript is empty');
      }

      // Prompt estruturado para GPT-4o
      const systemPrompt = `Você é um assistente especializado em análise de reuniões comerciais. 
Analise a transcrição fornecida e retorne um JSON estruturado com os seguintes campos:

{
  "sentiment": "positive" | "neutral" | "negative",
  "commercialQuality": <número de 0 a 10>,
  "executiveContext": "<resumo executivo em 2-3 frases>",
  "closingProbability": <número de 0 a 100>,
  "followUp": ["<ação 1>", "<ação 2>", ...],
  "keyTopics": ["<tópico 1>", "<tópico 2>", ...],
  "actionItems": ["<item 1>", "<item 2>", ...]
}

Critérios:
- sentiment: Analise o tom geral (positivo, neutro ou negativo)
- commercialQuality: Avalie a qualidade comercial da reunião (engajamento, clareza, objetividade)
- executiveContext: Resuma os pontos principais para um executivo
- closingProbability: Probabilidade de fechamento do negócio baseado nos sinais da reunião
- followUp: Próximos passos recomendados
- keyTopics: Principais temas discutidos
- actionItems: Itens de ação identificados

Retorne APENAS o JSON válido, sem texto adicional.`;

      const userPrompt = `Transcrição da reunião:\n\n${transcript}`;

      // Chama GPT-4o
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3, // Baixa temperatura para respostas mais consistentes
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content in GPT-4o response');
      }

      // Parse JSON
      const insights: MeetingInsights = JSON.parse(content);

      // Validações básicas
      if (!insights.sentiment || !insights.executiveContext) {
        throw new Error('Invalid insights format from GPT-4o');
      }

      logger.info(`Insights generated successfully for meeting ${meetingId}`);

      return insights;

    } catch (error: any) {
      logger.error('Error generating insights:', error);
      
      if (error.response) {
        logger.error('OpenAI API error:', {
          status: error.response.status,
          data: error.response.data
        });
      }

      throw error;
    }
  }

  /**
   * Salva insights no banco de dados
   */
  async saveInsights(meetingId: string, insights: MeetingInsights): Promise<void> {
    try {
      const { error } = await supabase
        .from('meetings')
        .update({
          insights: insights as any,
          updated_at: new Date().toISOString()
        })
        .eq('id', meetingId);

      if (error) {
        logger.error('Error saving insights to database:', error);
        throw error;
      }

      logger.info(`Insights saved for meeting ${meetingId}`);

    } catch (error) {
      logger.error('Error in saveInsights:', error);
      throw error;
    }
  }

  /**
   * Gera e salva insights (método completo)
   */
  async processInsights(meetingId: string, transcript: string): Promise<MeetingInsights> {
    try {
      // Gera insights
      const insights = await this.generateInsights(transcript, meetingId);

      // Salva no banco
      await this.saveInsights(meetingId, insights);

      return insights;

    } catch (error) {
      logger.error(`Error processing insights for meeting ${meetingId}:`, error);
      throw error;
    }
  }

  /**
   * Busca insights salvos
   */
  async getInsights(meetingId: string): Promise<MeetingInsights | null> {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('insights')
        .eq('id', meetingId)
        .single();

      if (error) {
        logger.error('Error fetching insights:', error);
        return null;
      }

      return data?.insights as MeetingInsights || null;

    } catch (error) {
      logger.error('Error in getInsights:', error);
      return null;
    }
  }

  /**
   * Gera insights de forma assíncrona (para ser chamado após reunião terminar)
   */
  async generateInsightsAsync(meetingId: string): Promise<void> {
    try {
      // Busca transcrição
      const { data: meeting, error } = await supabase
        .from('meetings')
        .select('transcript, status')
        .eq('id', meetingId)
        .single();

      if (error || !meeting) {
        logger.error(`Meeting ${meetingId} not found`);
        return;
      }

      if (!meeting.transcript || meeting.transcript.trim().length === 0) {
        logger.warn(`Meeting ${meetingId} has no transcript yet`);
        return;
      }

      // Gera e salva insights
      await this.processInsights(meetingId, meeting.transcript);

      logger.info(`Async insights generation completed for meeting ${meetingId}`);

    } catch (error) {
      logger.error(`Error in async insights generation for meeting ${meetingId}:`, error);
    }
  }
}

// Singleton
export const insightsService = new InsightsService();
