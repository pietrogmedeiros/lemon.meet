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
import subscriptionRouter, { stripeWebhookHandler } from './routes/subscription.routes.js'
import integrationsRouter from './routes/integrations.routes.js'
import coachingRouter from './routes/coaching.routes.js'
import meetingBaasRouter from './routes/meetingbaas.routes.js'
import calendarRouter from './routes/calendar.routes.js'
import pipedriveRouter from './routes/pipedrive.routes.js'
import hubspotRouter from './routes/hubspot.routes.js'
import gdriveRouter from './routes/gdrive.routes.js'
import notificationsRouter from './routes/notifications.routes.js'
import feedbackRouter from './routes/feedback.routes.js'
import schedulingRouter from './routes/scheduling.routes.js'
import featureRequestsRouter from './routes/feature-requests.routes.js'
import { calendarCronService } from './services/CalendarCronService.js'
import { setupSocketIO } from './config/socket.js'

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

// Stripe webhook — deve usar raw body, registrado ANTES do express.json()
app.post('/api/subscription/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler)

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
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

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
app.use('/api/scheduling', schedulingRouter)
app.use('/api/feature-requests', featureRequestsRouter)

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
})

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutdown initiated...')
  calendarCronService.stop()
  
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
