import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { supabase } from '../config/supabase.js';

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

export interface RapportCompany {
  name: string;
  description: string;
  mainProducts: string[];
  recentHighlights: string[];
  talkingPoints: string[];
}

export interface RapportPerson {
  name: string;
  role: string;
  background: string;
  conversationStarters: string[];
}

export interface RapportData {
  company?: RapportCompany;
  person?: RapportPerson;
  rapportTips: string[];
  iceBreakers: string[];
  suggestedTopics: string[];
}

export interface MeetingRapport {
  id: string;
  meeting_id: string;
  user_id: string;
  website_url: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  rapport_data: RapportData | null;
  created_at: string;
  updated_at: string;
}

export interface RapportUrls {
  website?: string;
  linkedin?: string;
  instagram?: string;
}

// ── Utilitário: strip de tags HTML ──────────────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Utilitário: extrai handle/nome da URL ────────────────────────────────────
function extractHandleFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

export class RapportService {
  /**
   * Faz scraping leve do website (fetch + strip HTML, limitado a 6000 chars)
   */
  async scrapeWebsite(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LemonMeet/1.0; +https://lemon.meet)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ao buscar ${url}`);
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        throw new Error('Tipo de conteúdo não suportado: ' + contentType);
      }

      const raw = await res.text();
      const stripped = stripHtml(raw);
      return stripped.slice(0, 6_000);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Chama DeepSeek V3 para gerar o rapport estruturado
   */
  async generateRapport(urls: RapportUrls, scrapedContent?: string): Promise<RapportData> {
    const linkedinHandle = urls.linkedin ? extractHandleFromUrl(urls.linkedin) : null;
    const instagramHandle = urls.instagram ? extractHandleFromUrl(urls.instagram) : null;

    const contextParts: string[] = [];

    if (scrapedContent) {
      contextParts.push(`## Conteúdo extraído do site (${urls.website})\n${scrapedContent}`);
    }
    if (urls.linkedin) {
      contextParts.push(`## LinkedIn\nURL: ${urls.linkedin}\nHandle/ID: ${linkedinHandle ?? 'desconhecido'}`);
    }
    if (urls.instagram) {
      contextParts.push(`## Instagram\nURL: ${urls.instagram}\nHandle: ${instagramHandle ?? 'desconhecido'}`);
    }

    const isPersonProfile = !!(urls.linkedin && !urls.website);

    const systemPrompt = `Você é um especialista em vendas consultivas e rapport em reuniões B2B. 
Com base nas informações fornecidas, gere um JSON estruturado para ajudar o vendedor a criar conexão genuína antes e durante a reunião.

Regras importantes:
- Responda APENAS em JSON válido, sem texto fora do JSON
- Use português do Brasil
- Seja específico e prático — dicas genéricas têm pouco valor
- Se a URL for de LinkedIn de pessoa física, preencha "person" em vez de "company"
- Se for site de empresa ou LinkedIn de empresa, preencha "company"
- Se houver LinkedIn de pessoa E site de empresa, preencha ambos
- Baseie-se nos dados reais fornecidos; para dados não disponíveis, use conhecimento geral público

Retorne exatamente este formato:
{
  "company": {
    "name": "<nome da empresa>",
    "description": "<descrição em 1-2 frases>",
    "mainProducts": ["<produto/serviço 1>", "<produto/serviço 2>"],
    "recentHighlights": ["<destaque ou notícia recente 1>", "<destaque 2>"],
    "talkingPoints": ["<ponto de conversa relevante 1>", "<ponto 2>", "<ponto 3>"]
  },
  "person": {
    "name": "<nome completo>",
    "role": "<cargo atual>",
    "background": "<trajetória em 1-2 frases>",
    "conversationStarters": ["<início de conversa 1>", "<início 2>"]
  },
  "rapportTips": ["<dica de rapport 1>", "<dica 2>", "<dica 3>"],
  "iceBreakers": ["<icebreaker 1>", "<icebreaker 2>"],
  "suggestedTopics": ["<tópico relevante 1>", "<tópico 2>", "<tópico 3>"]
}

Omita "company" se for apenas perfil pessoal. Omita "person" se for apenas empresa sem perfil pessoal.`;

    const userPrompt = contextParts.length > 0
      ? `Analise as informações abaixo e gere o rapport:\n\n${contextParts.join('\n\n')}`
      : `Gere rapport com base nas URLs fornecidas:\n- Website: ${urls.website ?? 'não informado'}\n- LinkedIn: ${urls.linkedin ?? 'não informado'}\n- Instagram: ${urls.instagram ?? 'não informado'}`;

    const completion = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';

    let data: RapportData;
    try {
      data = JSON.parse(raw) as RapportData;
    } catch {
      throw new Error('Resposta inválida do DeepSeek ao gerar rapport');
    }

    // Garante arrays mínimos
    data.rapportTips = data.rapportTips ?? [];
    data.iceBreakers = data.iceBreakers ?? [];
    data.suggestedTopics = data.suggestedTopics ?? [];

    return data;
  }

  /**
   * Persiste (upsert) os dados de rapport para a reunião
   */
  async saveRapport(
    meetingId: string,
    userId: string,
    urls: RapportUrls,
    rapportData: RapportData,
  ): Promise<MeetingRapport> {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('meeting_rapport')
      .upsert(
        {
          meeting_id: meetingId,
          user_id: userId,
          website_url: urls.website ?? null,
          linkedin_url: urls.linkedin ?? null,
          instagram_url: urls.instagram ?? null,
          rapport_data: rapportData,
          updated_at: now,
        },
        { onConflict: 'meeting_id' },
      )
      .select()
      .single();

    if (error || !data) {
      logger.error('Erro ao salvar rapport:', error);
      throw new Error('Erro ao salvar rapport no banco de dados');
    }

    return data as MeetingRapport;
  }

  /**
   * Busca rapport existente para uma reunião
   */
  async getRapport(meetingId: string): Promise<MeetingRapport | null> {
    const { data, error } = await supabase
      .from('meeting_rapport')
      .select('*')
      .eq('meeting_id', meetingId)
      .maybeSingle();

    if (error) {
      logger.error('Erro ao buscar rapport:', error);
      return null;
    }

    return (data as MeetingRapport) ?? null;
  }

  /**
   * Fluxo completo: raspa site (se houver), gera rapport com DeepSeek, salva e retorna
   */
  async enrichAndSave(
    meetingId: string,
    userId: string,
    urls: RapportUrls,
  ): Promise<MeetingRapport> {
    let scrapedContent: string | undefined;

    if (urls.website) {
      try {
        scrapedContent = await this.scrapeWebsite(urls.website);
        logger.info(`Site raspado para reunião ${meetingId}: ${scrapedContent.length} chars`);
      } catch (err) {
        logger.warn(`Falha ao raspar site ${urls.website}:`, err);
        // Continua sem o conteúdo raspado — DeepSeek usará só as URLs
      }
    }

    const rapportData = await this.generateRapport(urls, scrapedContent);
    return this.saveRapport(meetingId, userId, urls, rapportData);
  }
}

export const rapportService = new RapportService();
