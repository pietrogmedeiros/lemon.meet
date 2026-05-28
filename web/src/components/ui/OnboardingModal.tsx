import { useEffect, useState } from 'react'
import { X, Calendar, Bot, FileText, Lightbulb, ExternalLink, AlertTriangle, ChevronRight, ZoomIn } from 'lucide-react'

const STORAGE_KEY = 'lemon_onboarding_seen'

const steps = [
  {
    icon: Calendar,
    color: '#4285F4',
    bg: '#EBF3FF',
    number: '1',
    title: 'Conecte seu Google Calendar',
    description: 'Vá em Integrações → Permissões e conecte sua conta Google. O Lemon.meet vai ler seus eventos e preparar o bot automaticamente.',
    action: {
      label: 'Ir para Integrações',
      href: '/integrations/permissions',
      internal: true,
    },
  },
  {
    icon: Bot,
    color: '#2D5A27',
    bg: '#F0F7EE',
    number: '2',
    title: 'O bot entra sozinho na reunião',
    description: 'Quando seu evento começar, o "Lemon Notetaker" entra automaticamente no Google Meet, Zoom ou Teams — sem você precisar fazer nada.',
  },
  {
    icon: FileText,
    color: '#B8860B',
    bg: '#FFFBEA',
    number: '3',
    title: 'Transcrição gerada automaticamente',
    description: 'Após a reunião, a transcrição completa é processada com identificação de quem falou. Acesse tudo em "Reuniões".',
  },
  {
    icon: Lightbulb,
    color: '#7C3AED',
    bg: '#F5F0FF',
    number: '4',
    title: 'Insights e resumo inteligente',
    description: 'O Lemon.meet gera pontos-chave, itens de ação, sentimento da reunião e sugestões de follow-up — disponíveis em "Insights".',
  },
]

interface OnboardingModalProps {
  open: boolean
  onClose: () => void
}

