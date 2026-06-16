// ============================================================
// verify-baas-start-time.mjs — Verificação REAL do agendamento v2
//
// Resolve empiricamente, contra a API de produção do MeetingBaas, qual
// unidade de `start_time` agenda o bot corretamente (segundos vs ms) e se o
// endpoint /v2/bots honra o agendamento — causa raiz das falhas de 15/jun
// (bot entrava ~28 min adiantado, sala vazia, "Timeout waiting to start
// recording"). O commit v2 (0682148) mandava start_time em SEGUNDOS.
//
// Para cada unidade testada:
//   1. cria um bot agendado p/ AGORA + LEAD_MIN minutos
//   2. espera POLL_WAIT_S e consulta GET /v2/bots/{id}
//   3. inspeciona status + qualquer timestamp de agendamento devolvido
//   4. VEREDITO: o bot está esperando (agendado certo) ou já tentou entrar
//      AGORA (start_time no passado → unidade errada / ignorado)?
//   5. cancela o bot (DELETE; fallback /leave) — nunca chega a entrar.
//
// Uso:
//   node server/scripts/verify-baas-start-time.mjs            (testa ms + s)
//   node server/scripts/verify-baas-start-time.mjs ms         (só ms)
//   node server/scripts/verify-baas-start-time.mjs seconds    (só segundos)
//
// Requer MEETINGBAAS_API_KEY no server/.env (ou no ambiente).
// ============================================================

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

function loadEnv() {
  if (process.env.MEETINGBAAS_API_KEY) return process.env
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
const API_KEY = env.MEETINGBAAS_API_KEY
if (!API_KEY) {
  console.error('✗ MEETINGBAAS_API_KEY ausente (server/.env ou env).')
  process.exit(1)
}

const BASE = 'https://api.meetingbaas.com'
const H = { 'Content-Type': 'application/json', 'x-meeting-baas-api-key': API_KEY }
const LEAD_MIN = 30          // agenda 30 min no futuro
const POLL_WAIT_S = 12       // espera antes de consultar o estado
const SLOP_MS = 3 * 60_000   // tolerância p/ casar o timestamp devolvido

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// URL de Meet plausível e descartável; o bot é cancelado antes de entrar.
const MEET_URL = 'https://meet.google.com/lmn-verify-baas'

function buildBody(unit, joinAt) {
  const ms = joinAt.getTime()
  const start_time = unit === 'ms' ? ms : Math.floor(ms / 1000)
  return {
    body: {
      meeting_url: MEET_URL,
      bot_name: 'Lemon Verify (delete me)',
      recording_mode: 'audio_only',
      speech_to_text: { provider: 'Gladia' },
      deduplication_key: `verify-${unit}-${ms}`,
      automatic_leave: { noone_joined_timeout: 1800, silence_timeout: 1800, waiting_room_timeout: 1800 },
      start_time,
      extra: { lemon_verify: true },
    },
    start_time,
  }
}

// Procura, recursivamente, qualquer campo que pareça o horário agendado e
// devolve o ms epoch mais próximo do nosso alvo (aceita s ou ms).
function findScheduledMs(obj, targetMs, hits = []) {
  if (obj == null) return hits
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (/time|start|join|schedul|created|at$/i.test(k)) {
        if (typeof v === 'number') {
          const asMs = v > 1e12 ? v : v * 1000 // heurística s vs ms
          hits.push({ k, raw: v, asMs, deltaMin: Math.round((asMs - targetMs) / 60000) })
        } else if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) {
          const asMs = Date.parse(v)
          hits.push({ k, raw: v, asMs, deltaMin: Math.round((asMs - targetMs) / 60000) })
        }
      }
      if (v && typeof v === 'object') findScheduledMs(v, targetMs, hits)
    }
  }
  return hits
}

function extractStatus(obj) {
  // Tenta os caminhos conhecidos; senão varre por chave "status".
  const direct = obj?.bot_data?.status ?? obj?.status ?? obj?.data?.status
  if (direct) return JSON.stringify(direct)
  const hits = []
  const walk = (o) => {
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (/status|state|code/i.test(k) && (typeof v === 'string' || typeof v === 'number')) hits.push(`${k}=${v}`)
        if (v && typeof v === 'object') walk(v)
      }
    }
  }
  walk(obj)
  return hits.join(', ') || '(sem campo de status)'
}

const JOINING = /join|in_call|recording|waiting_room|in_waiting|connecting/i

async function cancel(botId) {
  // Bot agendado: tenta DELETE; se não, /leave.
  let r = await fetch(`${BASE}/v2/bots/${encodeURIComponent(botId)}`, { method: 'DELETE', headers: H })
  if (r.ok) return `DELETE ${r.status}`
  r = await fetch(`${BASE}/v2/bots/${encodeURIComponent(botId)}/leave`, { method: 'POST', headers: H })
  return `leave ${r.status}`
}

