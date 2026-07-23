// ============================================================
// metrics.ts
// Instrumentação Prometheus do backend (observabilidade pura).
//
// Expõe:
//   - register            : Registry do prom-client (usado por GET /metrics)
//   - metricsMiddleware    : mede RED (Rate/Errors/Duration) por rota
//   - metricsHandler       : handler da rota GET /metrics
//
// Métricas padrão do Node (event loop, heap, GC, etc.) saem com o
// prefixo lemon_meet_backend_. O scrape do Prometheus roda contra
// http://lemon-meet_backend:3000/metrics (rede interna Docker).
// ============================================================

import type { Request, Response, NextFunction } from 'express'
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client'
import { logger } from './utils/logger.js'

const PREFIX = 'lemon_meet_backend_'

// Registry dedicado (não usamos o global) — mais fácil de isolar/testar.
export const register = new Registry()

// Métricas padrão do Node: process_*, nodejs_* (heap, event loop lag, GC…)
collectDefaultMetrics({ register, prefix: PREFIX })

// RED — Rate + Errors (via status_code) por rota.
const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total de requisições HTTP recebidas',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
})

// RED — Duration. Buckets em segundos, calibrados p/ latência de API.
const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração das requisições HTTP em segundos',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
})

// ============================================================
// Métricas de PRODUTO (namespace lemon_meet_*)
// Fluxos de negócio: dispatch de bots, transcrição, reuniões e
// o cron de calendário. Alimentadas pelos helpers exportados no
// fim deste arquivo — os serviços chamam os helpers (1 linha),
// mantendo o código de negócio limpo.
// ============================================================

// --- Bots / Dispatch ---
const botDispatchTotal = new Counter({
  name: 'lemon_meet_bot_dispatch_total',
  help: 'Dispatches de bot por provider, modo e resultado',
  labelNames: ['provider', 'mode', 'outcome'] as const, // mode=immediate|scheduled, outcome=success|fail
  registers: [register],
})

