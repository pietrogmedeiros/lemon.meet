// ============================================================
// PublicWebinarPage.tsx — Página pública de inscrição em webinar
// Fluxo: lista de sessões → form (nome/email/telefone) → link
// ============================================================

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Calendar, Clock, CheckCircle, Loader, ChevronLeft, Copy, Check, ExternalLink } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface PublicSession {
  id: string
  scheduled_at: string
}

interface PublicConfig {
  title: string
  description: string | null
  team_name: string | null
  logo_url: string | null
  sessions: PublicSession[]
}

function formatPretty(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function PublicWebinarPage() {
  const { slug } = useParams<{ slug: string }>()
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [guestName, setGuestName] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resultLink, setResultLink] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/webinars/public/${slug}`)
        if (!res.ok) {
          if (res.status === 404) setError('Página de webinar não encontrada')
          else setError('Erro ao carregar webinar')
          return
        }
        const data = await res.json()
        if (!active) return
        setConfig(data.config)
      } catch {
        if (active) setError('Erro ao conectar com o servidor')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [slug])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedSessionId || !guestName.trim() || !guestEmail.trim() || !guestPhone.trim()) {
      alert('Preencha todos os campos')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`${API}/api/webinars/public/${slug}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSessionId,
          guest_name: guestName.trim(),
          guest_email: guestEmail.trim(),
          guest_phone: guestPhone.trim()
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Erro ao registrar')
      setResultLink(data.session.webinar_link)
    } catch (err: any) {
      alert('Erro: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const copyLink = () => {
    if (!resultLink) return
    navigator.clipboard.writeText(resultLink)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2500)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <Loader className="animate-spin text-[#2D5A27]" size={48} />
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg p-12 max-w-md text-center">
          <h1 className="text-2xl font-bold text-[#333] mb-3">Página não encontrada</h1>
          <p className="text-[#666]">{error}</p>
        </div>
      </div>
    )
  }

  const selectedSession = config.sessions.find(s => s.id === selectedSessionId) ?? null

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-lg overflow-hidden">
        {/* Header com logo */}
        <div className="px-8 pt-8 pb-6 border-b border-[#F0F0F0] flex items-center gap-4">
          {config.logo_url ? (
            <img
              src={config.logo_url}
              alt={config.team_name ?? 'Logo'}
              className="w-14 h-14 rounded-xl object-contain border border-[#E0E0E0] bg-white"
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-[#2D5A27] flex items-center justify-center text-white font-bold text-xl">
              {(config.team_name ?? 'W').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            {config.team_name && <p className="text-xs text-[#666] uppercase tracking-wider mb-1">{config.team_name}</p>}
            <h1 className="text-2xl font-bold text-[#333] truncate">{config.title}</h1>
          </div>
        </div>

        <div className="p-8">
          {config.description && !resultLink && (
            <p className="text-sm text-[#666] mb-6">{config.description}</p>
          )}

          {/* Step: Success — link disponível */}
          {resultLink ? (
            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="text-green-600" size={40} />
              </div>
              <h2 className="text-2xl font-bold text-[#2D5A27] mb-2">Inscrição confirmada!</h2>
              <p className="text-[#666] mb-6">
                {selectedSession ? `Sessão: ${formatPretty(selectedSession.scheduled_at)}` : ''}
              </p>
              <p className="text-sm text-[#666] mb-3">
                Copie o link abaixo para acessar o webinar na hora marcada:
              </p>
              <div className="p-4 bg-[#F8F9FA] border border-[#E0E0E0] rounded-xl break-all text-sm text-[#333] mb-4">
                {resultLink}
              </div>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={copyLink}
                  className="flex items-center gap-2 bg-[#2D5A27] text-white px-6 py-3 rounded-xl hover:bg-[#234520] transition-colors font-medium"
                >
                  {linkCopied ? <Check size={18} /> : <Copy size={18} />}
                  {linkCopied ? 'Copiado!' : 'Copiar link'}
                </button>
                <a
                  href={resultLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 border border-[#2D5A27] text-[#2D5A27] px-6 py-3 rounded-xl hover:bg-[#2D5A27]/5 transition-colors font-medium"
                >
                  <ExternalLink size={18} />
                  Abrir agora
                </a>
              </div>
            </div>
          ) : !selectedSessionId ? (
            // Step 1: escolher sessão
            <div>
              <h2 className="text-lg font-semibold text-[#333] mb-4">Escolha uma data</h2>
              {config.sessions.length === 0 ? (
                <p className="text-sm text-[#666] py-6 text-center">Nenhuma sessão disponível no momento.</p>
              ) : (
                <div className="space-y-3">
                  {config.sessions.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSessionId(s.id)}
                      className="w-full px-6 py-4 border-2 border-[#E0E0E0] rounded-xl hover:border-[#2D5A27] hover:bg-[#2D5A27]/5 transition-all text-left flex items-center gap-3"
                    >
                      <Calendar size={20} className="text-[#2D5A27] shrink-0" />
                      <span className="font-medium text-[#333]">{formatPretty(s.scheduled_at)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Step 2: form
            <form onSubmit={handleSubmit}>
              <button
                type="button"
                onClick={() => setSelectedSessionId(null)}
                className="flex items-center gap-2 text-[#666] hover:text-[#333] mb-6 text-sm"
              >
                <ChevronLeft size={18} />
                Voltar
              </button>

              <h2 className="text-lg font-semibold text-[#333] mb-2">Seus dados</h2>
              {selectedSession && (
                <div className="flex items-center gap-2 text-sm text-[#666] mb-6">
                  <Clock size={14} />
                  <span>{formatPretty(selectedSession.scheduled_at)}</span>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#333] mb-1.5">Nome *</label>
                  <input
                    type="text"
                    value={guestName}
                    onChange={e => setGuestName(e.target.value)}
                    required
                    placeholder="João Silva"
                    className="w-full px-4 py-3 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#333] mb-1.5">E-mail *</label>
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={e => setGuestEmail(e.target.value)}
                    required
                    placeholder="joao@empresa.com"
                    className="w-full px-4 py-3 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#333] mb-1.5">Telefone *</label>
                  <input
                    type="tel"
                    value={guestPhone}
                    onChange={e => setGuestPhone(e.target.value)}
                    required
                    placeholder="(11) 99999-9999"
                    className="w-full px-4 py-3 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-[#2D5A27] text-white px-6 py-4 rounded-xl hover:bg-[#234520] transition-colors disabled:opacity-50 font-semibold"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader className="animate-spin" size={20} />
                      Confirmando…
                    </span>
                  ) : 'Confirmar inscrição'}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="px-8 py-4 bg-[#F8F9FA] border-t border-[#E0E0E0] text-center">
          <p className="text-xs text-[#666]">
            Powered by <span className="font-semibold text-[#2D5A27]">Lemon Meet</span>
          </p>
        </div>
      </div>
    </div>
  )
}
