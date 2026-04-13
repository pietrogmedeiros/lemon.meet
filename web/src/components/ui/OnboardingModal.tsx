import { useEffect, useState } from 'react'
import { X, Chrome, MousePointerClick, Mic, StopCircle, ExternalLink } from 'lucide-react'

const STORAGE_KEY = 'lemon_onboarding_seen'

const steps = [
  {
    icon: Chrome,
    color: '#4285F4',
    bg: '#EBF3FF',
    number: '1',
    title: 'Instale a extensão no Chrome',
    description: 'Baixe e instale a extensão Lemon.meet gratuitamente na Chrome Web Store.',
    action: {
      label: 'Instalar extensão',
      href: 'https://chromewebstore.google.com/detail/lemonmeet/meedmcpknakneklnhabddnjkkiemjogd?authuser=0&hl=pt-BR',
    },
  },
  {
    icon: MousePointerClick,
    color: '#2D5A27',
    bg: '#F0F7EE',
    number: '2',
    title: 'Entre na reunião e clique no botão verde',
    description: 'Ao entrar no Google Meet, um botão verde 🍋 aparece na tela. Clique nele para começar a gravar.',
  },
  {
    icon: Mic,
    color: '#B8860B',
    bg: '#FFFBEA',
    number: '3',
    title: 'Permita o acesso ao microfone',
    description: 'Na primeira vez, o Chrome pedirá permissão para usar o microfone. Clique em "Permitir" para gravar sua voz junto com os participantes.',
  },
  {
    icon: StopCircle,
    color: '#DC3545',
    bg: '#FFF0F1',
    number: '4',
    title: 'Encerre a gravação',
    description: 'Quando a reunião terminar, clique novamente no botão (agora vermelho) para parar. Os insights serão gerados automaticamente.',
  },
]

interface OnboardingModalProps {
  open: boolean
  onClose: () => void
}

export function OnboardingModal({ open, onClose }: OnboardingModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#F0F0F0]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#F0F7EE] flex items-center justify-center text-xl">
              🍋
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-[#1a1a1a] leading-tight">Como usar o Lemon.meet</h2>
              <p className="text-[12px] text-[#888] mt-0.5">Siga os 4 passos abaixo para começar</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#aaa] hover:text-[#444] hover:bg-[#F5F5F5] transition-colors"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Steps */}
        <div className="overflow-y-auto px-6 py-5 space-y-4">
          {steps.map((step, i) => {
            const Icon = step.icon
            return (
              <div key={i} className="flex gap-4">
                {/* Número + linha conectora */}
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

                {/* Conteúdo */}
                <div className="pb-4 flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={15} style={{ color: step.color }} className="shrink-0" />
                    <span className="text-[14px] font-semibold text-[#1a1a1a]">{step.title}</span>
                  </div>
                  <p className="text-[13px] text-[#666] leading-relaxed">{step.description}</p>
                  {step.action && (
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
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#F0F0F0] flex items-center justify-between gap-3">
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
            <span className="text-[12px] text-[#888]">Não mostrar novamente</span>
          </label>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors"
            style={{ background: '#2D5A27' }}
          >
            Entendido!
          </button>
        </div>
      </div>
    </div>
  )
}

/** Hook que controla abertura automática na primeira visita */
export function useOnboarding() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY)
    if (!seen) {
      // Pequeno delay para a UI carregar antes de abrir o modal
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
