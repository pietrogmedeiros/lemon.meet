#!/usr/bin/env node
/**
 * Script para diagnosticar reuniões completed sem transcrição
 * Busca dados do bot no MeetingBaas para descobrir a causa
 * 
 * Uso: node diagnose-failed-transcriptions.mjs
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '..', '.env') })

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const meetingBaasApiKey = process.env.MEETINGBAAS_API_KEY

if (!supabaseUrl || !supabaseServiceKey || !meetingBaasApiKey) {
  console.error('❌ Faltam variáveis de ambiente')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Busca dados do bot na API MeetingBaas
async function getBotData(botId) {
  try {
    const response = await fetch(`https://api.meetingbaas.com/bots/${botId}`, {
      headers: {
        'x-meeting-baas-api-key': meetingBaasApiKey,
      },
    })

    if (!response.ok) {
      return { error: `HTTP ${response.status}` }
    }

    return await response.json()
  } catch (error) {
    return { error: error.message }
  }
}

async function diagnose() {
  console.log('🔍 Buscando reuniões completed sem transcrição...\n')

  // Busca reuniões problemáticas
  const { data: meetings, error } = await supabase
    .from('meetings')
    .select('id, user_id, baas_bot_id, started_at, ended_at, meet_link, source')
    .eq('status', 'completed')
    .or('transcript.is.null,transcript.eq.')
    .order('started_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('❌ Erro ao buscar reuniões:', error)
    return
  }

  console.log(`📊 Encontradas ${meetings.length} reuniões sem transcrição\n`)
  console.log('=' .repeat(80))

  for (const meeting of meetings) {
    const duration = meeting.ended_at && meeting.started_at
      ? Math.round((new Date(meeting.ended_at) - new Date(meeting.started_at)) / 1000)
      : 0

    console.log(`\n📅 Meeting: ${meeting.id}`)
    console.log(`   Fonte: ${meeting.source}`)
    console.log(`   Duração: ${duration}s (${Math.floor(duration / 60)}min ${duration % 60}s)`)
    console.log(`   Link: ${meeting.meet_link || 'N/A'}`)

    if (!meeting.baas_bot_id) {
      console.log(`   ⚠️  SEM BOT - Gravação via extensão que não gerou transcrição`)
      console.log(`   Possíveis causas:`)
      console.log(`      • Extensão parou antes de processar`)
      console.log(`      • Áudio não foi capturado`)
      console.log(`      • Erro ao enviar chunks para servidor`)
      continue
    }

    console.log(`   Bot ID: ${meeting.baas_bot_id}`)
    console.log(`   🔎 Buscando dados na API MeetingBaas...`)

    const botData = await getBotData(meeting.baas_bot_id)

    if (botData.error) {
      console.log(`   ❌ Erro ao buscar bot: ${botData.error}`)
      continue
    }

    // Analisa os dados do bot
    const { 
      status_changes, 
      recording,
      mp4,
      transcription_segments,
      speakers,
      joined_at,
      left_at,
      error: botError 
    } = botData

    console.log(`\n   📊 DADOS DO BOT:`)
    console.log(`   Status: ${status_changes?.[status_changes.length - 1]?.code || 'unknown'}`)
    
    if (joined_at && left_at) {
      const botDuration = Math.round((new Date(left_at) - new Date(joined_at)) / 1000)
      console.log(`   Tempo na reunião: ${botDuration}s (${Math.floor(botDuration / 60)}min ${botDuration % 60}s)`)
    }

    // Verifica gravação
    if (recording?.recording_url) {
      console.log(`   ✅ TEM GRAVAÇÃO: ${recording.recording_url}`)
      console.log(`   Tamanho: ${(recording.size_bytes / 1024 / 1024).toFixed(2)} MB`)
    } else if (mp4?.url) {
      console.log(`   ✅ TEM MP4: ${mp4.url}`)
    } else {
      console.log(`   ❌ SEM GRAVAÇÃO DE ÁUDIO`)
    }

    // Verifica speakers
    if (speakers && speakers.length > 0) {
      console.log(`   🎤 Speakers detectados: ${speakers.length}`)
      speakers.forEach((s, i) => {
        console.log(`      Speaker ${i + 1}: ${s.name || 'Unknown'}`)
      })
    } else {
      console.log(`   ⚠️  NENHUM SPEAKER DETECTADO - ninguém falou ou áudio estava mudo`)
    }

    // Verifica transcrição
    if (transcription_segments && transcription_segments.length > 0) {
      console.log(`   📝 Segmentos de transcrição: ${transcription_segments.length}`)
      const totalWords = transcription_segments.reduce((sum, seg) => sum + (seg.words?.length || 0), 0)
      console.log(`   Total de palavras: ${totalWords}`)
    } else {
      console.log(`   ❌ SEM TRANSCRIÇÃO`)
    }

    // Verifica erros
    if (botError) {
      console.log(`   ⚠️  ERRO DO BOT: ${botError}`)
    }

    // Diagnóstico final
    console.log(`\n   🔍 DIAGNÓSTICO:`)
    
    if (!recording?.recording_url && !mp4?.url) {
      console.log(`   ❌ Bot não conseguiu gravar áudio`)
      console.log(`      Causa provável: Usuário não deu permissão ou bot foi bloqueado`)
    } else if (!speakers || speakers.length === 0) {
      console.log(`   ⚠️  Bot gravou mas não detectou nenhuma voz`)
      console.log(`      Causa provável:`)
      console.log(`      • Reunião em silêncio`)
      console.log(`      • Bot entrou mutado`)
      console.log(`      • Áudio muito baixo/ruído`)
    } else if (!transcription_segments || transcription_segments.length === 0) {
      console.log(`   ⚠️  Bot detectou speakers mas transcrição falhou`)
      console.log(`      Causa provável: Falha no serviço de transcrição (Gladia)`)
    } else {
      console.log(`   ⚠️  Bot funcionou mas dados não foram processados corretamente`)
      console.log(`      Causa provável: Webhook não disparou ou erro ao processar`)
    }

    console.log(`\n` + '='.repeat(80))
  }

  console.log(`\n✅ Diagnóstico concluído!`)
  console.log(`\n💡 RESUMO:`)
  console.log(`   • Sem bot (extensão): ${meetings.filter(m => !m.baas_bot_id).length}`)
  console.log(`   • Com bot: ${meetings.filter(m => m.baas_bot_id).length}`)
  console.log(`\n📝 Para reprocessar uma reunião específica:`)
  console.log(`   node reprocess-meeting-by-id.mjs <meeting-id>`)
}

diagnose().catch(err => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
