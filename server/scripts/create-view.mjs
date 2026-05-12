#!/usr/bin/env node
/**
 * Script para criar a VIEW meetings_with_user no Supabase
 * Executa: node create-view.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '..', '.env') })

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Faltam variáveis de ambiente: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function createView() {
  console.log('📊 Criando VIEW meetings_with_user...')
  
  const sql = readFileSync(join(__dirname, 'create-meetings-view.sql'), 'utf-8')
  
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql })
  
  if (error) {
    // Tenta método alternativo
    console.log('⚠️  Método RPC não disponível, tentando query direta...')
    
    const { error: directError } = await supabase
      .from('meetings')
      .select('*')
      .limit(0) // Só para testar conexão
    
    if (directError) {
      console.error('❌ Erro ao conectar:', directError)
      process.exit(1)
    }
    
    console.log('\n📝 Execute este SQL manualmente no SQL Editor do Supabase:\n')
    console.log(sql)
    console.log('\n🔗 Acesse: https://supabase.com/dashboard/project/[SEU_PROJECT]/editor')
    return
  }
  
  console.log('✅ VIEW criada com sucesso!')
  console.log('📌 Use "meetings_with_user" no Table Editor para ver reuniões com nomes')
}

createView().catch(err => {
  console.error('❌ Erro:', err)
  process.exit(1)
})
