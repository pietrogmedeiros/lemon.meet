#!/usr/bin/env node
// incident-recheck.mjs — revalida o incidente dos bots (2026-07-23) algumas
// horas após o deploy do fix (commit 20e54f8). Verifica REGRESSÃO de:
//   Bug A: reuniões voltando a ficar presas em 'requesting' (bot not_admitted)
//   Bug B: bot despachado para usuário com assinatura NÃO ativa
// Imprime um veredito PASS/ATENÇÃO. Lê server/.env.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DEPLOY_AT = '2026-07-23T15:32:00Z'   // fim do deploy do fix
const STUCK_MIN = 15

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
const U = env.SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'count=exact' }

async function count(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: '0-0' } })
  const cr = r.headers.get('content-range') || '*/0'
  return parseInt(cr.split('/')[1] || '0', 10)
}

const now = new Date()
const cutoffStuck = new Date(now.getTime() - STUCK_MIN * 60 * 1000).toISOString()

// Bug A: presas em requesting com início já passado
const stuck = await count(`meetings?select=id&status=eq.requesting&started_at=lt.${cutoffStuck}`)

// Health: reuniões de calendário criadas DESDE o deploy + quantas completaram/falharam/presas
const sinceDeploy = `created_at=gte.${DEPLOY_AT}`
const calNew = await count(`meetings?select=id&source=eq.calendar&${sinceDeploy}`)
const calDone = await count(`meetings?select=id&source=eq.calendar&status=eq.completed&${sinceDeploy}`)
const calReq = await count(`meetings?select=id&source=eq.calendar&status=eq.requesting&${sinceDeploy}`)

// Bug B: bot em usuário inativo — reuniões calendar novas cujo dono NÃO tem sub ativa.
// Busca os user_ids das novas e cruza com user_subscriptions status=active.
let botsOnInactive = 0, inactiveDetail = []
const mr = await fetch(`${U}/rest/v1/meetings?select=id,user_id,title&source=eq.calendar&${sinceDeploy}`, { headers: H })
const newMeetings = await mr.json()
const userIds = [...new Set((newMeetings || []).map(m => m.user_id).filter(Boolean))]
if (userIds.length) {
  const sr = await fetch(`${U}/rest/v1/user_subscriptions?select=user_id,status&user_id=in.(${userIds.join(',')})`, { headers: H })
  const subs = await sr.json()
  const active = new Set((subs || []).filter(s => s.status === 'active').map(s => s.user_id))
  for (const m of newMeetings) {
    if (!active.has(m.user_id)) { botsOnInactive++; inactiveDetail.push((m.title || '').slice(0, 30)) }
  }
}

const regression = stuck > 0 || botsOnInactive > 0
const verdict = regression ? '⚠️ ATENÇÃO' : '✅ PASS'
const line = `${verdict} — presas(requesting+velhas)=${stuck} | bot em user inativo=${botsOnInactive} | calendar novas desde deploy: ${calNew} (ok=${calDone}, req=${calReq})`
console.log(line)
if (inactiveDetail.length) console.log('  inativos:', inactiveDetail.join(' | '))

// saída pra o wrapper (notificação)
process.stdout.write(`\n__VERDICT__${verdict}__${regression ? 'REGRESSAO' : 'OK'}__${stuck}/${botsOnInactive}\n`)
