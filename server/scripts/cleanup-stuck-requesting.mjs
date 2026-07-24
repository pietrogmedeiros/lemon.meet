#!/usr/bin/env node
// cleanup-stuck-requesting.mjs
// Marca como 'failed' as reuniões presas em 'requesting' cujo início já passou
// há mais de STUCK_MIN minutos (bot nunca entrou — ex.: not_admitted). É uma
// limpeza pontual dos registros que ficaram presos ANTES do fix do webhook.
//
// Uso:  node scripts/cleanup-stuck-requesting.mjs            (dry-run: só lista)
//       node scripts/cleanup-stuck-requesting.mjs --apply    (aplica o UPDATE)
//
// Lê SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY do server/.env.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const STUCK_MIN = 15
const APPLY = process.argv.includes('--apply')

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
const U = env.SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }

const cutoff = new Date(Date.now() - STUCK_MIN * 60 * 1000).toISOString()
const filter = `status=eq.requesting&started_at=lt.${cutoff}`

const pv = await fetch(`${U}/rest/v1/meetings?select=id,title,started_at,bot_provider,user_id&${filter}`, { headers: H })
const rows = await pv.json()
console.log(`Presas em 'requesting' com início < ${cutoff.slice(0, 16)} (há +${STUCK_MIN}min): ${rows.length}`)
for (const m of rows) console.log(`  ${m.started_at?.slice(5, 16)}  ${m.bot_provider ?? '-'}  ${(m.title ?? '').slice(0, 40)}`)

if (!APPLY) {
  console.log('\n(dry-run) rode com --apply para marcar como failed.')
  process.exit(0)
}

const up = await fetch(`${U}/rest/v1/meetings?${filter}`, {
  method: 'PATCH', headers: H,
  body: JSON.stringify({ status: 'failed', failure_reason: 'stuck_bot_not_admitted_cleanup' }),
})
const done = await up.json()
console.log(`\n>>> Marcadas como failed: ${Array.isArray(done) ? done.length : JSON.stringify(done).slice(0, 200)}`)
