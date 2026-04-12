import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { supabase } from '../config/supabase.js';

// DeepSeek usa a mesma interface do OpenAI SDK
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

export interface BantDimension {
  score: number;   // 0-10
  evidence: string;
}

export interface BantScore {
  budget: BantDimension;
  authority: BantDimension;
  need: BantDimension;
  timeline: BantDimension;
}

export interface MeetingInsights {
  sentiment: 'positive' | 'neutral' | 'negative';
  commercialQuality: number; // 0-10
  executiveContext: string;
  closingProbability: number; // 0-100%
  followUp: string[];
  followUpSuggestions: string[]; // exactly 4 sales follow-up suggestions
  keyTopics: string[];
  actionItems: string[];
  bantScore?: BantScore;
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
      const systemPrompt = `Você é um assistente especializado em análise de reuniões comerciais para times de vendas. 
Analise a transcrição fornecida e retorne um JSON estruturado com os seguintes campos:

{
  "sentiment": "positive" | "neutral" | "negative",
  "commercialQuality": <número de 0 a 10>,
  "executiveContext": "<resumo executivo em 2-3 frases>",
  "closingProbability": <número de 0 a 100>,
  "followUp": ["<ação 1>", "<ação 2>", ...],
  "followUpSuggestions": ["<sugestão 1>", "<sugestão 2>", "<sugestão 3>", "<sugestão 4>"],
  "keyTopics": ["<tópico 1>", "<tópico 2>", ...],
  "actionItems": ["<item 1>", "<item 2>", ...],
  "bantScore": {
    "budget": { "score": <0-10>, "evidence": "<evidência encontrada na transcrição>" },
    "authority": { "score": <0-10>, "evidence": "<evidência encontrada na transcrição>" },
    "need": { "score": <0-10>, "evidence": "<evidência encontrada na transcrição>" },
    "timeline": { "score": <0-10>, "evidence": "<evidência encontrada na transcrição>" }
  }
}

Critérios:
- sentiment: Analise o tom geral (positivo, neutro ou negativo)
- commercialQuality: Avalie a qualidade comercial da reunião (engajamento, clareza, objetividade)
- executiveContext: Resuma os pontos principais para um executivo
- closingProbability: Probabilidade de fechamento do negócio baseado nos sinais da reunião
- followUp: Próximos passos gerais recomendados
- followUpSuggestions: EXATAMENTE 4 mensagens prontas para enviar diretamente ao cliente via e-mail ou WhatsApp após a reunião. Cada mensagem deve estar escrita na primeira pessoa ("Olá [nome/cliente], ...") em português do Brasil, tom profissional mas humano, referenciar algo específico discutido na reunião, e ter uma chamada para ação clara. Não escreva instruções para o vendedor — escreva o texto da mensagem em si, como se fosse disparar agora. Ordene da mais urgente para a menos urgente.
- keyTopics: Principais temas discutidos
- actionItems: Itens de ação identificados
- bantScore: Avalie a qualidade de cada dimensão BANT com base em evidências concretas da transcrição. Score 0 = sem evidência, 10 = confirmação explícita e forte. Se não houver evidência para alguma dimensão, use score 0 e evidence "Não mencionado na reunião".

Retorne APENAS o JSON válido, sem texto adicional.`;

      const userPrompt = `Transcrição da reunião:\n\n${transcript}`;

      // Chama DeepSeek V3
      const response = await deepseek.chat.completions.create({
        model: 'deepseek-chat', // deepseek-chat = DeepSeek V3
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No content in DeepSeek response');
      }

      // Parse JSON
      const insights: MeetingInsights = JSON.parse(content);

      // Validações básicas
      if (!insights.sentiment || !insights.executiveContext) {
        throw new Error('Invalid insights format from DeepSeek');
      }

      logger.info(`Insights generated successfully for meeting ${meetingId}`);

      return insights;

    } catch (error: any) {
      logger.error('Error generating insights:', error);
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
   * Gera e-mail de follow-up profissional baseado nos insights da reunião
   */
  async generateFollowUpEmail(meetingTitle: string, insights: MeetingInsights): Promise<string> {
    const systemPrompt = `Você é um especialista em vendas consultivas. Com base nos insights de uma reunião comercial, escreva um e-mail de follow-up profissional, personalizado e persuasivo em português do Brasil.

O e-mail deve:
- Ter assunto na primeira linha no formato "Assunto: ..."
- Ser conciso (máx. 200 palavras no corpo)
- Referenciar os pontos discutidos na reunião
- Incluir os próximos passos acordados
- Ter tom profissional mas humano
- Terminar com uma chamada para ação clara

Retorne APENAS o texto do e-mail (assunto + corpo), sem explicações.`;

    const userPrompt = `Reunião: ${meetingTitle}
Contexto executivo: ${insights.executiveContext}
Probabilidade de fechamento: ${insights.closingProbability}%
Próximos passos: ${insights.actionItems.slice(0, 3).join('; ')}
Sugestões de follow-up: ${insights.followUpSuggestions.slice(0, 2).join('; ')}`;

    const response = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
    });

    return response.choices[0]?.message?.content ?? '';
  }

  /**
   * Gera briefing pré-reunião baseado no histórico de reuniões anteriores
   */
  async generateBriefing(currentMeetingTitle: string, pastMeetings: { title: string | null; insights: MeetingInsights }[]): Promise<string> {
    if (pastMeetings.length === 0) return '';

    const systemPrompt = `Você é um assistente de vendas. Com base no histórico de reuniões anteriores com este cliente, gere um briefing pré-reunião conciso e útil em português do Brasil.

O briefing deve:
- Resumir os principais pontos discutidos anteriormente
- Destacar os compromissos e próximos passos que ficaram em aberto
- Pontuar o histórico de interesse e objeções do cliente
- Sugerir 2-3 pontos para abordar na reunião atual
- Ser objetivo (máx. 180 palavras)

Retorne APENAS o texto do briefing, sem cabeçalhos ou formatação markdown.`;

    const history = pastMeetings.map((m, i) =>
      `Reunião ${i + 1}: ${m.title ?? 'Sem título'}\nContexto: ${m.insights.executiveContext}\nAções pendentes: ${m.insights.actionItems.slice(0, 2).join('; ')}`
    ).join('\n\n');

    const userPrompt = `Reunião atual: ${currentMeetingTitle}\n\nHistórico:\n${history}`;

    const response = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
    });

    return response.choices[0]?.message?.content ?? '';
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
