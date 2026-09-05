// Server version: 2026-05-12T23:30:00Z - FORCE DEPLOY: Dev user access + Socket.io fix
// CRÍTICO: pietrogoncalvesmedeiros@gmail.com tem acesso total + Socket.io inicializado
import express, { type Express } from 'express'
import { createServer } from 'http'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import transcricoesRouter from './routes/transcricoes.routes.js'
import extensionRouter from './routes/extension.routes.js'
import inPersonRouter from './routes/in-person.routes.js'
import teamsRouter from './routes/teams.routes.js'
import subscriptionRouter, { abacatepayWebhookHandler } from './routes/subscription.routes.js'
import integrationsRouter from './routes/integrations.routes.js'
import coachingRouter from './routes/coaching.routes.js'
import meetingBaasRouter from './routes/meetingbaas.routes.js'
import { attendeeWebhookHandler } from './routes/attendee.routes.js'
import { skribbyWebhookHandler } from './routes/skribby.routes.js'
import calendarRouter from './routes/calendar.routes.js'
import { TranscriptionService } from './services/TranscriptionService.js'
import { dailyDigestService, proximoDisparo } from './services/DailyDigestService.js'
import pipedriveRouter from './routes/pipedrive.routes.js'
import hubspotRouter from './routes/hubspot.routes.js'
import gdriveRouter from './routes/gdrive.routes.js'
import notificationsRouter from './routes/notifications.routes.js'
import feedbackRouter from './routes/feedback.routes.js'
import accountRouter from './routes/account.routes.js'
import schedulingRouter from './routes/scheduling.routes.js'
import featureRequestsRouter from './routes/feature-requests.routes.js'
import adminMetricsRouter from './routes/admin-metrics.routes.js'
import webinarRouter from './routes/webinar.routes.js'
import { calendarCronService } from './services/CalendarCronService.js'
import { setupSocketIO } from './config/socket.js'
import { metricsMiddleware, metricsHandler } from './metrics.js'

// Load environment variables
dotenv.config()

// Force redeploy: 2026-05-09T02:50:00Z
const app: Express = express()
const httpServer = createServer(app)
const PORT = process.env.PORT || 3000

// Initialize Socket.io
const io = setupSocketIO(httpServer)
console.log('[Server] ✅ Socket.io initialized')
console.log('[Server] 🔧 DEV USER ACCESS ENABLED: pietrogoncalvesmedeiros@gmail.com')
console.log('[Server] 📊 Version: 2026-05-12T23:30:00Z')

// Middleware
app.set('trust proxy', 1) // necessário atrás de proxies (Railway, Heroku, etc.)

// Domínios do Lemon.crm autorizados a embedar o app via iframe
// Configure via LEMON_CRM_URL (aceita múltiplos domínios separados por vírgula).
// Em dev, o frontend do CRM roda em http://localhost:3001 e já vem incluído por padrão.
const lemonCrmOrigins = Array.from(
  new Set(
    [
      'http://localhost:3001',
      ...(process.env.LEMON_CRM_URL || '').split(',').map((url) => url.trim()),
    ].filter(Boolean)
  )
)

app.use(
  helmet({
    // Desabilita X-Frame-Options (substituído por CSP frame-ancestors abaixo).
    // Manter X-Frame-Options junto com frame-ancestors causa conflito em alguns browsers.
    frameguard: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        frameAncestors: ["'self'", ...lemonCrmOrigins],
      },
    },
  })
)
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'http://localhost:5173',
      // Firebase Hosting (domínio padrão e domínio customizado)
      'https://lemon-meet.web.app',
      'https://lemon-meet.firebaseapp.com',
      // Staging
      'https://lemon-meet-staging.web.app',
      'https://lemon-meet-staging.firebaseapp.com',
      // Lemon.crm (host que embeda o app via iframe)
      ...lemonCrmOrigins,
    ]
    // Permite extensões Chrome e requisições sem origin (ex: curl)
    if (!origin || origin.startsWith('chrome-extension://') || allowed.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error(`CORS bloqueado para origin: ${origin}`))
    }
  },
  credentials: true,
  maxAge: 600, // cache preflight OPTIONS por 10 minutos
}))
app.use(morgan('dev'))

// AbacatePay webhook — deve usar raw body, registrado ANTES do express.json()
// (necessário para verificação HMAC-SHA256 da assinatura)
app.post('/api/subscription/webhook', express.raw({ type: 'application/json' }), abacatepayWebhookHandler)

// Attendee webhook — mesma exigência de raw body para validar a assinatura
// HMAC-SHA256 (X-Webhook-Signature). Registrado ANTES do express.json().
app.post('/api/attendee/webhook', express.raw({ type: 'application/json' }), attendeeWebhookHandler)

// Skribby webhook — mesma exigência de raw body para validar a assinatura HMAC.
// Registrado ANTES do express.json(). Fase 0 (dark): o handler é inerte
// enquanto SKRIBBY_ENABLED !== 'true'.
app.post('/api/skribby/webhook', express.raw({ type: 'application/json' }), skribbyWebhookHandler)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: 'Too many requests from this IP, please try again later',
})
app.use('/api', limiter)

