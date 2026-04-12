import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout'
import { useAuth, useSubscription } from '@/contexts'
import {
  CreditCard, CheckCircle, XCircle, Clock, Calendar,
  ArrowLeft, ExternalLink, Loader, RefreshCw
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface SubscriptionDetails {
  plan: string
  status: string
  amount: number | null
  currency: string | null
  currentPeriodEnd: string | null
  lastPayment: { amount: number; currency: string; date: string } | null
  paymentMethod: { brand: string; last4: string; expMonth: number; expYear: number } | null
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function CardBrandIcon({ brand }: { brand: string }) {
  const labels: Record<string, string> = { visa: 'VISA', mastercard: 'MC', amex: 'AMEX', elo: 'ELO' }
  return (
    <span className="text-xs font-bold bg-neutral-100 text-[#333] px-2 py-0.5 rounded-md uppercase tracking-wide">
      {labels[brand] ?? brand}
    </span>
  )
}

export function SubscriptionPage() {
  const { session } = useAuth()
  const { isTrial, isExpired, daysLeft } = useSubscription()
  const navigate = useNavigate()
  const [details, setDetails] = useState<SubscriptionDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)

  const fetchDetails = async () => {
    if (!session?.access_token) return
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/subscription/details`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      setDetails(data.details)
    } catch {
      setDetails(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDetails()
  }, [session])

  const handlePortal = async () => {
    if (!session?.access_token) return
    setPortalLoading(true)
    try {
      const res = await fetch(`${API}/api/subscription/portal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch {
      alert('Erro ao conectar com o servidor.')
    } finally {
      setPortalLoading(false)
    }
  }

  const planLabel: Record<string, string> = {
    trial: 'Trial',
    starter: 'Starter',
    professional: 'Professional',
  }

  const statusInfo = () => {
    if (isExpired) return { label: 'Expirado', color: 'text-red-500', bg: 'bg-red-50 border-red-200', icon: <XCircle size={16} className="text-red-500" /> }
    if (isTrial) return { label: `Trial — ${daysLeft} dia${daysLeft !== 1 ? 's' : ''} restante${daysLeft !== 1 ? 's' : ''}`, color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200', icon: <Clock size={16} className="text-yellow-500" /> }
    return { label: 'Ativo', color: 'text-green-600', bg: 'bg-green-50 border-green-200', icon: <CheckCircle size={16} className="text-green-500" /> }
  }

  const si = statusInfo()

  return (
    <MainLayout>
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-1.5 text-sm text-[#666] hover:text-[#333] transition"
          >
            <ArrowLeft size={16} />
            Configurações
          </button>
          {!loading && details && details.plan !== 'trial' && (
            <button
              onClick={handlePortal}
              disabled={portalLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition disabled:opacity-50"
            >
              {portalLoading ? <Loader size={13} className="animate-spin" /> : <CreditCard size={13} />}
              Gerenciar via Stripe
              <ExternalLink size={11} />
            </button>
          )}
        </div>

        <div>
          <h1 className="text-2xl font-bold text-[#1a1a1a]">Minha Assinatura</h1>
          <p className="text-sm text-[#666] mt-1">Detalhes do seu plano e histórico de pagamentos.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader size={28} className="animate-spin text-[#2D5A27]" />
          </div>
        ) : !details ? (
          <div className="bg-white border border-[#E0E0E0] rounded-2xl p-8 text-center">
            <p className="text-[#666]">Não foi possível carregar os detalhes.</p>
            <button onClick={fetchDetails} className="mt-3 flex items-center gap-1.5 mx-auto text-sm text-[#2D5A27] font-medium hover:underline">
              <RefreshCw size={14} /> Tentar novamente
            </button>
          </div>
        ) : (
          <>
            {/* Status Banner */}
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium ${si.bg} ${si.color}`}>
              {si.icon}
              {si.label}
            </div>

            {/* Grid 2 colunas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

              {/* Coluna esquerda — Plano */}
              <div className="bg-white border border-[#E8E8E8] rounded-2xl overflow-hidden shadow-sm">
                <div className="px-5 py-4 border-b border-[#F0F0F0]">
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#999]">Plano</p>
                </div>
                <Row
                  label="Plano atual"
                  value={
                    <span className={`font-semibold ${si.color}`}>
                      {planLabel[details.plan] ?? details.plan}
                    </span>
                  }
                />
                <Row
                  label="Status"
                  value={
                    <span className={`font-medium ${si.color}`}>{si.label}</span>
                  }
                />
                <Row
                  label="Valor"
                  value={
                    details.amount !== null && details.currency
                      ? <span className="font-semibold text-[#1a1a1a]">{formatCurrency(details.amount, details.currency)}<span className="text-xs text-[#999] font-normal ml-1">/mês</span></span>
                      : <span className="text-[#999]">—</span>
                  }
                />
                <Row
                  label="Próxima cobrança"
                  value={
                    details.currentPeriodEnd
                      ? <span className="flex items-center gap-1.5 text-[#333]"><Calendar size={13} className="text-[#2D5A27]" />{formatDate(details.currentPeriodEnd)}</span>
                      : <span className="text-[#999]">—</span>
                  }
                  last
                />
              </div>

              {/* Coluna direita — Pagamento */}
              <div className="bg-white border border-[#E8E8E8] rounded-2xl overflow-hidden shadow-sm">
                <div className="px-5 py-4 border-b border-[#F0F0F0]">
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#999]">Pagamento</p>
                </div>
                <Row
                  label="Último pagamento"
                  value={
                    details.lastPayment
                      ? <span className="text-[#333]">{formatCurrency(details.lastPayment.amount, details.lastPayment.currency)}<span className="text-[#999] text-xs ml-1">{formatDate(details.lastPayment.date)}</span></span>
                      : <span className="text-[#999]">Nenhum registrado</span>
                  }
                />
                <Row
                  label="Meio de pagamento"
                  value={
                    details.paymentMethod
                      ? (
                        <span className="flex items-center gap-2">
                          <CardBrandIcon brand={details.paymentMethod.brand} />
                          <span className="text-[#333]">•••• {details.paymentMethod.last4}</span>
                          <span className="text-xs text-[#999]">{details.paymentMethod.expMonth.toString().padStart(2, '0')}/{details.paymentMethod.expYear}</span>
                        </span>
                      )
                      : <span className="text-[#999]">—</span>
                  }
                  last
                />
              </div>
            </div>

            {/* Trial banner */}
            {isTrial && (
              <div className="bg-[#2D5A27]/5 border border-[#2D5A27]/15 rounded-2xl p-5">
                <p className="text-sm font-semibold text-[#2D5A27] mb-1">Seu período de teste {daysLeft === 0 ? 'termina hoje' : `termina em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`}</p>
                <p className="text-xs text-[#666] mb-3">Escolha um plano para continuar usando o Lemon.meet após o trial.</p>
                <button
                  onClick={() => navigate('/settings')}
                  className="text-sm font-semibold text-[#2D5A27] underline hover:no-underline"
                >
                  Ver planos disponíveis
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </MainLayout>
  )
}

function Row({ label, value, last = false }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-5 py-4 gap-4 ${!last ? 'border-b border-[#F0F0F0]' : ''}`}>
      <span className="text-sm text-[#666] shrink-0 w-48">{label}</span>
      <span className="text-sm text-right">{value}</span>
    </div>
  )
}
