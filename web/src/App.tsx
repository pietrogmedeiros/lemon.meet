import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { ThemeProvider, AuthProvider, SubscriptionProvider } from '@/contexts'
import { ProtectedRoute } from '@/components/auth'
import { FeedbackSurveyModal } from '@/components/FeedbackSurveyModal'
import { useFeedbackSurvey } from '@/hooks/useFeedbackSurvey'


/**
 * O link de "redefinir senha" do e-mail cria uma sessão e dispara
 * PASSWORD_RECOVERY. O formulário de nova senha vive na SettingsPage — mas o
 * Supabase só respeita o redirectTo se a URL estiver na allowlist do projeto;
 * fora dela, ele manda para a Site URL, que aqui cai em /dashboard. Resultado
 * relatado pelo Pietro: clicava no link e chegava no Lemon logado, sem
 * formulário nenhum, sem entender por quê.
 *
 * Escutando aqui em cima, o destino do link deixa de importar: onde quer que
 * ele caia, levamos a pessoa ao formulário. A flag em sessionStorage existe
 * porque o evento pode disparar ANTES de a SettingsPage montar — sem ela, a
 * navegação acontece e o formulário não aparece.
 */
function PasswordRecoveryRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        sessionStorage.setItem('lemon_password_recovery', '1')
        navigate('/settings', { replace: true })
      }
    })
    return () => subscription.unsubscribe()
  }, [navigate])
  return null
}

// Eager — carregam no bundle inicial (login + dashboard são as primeiras telas)
import { LoginPage, DashboardPage } from '@/pages'

// Lazy — cada página vira um chunk separado, carregado só quando navegado
const MeetingsPage            = lazy(() => import('@/pages/MeetingsPage').then(m => ({ default: m.MeetingsPage })))
const TranscricaoDetalhesPage = lazy(() => import('@/pages/TranscricaoDetalhesPage').then(m => ({ default: m.TranscricaoDetalhesPage })))
const InsightsPage            = lazy(() => import('@/pages/InsightsPage').then(m => ({ default: m.InsightsPage })))
const SettingsPage            = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const TeamPage                = lazy(() => import('@/pages/TeamPage').then(m => ({ default: m.TeamPage })))
const SubscriptionPage        = lazy(() => import('@/pages/SubscriptionPage').then(m => ({ default: m.SubscriptionPage })))
const CheckoutPage            = lazy(() => import('@/pages/CheckoutPage').then(m => ({ default: m.CheckoutPage })))
const IntegrationsPage        = lazy(() => import('@/pages/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })))
const CoachingPage            = lazy(() => import('@/pages/CoachingPage').then(m => ({ default: m.CoachingPage })))
const RelatorioPage           = lazy(() => import('@/pages/RelatorioPage').then(m => ({ default: m.RelatorioPage })))
const UpcomingMeetingsPage    = lazy(() => import('@/pages/UpcomingMeetingsPage').then(m => ({ default: m.UpcomingMeetingsPage })))
const PrivacyPolicyPage       = lazy(() => import('@/pages/PrivacyPolicyPage').then(m => ({ default: m.PrivacyPolicyPage })))
const TermosAppPage           = lazy(() => import('@/pages/TermosAppPage').then(m => ({ default: m.TermosAppPage })))
const CalendarPage            = lazy(() => import('@/pages/CalendarPage').then(m => ({ default: m.CalendarPage })))
const JoinTeamPage            = lazy(() => import('@/pages/JoinTeamPage').then(m => ({ default: m.JoinTeamPage })))
const TeamSchedulingPage      = lazy(() => import('@/pages/TeamSchedulingPage').then(m => ({ default: m.TeamSchedulingPage })))
const TeamSchedulingListPage  = lazy(() => import('@/pages/TeamSchedulingListPage').then(m => ({ default: m.TeamSchedulingListPage })))
const PublicSchedulingPage    = lazy(() => import('@/pages/PublicSchedulingPage').then(m => ({ default: m.PublicSchedulingPage })))
const FeatureRequestsPage     = lazy(() => import('@/pages/FeatureRequestsPage').then(m => ({ default: m.FeatureRequestsPage })))
const AdminMetricsPage        = lazy(() => import('@/pages/AdminMetricsPage').then(m => ({ default: m.AdminMetricsPage })))
const WebinarConfigPage       = lazy(() => import('@/pages/WebinarConfigPage').then(m => ({ default: m.WebinarConfigPage })))
const PublicWebinarPage       = lazy(() => import('@/pages/PublicWebinarPage').then(m => ({ default: m.PublicWebinarPage })))

function App() {
  const { shouldShow, markSubmitted } = useFeedbackSurvey();

  return (
    <ThemeProvider>
      <AuthProvider>
        <SubscriptionProvider>
        <Suspense fallback={
          <div className="flex h-screen items-center justify-center bg-background">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#2D5A27] border-r-transparent" />
          </div>
        }>
        <PasswordRecoveryRedirect />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/join/:token" element={<JoinTeamPage />} />
          <Route path="/agenda/:slug" element={<PublicSchedulingPage />} />
          <Route path="/webinar/:slug" element={<PublicWebinarPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/meetings/:id"
            element={
              <ProtectedRoute>
                <TranscricaoDetalhesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/meetings"
            element={
              <ProtectedRoute>
                <MeetingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/insights"
            element={
              <ProtectedRoute>
                <InsightsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team"
            element={
              <ProtectedRoute>
                <TeamPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team-scheduling"
            element={
              <ProtectedRoute>
                <TeamSchedulingListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teams/:teamId/scheduling"
            element={
              <ProtectedRoute>
                <TeamSchedulingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/subscription"
            element={
              <ProtectedRoute>
                <SubscriptionPage />
              </ProtectedRoute>
            }
          />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route
            path="/coaching"
            element={
              <ProtectedRoute>
                <CoachingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/relatorio"
            element={
              <ProtectedRoute>
                <RelatorioPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/integrations"
            element={<Navigate to="/integrations/permissions" replace />}
          />
          <Route
            path="/integrations/permissions"
            element={
              <ProtectedRoute>
                <IntegrationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/integrations/apps"
            element={
              <ProtectedRoute>
                <IntegrationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/integrations/webhooks"
            element={
              <ProtectedRoute>
                <IntegrationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/upcoming"
            element={
              <ProtectedRoute>
                <UpcomingMeetingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/calendar"
            element={
              <ProtectedRoute>
                <CalendarPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/feature-requests"
            element={
              <ProtectedRoute>
                <FeatureRequestsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/metrics"
            element={
              <ProtectedRoute>
                <AdminMetricsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/webinars"
            element={
              <ProtectedRoute>
                <WebinarConfigPage />
              </ProtectedRoute>
            }
          />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/termos-app" element={<TermosAppPage />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        
        {/* Modal de pesquisa de satisfação */}
        <FeedbackSurveyModal isOpen={shouldShow} onSubmitted={markSubmitted} />
        
        </Suspense>
        </SubscriptionProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