// Health check endpoint
// `ffmpeg` entra aqui porque a transcrição de reunião longa DEPENDE dele: sem
// ffmpeg no container, todo áudio acima do limite do Whisper falha. Sondado uma
// vez no boot para não pagar um spawn por requisição.
/**
 * Etiqueta do que está rodando. O webhook do EasyPanel fica verde mesmo quando
 * o build falha e o contêiner ANTIGO continua no ar — sem isso, "está no ar" é
 * palpite por uptime. Trocar a cada mudança que precise ser confirmada.
 */
const BUILD_TAG = 'resumo-janela-5'

let ffmpegReady: boolean | null = null
let audioCodec: string | null = null
void TranscriptionService.ffmpegAvailable().then(async (ok) => {
  ffmpegReady = ok
  if (!ok) {
    console.error('[boot] ffmpeg NÃO está disponível — reuniões longas vão falhar')
    return
  }
  // Qual encoder o ffmpeg deste contêiner tem de fato. `libopus` é biblioteca
  // externa e pode faltar; sem saber disso, uma falha de encoder vira "413" no
  // fim da linha, que foi o que aconteceu em 01/09.
  audioCodec = (await TranscriptionService.audioEncoder()).codec
})

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    build: BUILD_TAG,
    ffmpeg: ffmpegReady,
    audioCodec,
    // Booleano de propósito: prova que a variável chegou ao contêiner sem
    // expor a chave. Sem isso, "coloquei a variável" é indistinguível de
    // "coloquei e não pegou" até alguém reclamar que o e-mail não chegou.
    resend: Boolean(process.env.RESEND_API_KEY),
    digest: {
      proximo: proximoDisparo(new Date()),
      ultimoEnvio: dailyDigestService.ultimoDiaEnviado,
    },
  })
})

// Dispara o resumo por e-mail sob demanda. Guardado só pela chave de máquina,
// mesmo esquema do /metrics — serve para testar depois de mexer em variável de
// ambiente e para reenviar um dia específico sem esperar as 07:47.
app.post('/api/admin/daily-digest/run', async (req, res) => {
  const esperada = process.env.ADMIN_METRICS_KEY
  if (!esperada || esperada.length < 16) {
    res.status(503).json({ error: 'admin_metrics_key_not_configured' })
    return
  }
  if (req.header('x-admin-key') !== esperada) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  if (!process.env.RESEND_API_KEY) {
    res.status(503).json({ error: 'resend_api_key_not_configured' })
    return
  }
  try {
    const resultado = await dailyDigestService.enviarParaTodos()
    res.json({ ok: true, ...resultado })
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

// Prometheus scrape endpoint. Registrado antes do metricsMiddleware
// para não instrumentar a si mesmo nem o /health.
app.get('/metrics', metricsHandler)

// Métricas RED por rota — a partir daqui, tudo é instrumentado.
app.use(metricsMiddleware)

// API Routes
app.use('/api/transcricoes', transcricoesRouter)
app.use('/api/meetings', inPersonRouter)
app.use('/api/meetings', extensionRouter)
app.use('/api/teams', teamsRouter)
app.use('/api/subscription', subscriptionRouter)
app.use('/api/integrations', integrationsRouter)
app.use('/api/coaching', coachingRouter)
app.use('/api/meetingbaas', meetingBaasRouter)
app.use('/api/calendar', calendarRouter)
app.use('/api/pipedrive', pipedriveRouter)
app.use('/api/hubspot', hubspotRouter)
app.use('/api/gdrive', gdriveRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/feedback', feedbackRouter)
app.use('/api/account', accountRouter)
app.use('/api/scheduling', schedulingRouter)
app.use('/api/feature-requests', featureRequestsRouter)
app.use('/api/admin/metrics', adminMetricsRouter)
app.use('/api/webinars', webinarRouter)

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Server Error]', err)
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  })
})

// Start server
httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║                 🎙️  VIBE AI SERVER 🎙️                  ║
║                                                          ║
║  Status: Online ✅                                        ║
║  Port: ${PORT}                                        ║
║  Environment: ${process.env.NODE_ENV || 'development'}                              ║
║                                                          ║
║  API Transcrições: /api/transcricoes                     ║
║  API Meetings (ext): /api/meetings                       ║
║  Health Check: /health                                   ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `)

  if (process.env.DISABLE_CALENDAR_CRON === 'true') {
    console.log('[CalendarCron] Desabilitado por DISABLE_CALENDAR_CRON=true')
  } else {
    // Inicia o cron de auto-dispatch de bots via Google Calendar
    calendarCronService.start()
  }

  // Resumo do dia anterior, 07:47 (São Paulo)
  if (process.env.DISABLE_DAILY_DIGEST === 'true') {
    console.log('[DailyDigest] Desabilitado por DISABLE_DAILY_DIGEST=true')
  } else {
    dailyDigestService.start()
  }
})

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutdown initiated...')
  calendarCronService.stop()
  dailyDigestService.stop()
  
  // Fecha servidor HTTP
  httpServer.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
  
  // Força saída após 10 segundos
  setTimeout(() => {
    console.error('Forced shutdown after timeout')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...')
  shutdown()
})

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...')
  shutdown()
})

export { app, httpServer }