export function OnboardingModal({ open, onClose }: OnboardingModalProps) {
  const [page, setPage] = useState<1 | 2>(1)
  const [lightbox, setLightbox] = useState<string | null>(null)

  // Reseta para página 1 toda vez que o modal abre
  useEffect(() => {
    if (open) { setPage(1); setLightbox(null) }
  }, [open])

  if (!open) return null

  return (
    <>
    {/* Lightbox */}
    {lightbox && (
      <div
        className="fixed inset-0 z-[10000] flex items-center justify-center p-6"
        style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
        onClick={() => setLightbox(null)}
      >
        <button
          onClick={() => setLightbox(null)}
          className="absolute top-4 right-4 p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
          aria-label="Fechar imagem"
        >
          <X size={22} />
        </button>
        <img
          src={lightbox}
          alt="Imagem ampliada"
          className="max-w-full max-h-full rounded-2xl shadow-2xl object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )}

    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className={`bg-surface rounded-2xl shadow-2xl w-full flex flex-col overflow-hidden transition-all duration-300 ${page === 2 ? 'max-w-2xl' : 'max-w-lg'}`}
        style={{ maxHeight: '92vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-neutral-light">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#F0F7EE] flex items-center justify-center text-xl">
              🍋
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-primary leading-tight">
                {page === 1 ? 'Como usar o Lemon.meet' : 'Permissões necessárias'}
              </h2>
              <p className="text-[12px] text-secondary mt-0.5">
                {page === 1 ? '4 passos para gravar reuniões automaticamente' : 'Importante: leia antes de conectar'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Indicador de página */}
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full transition-colors ${page === 1 ? 'bg-[#2D5A27]' : 'bg-[#E0E0E0]'}`} />
              <div className={`w-2 h-2 rounded-full transition-colors ${page === 2 ? 'bg-[#2D5A27]' : 'bg-[#E0E0E0]'}`} />
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#aaa] hover:text-[#444] hover:bg-neutral-lighter transition-colors"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Conteúdo página 1 — passos */}
        {page === 1 && (
          <div className="overflow-y-auto px-6 py-5 space-y-4">
            {steps.map((step, i) => {
              const Icon = step.icon
              return (
                <div key={i} className="flex gap-4">
                  <div className="flex flex-col items-center gap-0">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-sm"
                      style={{ background: step.bg, color: step.color }}
                    >
                      {step.number}
                    </div>
                    {i < steps.length - 1 && (
                      <div className="w-px flex-1 min-h-[16px] mt-1" style={{ background: '#F0F0F0' }} />
                    )}
                  </div>
                  <div className="pb-4 flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon size={15} style={{ color: step.color }} className="shrink-0" />
                      <span className="text-[14px] font-semibold text-primary">{step.title}</span>
                    </div>
                    <p className="text-[13px] text-secondary leading-relaxed">{step.description}</p>
                    {step.action && (
                      step.action.internal ? (
                        <a
                          href={step.action.href}
                          onClick={onClose}
                          className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                          style={{ background: step.bg, color: step.color }}
                        >
                          <ExternalLink size={12} />
                          {step.action.label}
                        </a>
                      ) : (
                        <a
                          href={step.action.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                          style={{ background: step.bg, color: step.color }}
                        >
                          <ExternalLink size={12} />
                          {step.action.label}
                        </a>
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Conteúdo página 2 — permissões */}
        {page === 2 && (
          <div className="overflow-y-auto px-6 py-5 space-y-6">

            {/* Aviso app não verificado */}
            <div className="flex gap-2 items-start p-3 rounded-xl bg-amber-50 border border-amber-200">
              <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-700 leading-relaxed">
                O Lemon.meet está em <strong>processo de homologação pelo Google</strong>. Por isso, ao conectar o Google Calendar aparece um aviso de "app não verificado". Siga os passos abaixo para continuar normalmente.
              </p>
            </div>

            {/* Seção Calendar */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-[#EBF3FF] flex items-center justify-center shrink-0">
                  <Calendar size={13} className="text-[#4285F4]" />
                </div>
                <span className="text-[14px] font-semibold text-primary">Integrando o Google Calendar</span>
              </div>
              <ol className="space-y-3 ml-1">
                <li className="flex gap-3 items-start">
                  <span className="text-[11px] font-bold bg-[#4285F4] text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">1</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-[#444] leading-snug mb-2">Na tela de aviso do Google, clique em <strong>"Avançado"</strong></p>
                    <div className="relative group cursor-zoom-in" onClick={() => setLightbox('/permissaocalendar1.png')}>
                      <img
                        src="/permissaocalendar1.png"
                        alt="Clique em Avançado"
                        className="w-full rounded-xl border border-neutral-light object-contain max-h-64 transition-opacity group-hover:opacity-90"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-black/50 rounded-full p-2">
                          <ZoomIn size={18} className="text-white" />
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
                <li className="flex gap-3 items-start">
                  <span className="text-[11px] font-bold bg-[#4285F4] text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">2</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-[#444] leading-snug mb-2">Depois clique em <strong>"Acessar Lemon.meet (não seguro)"</strong></p>
                    <div className="relative group cursor-zoom-in" onClick={() => setLightbox('/permissaocalendar2.png')}>
                      <img
                        src="/permissaocalendar2.png"
                        alt="Acessar Lemon.meet (não seguro)"
                        className="w-full rounded-xl border border-neutral-light object-contain max-h-64 transition-opacity group-hover:opacity-90"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-black/50 rounded-full p-2">
                          <ZoomIn size={18} className="text-white" />
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              </ol>
            </div>

            {/* Divisor */}
            <div className="border-t border-neutral-light" />

            {/* Seção bot na reunião */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-[#F0F7EE] flex items-center justify-center shrink-0">
                  <Bot size={13} className="text-brand" />
                </div>
                <span className="text-[14px] font-semibold text-primary">Permitindo o bot na reunião</span>
              </div>
              <ol className="space-y-3 ml-1">
                <li className="flex gap-3 items-start">
                  <span className="text-[11px] font-bold bg-[#2D5A27] text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">1</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-[#444] leading-snug mb-2">Na reunião, clique nos <strong>3 pontos</strong> ao lado do "Lemon Notetaker" na lista de participantes</p>
                    <div className="relative group cursor-zoom-in" onClick={() => setLightbox('/permissaonotetaker2.jpeg')}>
                      <img
                        src="/permissaonotetaker2.jpeg"
                        alt="Clique nos 3 pontos"
                        className="w-full rounded-xl border border-neutral-light object-contain max-h-64 transition-opacity group-hover:opacity-90"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-black/50 rounded-full p-2">
                          <ZoomIn size={18} className="text-white" />
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
                <li className="flex gap-3 items-start">
                  <span className="text-[11px] font-bold bg-[#2D5A27] text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">2</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-[#444] leading-snug mb-2">Selecione <strong>"Permitir Entrada"</strong></p>
                    <div className="relative group cursor-zoom-in" onClick={() => setLightbox('/permissaonotetaker1.jpeg')}>
                      <img
                        src="/permissaonotetaker1.jpeg"
                        alt="Permitir Entrada"
                        className="w-full rounded-xl border border-neutral-light object-contain max-h-64 transition-opacity group-hover:opacity-90"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-black/50 rounded-full p-2">
                          <ZoomIn size={18} className="text-white" />
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              </ol>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-light flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 accent-[#2D5A27] cursor-pointer"
              onChange={(e) => {
                if (e.target.checked) localStorage.setItem(STORAGE_KEY, '1')
                else localStorage.removeItem(STORAGE_KEY)
              }}
              defaultChecked={!!localStorage.getItem(STORAGE_KEY)}
            />
            <span className="text-[12px] text-secondary">Não mostrar novamente</span>
          </label>
          <div className="flex items-center gap-2">
            {page === 2 && (
              <button
                onClick={() => setPage(1)}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold text-secondary hover:bg-neutral-lighter transition-colors"
              >
                Voltar
              </button>
            )}
            <button
              onClick={() => page === 1 ? setPage(2) : onClose()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors"
              style={{ background: '#2D5A27' }}
            >
              {page === 1 ? (
                <>Próximo <ChevronRight size={14} /></>
              ) : (
                'Entendido!'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}

/** Hook que controla abertura automática na primeira visita */
export function useOnboarding() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY)
    if (!seen) {
      const t = setTimeout(() => setOpen(true), 600)
      return () => clearTimeout(t)
    }
  }, [])

  const openModal = () => setOpen(true)
  const closeModal = () => {
    setOpen(false)
    localStorage.setItem(STORAGE_KEY, '1')
  }

  return { open, openModal, closeModal }
}


