import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { supabase } from '../config/supabase.js';

// DeepSeek usa a mesma interface do OpenAI SDK
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

// Dimensão padrão usada por BANT e SPIN (score 0-10 + evidência textual)
export interface ScoreDimension {
  score: number;   // 0-10
  evidence: string;
}

// BANT continua igual — mantido pra retrocompat
export type BantDimension = ScoreDimension;

export interface BantScore {
  budget: ScoreDimension;
  authority: ScoreDimension;
  need: ScoreDimension;
  timeline: ScoreDimension;
}

export interface SpinScore {
  situation: ScoreDimension;
  problem: ScoreDimension;
  implication: ScoreDimension;
  needPayoff: ScoreDimension;
}

export interface EscalationFlag {
  description: string;
  severity: 'low' | 'medium' | 'high';
}

// Campos comuns a todos os frameworks (Sales e CS)
interface BaseInsights {
  sentiment: 'positive' | 'neutral' | 'negative';
  executiveContext: string;
  followUp: string[];
  followUpSuggestions: string[]; // exatamente 4 sugestões prontas
  keyTopics: string[];
  actionItems: string[];
  participants?: number;
  duration?: number;
}

// Campos comuns a todos os frameworks de Sales (BANT e SPIN)
interface SalesBaseInsights extends BaseInsights {
  commercialQuality: number; // 0-10
  closingProbability: number; // 0-100%
}

export interface BantInsights extends SalesBaseInsights {
  framework: 'bant';
  bantScore: BantScore;
}

export interface SpinInsights extends SalesBaseInsights {
  framework: 'spin';
  spinScore: SpinScore;
}

export interface CsInsights extends BaseInsights {
  framework: 'cs';
  healthScore: number;          // 0-100 (substitui closingProbability)
  churnRisk: 'low' | 'medium' | 'high';
  churnRiskEvidence: string;
  satisfactionScore: number;    // 0-10
  escalationFlags: EscalationFlag[];
}

// Tipo discriminado: framework determina a variante
export type MeetingInsights = BantInsights | SpinInsights | CsInsights;

// Type guards
export function isSalesInsights(insights: MeetingInsights): insights is BantInsights | SpinInsights {
  return insights.framework === 'bant' || insights.framework === 'spin';
}

export function isCsInsights(insights: MeetingInsights): insights is CsInsights {
  return insights.framework === 'cs';
}

/**
 * Normaliza payload de insights vindo do banco.
 * Dados antigos não tinham `framework` — assumimos BANT (era o único modo).
 */
export function normalizeInsights(raw: any): MeetingInsights | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.framework) {
    // Retrocompat: registros antigos sem framework são BANT
    return { ...raw, framework: 'bant' } as BantInsights;
  }
  return raw as MeetingInsights;
}

// Config de avaliação herdada do time da reunião
interface TeamEvaluationConfig {
  teamType: 'sales' | 'customer_success';
  framework: 'bant' | 'spin'; // só relevante quando teamType='sales'
  customInstructions: string | null;
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

      // Parse JSON. Por enquanto (Fase 2a) toda chamada gera no formato BANT —
      // o branching por framework vem na Fase 2b com a config do time.
      const parsed = JSON.parse(content);
      const insights = { ...parsed, framework: 'bant' as const } as BantInsights;

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

