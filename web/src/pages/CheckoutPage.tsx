import { useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts'
import { Loader } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

const VALID_PLANS = ['starter', 'professional'] as const
type Plan = typeof VALID_PLANS[number]

export function CheckoutPage() {
  const { session, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const plan = searchParams.get('plan') as Plan | null

  useEffect(() => {
    // Aguarda auth carregar
    if (loading) return

    // Plano inválido → vai para settings
    if (!plan || !VALID_PLANS.includes(plan)) {
      navigate('/settings', { replace: true })
      return
    }

    // Não logado → vai para login preservando destino
    if (!session) {
      navigate(`/login?next=/checkout?plan=${plan}`, { replace: true })
      return
    }

    // Logado → dispara checkout automaticamente
    const startCheckout = async () => {
      try {
        const res = await fetch(`${API}/api/subscription/checkout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ plan }),
        })
        const data = await res.json()
        if (data.url) {
          window.location.href = data.url
        } else {
          navigate('/settings', { replace: true })
        }
      } catch {
        navigate('/settings', { replace: true })
      }
    }

    startCheckout()
  }, [loading, session, plan, navigate])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      <img src="/logo.png" alt="Lemon.meet" className="w-12 h-12 object-contain" />
      <Loader size={24} className="animate-spin text-brand" />
      <p className="text-sm text-secondary">Preparando seu checkout...</p>
    </div>
  )
}
