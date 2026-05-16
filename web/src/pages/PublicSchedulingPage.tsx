// ============================================================
// PublicSchedulingPage.tsx
// Página pública de agendamento (sem autenticação)
// Visitantes podem agendar reuniões via Round Robin
// ============================================================

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Calendar, Clock, CheckCircle, Loader, ChevronLeft } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface PublicConfig {
  title: string
  description: string | null
  meeting_duration_minutes: number
  team_name: string
  working_hours: Record<string, any>
  logo_url: string | null
}

export function PublicSchedulingPage() {
  const { slug } = useParams<{ slug: string }>()
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Form
  const [guestName, setGuestName] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [guestNotes, setGuestNotes] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [slug])

  const loadConfig = async () => {
    try {
      const response = await fetch(`${API}/api/scheduling/public/${slug}`)

      if (!response.ok) {
        if (response.status === 404) {
          setError('Página de agendamento não encontrada')
        } else {
          setError('Erro ao carregar configuração')
        }
        return
      }

      const data = await response.json()
      setConfig(data.config)
    } catch (err) {
      setError('Erro ao conectar com o servidor')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!guestName || !guestEmail || !selectedDate || !selectedTime) {
      alert('Preencha todos os campos obrigatórios')
      return
    }

    setSubmitting(true)

    try {
      // Monta ISO string do horário selecionado
      const scheduledStart = `${selectedDate}T${selectedTime}:00.000Z`

      const response = await fetch(`${API}/api/scheduling/public/${slug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_name: guestName,
          guest_email: guestEmail,
          guest_phone: guestPhone || null,
          guest_notes: guestNotes || null,
          scheduled_start: scheduledStart
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Erro ao criar agendamento')
      }

      setSuccess(true)
    } catch (err: any) {
      alert('❌ ' + err.message)
    } finally {
      setSubmitting(false)
    }
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
          <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl">❌</span>
          </div>
          <h1 className="text-2xl font-bold text-[#333333] mb-3">
            Página não encontrada
          </h1>
          <p className="text-[#666666]">{error}</p>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-8">
        <div className="bg-white rounded-2xl shadow-lg p-12 max-w-md text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="text-green-600" size={40} />
          </div>
          <h1 className="text-3xl font-bold text-[#2D5A27] mb-3">
            Agendamento Confirmado!
          </h1>
          <p className="text-[#666666] mb-8">
            Enviamos uma confirmação para <strong>{guestEmail}</strong>
          </p>
          <div className="p-6 bg-[#F8F9FA] rounded-xl text-left space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Calendar size={18} className="text-[#2D5A27]" />
              <span className="text-[#333333] font-medium">
                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                  weekday: 'long'
                })}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Clock size={18} className="text-[#2D5A27]" />
              <span className="text-[#333333] font-medium">{selectedTime}</span>
            </div>
          </div>
          <p className="text-sm text-[#999999] mt-8">
            O evento já foi adicionado na sua agenda e na agenda do responsável
          </p>
        </div>
      </div>
    )
  }

  // Gera slots de horário (placeholder - backend deveria retornar disponibilidade real)
  const timeSlots = [
    '09:00',
    '10:00',
    '11:00',
    '14:00',
    '15:00',
    '16:00',
    '17:00'
  ]

  // Próximos 7 dias
  const availableDates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() + i + 1)
    return date.toISOString().split('T')[0]
  })

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-8">
      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] min-h-[600px]">
          {/* Left Sidebar - Event Info */}
          <div className="bg-white border-r border-[#E0E0E0] p-8">
            <div className="flex items-center gap-3 mb-6">
              {config.logo_url ? (
                <img 
                  src={config.logo_url} 
                  alt={config.team_name}
                  className="w-12 h-12 rounded-full object-cover border border-[#E0E0E0]"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-[#2D5A27] flex items-center justify-center text-white font-bold text-lg">
                  {config.team_name.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-sm text-[#666666]">{config.team_name}</p>
                <h1 className="text-xl font-bold text-[#333333]">{config.title}</h1>
              </div>
            </div>
            
            {config.description && (
              <p className="text-sm text-[#666666] mb-6">{config.description}</p>
            )}

            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3 text-[#666666]">
                <Clock size={18} className="text-[#2D5A27]" />
                <span>{config.meeting_duration_minutes} minutos</span>
              </div>
              <div className="flex items-center gap-3 text-[#666666]">
                <Calendar size={18} className="text-[#2D5A27]" />
                <span>Reunião por vídeo</span>
              </div>
            </div>
          </div>

          {/* Right Side - Date/Time Selection + Form */}
          <div className="p-8">
            {!selectedDate ? (
              // Step 1: Select Date
              <div>
                <h2 className="text-2xl font-bold text-[#333333] mb-6">Selecione uma data</h2>
                <div className="grid gap-3 max-w-md">
                  {availableDates.map((date) => (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setSelectedDate(date)}
                      className="px-6 py-4 border-2 border-[#E0E0E0] rounded-xl hover:border-[#2D5A27] hover:bg-[#2D5A27]/5 transition-all text-left"
                    >
                      <div className="font-semibold text-[#333333]">
                        {new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', {
                          weekday: 'long',
                          day: '2-digit',
                          month: 'long'
                        })}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : !selectedTime ? (
              // Step 2: Select Time
              <div>
                <button
                  onClick={() => setSelectedDate('')}
                  className="flex items-center gap-2 text-[#666666] hover:text-[#333333] mb-6"
                >
                  <ChevronLeft size={20} />
                  Voltar
                </button>
                <h2 className="text-2xl font-bold text-[#333333] mb-2">
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'long'
                  })}
                </h2>
                <p className="text-sm text-[#666666] mb-6">Escolha um horário disponível</p>
                
                <div className="grid grid-cols-2 gap-3 max-w-md">
                  {timeSlots.map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => setSelectedTime(time)}
                      className="px-6 py-3 border-2 border-[#E0E0E0] rounded-xl hover:border-[#2D5A27] hover:bg-[#2D5A27]/5 transition-all font-medium text-[#333333]"
                    >
                      {time}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              // Step 3: Fill Form
              <form onSubmit={handleSubmit}>
                <button
                  type="button"
                  onClick={() => setSelectedTime('')}
                  className="flex items-center gap-2 text-[#666666] hover:text-[#333333] mb-6"
                >
                  <ChevronLeft size={20} />
                  Voltar
                </button>
                
                <h2 className="text-2xl font-bold text-[#333333] mb-2">Seus dados</h2>
                <div className="flex items-center gap-2 text-sm text-[#666666] mb-6">
                  <Calendar size={16} />
                  <span>
                    {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'long'
                    })} às {selectedTime}
                  </span>
                </div>

                <div className="space-y-4 max-w-md">
                  <div>
                    <label className="block text-sm font-medium text-[#333333] mb-2">
                      Seu nome *
                    </label>
                    <input
                      type="text"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="João Silva"
                      required
                      className="w-full px-4 py-3 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#333333] mb-2">
                      Seu e-mail *
                    </label>
                    <input
                      type="email"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      placeholder="joao@empresa.com"
                      required
                      className="w-full px-4 py-3 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#333333] mb-2">
                      Telefone (opcional)
                    </label>
                    <input
                      type="tel"
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      placeholder="(11) 99999-9999"
                      className="w-full px-4 py-3 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#333333] mb-2">
                      Observações (opcional)
                    </label>
                    <textarea
                      value={guestNotes}
                      onChange={(e) => setGuestNotes(e.target.value)}
                      placeholder="Conte-nos brevemente sobre o que gostaria de conversar..."
                      rows={3}
                      className="w-full px-4 py-3 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-[#2D5A27] text-white px-6 py-4 rounded-xl hover:bg-[#234520] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                  >
                    {submitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader className="animate-spin" size={20} />
                        Agendando...
                      </span>
                    ) : (
                      'Confirmar Agendamento'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-4 bg-[#F8F9FA] border-t border-[#E0E0E0] text-center">
          <p className="text-sm text-[#666666]">
            Powered by <span className="font-semibold text-[#2D5A27]">Lemon Meet</span>
          </p>
        </div>
      </div>
    </div>
  )
}
