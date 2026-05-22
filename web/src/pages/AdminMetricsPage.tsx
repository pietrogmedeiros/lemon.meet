// ============================================================
// AdminMetricsPage.tsx — Painel interno de observabilidade
//
// Gate duplo no frontend:
//   1. supabase user.email ∈ DEV_ALLOWLIST
//   2. token salvo em localStorage (prompt na primeira visita) validado
//      no backend contra ADMIN_METRICS_KEY
//
// Backend: /api/admin/metrics?range=7d|30d|90d|all
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout'
import { Card } from '@/components/ui'
import { supabase } from '@/lib/supabase'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const ADMIN_KEY_STORAGE = 'admin-metrics-key'

const DEV_ALLOWLIST = new Set(['pietrogoncalvesmedeiros@gmail.com'])

type RangeKey = '7d' | '30d' | '90d' | 'all'

interface MetricsPayload {
  range: RangeKey
  rangeDays: number
  generatedAt: string
  tookMs: number
  fromCache?: boolean
  counts: {
    users: number
    meetings: number
    teams: number
    teamMembers: number
    calendarIntegrations: number
    aiChats: number
  }
  overview: {
    totalUsers: number
    newUsers7d: number
    newUsers30d: number
    dau: number
    wau: number
    mau: number
    totalMeetings: number
    meetings7d: number
    meetings30d: number
    transcriptSuccessPct: number
    insightsSuccessPct: number
    avgTimeToInsightsMs: number | null
    activationRate: number
    usersWithMeeting: number
  }
  timeseries: {
    days: string[]
    meetingsByDay: number[]
    signupsByDay: number[]
    failuresByDay: number[]
    activeUsersByDay: number[]
    meetingsBySource: Record<string, number[]>
    failuresByReason: Record<string, number[]>
  }
  quality: {
    funnel: {
      total: number
      withTranscript: number
      withInsights: number
      failed: number
      transcriptPct: number
      insightsPct: number
    }
    failureBreakdown: Array<{ reason: string; count: number; pct: number }>
    durationBuckets: Array<{ label: string; count: number }>
    avgDurationSeconds: number | null
  }
  teams: {
    teams: Array<{
      id: string
      name: string
      teamType: string | null
      framework: string | null
      totalMeetings: number
      meetings30d: number
      activeUsers: number
      memberCount: number
    }>
    teamTypeDistribution: Array<{ label: string; count: number }>
    frameworkDistribution: Array<{ label: string; count: number }>
    activeTeams30d: number
  }
  retention: {
    cohorts: Array<{ weekLabel: string; size: number; retention: Array<number | null> }>
    maxWeek: number
  }
  adoption: {
    calendarConnectedPct: number
    calendarConnectedCount: number
    usersBySource: Array<{ source: string; users: number; pct: number }>
    aiChatAdoptionPct: number
    aiChatUsers: number
  }
  aiUsage: {
    days: string[]
    chatsByDay: number[]
    tokensByDay: number[]
    reprocessByDay: number[]
    totalChats: number
    totalTokens: number
  }
  feedback: Array<{
    id: string
    userEmail: string | null
    howUsing: string | null
    whatThink: string | null
    featureRequest: string | null
    createdAt: string
  }>
}

// ── helpers ──────────────────────────────────────────────────
function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('pt-BR')
}
function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${n.toFixed(1)}%`
}
function formatMs(ms: number | null | undefined): string {
  if (!ms) return '—'
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(0)}s`
  return `${(sec / 60).toFixed(1)}min`
}
function formatDuration(s: number | null | undefined): string {
  if (!s) return '—'
  const m = Math.floor(s / 60)
  return `${m}min`
}
const REASON_COLORS: Record<string, string> = {
  no_transcript_in_webhook: '#E07B6F',
  no_transcript: '#E07B6F',
  no_transcription_url: '#D86F8C',
  transcription_download_failed: '#C97AB4',
  insights_generation_failed: '#B97FCC',
  extension_no_audio_captured: '#9C8EE0',
  transcription_failed: '#7AA8E0',
  unknown: '#888',
}
const SOURCE_COLORS: Record<string, string> = {
  calendar: '#2D5A27',
  extension: '#5A7F47',
  in_person: '#A47A47',
  presencial: '#A47A47',
  zoom: '#3C5A99',
  google_meet: '#2D5A27',
  unknown: '#888',
}
function colorForReason(r: string): string {
  return REASON_COLORS[r] ?? '#888'
}
function colorForSource(s: string): string {
  return SOURCE_COLORS[s] ?? '#666'
}

