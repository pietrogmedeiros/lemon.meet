import { Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider, AuthProvider, SubscriptionProvider } from '@/contexts'
import { ProtectedRoute } from '@/components/auth'
import { LoginPage, DashboardPage, MeetingsPage, TranscricaoDetalhesPage, InsightsPage, SettingsPage, TeamPage, SubscriptionPage, CheckoutPage, IntegrationsPage, CoachingPage, RelatorioPage } from '@/pages'

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SubscriptionProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
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
            element={
              <ProtectedRoute>
                <IntegrationsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </SubscriptionProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
