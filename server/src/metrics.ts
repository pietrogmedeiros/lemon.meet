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
import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client'
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
