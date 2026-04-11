import { ReactNode } from 'react'
import { Sidebar, TopNavBar } from '@/components/layout'
import { useSubscription } from '@/contexts'
import { Clock, Lock, Zap, AlertTriangle } from 'lucide-react'

interface MainLayoutProps {
  children: ReactNode
}

const PLAN_LABELS: Record<string, string> = {
  trial: 'Trial',
  starter: 'Starter',
  professional: 'Professional',
}

export function MainLayout({ children }: MainLayoutProps) {
  const { isTrial, isExpired, daysLeft, loading, subscription } = useSubscription()

  // Configuração do banner de trial
  const getBanner = () => {
    if (loading || !isTrial || isExpired || daysLeft === null) return null
    if (daysLeft <= 1)
      return {
        bg: 'bg-red-50 border-red-200 text-red-700',
        icon: <AlertTriangle size={14} className="shrink-0" />,
        msg: daysLeft === 0 ? 'Seu período de teste expira hoje!' : 'Seu período de teste expira amanhã!',
        urgent: true,
      }
    if (daysLeft <= 3)
      return {
        bg: 'bg-amber-50 border-amber-200 text-amber-700',
        icon: <Clock size={14} className="shrink-0" />,
        msg: `Seu período de teste expira em ${daysLeft} dia${daysLeft > 1 ? 's' : ''}.`,
        urgent: false,
      }
    return {
      bg: 'bg-blue-50 border-blue-200 text-blue-700',
      icon: <Clock size={14} className="shrink-0" />,
      msg: `Você está no período gratuito de 7 dias. ${daysLeft} dia${daysLeft > 1 ? 's' : ''} restante${daysLeft > 1 ? 's' : ''}.`,
      urgent: false,
    }
  }

  const banner = getBanner()

  return (
    <div className="flex min-h-screen bg-background dark:bg-gray-900">
      <Sidebar />

      <div className="flex-1 flex flex-col">
        <TopNavBar />

        {/* Banner de trial */}
        {banner && (
          <div className={`flex items-center gap-2 px-6 py-2.5 text-sm border-b ${banner.bg}`}>
            {banner.icon}
            <span>{banner.msg}</span>
            <span className="ml-auto flex items-center gap-3">
              {subscription && (
                <span className="text-xs font-medium opacity-70">
                  Plano atual: {PLAN_LABELS[subscription.plan] ?? subscription.plan}
                </span>
              )}
              <button
                onClick={() => window.location.href = '/settings#upgrade'}
                className={`text-xs font-semibold underline underline-offset-2 ${banner.urgent ? 'animate-pulse' : ''}`}
              >
                Ver planos →
              </button>
            </span>
          </div>
        )}

        <main className="flex-1 p-8 relative">
          {children}

          {/* Overlay de acesso bloqueado quando trial expirou */}
          {!loading && isExpired && (
            <div className="absolute inset-0 bg-white/95 backdrop-blur-sm z-50 flex items-center justify-center p-6 overflow-auto">
              <div className="max-w-lg w-full text-center space-y-7 py-8">
                {/* Ícone */}
                <div className="w-20 h-20 rounded-3xl bg-[#2D5A27]/10 flex items-center justify-center mx-auto">
                  <Lock size={38} className="text-[#2D5A27]" />
                </div>

                <div>
                  <h2 className="text-2xl font-bold text-[#333333]">Período de teste encerrado</h2>
                  <p className="mt-2 text-[#666666] text-sm leading-relaxed max-w-sm mx-auto">
                    Seus 7 dias gratuitos chegaram ao fim. Escolha um plano para continuar acessando suas reuniões e insights.
                  </p>
                </div>

                {/* Cards de plano */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                  {/* Starter */}
                  <div className="border border-[#E0E0E0] rounded-2xl p-6 space-y-3 shadow-sm hover:shadow-md transition">
                    <div>
                      <p className="font-bold text-[#333333] text-base">Starter</p>
                      <p className="text-xs text-[#999999] mt-0.5">Para indivíduos e freelancers</p>
                    </div>
                    <p className="text-3xl font-bold text-[#2D5A27]">
                      R$ 29<span className="text-sm font-normal text-[#666666]">/mês</span>
                    </p>
                    <ul className="text-xs text-[#666666] space-y-1.5">
                      <li className="flex items-center gap-1.5">✓ Transcrições ilimitadas</li>
                      <li className="flex items-center gap-1.5">✓ Insights com IA</li>
                      <li className="flex items-center gap-1.5">✓ Histórico de reuniões</li>
                    </ul>
                    <button
                      onClick={() => alert('Em breve!')}
                      className="w-full py-2.5 rounded-xl border-2 border-[#2D5A27] text-[#2D5A27] text-sm font-semibold hover:bg-[#2D5A27]/5 transition"
                    >
                      Assinar Starter
                    </button>
                  </div>

                  {/* Professional */}
                  <div className="border-2 border-[#2D5A27] rounded-2xl p-6 space-y-3 shadow-sm bg-[#2D5A27]/5 relative hover:shadow-md transition">
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#2D5A27] text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-1">
                      <Zap size={10} /> Popular
                    </span>
                    <div>
                      <p className="font-bold text-[#333333] text-base">Professional</p>
                      <p className="text-xs text-[#999999] mt-0.5">Para equipes e empresas</p>
                    </div>
                    <p className="text-3xl font-bold text-[#2D5A27]">
                      R$ 79<span className="text-sm font-normal text-[#666666]">/mês</span>
                    </p>
                    <ul className="text-xs text-[#666666] space-y-1.5">
                      <li className="flex items-center gap-1.5">✓ Tudo do Starter</li>
                      <li className="flex items-center gap-1.5">✓ Times e membros</li>
                      <li className="flex items-center gap-1.5">✓ Reuniões do time</li>
                    </ul>
                    <button
                      onClick={() => alert('Em breve!')}
                      className="w-full py-2.5 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition shadow-sm"
                    >
                      Assinar Professional
                    </button>
                  </div>
                </div>

                <p className="text-xs text-[#BBBBBB]">
                  Dúvidas?{' '}
                  <a href="mailto:contato@lemon.meet" className="underline text-[#999999] hover:text-[#666666]">
                    Fale conosco
                  </a>
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
