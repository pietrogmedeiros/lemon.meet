import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { Button } from '@/components/ui'
import { Mail, Lock } from 'lucide-react'
import { useAuth } from '@/contexts'

export function LoginPage() {
  const { t } = useTranslation()
  const { signInWithEmail, signInWithGoogle, user, loading: authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const nextUrl = searchParams.get('next') || '/dashboard'

  // Se já logado, redireciona para ?next
  useEffect(() => {
    if (!authLoading && user) {
      navigate(nextUrl, { replace: true })
    }
  }, [authLoading, user, navigate, nextUrl])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await signInWithEmail(email, password)
    if (error) {
      setError('Email ou senha inválidos.')
      setLoading(false)
    } else {
      navigate(nextUrl, { replace: true })
    }
  }

  const handleGoogleSignIn = async () => {
    setError(null)
    setGoogleLoading(true)
    const { error } = await signInWithGoogle()
    if (error) {
      setError('Erro ao conectar com o Google. Tente novamente.')
      setGoogleLoading(false)
    }
    // Se não houve erro, o Supabase redireciona para o Google automaticamente
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background dark:bg-gray-900">
      <div className="max-w-md w-full px-6">
        <div className="text-center mb-8">
          <img src="/lemon.meet.png" alt="Lemon.meet" className="h-28 object-contain mx-auto mb-4" />
          
          <p className="text-body-large text-secondary mt-2">
            {t('app.tagline')}
          </p>
        </div>

        <div className="bg-surface dark:bg-gray-800 border border-neutral-light dark:border-gray-700 rounded-2xl p-8 shadow-sm">
          <h2 className="text-headline-2 text-primary dark:text-white mb-3 text-center">
            {t('auth.login.title', 'Bem-vindo ao Lemon.meet')}
          </h2>
          
          <p className="text-body-small text-secondary dark:text-gray-400 mb-6 text-center">
            {t('auth.login.subtitle', 'Entre com sua conta para começar')}
          </p>

          {/* Mensagem de erro */}
          {error && (
            <div className="mb-4 rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          {/* Formulário Email/Senha */}
          <form onSubmit={handleEmailAuth} className="space-y-4 mb-6">
            <div>
              <label className="block text-body-small font-medium text-primary mb-2">
                <Mail className="inline w-4 h-4 mr-2" />
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="input"
              />
            </div>

            <div>
              <label className="block text-body-small font-medium text-primary mb-2">
                <Lock className="inline w-4 h-4 mr-2" />
                Senha
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              loading={loading}
            >
              {loading ? 'Carregando...' : 'Entrar'}
            </Button>
          </form>

          {/* Toggle Login/Cadastro */}
          <div className="text-center mb-6">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="text-body-small text-primary-light hover:text-primary hover:underline"
            >
              Não tem conta? Cadastre-se com Google
            </button>
          </div>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-light"></div>
            </div>
            <div className="relative flex justify-center text-body-small">
              <span className="px-2 bg-white text-secondary">ou</span>
            </div>
          </div>

          {/* Google OAuth */}
          <Button
            variant="secondary"
            size="lg"
            className="w-full flex items-center justify-center gap-3"
            onClick={handleGoogleSignIn}
            loading={googleLoading}
          >
            {!googleLoading && (
              <img
                src="https://e7.pngegg.com/pngimages/704/688/png-clipart-google-google.png"
                alt="Google"
                className="h-5 w-5 object-contain"
              />
            )}
            Entrar com Google
          </Button>

          <p className="text-body-small text-secondary mt-6 text-center">
            Ao entrar, você concorda com nossos{' '}
            <Link to="/termos-app" className="underline hover:text-primary transition-colors">Termos de Uso</Link>
            {' '}e{' '}
            <Link to="/privacy-policy" className="underline hover:text-primary transition-colors">Política de Privacidade</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
