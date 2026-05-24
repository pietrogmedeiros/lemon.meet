// ============================================================
// admin-metrics.routes.ts — Painel interno de observabilidade
//
// GET /api/admin/metrics?range=7d|30d|90d|all
//   Retorna payload agregado pra alimentar /admin/metrics no front.
//
// Gate: authMiddleware → adminMetricsGate (email allowlist + chave)
// Cache em memória de 60s pra não bater no banco a cada refresh.
// ============================================================

import { Router, type Response } from 'express'
import type express from 'express'

import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { adminMetricsGate } from '../middleware/admin-metrics.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'

const router: express.Router = Router()

// ── Cache ────────────────────────────────────────────────────
const CACHE_TTL_MS = 60_000
const cache = new Map<string, { expiresAt: number; payload: any }>()

function getCached(key: string): any | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    cache.delete(key)
    return null
  }
  return hit.payload
}

function setCached(key: string, payload: any) {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, payload })
}

// ── Tipos ────────────────────────────────────────────────────
type RangeKey = '7d' | '30d' | '90d' | 'all'

interface MeetingRow {
  id: string
  user_id: string | null
  team_id: string | null
  status: string | null
  source: string | null
  platform: string | null
  failure_reason: string | null
  bot_provider: string | null
  duration_seconds: number | null
  transcript: string | null
  insights: any
  created_at: string
  ended_at: string | null
  started_at: string | null
  updated_at: string | null
  title: string | null
}

interface UserLite {
  id: string
  email: string | null
  created_at: string
}