const botDispatchDuration = new Histogram({
  name: 'lemon_meet_bot_dispatch_duration_seconds',
  help: 'Latência da chamada de dispatch ao provider do bot',
  labelNames: ['provider', 'mode'] as const,
  buckets: [0.1, 0.3, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
})

const botFallbackTotal = new Counter({
  name: 'lemon_meet_bot_fallback_total',
  help: 'Fallbacks de provider por FALHA (ex: skribby/attendee → meetingbaas)',
  labelNames: ['to_provider'] as const,
  registers: [register],
})

const botStatusTotal = new Counter({
  name: 'lemon_meet_bot_status_total',
  help: 'Transições de status do bot recebidas via webhook',
  labelNames: ['provider', 'status'] as const, // status interno: requesting|recording|processing|completed|failed
  registers: [register],
})

const attendeeActiveBots = new Gauge({
  name: 'lemon_meet_attendee_active_bots',
  help: 'Bots Attendee ativos na janela de capacidade (último valor observado no dispatch)',
  registers: [register],
})

const attendeeMaxConcurrent = new Gauge({
  name: 'lemon_meet_attendee_max_concurrent',
  help: 'Teto de bots Attendee simultâneos (ATTENDEE_MAX_CONCURRENT)',
  registers: [register],
})

// --- Transcrição (Groq/Whisper) ---
const transcriptionDuration = new Histogram({
  name: 'lemon_meet_transcription_duration_seconds',
  help: 'Latência da transcrição via Groq por método e resultado',
  labelNames: ['method', 'result'] as const, // method=file|buffer, result=success|error
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [register],
})

const transcriptionTotal = new Counter({
  name: 'lemon_meet_transcription_total',
  help: 'Transcrições executadas por método e resultado',
  labelNames: ['method', 'result'] as const,
  registers: [register],
})

const transcriptionAudioSeconds = new Histogram({
  name: 'lemon_meet_transcription_audio_seconds',
  help: 'Duração (em segundos) do áudio submetido à transcrição',
  labelNames: ['source'] as const,
  buckets: [30, 60, 300, 600, 1800, 3600, 7200],
  registers: [register],
})

// --- Reuniões ---
const meetingsCreatedTotal = new Counter({
  name: 'lemon_meet_meetings_created_total',
  help: 'Reuniões criadas por origem e tipo',
  labelNames: ['source', 'type'] as const, // source=extension|in_person|desktop|calendar, type=online|in_person
  registers: [register],
})

const meetingsStuckRequesting = new Gauge({
  name: 'lemon_meet_meetings_stuck_requesting',
  help: 'Reuniões presas em requesting por provider (detectado pelo cron)',
  labelNames: ['provider'] as const,
  registers: [register],
})

// --- Calendar cron ---
const calendarCronTicksTotal = new Counter({
  name: 'lemon_meet_calendar_cron_ticks_total',
  help: 'Execuções (ticks) do cron de calendário por resultado',
  labelNames: ['result'] as const, // success|error
  registers: [register],
})

const calendarCronDuration = new Histogram({
  name: 'lemon_meet_calendar_cron_duration_seconds',
  help: 'Duração de cada tick do cron de calendário',
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [register],
})

const calendarCronEventsMatched = new Counter({
  name: 'lemon_meet_calendar_cron_events_matched_total',
  help: 'Eventos de calendário dentro da janela de agendamento (candidatos a bot)',
  registers: [register],
})

const calendarCronBotsDispatched = new Counter({
  name: 'lemon_meet_calendar_cron_bots_dispatched_total',
  help: 'Bots efetivamente disparados pelo cron de calendário',
  labelNames: ['mode'] as const, // immediate|scheduled
  registers: [register],
})

// ============================================================
// Helpers de registro — API estável para os serviços de negócio.
// Todos são no-throw por design (observabilidade nunca deve
// derrubar o fluxo de negócio).
// ============================================================

export const botMetrics = {
  /** Registra o resultado + latência de um dispatch. durationSeconds opcional. */
  dispatch(provider: string, mode: 'immediate' | 'scheduled', outcome: 'success' | 'fail', durationSeconds?: number): void {
    try {
      botDispatchTotal.inc({ provider, mode, outcome })
      if (typeof durationSeconds === 'number' && durationSeconds >= 0) {
        botDispatchDuration.observe({ provider, mode }, durationSeconds)
      }
    } catch { /* noop */ }
  },
  fallback(toProvider: string): void {
    try { botFallbackTotal.inc({ to_provider: toProvider }) } catch { /* noop */ }
  },
  status(provider: string, status: string): void {
    try { botStatusTotal.inc({ provider, status }) } catch { /* noop */ }
  },
  /** Reflete a ocupação observada na decisão de capacidade. */
  capacity(activeAttendee: number, maxConcurrent: number): void {
    try {
      attendeeActiveBots.set(activeAttendee)
      attendeeMaxConcurrent.set(maxConcurrent)
    } catch { /* noop */ }
  },
}

export const transcriptionMetrics = {
  observe(method: 'file' | 'buffer', result: 'success' | 'error', durationSeconds: number): void {
    try {
      transcriptionTotal.inc({ method, result })
      if (durationSeconds >= 0) transcriptionDuration.observe({ method, result }, durationSeconds)
    } catch { /* noop */ }
  },
  audioSeconds(source: string, seconds: number): void {
    try { if (seconds > 0) transcriptionAudioSeconds.observe({ source }, seconds) } catch { /* noop */ }
  },
}

export const meetingMetrics = {
  created(source: string, type: 'online' | 'in_person'): void {
    try { meetingsCreatedTotal.inc({ source, type }) } catch { /* noop */ }
  },
  /** Substitui o gauge de presas em requesting com o breakdown atual por provider. */
  stuckRequesting(byProvider: Record<string, number>): void {
    try {
      meetingsStuckRequesting.reset()
      for (const [provider, n] of Object.entries(byProvider)) {
        meetingsStuckRequesting.set({ provider }, n)
      }
    } catch { /* noop */ }
  },
}

export const cronMetrics = {
  tick(result: 'success' | 'error', durationSeconds: number): void {
    try {
      calendarCronTicksTotal.inc({ result })
      if (durationSeconds >= 0) calendarCronDuration.observe(durationSeconds)
    } catch { /* noop */ }
  },
  eventsMatched(n: number): void {
    try { if (n > 0) calendarCronEventsMatched.inc(n) } catch { /* noop */ }
  },
  botDispatched(mode: 'immediate' | 'scheduled'): void {
    try { calendarCronBotsDispatched.inc({ mode }) } catch { /* noop */ }
  },
}

/**
 * Resolve o label `route` evitando explosão de cardinalidade.
 * Preferimos o padrão da rota registrada no Express (ex: `/users/:id`),
 * que já vem parametrizado. Sem rota casada (404, etc.), caímos no
 * baseUrl + path e normalizamos segmentos dinâmicos (IDs, UUIDs) p/ `:id`.
 */
function resolveRoute(req: Request): string {
  const routePath = req.route?.path
  if (routePath) {
    // baseUrl carrega o prefixo do router montado (ex: `/api/teams`).
    const base = req.baseUrl || ''
    const full = `${base}${routePath}`
    return full || routePath
  }

  const raw = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path
  return normalizePath(raw)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NUMERIC_RE = /^\d+$/
const LONG_ID_RE = /^[A-Za-z0-9_-]{16,}$/ // nanoid, tokens, etc.

function normalizePath(path: string): string {
  return (
    path
      .split('/')
      .map((seg) => {
        if (!seg) return seg
        if (UUID_RE.test(seg) || NUMERIC_RE.test(seg) || LONG_ID_RE.test(seg)) {
          return ':id'
        }
        return seg
      })
      .join('/') || '/'
  )
}

/**
 * Middleware global de métricas RED. Deve ser montado ANTES das rotas de
 * negócio (e depois de /health, que não instrumentamos). Registra o
 * counter e o histogram no evento `finish` da resposta.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const endTimer = httpRequestDuration.startTimer()

  res.on('finish', () => {
    const route = resolveRoute(req)
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    }
    httpRequestsTotal.inc(labels)
    endTimer(labels)
  })

  next()
}

/**
 * Extrai a credencial apresentada na requisição, aceitando duas formas:
 *   1. `Authorization: Bearer <key>` — usada pelo scrape do Prometheus
 *      (o único esquema de auth por credencial que ele suporta em
 *      scrape_configs, via bloco `authorization`).
 *   2. `x-metrics-key: <key>` — conveniência p/ curl e debug manual.
 */
function extractMetricsKey(req: Request): string | null {
  const authHeader = req.headers['authorization']
  if (typeof authHeader === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
    if (match) return match[1]
  }

  const headerKey = req.headers['x-metrics-key']
  if (typeof headerKey === 'string') return headerKey

  return null
}

/**
 * Handler da rota GET /metrics.
 * Se ADMIN_METRICS_KEY estiver definida, exige a credencial via
 * `Authorization: Bearer <key>` (Prometheus) ou `x-metrics-key` (curl) —
 * 401 se não bater. Se a env estiver vazia, o endpoint fica aberto:
 * assume-se que só é alcançável pela rede interna do Docker. Ver README.
 */
export async function metricsHandler(req: Request, res: Response): Promise<void> {
  const expectedKey = process.env.ADMIN_METRICS_KEY

  if (expectedKey && expectedKey.length > 0) {
    const provided = extractMetricsKey(req)
    if (provided !== expectedKey) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
  }

  try {
    res.set('Content-Type', register.contentType)
    res.end(await register.metrics())
  } catch (err) {
    logger.error('[Metrics] Falha ao coletar métricas', err)
    res.status(500).end()
  }
}