      return normalizeInsights(data?.insights);

    } catch (error) {
      logger.error('Error in getInsights:', error);
      return null;
    }
  }

  /**
   * Gera e-mail de follow-up profissional baseado nos insights da reunião.
   * Adapta o framing para Sales (foco em fechamento) ou Customer Success (foco em saúde da conta).
   */
  async generateFollowUpEmail(meetingTitle: string, insights: MeetingInsights): Promise<string> {
    const isCs = isCsInsights(insights);

    const systemPrompt = isCs
      ? `Você é um especialista em Customer Success. Com base nos insights de uma reunião com cliente ativo, escreva um e-mail de follow-up profissional, atencioso e construtivo em português do Brasil.

O e-mail deve:
- Ter assunto na primeira linha no formato "Assunto: ..."
- Ser conciso (máx. 200 palavras no corpo)
- Reforçar parceria de longo prazo e valor entregue
- Endereçar pontos de atenção/risco se houver
- Listar próximos passos acordados
- Ter tom empático e profissional
- Terminar com proposta clara de próximo contato

Retorne APENAS o texto do e-mail (assunto + corpo), sem explicações.`
      : `Você é um especialista em vendas consultivas. Com base nos insights de uma reunião comercial, escreva um e-mail de follow-up profissional, personalizado e persuasivo em português do Brasil.

O e-mail deve:
- Ter assunto na primeira linha no formato "Assunto: ..."
- Ser conciso (máx. 200 palavras no corpo)
- Referenciar os pontos discutidos na reunião
- Incluir os próximos passos acordados
- Ter tom profissional mas humano
- Terminar com uma chamada para ação clara

Retorne APENAS o texto do e-mail (assunto + corpo), sem explicações.`;

    const metricLine = isCs
      ? `Health Score: ${insights.healthScore}/100 | Risco de churn: ${insights.churnRisk}`
      : `Probabilidade de fechamento: ${insights.closingProbability}%`;

    const userPrompt = `Reunião: ${meetingTitle}
Contexto executivo: ${insights.executiveContext}
${metricLine}
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
  async generateBriefing(currentMeetingTitle: string, pastMeetings: { title: string | null; insights: MeetingInsights; created_at?: string }[]): Promise<string> {
    if (pastMeetings.length === 0) return '';

    const systemPrompt = `Você é um assistente de vendas. Com base no histórico de reuniões anteriores com este cliente, gere um briefing pré-reunião conciso e útil em português do Brasil.

O briefing deve:
- Resumir os principais pontos discutidos anteriormente
- Destacar os compromissos e próximos passos que ficaram em aberto
- Pontuar o histórico de interesse, objeções e sentiment do cliente
- Mencionar a probabilidade de fechamento se relevante
- Sugerir 2-3 pontos estratégicos para abordar na reunião atual
- Ser objetivo e direto (máx. 200 palavras)

Retorne APENAS o texto do briefing, sem cabeçalhos ou formatação markdown.`;

    const history = pastMeetings.map((m, i) => {
      const parts = [`Reunião ${i + 1}: ${m.title ?? 'Sem título'}`];
      
      // Adiciona contexto executivo se disponível
      if (m.insights.executiveContext) {
        parts.push(`Contexto: ${m.insights.executiveContext}`);
      }
      
      // Adiciona tópicos principais
      if (m.insights.keyTopics && m.insights.keyTopics.length > 0) {
        parts.push(`Tópicos: ${m.insights.keyTopics.slice(0, 3).join(', ')}`);
      }
      
      // Adiciona ações pendentes
      if (m.insights.actionItems && m.insights.actionItems.length > 0) {
        parts.push(`Ações pendentes: ${m.insights.actionItems.slice(0, 3).join('; ')}`);
      }
      
      // Adiciona sentiment e probabilidade
      const sentiment = m.insights.sentiment === 'positive' ? '😊 Positivo' : 
                       m.insights.sentiment === 'negative' ? '😟 Negativo' : '😐 Neutro';
      parts.push(`Sentiment: ${sentiment}`);
      
      if (isCsInsights(m.insights)) {
        parts.push(`Health Score: ${m.insights.healthScore}/100`);
        parts.push(`Risco de churn: ${m.insights.churnRisk}`);
      } else if (m.insights.closingProbability !== undefined) {
        parts.push(`Prob. fechamento: ${m.insights.closingProbability}%`);
      }
      
      // Adiciona data se disponível
      if (m.created_at) {
        const date = new Date(m.created_at);
        parts.push(`Data: ${date.toLocaleDateString('pt-BR')}`);
      }
      
      return parts.join('\n');
    }).join('\n\n');

    const userPrompt = `Reunião atual: ${currentMeetingTitle}\n\nHistórico de reuniões anteriores:\n${history}`;

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
   * Regenera um FUP aplicando um direcionador de tom específico
   */
  async regenerateFollowUp(
    originalFup: string,
    tone: 'formal' | 'objetivo' | 'urgente' | 'consultivo' | 'criativo',
    transcriptContext: string
  ): Promise<string> {
    const toneInstructions = {
      formal: `Tom FORMAL:
- Linguagem profissional e estruturada
- Tratamento respeitoso e autoritativo
- Evite informalidades e gírias
- Use estrutura clara com saudação, corpo e fechamento
- Adequado para enterprise e primeiro contato`,
      
      objetivo: `Tom OBJETIVO:
- Máximo 3-4 linhas, direto ao ponto
- Sem enrolação ou rodeios
- Foco na ação e próximos passos
- Linguagem clara e sucinta
- Adequado para clientes apressados e reengajamento`,
      
      urgente: `Tom URGENTE:
- Enfatize deadlines e prazos
- Use gatilhos de scarcity (vagas limitadas, oferta temporária)
- Call-to-action forte e imediata
- Senso de oportunidade que não pode ser perdida
- Adequado para fim de mês e propostas vencendo`,
      
      consultivo: `Tom CONSULTIVO:
- Faça perguntas estratégicas
- Demonstre empatia e interesse genuíno
- Foque em entender a situação do cliente
- Linguagem de parceria e diálogo
- Adequado para qualificação e exploração`,
      
      criativo: `Tom CRIATIVO:
- Linguagem descontraída e humanizada
- Use storytelling quando apropriado
- Seja memorável e diferente
- Mantenha profissionalismo mas com personalidade
- Adequado para reengajamento e prospecção`
    };

    const systemPrompt = `Você é um assistente de vendas especializado em follow-ups. Sua tarefa é regenerar uma mensagem de follow-up aplicando um tom específico.

INSTRUÇÕES:
${toneInstructions[tone]}

IMPORTANTE:
- Mantenha a essência e informações-chave da mensagem original
- Adapte APENAS o tom, estilo e estrutura
- A mensagem deve estar pronta para enviar (primeira pessoa)
- Não adicione placeholders como [nome do cliente]
- Use informações do contexto da transcrição quando relevante
- Retorne APENAS o texto da mensagem, sem aspas ou formatação extra`;

    const userPrompt = `Mensagem original:
${originalFup}

Contexto da reunião (use para personalizar):
${transcriptContext.substring(0, 1000)}

Regenere a mensagem aplicando o tom ${tone.toUpperCase()}.`;

    const response = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content?.trim() ?? originalFup;
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
