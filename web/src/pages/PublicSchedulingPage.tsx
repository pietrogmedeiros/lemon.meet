// ============================================================
// PublicSchedulingPage.tsx
// Página pública de agendamento (sem autenticação)
// Visitantes podem agendar reuniões via Round Robin
// ============================================================

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Calendar, Clock, CheckCircle, Loader, ChevronLeft, User } from 'lucide-react'

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
  const [hostName, setHostName] = useState<string | null>(null)

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
      // Manda a hora de PAREDE que o visitante viu; o servidor converte usando o
      // fuso do time. Antes montávamos `${data}T${hora}:00.000Z`, o que declarava
      // o rótulo do slot como UTC: "15:00" chegava como 12:00 em Brasília, a
      // reserva batia num horário diferente do escolhido e voltava 409.
      const response = await fetch(`${API}/api/scheduling/public/${slug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_name: guestName,
          guest_email: guestEmail,
          guest_phone: guestPhone || null,
          guest_notes: guestNotes || null,
          scheduled_date: selectedDate,
          scheduled_time: selectedTime
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Erro ao criar agendamento')
      }

      // Quem vai atender — o round-robin decide no servidor, então só dá pra
      // saber depois de confirmar.
      const result = await response.json().catch(() => null)
      setHostName(result?.booking?.host_name ?? null)
      setSuccess(true)
    } catch (err: any) {
      alert('❌ ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-lighter flex items-center justify-center">
        <Loader className="animate-spin text-brand" size={48} />
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className="min-h-screen bg-neutral-lighter flex items-center justify-center px-4">
        <div className="bg-surface rounded-2xl shadow-lg p-12 max-w-md text-center">
          <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl">❌</span>
          </div>
          <h1 className="text-2xl font-bold text-primary mb-3">
            Página não encontrada
          </h1>
          <p className="text-secondary">{error}</p>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-neutral-lighter flex items-center justify-center p-8">
        <div className="bg-surface rounded-2xl shadow-lg p-12 max-w-md text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="text-green-600" size={40} />
          </div>
          <h1 className="text-3xl font-bold text-brand mb-3">
            Agendamento Confirmado!
          </h1>
          <p className="text-secondary mb-8">
            {hostName
              ? <>Sua reunião com <span className="font-semibold text-primary">{hostName}</span> está confirmada</>
              : 'Seu agendamento foi confirmado com sucesso'}
          </p>
          <div className="p-6 bg-background rounded-xl text-left space-y-3">
            {hostName && (
              <div className="flex items-center gap-3 text-sm">
                <User size={18} className="text-brand" />
                <span className="text-primary font-medium">{hostName}</span>
              </div>
            )}
            <div className="flex items-center gap-3 text-sm">
              <Calendar size={18} className="text-brand" />
              <span className="text-primary font-medium">
                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                  weekday: 'long'
                })}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Clock size={18} className="text-brand" />
              <span className="text-primary font-medium">{selectedTime}</span>
            </div>
          </div>
          <p className="text-sm text-tertiary mt-8">
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

  // Próximos 7 dias ÚTEIS segundo o working_hours da config.
  //
  // Antes eram os 7 próximos dias corridos, sem filtro: sábado e domingo
  // apareciam na lista e, ao clicar, não havia horário nenhum — o backend já
  // devolvia slots:[] pra dia desabilitado. Agora só entram dias habilitados.
  //
  // A data é montada com getFullYear/getMonth/getDate (hora local), não com
  // toISOString(), que converte pra UTC: à noite no Brasil o ISO já virou o dia
  // seguinte e a lista pulava um dia.
  const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const availableDates: string[] = []
  for (let offset = 1; availableDates.length < 7 && offset <= 30; offset++) {
    const date = new Date()
    date.setDate(date.getDate() + offset)
    const dayKey = DAY_KEYS[date.getDay()]
    if (config?.working_hours?.[dayKey]?.enabled === false) continue
    if (config?.working_hours && !config.working_hours[dayKey]) continue

    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    availableDates.push(iso)
  }

  return (
    <div className="min-h-screen bg-neutral-lighter flex items-center justify-center p-8">
      <div className="w-full max-w-6xl bg-surface rounded-2xl shadow-lg overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] min-h-[600px]">
          {/* Left Sidebar - Event Info */}
          <div className="bg-surface border-r border-neutral-light p-8">
            <div className="flex items-center gap-3 mb-6">
              {config.logo_url ? (
                <img 
                  src={config.logo_url} 
                  alt={config.team_name}
                  className="w-12 h-12 rounded-full object-cover border border-neutral-light"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-[#2D5A27] flex items-center justify-center text-white font-bold text-lg">
                  {config.team_name.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-sm text-secondary">{config.team_name}</p>
                <h1 className="text-xl font-bold text-primary">{config.title}</h1>
              </div>
            </div>
            
            {config.description && (
              <p className="text-sm text-secondary mb-6">{config.description}</p>
            )}

            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3 text-secondary">
                <Clock size={18} className="text-brand" />
                <span>{config.meeting_duration_minutes} minutos</span>
              </div>
              <div className="flex items-center gap-3 text-secondary">
                <Calendar size={18} className="text-brand" />
                <span>Reunião por vídeo</span>
              </div>
            </div>
          </div>

          {/* Right Side - Date/Time Selection + Form */}
          <div className="p-8">
            {!selectedDate ? (
              // Step 1: Select Date
              <div>
                <h2 className="text-2xl font-bold text-primary mb-6">Selecione uma data</h2>
                <div className="grid gap-3 max-w-md">
                  {availableDates.map((date) => (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setSelectedDate(date)}
                      className="px-6 py-4 border-2 border-neutral-light rounded-xl hover:border-[#2D5A27] hover:bg-[#2D5A27]/5 transition-all text-left"
                    >
                      <div className="font-semibold text-primary">
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
                  className="flex items-center gap-2 text-secondary hover:text-primary mb-6"
                >
                  <ChevronLeft size={20} />
                  Voltar
                </button>
                <h2 className="text-2xl font-bold text-primary mb-2">
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'long'
                  })}
                </h2>
                <p className="text-sm text-secondary mb-6">Escolha um horário disponível</p>
                
                <div className="grid grid-cols-2 gap-3 max-w-md">
                  {timeSlots.map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => setSelectedTime(time)}
                      className="px-6 py-3 border-2 border-neutral-light rounded-xl hover:border-[#2D5A27] hover:bg-[#2D5A27]/5 transition-all font-medium text-primary"
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
                  className="flex items-center gap-2 text-secondary hover:text-primary mb-6"
                >
                  <ChevronLeft size={20} />
                  Voltar
                </button>
                
                <h2 className="text-2xl font-bold text-primary mb-2">Seus dados</h2>
                <div className="flex items-center gap-2 text-sm text-secondary mb-6">
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
                    <label className="block text-sm font-medium text-primary mb-2">
                      Seu nome *
                    </label>
                    <input
                      type="text"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="João Silva"
                      required
                      className="w-full px-4 py-3 border border-neutral-light rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-primary mb-2">
                      Seu e-mail *
                    </label>
                    <input
                      type="email"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      placeholder="joao@empresa.com"
                      required
                      className="w-full px-4 py-3 border border-neutral-light rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-primary mb-2">
                      Telefone (opcional)
                    </label>
                    <input
                      type="tel"
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      placeholder="(11) 99999-9999"
                      className="w-full px-4 py-3 border border-neutral-light rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-primary mb-2">
                      Observações (opcional)
                    </label>
                    <textarea
                      value={guestNotes}
                      onChange={(e) => setGuestNotes(e.target.value)}
                      placeholder="Conte-nos brevemente sobre o que gostaria de conversar..."
                      rows={3}
                      className="w-full px-4 py-3 border border-neutral-light rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
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
        <div className="px-8 py-4 bg-background border-t border-neutral-light text-center">
          <p className="text-sm text-secondary">
            Powered by <span className="font-semibold text-brand">Lemon Meet</span>
          </p>
        </div>
      </div>
    </div>
  )
}