// ── tiny bar/line components (sem dep nova) ──────────────────
function ChartTooltip({ hover, containerWidth, n }: {
  hover: { i: number; lines: Array<{ label: string; value: string; color?: string }>; title: string } | null
  containerWidth: number
  n: number
}) {
  if (!hover || !containerWidth) return null
  // Posiciona acima da barra hover-ada
  const colW = containerWidth / n
  const x = colW * (hover.i + 0.5)
  // Largura do tooltip estimada — clampa pra não vazar
  const tipW = 180
  const left = Math.max(4, Math.min(containerWidth - tipW - 4, x - tipW / 2))
  return (
    <div
      className="absolute pointer-events-none z-10 bg-white rounded-md shadow-lg border border-[#E5E7EB] px-2.5 py-1.5 text-xs"
      style={{ left, top: -8, transform: 'translateY(-100%)', minWidth: 120, maxWidth: tipW }}
    >
      <div className="font-medium text-[#1F2937] mb-1">{hover.title}</div>
      {hover.lines.map((l, idx) => (
        <div key={idx} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[#444]">
            {l.color && <span className="inline-block w-2 h-2 rounded-sm" style={{ background: l.color }} />}
            <span>{l.label}</span>
          </span>
          <span className="tabular-nums text-[#1F2937] font-medium">{l.value}</span>
        </div>
      ))}
    </div>
  )
}

function BarChart({ labels, values, color = '#2D5A27', height = 140, formatValue }: {
  labels: string[]
  values: number[]
  color?: string
  height?: number
  formatValue?: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const update = () => setContainerWidth(el.offsetWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!values.length) return null
  const max = Math.max(...values, 1)
  const hoverState = hover === null ? null : {
    i: hover,
    title: labels[hover] ?? '',
    lines: [{ label: 'valor', value: formatValue ? formatValue(values[hover]) : values[hover].toLocaleString('pt-BR') }],
  }

  return (
    <div ref={ref} className="relative" style={{ height }}>
      <ChartTooltip hover={hoverState} containerWidth={containerWidth} n={values.length} />
      <div className="flex items-end gap-px h-full" onMouseLeave={() => setHover(null)}>
        {values.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t transition-opacity cursor-default"
            onMouseEnter={() => setHover(i)}
            style={{
              height: `${(v / max) * 100}%`,
              background: color,
              minHeight: v > 0 ? 2 : 0,
              opacity: hover === null ? (v > 0 ? 1 : 0.15) : hover === i ? 1 : 0.5,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function StackedBarChart({ labels, series, height = 160 }: {
  labels: string[]
  series: Array<{ name: string; values: number[]; color: string }>
  height?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const update = () => setContainerWidth(el.offsetWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!series.length) return null
  const n = labels.length
  const totals: number[] = []
  for (let i = 0; i < n; i++) {
    let s = 0
    for (const ser of series) s += ser.values[i] ?? 0
    totals.push(s)
  }
  const max = Math.max(...totals, 1)

  const hoverState = hover === null ? null : {
    i: hover,
    title: `${labels[hover] ?? ''} · total ${totals[hover]}`,
    lines: series
      .map(ser => ({ label: ser.name, value: (ser.values[hover] ?? 0).toLocaleString('pt-BR'), color: ser.color, raw: ser.values[hover] ?? 0 }))
      .filter(l => l.raw > 0)
      .sort((a, b) => b.raw - a.raw),
  }

  return (
    <div ref={ref} className="relative" style={{ height }}>
      <ChartTooltip hover={hoverState} containerWidth={containerWidth} n={n} />
      <div className="flex items-end gap-px h-full" onMouseLeave={() => setHover(null)}>
        {Array.from({ length: n }).map((_, i) => {
          const total = totals[i]
          return (
            <div
              key={i}
              className="flex-1 flex flex-col-reverse rounded-t overflow-hidden cursor-default transition-opacity"
              onMouseEnter={() => setHover(i)}
              style={{
                height: `${(total / max) * 100}%`,
                minHeight: total > 0 ? 2 : 0,
                opacity: hover === null ? 1 : hover === i ? 1 : 0.5,
              }}
            >
              {series.map((ser, j) => (
                <div
                  key={j}
                  style={{
                    background: ser.color,
                    height: `${total > 0 ? ((ser.values[i] ?? 0) / total) * 100 : 0}%`,
                    minHeight: (ser.values[i] ?? 0) > 0 ? 1 : 0,
                  }}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function KpiCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
      <div className="text-[11px] uppercase tracking-wider text-[#666]">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-[#1F2937]">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-[#999]">{hint}</div>}
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-[#1F2937]">{title}</h2>
        {subtitle && <p className="text-xs text-[#666] mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </Card>
  )
}

function Legend({ items }: { items: Array<{ label: string; color: string; value?: string | number }> }) {
  return (
    <div className="flex flex-wrap gap-3 mt-2 text-xs text-[#444]">
      {items.map(it => (
        <div key={it.label} className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} />
          <span>{it.label}{it.value !== undefined ? ` · ${it.value}` : ''}</span>
        </div>
      ))}
    </div>
  )
}

// ── página ───────────────────────────────────────────────────
export function AdminMetricsPage() {
  const navigate = useNavigate()
  const [authChecked, setAuthChecked] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [adminKey, setAdminKey] = useState<string>(() => localStorage.getItem(ADMIN_KEY_STORAGE) || '')
  const [keyPrompt, setKeyPrompt] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)

  const [range, setRange] = useState<RangeKey>('30d')
  const [data, setData] = useState<MetricsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Bootstrap: pega session e email
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!active) return
      const email = session?.user?.email?.toLowerCase().trim() ?? null
      setUserEmail(email)
      setAccessToken(session?.access_token ?? null)
      setAuthChecked(true)
      if (!session) navigate('/login')
    })()
    return () => { active = false }
  }, [navigate])

  const isAllowed = userEmail ? DEV_ALLOWLIST.has(userEmail) : false

  // Fetch
  const fetchMetrics = useCallback(async () => {
    if (!accessToken || !adminKey || !isAllowed) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/admin/metrics?range=${range}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-admin-key': adminKey,
        },
      })
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}))
        if (body.error === 'invalid_admin_key') {
          setKeyError('Chave inválida. Limpe e tente de novo.')
          setLoading(false)
          return
        }
        setError('Sem permissão.')
        setLoading(false)
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as MetricsPayload
      setData(json)
      setKeyError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [accessToken, adminKey, isAllowed, range, refreshKey])

  useEffect(() => { fetchMetrics() }, [fetchMetrics])

  const handleSaveKey = () => {
    const k = keyPrompt.trim()
    if (k.length < 16) {
      setKeyError('Token muito curto (mín. 16 chars).')
      return
    }
    localStorage.setItem(ADMIN_KEY_STORAGE, k)
    setAdminKey(k)
    setKeyPrompt('')
    setKeyError(null)
  }

  const handleClearKey = () => {
    localStorage.removeItem(ADMIN_KEY_STORAGE)
    setAdminKey('')
    setData(null)
  }

  const tsLabels = useMemo(() => data?.timeseries.days.map(d => d.slice(5)) ?? [], [data])

  // ── render gates ───────────────────────────────────────────
  if (!authChecked) {
    return <MainLayout><div className="p-6 text-sm text-[#666]">Verificando sessão…</div></MainLayout>
  }
  if (!isAllowed) {
    return (
      <MainLayout>
        <div className="p-6">
          <Card>
            <h1 className="text-lg font-semibold mb-2">Acesso restrito</h1>
            <p className="text-sm text-[#666]">Este painel é apenas para devs autorizados.</p>
            <p className="text-xs text-[#999] mt-2">Logado como: {userEmail ?? '—'}</p>
          </Card>
        </div>
      </MainLayout>
    )
  }
  if (!adminKey) {
    return (
      <MainLayout>
        <div className="p-6 max-w-md">
          <Card>
            <h1 className="text-lg font-semibold mb-2">Token do painel</h1>
            <p className="text-sm text-[#666] mb-3">Cole o <code>ADMIN_METRICS_KEY</code> configurado no servidor.</p>
            <input
              type="password"
              value={keyPrompt}
              onChange={e => setKeyPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveKey() }}
              placeholder="x-admin-key"
              className="w-full px-3 py-2 border border-[#E5E7EB] rounded text-sm"
              autoFocus
            />
            {keyError && <p className="text-xs text-red-600 mt-2">{keyError}</p>}
            <button
              onClick={handleSaveKey}
              className="mt-3 px-4 py-2 bg-[#2D5A27] text-white rounded text-sm hover:bg-[#244520]"
            >
              Salvar e entrar
            </button>
          </Card>
        </div>
      </MainLayout>
    )
  }

  // ── render principal ───────────────────────────────────────
  return (
    <MainLayout>
      <div className="p-4 sm:p-6 max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#1F2937]">Métricas internas</h1>
            <p className="text-xs text-[#666] mt-1">
              Logado como {userEmail}
              {data && <> · gerado em {new Date(data.generatedAt).toLocaleTimeString('pt-BR')} ({data.tookMs}ms{data.fromCache ? ', cache' : ''})</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={range}
              onChange={e => setRange(e.target.value as RangeKey)}
              className="px-3 py-1.5 border border-[#E5E7EB] rounded text-sm bg-white"
            >
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="90d">Últimos 90 dias</option>
              <option value="all">Tudo</option>
            </select>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              disabled={loading}
              className="px-3 py-1.5 border border-[#E5E7EB] rounded text-sm bg-white hover:bg-[#F8F9FA] disabled:opacity-50"
            >
              {loading ? 'Atualizando…' : 'Atualizar'}
            </button>
            <button
              onClick={handleClearKey}
              className="px-3 py-1.5 border border-[#E5E7EB] rounded text-sm bg-white hover:bg-[#F8F9FA] text-[#666]"
              title="Esquecer o token e voltar ao prompt"
            >
              Sair do painel
            </button>
          </div>
        </div>

        {error && <Card className="mb-4 border-red-200 bg-red-50"><p className="text-sm text-red-700">Erro: {error}</p></Card>}

        {!data && loading && <p className="text-sm text-[#666]">Carregando…</p>}

        {data && (
          <>
            {/* ── KPIs ───────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
              <KpiCard title="Total users" value={formatNumber(data.overview.totalUsers)} hint={`+${data.overview.newUsers7d} em 7d · +${data.overview.newUsers30d} em 30d`} />
              <KpiCard title="DAU / WAU / MAU" value={`${data.overview.dau} / ${data.overview.wau} / ${data.overview.mau}`} hint="usuários distintos c/ meeting" />
              <KpiCard title="Meetings totais" value={formatNumber(data.overview.totalMeetings)} hint={`${data.overview.meetings7d} em 7d · ${data.overview.meetings30d} em 30d`} />
              <KpiCard title="Transcrição OK" value={formatPct(data.overview.transcriptSuccessPct)} hint="% de meetings c/ transcrição" />
              <KpiCard title="Insights OK" value={formatPct(data.overview.insightsSuccessPct)} hint="completed sem failure_reason" />
              <KpiCard title="Tempo até insights" value={formatMs(data.overview.avgTimeToInsightsMs)} hint="média (created → updated)" />
            </div>

            {/* ── Crescimento ────────────────────────────────── */}
            <Section title="Crescimento" subtitle="Signups, ativação e usuários ativos por dia">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-[#666] mb-1">Signups/dia</div>
                  <BarChart labels={tsLabels} values={data.timeseries.signupsByDay} color="#5A7F47" />
                  <div className="text-xs text-[#999] mt-1">{data.timeseries.signupsByDay.reduce((a, b) => a + b, 0)} no período</div>
                </div>
                <div>
                  <div className="text-xs text-[#666] mb-1">Usuários ativos/dia</div>
                  <BarChart labels={tsLabels} values={data.timeseries.activeUsersByDay} color="#2D5A27" />
                  <div className="text-xs text-[#999] mt-1">pico: {Math.max(...data.timeseries.activeUsersByDay, 0)}</div>
                </div>
                <div>
                  <div className="text-xs text-[#666] mb-1">Ativação</div>
                  <div className="text-3xl font-semibold text-[#2D5A27]">{formatPct(data.overview.activationRate)}</div>
                  <div className="text-xs text-[#999]">{data.overview.usersWithMeeting} de {data.overview.totalUsers} users já fizeram ≥1 meeting</div>
                </div>
              </div>
            </Section>

            {/* ── Engajamento ────────────────────────────────── */}
            <Section title="Engajamento" subtitle="Meetings por dia, por fonte e por plataforma">
              <div>
                <StackedBarChart
                  labels={tsLabels}
                  series={Object.entries(data.timeseries.meetingsBySource).map(([source, values]) => ({
                    name: source,
                    values,
                    color: colorForSource(source),
                  }))}
                />
                <Legend
                  items={Object.entries(data.timeseries.meetingsBySource).map(([source, values]) => ({
                    label: source,
                    color: colorForSource(source),
                    value: values.reduce((a, b) => a + b, 0),
                  }))}
                />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
                <div>
                  <div className="text-xs text-[#666] mb-1">Distribuição de duração</div>
                  <div className="space-y-1">
                    {data.quality.durationBuckets.map(b => {
                      const max = Math.max(...data.quality.durationBuckets.map(x => x.count), 1)
                      return (
                        <div key={b.label} className="flex items-center gap-2 text-xs">
                          <div className="w-16 text-[#666]">{b.label}</div>
                          <div className="flex-1 bg-[#F0F0F0] rounded h-4 relative overflow-hidden">
                            <div className="bg-[#5A7F47] h-full" style={{ width: `${(b.count / max) * 100}%` }} />
                          </div>
                          <div className="w-10 text-right tabular-nums">{b.count}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="text-xs text-[#999] mt-2">média: {formatDuration(data.quality.avgDurationSeconds)}</div>
                </div>
                <div>
                  <div className="text-xs text-[#666] mb-1">Meetings/dia (total)</div>
                  <BarChart labels={tsLabels} values={data.timeseries.meetingsByDay} color="#2D5A27" height={140} />
                  <div className="text-xs text-[#999] mt-1">total: {data.timeseries.meetingsByDay.reduce((a, b) => a + b, 0)}</div>
                </div>
              </div>
            </Section>

            {/* ── Qualidade (núcleo do produto) ──────────────── */}
            <Section title="Qualidade do core" subtitle="Funil de transcrição → insights e razões de falha">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="col-span-1">
                  <div className="text-xs text-[#666] mb-2">Funil ({data.range === 'all' ? 'tudo' : `${data.rangeDays}d`})</div>
                  {(() => {
                    const f = data.quality.funnel
                    const max = Math.max(f.total, 1)
                    const rows = [
                      { label: 'Meetings criadas', count: f.total, color: '#888' },
                      { label: 'Com transcrição', count: f.withTranscript, color: '#5A7F47' },
                      { label: 'Com insights', count: f.withInsights, color: '#2D5A27' },
                      { label: 'Falhou', count: f.failed, color: '#E07B6F' },
                    ]
                    return (
                      <div className="space-y-2">
                        {rows.map(r => (
                          <div key={r.label}>
                            <div className="flex justify-between text-xs mb-0.5">
                              <span className="text-[#444]">{r.label}</span>
                              <span className="tabular-nums text-[#666]">{r.count} ({formatPct((r.count / max) * 100)})</span>
                            </div>
                            <div className="bg-[#F0F0F0] rounded h-3 overflow-hidden">
                              <div style={{ width: `${(r.count / max) * 100}%`, background: r.color }} className="h-full" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
                <div className="col-span-1 lg:col-span-2">
                  <div className="text-xs text-[#666] mb-2">Falhas por motivo</div>
                  {data.quality.failureBreakdown.length === 0 ? (
                    <p className="text-sm text-[#999]">Sem falhas no período. 🎉</p>
                  ) : (
                    <div className="space-y-1">
                      {data.quality.failureBreakdown.map(f => {
                        const max = data.quality.failureBreakdown[0].count
                        return (
                          <div key={f.reason} className="flex items-center gap-2 text-xs">
                            <div className="w-56 text-[#444] truncate" title={f.reason}>{f.reason}</div>
                            <div className="flex-1 bg-[#F0F0F0] rounded h-4 overflow-hidden">
                              <div className="h-full" style={{ width: `${(f.count / max) * 100}%`, background: colorForReason(f.reason) }} />
                            </div>
                            <div className="w-16 text-right tabular-nums text-[#666]">{f.count} · {formatPct(f.pct)}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-5">
                <div className="text-xs text-[#666] mb-1">Falhas/dia stacked por motivo</div>
                <StackedBarChart
                  labels={tsLabels}
                  series={Object.entries(data.timeseries.failuresByReason).map(([reason, values]) => ({
                    name: reason, values, color: colorForReason(reason),
                  }))}
                />
                <Legend
                  items={Object.entries(data.timeseries.failuresByReason).map(([reason, values]) => ({
                    label: reason, color: colorForReason(reason), value: values.reduce((a, b) => a + b, 0),
                  }))}
                />
              </div>
            </Section>

            {/* ── Adoção de features ─────────────────────────── */}
            <Section title="Adoção de features" subtitle="Em quais superfícies os usuários estão entrando">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard title="Google Calendar conectado" value={formatPct(data.adoption.calendarConnectedPct)} hint={`${data.adoption.calendarConnectedCount} users`} />
                <KpiCard title="Usaram chat IA" value={formatPct(data.adoption.aiChatAdoptionPct)} hint={`${data.adoption.aiChatUsers} users`} />
                <KpiCard title="Times c/ atividade 30d" value={formatNumber(data.teams.activeTeams30d)} hint={`de ${data.counts.teams} times`} />
                <KpiCard title="Tokens IA totais" value={formatNumber(data.aiUsage.totalTokens)} hint={`${data.aiUsage.totalChats} chats`} />
              </div>
              <div className="mt-4">
                <div className="text-xs text-[#666] mb-2">% de users por fonte de meeting</div>
                <div className="space-y-1">
                  {data.adoption.usersBySource.map(s => {
                    const max = Math.max(...data.adoption.usersBySource.map(x => x.users), 1)
                    return (
                      <div key={s.source} className="flex items-center gap-2 text-xs">
                        <div className="w-28 text-[#444]">{s.source}</div>
                        <div className="flex-1 bg-[#F0F0F0] rounded h-4 overflow-hidden">
                          <div className="h-full" style={{ width: `${(s.users / max) * 100}%`, background: colorForSource(s.source) }} />
                        </div>
                        <div className="w-28 text-right tabular-nums text-[#666]">{s.users} ({formatPct(s.pct)})</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </Section>

            {/* ── Times ──────────────────────────────────────── */}
            <Section title="Times" subtitle="Top 10 por atividade e distribuição">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-[#666] border-b border-[#E5E7EB]">
                    <tr>
                      <th className="text-left py-2 pr-3">Time</th>
                      <th className="text-left py-2 px-3">Tipo</th>
                      <th className="text-left py-2 px-3">Framework</th>
                      <th className="text-right py-2 px-3">Membros</th>
                      <th className="text-right py-2 px-3">30d</th>
                      <th className="text-right py-2 px-3">Total</th>
                      <th className="text-right py-2 pl-3">Users ativos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teams.teams.slice(0, 10).map(t => (
                      <tr key={t.id} className="border-b border-[#F0F0F0]">
                        <td className="py-2 pr-3 font-medium">{t.name}</td>
                        <td className="py-2 px-3 text-[#666]">{t.teamType ?? '—'}</td>
                        <td className="py-2 px-3 text-[#666]">{t.framework ?? '—'}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{t.memberCount}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-medium">{t.meetings30d}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{t.totalMeetings}</td>
                        <td className="py-2 pl-3 text-right tabular-nums">{t.activeUsers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <div className="text-xs text-[#666] mb-1">Tipo de time</div>
                  <div className="space-y-1">
                    {data.teams.teamTypeDistribution.map(t => (
                      <div key={t.label} className="flex justify-between text-xs"><span>{t.label}</span><span className="tabular-nums">{t.count}</span></div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#666] mb-1">Framework de avaliação</div>
                  <div className="space-y-1">
                    {data.teams.frameworkDistribution.map(t => (
                      <div key={t.label} className="flex justify-between text-xs"><span>{t.label}</span><span className="tabular-nums">{t.count}</span></div>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            {/* ── Retenção ───────────────────────────────────── */}
            <Section title="Retenção (cohorts semanais)" subtitle="% de usuários da cohort que voltaram a ter meeting na semana N">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[#666] border-b border-[#E5E7EB]">
                      <th className="text-left py-1.5 pr-2">Cohort</th>
                      <th className="text-right py-1.5 px-2">N</th>
                      {Array.from({ length: data.retention.maxWeek + 1 }).map((_, i) => (
                        <th key={i} className="text-right py-1.5 px-2">W{i}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.retention.cohorts.map(c => (
                      <tr key={c.weekLabel} className="border-b border-[#F8F9FA]">
                        <td className="py-1.5 pr-2 text-[#444]">{c.weekLabel}</td>
                        <td className="py-1.5 px-2 text-right text-[#666] tabular-nums">{c.size}</td>
                        {c.retention.map((v, w) => (
                          <td
                            key={w}
                            className="py-1.5 px-2 text-right tabular-nums"
                            style={{
                              background: v === null ? 'transparent' : `rgba(45, 90, 39, ${Math.min((v ?? 0) / 100, 1) * 0.35})`,
                            }}
                          >
                            {v === null ? '' : `${v.toFixed(0)}%`}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.retention.cohorts.length === 0 && <p className="text-sm text-[#999]">Sem dados suficientes ainda.</p>}
            </Section>

            {/* ── IA usage ───────────────────────────────────── */}
            <Section title="Uso de IA" subtitle="Chats, tokens e reprocessamentos por dia">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-[#666] mb-1">Chats IA/dia</div>
                  <BarChart labels={tsLabels} values={data.aiUsage.chatsByDay} color="#B97FCC" />
                  <div className="text-xs text-[#999] mt-1">total: {data.aiUsage.totalChats}</div>
                </div>
                <div>
                  <div className="text-xs text-[#666] mb-1">Tokens IA/dia</div>
                  <BarChart labels={tsLabels} values={data.aiUsage.tokensByDay} color="#9C8EE0" />
                  <div className="text-xs text-[#999] mt-1">total: {formatNumber(data.aiUsage.totalTokens)}</div>
                </div>
                <div>
                  <div className="text-xs text-[#666] mb-1">Reprocessamentos/dia</div>
                  <BarChart labels={tsLabels} values={data.aiUsage.reprocessByDay} color="#A47A47" />
                  <div className="text-xs text-[#999] mt-1">sinal de qualidade ruim de insights</div>
                </div>
              </div>
            </Section>

            {/* ── Voz do usuário ─────────────────────────────── */}
            <Section title="Voz do usuário" subtitle="Últimos 10 feedbacks coletados">
              {data.feedback.length === 0 ? (
                <p className="text-sm text-[#999]">Sem feedbacks ainda.</p>
              ) : (
                <div className="space-y-3">
                  {data.feedback.map(f => (
                    <div key={f.id} className="border-l-2 border-[#5A7F47] pl-3 text-sm">
                      <div className="text-xs text-[#666] mb-1">
                        {f.userEmail ?? '—'} · {new Date(f.createdAt).toLocaleDateString('pt-BR')}
                      </div>
                      {f.howUsing && <div><span className="text-[#999] text-xs">como usa:</span> {f.howUsing}</div>}
                      {f.whatThink && <div><span className="text-[#999] text-xs">o que acha:</span> {f.whatThink}</div>}
                      {f.featureRequest && <div><span className="text-[#999] text-xs">pediu:</span> {f.featureRequest}</div>}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <p className="text-xs text-[#999] mt-6 mb-2">
              Dados de {data.counts.users} users · {data.counts.meetings} meetings · {data.counts.teams} times · {data.counts.aiChats} chats IA · cache 60s.
            </p>
          </>
        )}
      </div>
    </MainLayout>
  )
}
