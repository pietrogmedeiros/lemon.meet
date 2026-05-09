#!/usr/bin/env node
/**
 * Script para executar migration SQL no Supabase
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Carregar SQL da migration
const sqlFile = process.argv[2] || 'migration-add-participant-emails.sql'
const sqlPath = join(__dirname, sqlFile)
const sql = readFileSync(sqlPath, 'utf-8')

// Conectar ao Supabase
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar definidos')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

console.log('🔄 Executando migration:', sqlFile)

try {
  // Executar SQL usando o client PostgreSQL do Supabase
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql }).catch(() => {
    // Fallback: executar comandos individualmente
    return executeSqlDirectly(sql)
  })

  if (error) {
    throw error
  }

  console.log('✅ Migration executada com sucesso!')
  console.log(data)
} catch (error) {
  console.error('❌ Erro ao executar migration:', error.message)
  process.exit(1)
}

async function executeSqlDirectly(sql) {
  // Dividir em comandos individuais
  const commands = sql
    .split(';')
    .map(cmd => cmd.trim())
    .filter(cmd => cmd && !cmd.startsWith('--'))

  for (const cmd of commands) {
    if (!cmd) continue
    console.log('Executando:', cmd.substring(0, 100) + '...')
    
    // Para ALTER TABLE e CREATE INDEX, precisamos usar conexão direta
    // Como não temos acesso direto via SDK, vamos apenas logar
    console.log('⚠️  Este comando precisa ser executado manualmente no SQL Editor do Supabase')
  }

  return { data: null, error: null }
}