// ── Helpers ──────────────────────────────────────────────────
function rangeToDays(range: RangeKey): number | null {
  if (range === 'all') return null
  return parseInt(range.replace('d', ''), 10)
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

function safePct(num: number, den: number): number {
  if (!den) return 0
  return Math.round((num / den) * 1000) / 10
}

// ── Fetchers ─────────────────────────────────────────────────
async function fetchAllMeetings(): Promise<MeetingRow[]> {
  const PAGE = 1000
  const out: MeetingRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('meetings')
      .select('id,user_id,team_id,status,source,platform,failure_reason,bot_provider,duration_seconds,transcript,insights,created_at,ended_at,started_at,updated_at,title')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`meetings fetch: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...(data as MeetingRow[]))
    if (data.length < PAGE) break
    from += PAGE
  }
  return out
}

async function fetchAllUsers(): Promise<UserLite[]> {
  const PAGE = 1000
  const out: UserLite[] = []
  let page = 1
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE })
    if (error) throw new Error(`users fetch: ${error.message}`)
    const users = data?.users ?? []
    if (users.length === 0) break
    for (const u of users) {
      out.push({ id: u.id, email: u.email ?? null, created_at: u.created_at })
    }
    if (users.length < PAGE) break
    page += 1
  }
  return out
}

// ── Aggregators ──────────────────────────────────────────────
function buildOverview(meetings: MeetingRow[], users: UserLite[]): any {
  const now = Date.now()
  const d1 = now - 24 * 3600 * 1000
  const d7 = now - 7 * 24 * 3600 * 1000
  const d30 = now - 30 * 24 * 3600 * 1000

  const m7 = meetings.filter(m => new Date(m.created_at).getTime() >= d7)
  const m30 = meetings.filter(m => new Date(m.created_at).getTime() >= d30)

  const activeUserIds = (since: number) => new Set(
    meetings
      .filter(m => m.user_id && new Date(m.created_at).getTime() >= since)
      .map(m => m.user_id as string),
  )
  const dau = activeUserIds(d1).size
  const wau = activeUserIds(d7).size
  const mau = activeUserIds(d30).size

  const withTranscript = meetings.filter(m => (m.transcript ?? '').trim().length > 0).length
  const withInsights = meetings.filter(m => m.insights && !m.failure_reason && m.status === 'completed').length
  const transcriptRate = safePct(withTranscript, meetings.length)
  const insightsRate = safePct(withInsights, meetings.length)

  // Tempo médio até insights: created_at → updated_at quando status=completed e sem failure_reason.
  const completedDeltas = meetings
    .filter(m => m.status === 'completed' && !m.failure_reason && m.updated_at && m.created_at)
    .map(m => new Date(m.updated_at as string).getTime() - new Date(m.created_at).getTime())
    .filter(ms => ms > 0 && ms < 6 * 3600 * 1000)
  const avgInsightsMs = completedDeltas.length
    ? Math.round(completedDeltas.reduce((a, b) => a + b, 0) / completedDeltas.length)
    : null

  const newUsers7d = users.filter(u => new Date(u.created_at).getTime() >= d7).length
  const newUsers30d = users.filter(u => new Date(u.created_at).getTime() >= d30).length

  // Activated: usuários com ≥1 meeting alguma vez
  const usersWithMeeting = new Set(meetings.map(m => m.user_id).filter(Boolean) as string[])
  const activationRate = safePct(usersWithMeeting.size, users.length)

  return {
    totalUsers: users.length,
    newUsers7d,
    newUsers30d,
    dau,
    wau,
    mau,
    totalMeetings: meetings.length,
    meetings7d: m7.length,
    meetings30d: m30.length,
    transcriptSuccessPct: transcriptRate,
    insightsSuccessPct: insightsRate,
    avgTimeToInsightsMs: avgInsightsMs,
    activationRate,
    usersWithMeeting: usersWithMeeting.size,
  }
}

function buildTimeseries(meetings: MeetingRow[], users: UserLite[], days: number): any {
  const start = daysAgo(days - 1)
  const dayKeys: string[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    dayKeys.push(isoDay(d))
  }
  const empty = () => Object.fromEntries(dayKeys.map(k => [k, 0])) as Record<string, number>

  const meetingsByDay = empty()
  const signupsByDay = empty()
  const failuresByDay = empty()
  const activeUsersByDay: Record<string, Set<string>> = Object.fromEntries(dayKeys.map(k => [k, new Set<string>()]))

  const meetingsBySource: Record<string, Record<string, number>> = {}
  const failuresByReason: Record<string, Record<string, number>> = {}

  for (const m of meetings) {
    const day = isoDay(new Date(m.created_at))
    if (!(day in meetingsByDay)) continue
    meetingsByDay[day] += 1
    if (m.user_id) activeUsersByDay[day].add(m.user_id)
    const src = m.source || 'unknown'
    meetingsBySource[src] ??= empty()
    meetingsBySource[src][day] += 1
    if (m.failure_reason) {
      failuresByDay[day] += 1
      const reason = m.failure_reason.split(':')[0] || 'unknown'
      failuresByReason[reason] ??= empty()
      failuresByReason[reason][day] += 1
    }
  }
  for (const u of users) {
    const day = isoDay(new Date(u.created_at))
    if (day in signupsByDay) signupsByDay[day] += 1
  }

  return {
    days: dayKeys,
    meetingsByDay: dayKeys.map(k => meetingsByDay[k]),
    signupsByDay: dayKeys.map(k => signupsByDay[k]),
    failuresByDay: dayKeys.map(k => failuresByDay[k]),
    activeUsersByDay: dayKeys.map(k => activeUsersByDay[k].size),
    meetingsBySource: Object.fromEntries(
      Object.entries(meetingsBySource).map(([k, v]) => [k, dayKeys.map(d => v[d])]),
    ),
    failuresByReason: Object.fromEntries(
      Object.entries(failuresByReason).map(([k, v]) => [k, dayKeys.map(d => v[d])]),
    ),
  }
}

function buildQuality(meetings: MeetingRow[]): any {
  const total = meetings.length
  const withTranscript = meetings.filter(m => (m.transcript ?? '').trim().length > 0).length
  const withInsights = meetings.filter(m => m.insights && !m.failure_reason && m.status === 'completed').length
  const failed = meetings.filter(m => m.status === 'failed' || m.failure_reason).length

  const reasonCounts = new Map<string, number>()
  for (const m of meetings) {
    if (!m.failure_reason) continue
    const reason = m.failure_reason.split(':')[0]
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
  }
  const failureBreakdown = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count, pct: safePct(count, total) }))
    .sort((a, b) => b.count - a.count)

  // Distribuição de duração (em buckets)
  const durations = meetings.map(m => m.duration_seconds).filter((d): d is number => typeof d === 'number' && d > 0)
  const buckets = [
    { label: '<5min', min: 0, max: 300, count: 0 },
    { label: '5-15min', min: 300, max: 900, count: 0 },
    { label: '15-30min', min: 900, max: 1800, count: 0 },
    { label: '30-60min', min: 1800, max: 3600, count: 0 },
    { label: '>60min', min: 3600, max: Infinity, count: 0 },
  ]
  for (const d of durations) {
    const b = buckets.find(b => d >= b.min && d < b.max)
    if (b) b.count += 1
  }

  return {
    funnel: {
      total,
      withTranscript,
      withInsights,
      failed,
      transcriptPct: safePct(withTranscript, total),
      insightsPct: safePct(withInsights, total),
    },
    failureBreakdown,
    durationBuckets: buckets,
    avgDurationSeconds: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
  }
}

function buildTeams(
  meetings: MeetingRow[],
  teams: Array<{ id: string; name: string; team_type: string | null; evaluation_framework: string | null; created_at: string }>,
  members: Array<{ team_id: string; user_id: string; role: string; status: string }>,
): any {
  const now = Date.now()
  const d30 = now - 30 * 24 * 3600 * 1000

  const byTeam = new Map<string, { id: string; name: string; total: number; last30d: number; users: Set<string>; type: string | null; framework: string | null }>()
  for (const t of teams) {
    byTeam.set(t.id, { id: t.id, name: t.name, total: 0, last30d: 0, users: new Set(), type: t.team_type, framework: t.evaluation_framework })
  }
  for (const m of meetings) {
    if (!m.team_id) continue
    const t = byTeam.get(m.team_id)
    if (!t) continue
    t.total += 1
    if (new Date(m.created_at).getTime() >= d30) t.last30d += 1
    if (m.user_id) t.users.add(m.user_id)
  }

  const teamRows = [...byTeam.values()]
    .map(t => ({
      id: t.id,
      name: t.name,
      teamType: t.type,
      framework: t.framework,
      totalMeetings: t.total,
      meetings30d: t.last30d,
      activeUsers: t.users.size,
    }))
    .sort((a, b) => b.meetings30d - a.meetings30d)

  // Distribuições
  const typeDist = new Map<string, number>()
  const frameworkDist = new Map<string, number>()
  for (const t of teams) {
    const tt = t.team_type || 'unknown'
    typeDist.set(tt, (typeDist.get(tt) ?? 0) + 1)
    const fw = t.evaluation_framework || 'unknown'
    frameworkDist.set(fw, (frameworkDist.get(fw) ?? 0) + 1)
  }

  const memberCounts = new Map<string, number>()
  for (const mem of members) {
    if (mem.status !== 'active') continue
    memberCounts.set(mem.team_id, (memberCounts.get(mem.team_id) ?? 0) + 1)
  }

  return {
    teams: teamRows.map(t => ({ ...t, memberCount: memberCounts.get(t.id) ?? 0 })),
    teamTypeDistribution: [...typeDist.entries()].map(([k, v]) => ({ label: k, count: v })),
    frameworkDistribution: [...frameworkDist.entries()].map(([k, v]) => ({ label: k, count: v })),
    activeTeams30d: teamRows.filter(t => t.meetings30d > 0).length,
  }
}

function buildRetention(meetings: MeetingRow[], users: UserLite[]): any {
  // Cohort semanal: para cada usuário, semana do signup (W0) e em quais semanas seguintes
  // teve ao menos 1 meeting. Retornamos % retidos em W1..W8.
  const userMeetings = new Map<string, number[]>() // userId → timestamps
  for (const m of meetings) {
    if (!m.user_id) continue
    const arr = userMeetings.get(m.user_id) ?? []
    arr.push(new Date(m.created_at).getTime())
    userMeetings.set(m.user_id, arr)
  }

  const WEEK = 7 * 24 * 3600 * 1000
  function weekOf(ts: number, start: number): number {
    return Math.floor((ts - start) / WEEK)
  }

  // Agrupa users por semana de signup (relativa à semana mais antiga)
  const signups = users
    .filter(u => userMeetings.has(u.id)) // só conta quem virou usuário ativo
    .map(u => ({ id: u.id, signupTs: new Date(u.created_at).getTime() }))
  if (signups.length === 0) return { cohorts: [], maxWeek: 0 }

  const minSignup = Math.min(...signups.map(s => s.signupTs))
  const cohortMap = new Map<number, { size: number; retained: number[] }>()

  const now = Date.now()
  const maxWeekTracked = 8

  for (const s of signups) {
    const cohortWeek = weekOf(s.signupTs, minSignup)
    const c = cohortMap.get(cohortWeek) ?? { size: 0, retained: Array(maxWeekTracked + 1).fill(0) }
    c.size += 1
    const ts = userMeetings.get(s.id) ?? []
    // marca cada semana onde teve atividade
    const weeksWithActivity = new Set<number>()
    for (const t of ts) {
      const wk = Math.floor((t - s.signupTs) / WEEK)
      if (wk >= 0 && wk <= maxWeekTracked) weeksWithActivity.add(wk)
    }
    for (const w of weeksWithActivity) c.retained[w] += 1
    cohortMap.set(cohortWeek, c)
  }

  // Converte cohorts em rows ordenadas (semana real, não relativa)
  const cohorts = [...cohortMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([wk, c]) => {
      const cohortStart = new Date(minSignup + wk * WEEK)
      const weeksElapsed = Math.floor((now - cohortStart.getTime()) / WEEK)
      return {
        weekLabel: isoDay(cohortStart),
        size: c.size,
        retention: c.retained.map((cnt, w) => {
          if (w > weeksElapsed) return null // ainda não passou tempo suficiente
          return safePct(cnt, c.size)
        }),
      }
    })

  return { cohorts, maxWeek: maxWeekTracked }
}

// Saúde por provider de bot (MeetingBaas vs Attendee).
// Permite ver no painel se o Attendee está degradando: failurePct sobe e
// o failureBreakdown mostra 'attendee_*'.
function buildProviders(meetings: MeetingRow[]): any {
  const ACTIVE = new Set(['requesting', 'recording', 'processing'])
  const byProvider = new Map<string, {
    total: number; completed: number; failed: number; withTranscript: number; active: number; failures: Map<string, number>
  }>()

  for (const m of meetings) {
    const p = m.bot_provider || 'meetingbaas'
    const e = byProvider.get(p) ?? { total: 0, completed: 0, failed: 0, withTranscript: 0, active: 0, failures: new Map() }
    e.total += 1
    if (m.status === 'completed' && !m.failure_reason) e.completed += 1
    if (m.status === 'failed' || m.failure_reason) {
      e.failed += 1
      const reason = (m.failure_reason ?? 'unknown').split(':')[0]
      e.failures.set(reason, (e.failures.get(reason) ?? 0) + 1)
    }
    if ((m.transcript ?? '').trim().length > 0) e.withTranscript += 1
    if (m.status && ACTIVE.has(m.status)) e.active += 1
    byProvider.set(p, e)
  }

  return [...byProvider.entries()]
    .map(([provider, e]) => ({
      provider,
      total: e.total,
      completed: e.completed,
      failed: e.failed,
      active: e.active,
      successPct: safePct(e.completed, e.total),
      failurePct: safePct(e.failed, e.total),
      transcriptPct: safePct(e.withTranscript, e.total),
      failureBreakdown: [...e.failures.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.total - a.total)
}

function buildAdoption(
  users: UserLite[],
  calendarIntegrations: Array<{ user_id: string; status: string }>,
  meetings: MeetingRow[],
  aiChats: Array<{ user_id: string; created_at: string }>,
): any {
  const totalUsers = users.length || 1
  const calendarConnected = new Set(
    calendarIntegrations.filter(c => c.status === 'active' || c.status === 'connected' || !c.status).map(c => c.user_id),
  ).size

  const sourceCounts = new Map<string, Set<string>>()
  for (const m of meetings) {
    if (!m.user_id) continue
    const src = m.source || 'unknown'
    const s = sourceCounts.get(src) ?? new Set()
    s.add(m.user_id)
    sourceCounts.set(src, s)
  }

  const usersWithAiChat = new Set(aiChats.map(a => a.user_id)).size

  return {
    calendarConnectedPct: safePct(calendarConnected, totalUsers),
    calendarConnectedCount: calendarConnected,
    usersBySource: [...sourceCounts.entries()].map(([source, set]) => ({
      source,
      users: set.size,
      pct: safePct(set.size, totalUsers),
    })),
    aiChatAdoptionPct: safePct(usersWithAiChat, totalUsers),
    aiChatUsers: usersWithAiChat,
  }
}

function buildAiUsage(
  aiChats: Array<{ created_at: string; user_id: string; tokens_used: number | null }>,
  meetings: MeetingRow[],
  days: number,
): any {
  const start = daysAgo(days - 1)
  const dayKeys: string[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    dayKeys.push(isoDay(d))
  }
  const empty = () => Object.fromEntries(dayKeys.map(k => [k, 0])) as Record<string, number>
  const chatsByDay = empty()
  const tokensByDay = empty()
  const reprocessByDay = empty()

  for (const c of aiChats) {
    const day = isoDay(new Date(c.created_at))
    if (day in chatsByDay) chatsByDay[day] += 1
    if (day in tokensByDay && typeof c.tokens_used === 'number') tokensByDay[day] += c.tokens_used
  }
  // Reprocessamento: aproximamos por meetings com updated_at >> created_at + 10min
  for (const m of meetings) {
    if (!m.updated_at) continue
    const diff = new Date(m.updated_at).getTime() - new Date(m.created_at).getTime()
    if (diff < 10 * 60 * 1000) continue
    const day = isoDay(new Date(m.updated_at))
    if (day in reprocessByDay) reprocessByDay[day] += 1
  }

  const totalTokens = aiChats.reduce((sum, c) => sum + (c.tokens_used ?? 0), 0)

  return {
    days: dayKeys,
    chatsByDay: dayKeys.map(k => chatsByDay[k]),
    tokensByDay: dayKeys.map(k => tokensByDay[k]),
    reprocessByDay: dayKeys.map(k => reprocessByDay[k]),
    totalChats: aiChats.length,
    totalTokens,
  }
}

// ── Endpoint principal ───────────────────────────────────────
router.get('/', authMiddleware, adminMetricsGate, async (req: AuthRequest, res: Response) => {
  try {
    const rangeParam = (req.query.range as string) || '30d'
    const range = (['7d', '30d', '90d', 'all'].includes(rangeParam) ? rangeParam : '30d') as RangeKey
    const days = rangeToDays(range) ?? 90 // pra timeseries, 'all' usa 90d como visualização

    const cacheKey = `metrics:${range}`
    const cached = getCached(cacheKey)
    if (cached) {
      res.json({ ...cached, fromCache: true })
      return
    }

    const t0 = Date.now()

    // Buscas paralelas
    const [meetingsAll, users, teamsData, membersData, calIntData, aiChatsData, feedbackData] = await Promise.all([
      fetchAllMeetings(),
      fetchAllUsers(),
      supabase.from('teams').select('id,name,team_type,evaluation_framework,created_at,owner_id'),
      supabase.from('team_members').select('team_id,user_id,role,status'),
      supabase.from('calendar_integrations').select('user_id,status,connected_at'),
      supabase.from('meeting_ai_chats').select('user_id,created_at,tokens_used'),
      supabase.from('user_feedback').select('*').order('created_at', { ascending: false }).limit(10),
    ])

    const teams = (teamsData.data ?? []) as any[]
    const members = (membersData.data ?? []) as any[]
    const calInts = (calIntData.data ?? []) as any[]
    const aiChats = (aiChatsData.data ?? []) as any[]
    const feedback = (feedbackData.data ?? []) as any[]

    // Filtra meetings no range (overview usa tudo; timeseries usa só 'days')
    const meetingsInRange = range === 'all'
      ? meetingsAll
      : meetingsAll.filter(m => new Date(m.created_at).getTime() >= daysAgo(days).getTime())

    const overview = buildOverview(meetingsAll, users)
    const timeseries = buildTimeseries(meetingsAll, users, days)
    const quality = buildQuality(meetingsInRange)
    const providers = buildProviders(meetingsInRange)
    const teamsBlock = buildTeams(meetingsAll, teams, members)
    const retention = buildRetention(meetingsAll, users)
    const adoption = buildAdoption(users, calInts, meetingsAll, aiChats)
    const aiUsage = buildAiUsage(aiChats, meetingsAll, days)

    const payload = {
      range,
      rangeDays: days,
      generatedAt: new Date().toISOString(),
      tookMs: Date.now() - t0,
      counts: {
        users: users.length,
        meetings: meetingsAll.length,
        teams: teams.length,
        teamMembers: members.length,
        calendarIntegrations: calInts.length,
        aiChats: aiChats.length,
      },
      overview,
      timeseries,
      quality,
      providers,
      teams: teamsBlock,
      retention,
      adoption,
      aiUsage,
      feedback: feedback.map(f => ({
        id: f.id,
        userEmail: f.user_email,
        howUsing: f.how_using,
        whatThink: f.what_think,
        featureRequest: f.feature_request,
        createdAt: f.created_at,
      })),
    }

    setCached(cacheKey, payload)
    res.json({ ...payload, fromCache: false })
  } catch (err) {
    logger.error('[AdminMetrics] Erro ao montar payload:', err)
    res.status(500).json({ error: 'internal_error', message: err instanceof Error ? err.message : String(err) })
  }
})

// ── Health-check do gate (frontend pinga pra validar a chave) ─
router.get('/ping', authMiddleware, adminMetricsGate, (_req: AuthRequest, res: Response) => {
  res.json({ ok: true })
})

export default router
