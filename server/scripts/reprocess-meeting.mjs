/**
 * Reprocessa insights de uma reunião específica usando as credenciais do servidor.
 * Uso: node scripts/reprocess-meeting.mjs <MEETING_ID>
 */
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const meetingId = process.argv[2];
if (!meetingId) {
  console.error('Usage: node scripts/reprocess-meeting.mjs <MEETING_ID>');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

const { data: meeting, error } = await supabase
  .from('meetings')
  .select('id, title, transcript, status')
  .eq('id', meetingId)
  .single();

if (error || !meeting) {
  console.error('Meeting not found:', error?.message);
  process.exit(1);
}

if (!meeting.transcript?.trim()) {
  console.error('Meeting has no transcript.');
  process.exit(1);
}

console.log(`Reprocessing: "${meeting.title ?? meeting.id}" (${meeting.transcript.length} chars)...`);

const systemPrompt = `Você é um assistente especializado em análise de reuniões comerciais para times de vendas. 
Analise a transcrição fornecida e retorne um JSON estruturado com os seguintes campos:

{
  "sentiment": "positive" | "neutral" | "negative",
  "commercialQuality": <número de 0 a 10>,
  "executiveContext": "<resumo executivo em 2-3 frases>",
  "closingProbability": <número de 0 a 100>,
  "followUp": ["<ação 1>", "<ação 2>", ...],
  "followUpSuggestions": ["<mensagem 1>", "<mensagem 2>", "<mensagem 3>", "<mensagem 4>"],
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

const response = await deepseek.chat.completions.create({
  model: 'deepseek-chat',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Transcrição da reunião:\n\n${meeting.transcript}` },
  ],
  temperature: 0.3,
  response_format: { type: 'json_object' },
});

const insights = JSON.parse(response.choices[0].message.content);

const { error: updateError } = await supabase
  .from('meetings')
  .update({ insights, status: 'completed', updated_at: new Date().toISOString() })
  .eq('id', meetingId);

if (updateError) {
  console.error('Error saving insights:', updateError.message);
  process.exit(1);
}

console.log('✅ Insights reprocessados com sucesso!');
console.log('followUpSuggestions:');
insights.followUpSuggestions?.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
