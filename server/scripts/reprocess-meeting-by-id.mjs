#!/usr/bin/env node
// ============================================================
// reprocess-meeting-by-id.mjs
// Busca transcrição no MeetingBaas e reprocessa uma reunião
// ============================================================

import { createClient } from '@supabase/supabase-js'

const MEETING_ID = process.argv[2] || '35d3df43-af10-4a76-a0ef-4c2385589298'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
const meetingBaasKey = process.env.MEETINGBAAS_API_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis SUPABASE_URL ou SUPABASE_KEY não configuradas')
  process.exit(1)
}

if (!meetingBaasKey) {
  console.error('❌ MEETINGBAAS_API_KEY não configurada')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

console.log('🔍 Reprocessando reunião:', MEETING_ID)
console.log('')

// 1. Busca a reunião no banco
const { data: meeting, error: meetingError } = await supabase
  .from('meetings')
  .select('*')
  .eq('id', MEETING_ID)
  .single()

if (meetingError || !meeting) {
  console.error('❌ Reunião não encontrada:', meetingError)
  process.exit(1)
}

console.log('📋 Dados da reunião:')
console.log('   ID:', meeting.id)
console.log('   Título:', meeting.title || 'Sem título')
console.log('   Status:', meeting.status)
console.log('   Bot ID:', meeting.baas_bot_id || 'N/A')
console.log('   Event UUID:', meeting.baas_event_uuid || 'N/A')
console.log('   Iniciada:', meeting.started_at)
console.log('   Finalizada:', meeting.ended_at)
console.log('   Tem transcrição:', meeting.transcript ? 'SIM' : 'NÃO')
console.log('')

if (!meeting.baas_bot_id) {
  console.error('❌ Reunião não tem baas_bot_id - não foi enviado bot')
  process.exit(1)
}

// 2. Busca dados do bot no MeetingBaas
console.log('🤖 Buscando dados do bot no MeetingBaas...')
const botResponse = await fetch(
  `https://api.meetingbaas.com/v2/bots/${encodeURIComponent(meeting.baas_bot_id)}`,
  {
    headers: {
      'x-meeting-baas-api-key': meetingBaasKey,
    },
  }
)

if (!botResponse.ok) {
  console.error(`❌ Erro ao buscar bot: ${botResponse.status} ${botResponse.statusText}`)
  const errorText = await botResponse.text()
  console.error('Resposta:', errorText)
  process.exit(1)
}

const botData = await botResponse.json()
console.log('✅ Bot encontrado no MeetingBaas')
console.log('   Status:', botData.status)
console.log('   Transcription URL:', botData.transcription || 'N/A')
console.log('   Recording URL:', botData.mp4 || 'N/A')
console.log('')

// 3. Verifica se há URL de transcrição
if (!botData.transcription) {
  console.warn('⚠️  Bot não tem URL de transcrição!')
  console.log('')
  console.log('🔍 Possíveis causas:')
  console.log('   1. Reunião foi muito curta (< 30 segundos)')
  console.log('   2. Ninguém falou durante a reunião')
  console.log('   3. Bot foi removido antes da transcrição ser processada')
  console.log('   4. Erro no MeetingBaas ao processar áudio')
  console.log('')
  console.log('💡 Recomendação: Marcar reunião como "completed" sem transcrição')
  
  const { error: updateError } = await supabase
    .from('meetings')
    .update({ 
      status: 'completed',
      updated_at: new Date().toISOString()
    })
    .eq('id', MEETING_ID)
  
  if (updateError) {
    console.error('❌ Erro ao atualizar status:', updateError)
  } else {
    console.log('✅ Status atualizado para "completed"')
  }
  
  process.exit(0)
}

// 4. Baixa a transcrição
console.log('📥 Baixando transcrição...')
const transcriptResponse = await fetch(botData.transcription)

if (!transcriptResponse.ok) {
  console.error(`❌ Erro ao baixar transcrição: ${transcriptResponse.status}`)
  process.exit(1)
}

const transcriptData = await transcriptResponse.json()
console.log('✅ Transcrição baixada')

// Identifica o formato da transcrição
let rawTranscription = []

if (Array.isArray(transcriptData)) {
  rawTranscription = transcriptData
} else if (transcriptData?.result?.utterances && Array.isArray(transcriptData.result.utterances)) {
  rawTranscription = transcriptData.result.utterances
} else if (transcriptData?.transcription && Array.isArray(transcriptData.transcription)) {
  rawTranscription = transcriptData.transcription
} else if (transcriptData?.utterances && Array.isArray(transcriptData.utterances)) {
  rawTranscription = transcriptData.utterances
} else {
  console.error('❌ Formato de transcrição desconhecido:', JSON.stringify(transcriptData).slice(0, 200))
  process.exit(1)
}

console.log(`   Total de entradas: ${rawTranscription.length}`)
console.log('')

if (rawTranscription.length === 0) {
  console.warn('⚠️  Transcrição está vazia (0 entradas)')
  console.log('💡 Marcar reunião como completed sem transcrição')
  
  const { error: updateError } = await supabase
    .from('meetings')
    .update({ 
      status: 'completed',
      updated_at: new Date().toISOString()
    })
    .eq('id', MEETING_ID)
  
  if (updateError) {
    console.error('❌ Erro ao atualizar status:', updateError)
  } else {
    console.log('✅ Status atualizado para "completed"')
  }
  
  process.exit(0)
}

// 5. Converte para segmentos e salva no banco
console.log('💾 Salvando segmentos no banco...')

const segments = rawTranscription.map((entry, i) => ({
  meeting_id: MEETING_ID,
  text: entry.transcription || entry.text || '',
  start_seconds: entry.time_begin || entry.start || 0,
  end_seconds: entry.time_end || entry.end || 0,
  speaker: entry.speaker || null,
  sequence: i,
  chunk_index: 0,
})).filter(s => s.text.trim().length > 0)

const fullTranscript = segments.map(s =>
  s.speaker ? `${s.speaker}: ${s.text}` : s.text
).join('\n')

console.log(`   Total de segmentos: ${segments.length}`)
console.log(`   Caracteres: ${fullTranscript.length}`)
console.log('')

if (segments.length > 0) {
  // Remove segmentos antigos (se houver)
  await supabase.from('transcript_segments').delete().eq('meeting_id', MEETING_ID)
  
  const { error: insertError } = await supabase
    .from('transcript_segments')
    .insert(segments)
  
  if (insertError) {
    console.error('❌ Erro ao salvar segmentos:', insertError)
    process.exit(1)
  }
  
  console.log('✅ Segmentos salvos')
}

// 6. Atualiza transcrição na reunião
await supabase
  .from('meetings')
  .update({
    transcript: fullTranscript,
    status: 'processing',
    updated_at: new Date().toISOString(),
  })
  .eq('id', MEETING_ID)

console.log('✅ Transcrição salva na reunião')
console.log('')

// 7. Gerar insights (se tiver OpenAI configurada)
const openaiKey = process.env.OPENAI_API_KEY

if (!openaiKey || openaiKey === 'sk-your-openai-key') {
  console.warn('⚠️  OPENAI_API_KEY não configurada - pulando geração de insights')
  await supabase
    .from('meetings')
    .update({ status: 'completed' })
    .eq('id', MEETING_ID)
  
  console.log('✅ Reunião marcada como completed (sem insights)')
  process.exit(0)
}

console.log('🧠 Gerando insights com IA...')

// Simula o insightsService.generateInsights
const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${openaiKey}`,
  },
  body: JSON.stringify({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'Você é um assistente especializado em analisar reuniões de vendas e gerar insights.'
      },
      {
        role: 'user',
        content: `Analise a transcrição abaixo e retorne um JSON com:
- summary: resumo executivo (2-3 frases)
- key_points: array de pontos-chave discutidos
- action_items: array de ações a serem tomadas
- sentiment: "positive", "neutral" ou "negative"

Transcrição:
${fullTranscript.slice(0, 8000)}
`
      }
    ],
    temperature: 0.3,
  })
})

if (openaiResponse.ok) {
  const aiData = await openaiResponse.json()
  const content = aiData.choices[0].message.content
  
  let insights
  try {
    insights = JSON.parse(content)
  } catch {
    insights = {
      summary: content.slice(0, 500),
      key_points: [],
      action_items: [],
      sentiment: 'neutral'
    }
  }
  
  await supabase
    .from('meetings')
    .update({
      insights,
      status: 'completed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', MEETING_ID)
  
  console.log('✅ Insights gerados e salvos')
  console.log('')
  console.log('📊 Resumo:', insights.summary || 'N/A')
} else {
  console.error('❌ Erro ao gerar insights:', await openaiResponse.text())
  await supabase
    .from('meetings')
    .update({ status: 'completed' })
    .eq('id', MEETING_ID)
}

console.log('')
console.log('🎉 Reunião reprocessada com sucesso!')
