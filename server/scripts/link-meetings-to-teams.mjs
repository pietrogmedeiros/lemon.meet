#!/usr/bin/env node
/**
 * Script de Migration: Vincular reuniões antigas aos times
 * 
 * Uso:
 *   node server/scripts/link-meetings-to-teams.mjs
 * 
 * O que faz:
 * 1. Busca todas as reuniões sem team_id
 * 2. Para cada reunião, encontra o time do user_id (owner ou member)
 * 3. Atualiza o team_id da reunião
 * 4. Exibe relatório de quantas foram atualizadas
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Carrega .env da raiz do projeto
config({ path: join(__dirname, '../../.env') })

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados no .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function linkMeetingsToTeams() {
  console.log('🚀 Iniciando migration: Vincular reuniões aos times\n')

  try {
    // 1. Buscar reuniões sem team_id
    console.log('📊 Buscando reuniões sem team_id...')
    const { data: meetings, error: meetingsError } = await supabase
      .from('meetings')
      .select('id, user_id, title, created_at')
      .is('team_id', null)
      .not('user_id', 'is', null)

    if (meetingsError) {
      throw new Error(`Erro ao buscar reuniões: ${meetingsError.message}`)
    }

    console.log(`✓ Encontradas ${meetings.length} reuniões sem team_id\n`)

    if (meetings.length === 0) {
      console.log('✅ Nenhuma reunião para processar!')
      return
    }

    // 2. Para cada reunião, buscar o time do usuário
    let updated = 0
    let skipped = 0

    for (const meeting of meetings) {
      console.log(`\n📝 Processando reunião: ${meeting.title || meeting.id}`)
      console.log(`   User ID: ${meeting.user_id}`)

      // Buscar time onde user é owner
      const { data: ownedTeam } = await supabase
        .from('teams')
        .select('id, name')
        .eq('owner_id', meeting.user_id)
        .maybeSingle()

      let teamId = ownedTeam?.id

      // Se não for owner, buscar onde é member
      if (!teamId) {
        const { data: membership } = await supabase
          .from('team_members')
          .select('team_id, teams(name)')
          .eq('user_id', meeting.user_id)
          .eq('status', 'active')
          .maybeSingle()

        teamId = membership?.team_id
      }

      if (teamId) {
        // Atualizar reunião com team_id
        const { error: updateError } = await supabase
          .from('meetings')
          .update({ team_id: teamId })
          .eq('id', meeting.id)

        if (updateError) {
          console.error(`   ❌ Erro ao atualizar: ${updateError.message}`)
          skipped++
        } else {
          console.log(`   ✅ Vinculada ao time: ${ownedTeam?.name || teamId}`)
          updated++
        }
      } else {
        console.log(`   ⚠️  Usuário não pertence a nenhum time - pulando`)
        skipped++
      }
    }

    // 3. Relatório final
    console.log('\n' + '='.repeat(60))
    console.log('📊 RELATÓRIO FINAL')
    console.log('='.repeat(60))
    console.log(`✅ Reuniões atualizadas: ${updated}`)
    console.log(`⚠️  Reuniões puladas:    ${skipped}`)
    console.log(`📝 Total processadas:   ${meetings.length}`)
    console.log('='.repeat(60))

    // 4. Verificar resultado
    console.log('\n🔍 Verificando resultado...')
    const { data: stats, error: statsError } = await supabase
      .rpc('get_meetings_stats')
      .single()

    if (!statsError && stats) {
      console.log(`\n📈 Estatísticas atualizadas:`)
      console.log(`   Reuniões com team:    ${stats.com_team || '?'}`)
      console.log(`   Reuniões sem team:    ${stats.sem_team || '?'}`)
      console.log(`   Total de reuniões:    ${stats.total || '?'}`)
    }

    console.log('\n✅ Migration concluída com sucesso!')

  } catch (err) {
    console.error('\n❌ Erro durante migration:', err)
    process.exit(1)
  }
}

// Executar
linkMeetingsToTeams()
