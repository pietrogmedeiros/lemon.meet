// ============================================================
// dedup-audit.mjs — Auditoria de duplicação de bots (calendário)
//
// Mede quantos bots foram desperdiçados por duplicação de reuniões do mesmo
// evento. Após o fix bc05964 (1 bot por reunião + compartilhar), o desperdício
// real = eventos com >1 DONA (bot_owner_meeting_id IS NULL). Reuniões LINKADAS
// (bot_owner_meeting_id != NULL) são o comportamento novo esperado (economia).
//
// Uso:
//   railway run node server/scripts/dedup-audit.mjs            (env de produção)
//   node server/scripts/dedup-audit.mjs                        (lê server/.env)
//   railway run node server/scripts/dedup-audit.mjs 2026-05-26T23:00:00Z  (janela custom)
//
// Baseline (pré-fix, 14 dias): 178 bots extras / 576 reuniões ≈ 31%.
// ============================================================

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

function loadEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const envPath = path.join(dir, '..', '.env')
  const txt = fs.readFileSync(envPath, 'utf8')
  const env = { ...process.env }
  for (const line of txt.split('\n')) {
    if (!line.includes('=')) continue
    const i = line.indexOf('=')
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return env
}

const env = loadEnv()
const URL = env.SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const h = { apikey: KEY, Authorization: `Bearer ${KEY}` }

// Janela: arg 1 = ISO desde quando; default = últimas 24h.
const since = process.argv[2] ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString()

let all = []
for (let from = 0; ; from += 1000) {
  const r = await fetch(
    `${URL}/rest/v1/meetings?created_at=gte.${since}&select=id,started_at,meet_link,baas_event_uuid,bot_owner_meeting_id,bot_provider,status,title&order=baas_event_uuid.asc`,
    { headers: { ...h, Range: `${from}-${from + 999}` } },
  )
  const page = await r.json()
  if (!Array.isArray(page) || page.length === 0) break
  all = all.concat(page)
  if (page.length < 1000) break
}

const owners = all.filter(m => !m.bot_owner_meeting_id)
const linked = all.filter(m => m.bot_owner_meeting_id)

// Desperdício real = eventos com >1 DONA.
const ownersByEvt = {}
for (const m of owners) {
  if (!m.baas_event_uuid) continue
  ;(ownersByEvt[m.baas_event_uuid] = ownersByEvt[m.baas_event_uuid] || []).push(m)
}
let dupEventGroups = 0, wastedOwnerBots = 0
const examples = []
for (const evt in ownersByEvt) {
  const g = ownersByEvt[evt]
  if (g.length > 1) {
    dupEventGroups++
    wastedOwnerBots += g.length - 1
    if (examples.length < 8) examples.push({ event: evt.slice(0, 12), donas: g.length, title: (g[0].title || '').slice(0, 30) })
  }
}

const pct = owners.length ? (wastedOwnerBots / owners.length * 100) : 0

console.log(`\n=== AUDITORIA DE DUPLICAÇÃO DE BOTS ===`)
console.log(`janela: desde ${since}`)
console.log(`reuniões na janela:        ${all.length}`)
console.log(`  donas (dispatch real):   ${owners.length}`)
console.log(`  linkadas (compartilham): ${linked.length}  ← economia (bots NÃO disparados)`)
console.log(`\nDESPERDÍCIO REAL (eventos com >1 dona):`)
console.log(`  grupos duplicados:       ${dupEventGroups}`)
console.log(`  bots extras desperdiçados: ${wastedOwnerBots}`)
console.log(`  % sobre as donas:        ${pct.toFixed(1)}%   (baseline pré-fix ≈ 31%)`)
if (examples.length) {
  console.log(`\nexemplos de desperdício remanescente:`)
  examples.forEach(e => console.log(`  evento ${e.event} · ${e.donas} donas · ${e.title}`))
}
console.log('')