async function testUnit(unit) {
  const joinAt = new Date(Date.now() + LEAD_MIN * 60_000)
  const targetMs = joinAt.getTime()
  const { body, start_time } = buildBody(unit, joinAt)

  console.log(`\n━━━ Unidade: ${unit.toUpperCase()} ━━━`)
  console.log(`  alvo joinAt = ${joinAt.toISOString()}  (start_time enviado = ${start_time})`)

  const createRes = await fetch(`${BASE}/v2/bots`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const createTxt = await createRes.text()
  if (!createRes.ok) {
    console.log(`  ✗ POST /v2/bots → ${createRes.status}: ${createTxt.slice(0, 300)}`)
    return { unit, ok: false, verdict: 'create_failed' }
  }
  let bot_id
  try { bot_id = String(JSON.parse(createTxt)?.data?.bot_id ?? JSON.parse(createTxt)?.bot_id) } catch { /* */ }
  console.log(`  ✓ criado bot_id=${bot_id} — aguardando ${POLL_WAIT_S}s para inspecionar estado…`)

  await sleep(POLL_WAIT_S * 1000)

  const getRes = await fetch(`${BASE}/v2/bots/${encodeURIComponent(bot_id)}`, { headers: H })
  const getTxt = await getRes.text()
  let getJson = {}
  try { getJson = JSON.parse(getTxt) } catch { /* */ }

  const status = extractStatus(getJson)
  const tsHits = findScheduledMs(getJson, targetMs).filter(h => Math.abs(h.deltaMin) <= 180 || /start|join|schedul/i.test(h.k))

  console.log(`  status reportado: ${status}`)
  if (tsHits.length) {
    console.log('  timestamps de agendamento devolvidos:')
    for (const h of tsHits) console.log(`    • ${h.k} = ${h.raw}  (Δ vs alvo: ${h.deltaMin} min)`)
  } else {
    console.log('  (a API não devolveu timestamp de agendamento reconhecível)')
  }

  // Veredito. A API NÃO devolve start_time de volta (só created_at), então o
  // sinal decisivo é o STATUS logo após criar: `queued` = aguardando o horário
  // (agendado certo); `joining_call`/in_call/etc = tentando entrar AGORA →
  // start_time foi lido como passado (unidade errada / ignorado).
  const joiningNow = JOINING.test(status)
  const scheduledOk = /queued|scheduled|pending|waiting_for_start/i.test(status) && !joiningNow
  let verdict
  if (scheduledOk) verdict = 'CORRETO — bot QUEUED, aguardando o horário-alvo'
  else if (joiningNow) verdict = 'ERRADO — bot já tentando entrar AGORA (start_time no passado/ignorado)'
  else verdict = `INCONCLUSIVO — status inesperado (${status}); inspecione o dump`

  console.log(`  ⇒ VEREDITO (${unit}): ${verdict}`)
  console.log(`  ── GET dump (${getRes.status}) ──\n${getTxt.slice(0, 1200)}`)

  const cleanup = bot_id ? await cancel(bot_id) : 'sem bot_id'
  console.log(`  🧹 cleanup: ${cleanup}`)

  return { unit, ok: true, bot_id, status, verdict, scheduledMatch: scheduledOk, joiningNow }
}

const arg = (process.argv[2] || '').toLowerCase()
const units = arg === 'ms' ? ['ms'] : arg === 'seconds' || arg === 's' ? ['seconds'] : ['ms', 'seconds']

console.log('═══════════════════════════════════════════════════════')
console.log(' Verificação REAL de start_time (MeetingBaas v2)')
console.log(` testando: ${units.join(' + ')} | lead=${LEAD_MIN}min | poll=${POLL_WAIT_S}s`)
console.log('═══════════════════════════════════════════════════════')

const results = []
for (const u of units) {
  try { results.push(await testUnit(u)) }
  catch (e) { console.log(`  ✗ erro testando ${u}: ${e.message}`); results.push({ unit: u, ok: false, verdict: 'error' }) }
}

console.log('\n═══════════════════ RESUMO ═══════════════════')
for (const r of results) console.log(`  ${r.unit.padEnd(8)} → ${r.verdict}`)
const winner = results.find(r => r.scheduledMatch)
if (winner) console.log(`\n✅ Unidade correta para start_time: ${winner.unit.toUpperCase()}`)
else console.log('\n⚠️  Nenhuma unidade agendou corretamente — start_time pode ser ignorado em /v2/bots (use /v2/bots/scheduled + join_at).')
