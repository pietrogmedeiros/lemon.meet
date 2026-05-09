#!/usr/bin/env node
/**
 * Script DEFINITIVO: Vincular TODAS as reuniões aos times
 * Execução: node server/scripts/link-meetings-to-teams.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

config({ path: join(__dirname, '../../.env') })

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function fixAllMeetings() {
  console.log('🚀 FORÇANDO atualização de TODAS as reuniões\n')

  try {
    // Buscar TODAS as reuniões
    const { data: allMeetings, error } = await supabase
      .from('meetings')
      .select('id, user_id, team_id, title')
      .order('created_at', { ascending: false })

    if (error) throw error

    console.log(`📊 Total de reuniões: ${allMeetings.length}`)
    
    const withTeam = allMeetings.filter(m => m.team_id).length
    const withoutTeam = allMeetings.filter(m => !m.team_id).length
    
    console.log(`✓ Com team_id: ${withTeam}`)
    console.log(`✗ Sem team_id: ${withoutTeam}\n`)

    if (withoutTeam === 0) {
      console.log('✅ Todas as reuniões já têm team_id!')
      return
    }

    // Para cada reunião SEM team_id
    let updated = 0
    let failed = 0

    for (const meeting of allMeetings.filter(m => !m.team_id)) {
      // Buscar time do usuário (owner)
      const { data: team } = await supabase
        .from('teams')
        .select('id, name')
        .eq('owner_id', meeting.user_id)
        .order('created_at', { ascending: true }) // Primeiro time criado
        .limit(1)
        .maybeSingle()

      if (team) {
        const { error: updateError } = await supabase
          .from('meetings')
          .update({ team_id: team.id })
          .eq('id', meeting.id)

        if (updateError) {
          console.error(`❌ Erro ao atualizar ${meeting.id}:`, updateError.message)
          failed++
        } else {
          console.log(`✓ ${meeting.title || meeting.id} → ${team.name}`)
          updated++
        }
      } else {
        console.log(`⚠️ Usuário ${meeting.user_id} não tem time`)
        failed++
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log(`✅ Atualizadas: ${updated}`)
    console.log(`❌ Falharam: ${failed}`)
    console.log('='.repeat(60))

  } catch (err) {
    console.error('❌ Erro:', err)
    process.exit(1)
  }
}

fixAllMeetings()
