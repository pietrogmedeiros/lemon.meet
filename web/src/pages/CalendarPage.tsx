import { useState, useEffect, useCallback } from 'react'
import { MainLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  ChevronLeft, ChevronRight, Calendar, ExternalLink,
  Video, Loader, CalendarOff, RefreshCw, X
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface CalendarEvent {
  event_id: string
  series_id: string
  event_type: 'one_off' | 'recurring'
  title: string
  start_time: string
  end_time: string
  status: 'confirmed' | 'cancelled' | 'tentative'
  meeting_url: string | null
  meeting_platform: 'zoom' | 'meet' | 'teams' | null
  bot_scheduled: boolean
  is_exception: boolean
}

const PLATFORM_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  meet:  { bg: 'bg-green-50 dark:bg-green-950/40',  text: 'text-green-700 dark:text-green-300',  border: 'border-green-200 dark:border-green-900/50', dot: 'bg-green-500' },
  zoom:  { bg: 'bg-blue-50 dark:bg-blue-950/40',   text: 'text-blue-700 dark:text-blue-300',   border: 'border-blue-200 dark:border-blue-900/50',  dot: 'bg-blue-500' },
  teams: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
  other: { bg: 'bg-neutral-lighter', text: 'text-secondary',  border: 'border-neutral-light', dot: 'bg-[#BBBBBB]' },
}

const PLATFORM_LABELS: Record<string, string> = {
  meet: 'Meet', zoom: 'Zoom', teams: 'Teams',
}

const WEEKDAYS_FULL  = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const WEEKDAYS_SHORT = ['D',   'S',   'T',   'Q',   'Q',   'S',   'S'  ]
const MONTHS = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
]

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function isToday(d: Date) {
  return isSameDay(d, new Date())
}

export function CalendarPage() {
  const navigate = useNavigate()
  const [session, setSession] = useState<any>(null)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [noCalendar, setNoCalendar] = useState(false)
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
  }, [])

  const loadEvents = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const startOfGrid = new Date(viewYear, viewMonth, 1)
      startOfGrid.setDate(startOfGrid.getDate() - startOfGrid.getDay())
      const endOfGrid = new Date(viewYear, viewMonth + 1, 0)
      endOfGrid.setDate(endOfGrid.getDate() + (6 - endOfGrid.getDay()))

      const res = await fetch(
        `${API}/api/calendar/events?start=${encodeURIComponent(startOfGrid.toISOString())}&end=${encodeURIComponent(endOfGrid.toISOString())}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      )
      const data = await res.json()
      if (data.noCalendar) {
        setNoCalendar(true)
        setEvents([])
      } else {
        setNoCalendar(false)
        setEvents(data.events ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [session, viewYear, viewMonth])

  useEffect(() => {
    if (session) loadEvents()
  }, [session, loadEvents])

  // ── Grid cells ────────────────────────────────────────────
  const firstDay = new Date(viewYear, viewMonth, 1)
  const startOffset = firstDay.getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  const cells: Date[] = []
  for (let i = 0; i < startOffset; i++)
    cells.push(new Date(viewYear, viewMonth, -startOffset + i + 1))
  for (let d = 1; d <= daysInMonth; d++)
    cells.push(new Date(viewYear, viewMonth, d))
  const rem = (7 - (cells.length % 7)) % 7
  for (let i = 1; i <= rem; i++)
    cells.push(new Date(viewYear, viewMonth + 1, i))

  function eventsForDay(date: Date) {
    return events
      .filter(e => isSameDay(new Date(e.start_time), date))
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
    setSelectedDay(null)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
    setSelectedDay(null)
  }
  function goToday() {
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth())
    setSelectedDay(today)
  }

  const selectedDayEvents = selectedDay ? eventsForDay(selectedDay) : []
  const isCurrentMonth = (date: Date) =>
    date.getMonth() === viewMonth && date.getFullYear() === viewYear

  // ── Sem calendário conectado ──────────────────────────────
  if (!loading && noCalendar) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center py-24 sm:py-32 gap-5 px-4">
          <div className="w-16 h-16 rounded-2xl bg-[#2D5A27]/10 flex items-center justify-center">
            <CalendarOff size={28} className="text-brand" />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-bold text-primary">Calendário não conectado</h2>
            <p className="text-sm text-secondary mt-1.5 max-w-xs">
              Conecte seu Google Calendar para visualizar seus eventos aqui.
            </p>
          </div>
          <button
            onClick={() => navigate('/integrations/permissions')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition shadow-sm"
          >
            <Calendar size={15} /> Conectar Google Calendar
          </button>
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <div className="flex flex-col gap-4 h-full">

        {/* ── Header ── */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg sm:text-xl font-bold text-primary">
              {MONTHS[viewMonth]} {viewYear}
            </h1>
            {loading && <Loader size={15} className="animate-spin text-brand" />}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={goToday}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-neutral-light text-secondary hover:bg-neutral-lighter transition"
            >
              Hoje
            </button>
            <button
              onClick={loadEvents}
              disabled={loading}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-neutral-light text-tertiary hover:bg-neutral-lighter transition disabled:opacity-50"
              title="Atualizar"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <div className="flex rounded-xl border border-neutral-light overflow-hidden">
              <button
                onClick={prevMonth}
                className="px-3 py-1.5 text-secondary hover:bg-neutral-lighter transition border-r border-neutral-light"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={nextMonth}
                className="px-3 py-1.5 text-secondary hover:bg-neutral-lighter transition"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Layout principal: grade + painel ── */}
        <div className={`
          flex flex-col gap-4
          ${selectedDay ? 'lg:grid lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_340px]' : ''}
        `}>

          {/* ── Grade do calendário ── */}
          <div className="bg-surface border border-neutral-light rounded-2xl shadow-sm overflow-hidden min-w-0">

            {/* Cabeçalho dias da semana */}
            <div className="grid grid-cols-7 border-b border-neutral-light">
              {WEEKDAYS_FULL.map((full, i) => (
                <div key={full} className="text-center py-2 sm:py-2.5">
                  {/* Mobile: letra única | sm+: abreviação */}
                  <span className="sm:hidden text-[10px] font-semibold text-tertiary uppercase">
                    {WEEKDAYS_SHORT[i]}
                  </span>
                  <span className="hidden sm:inline text-[10px] font-semibold text-tertiary uppercase tracking-wider">
                    {full}
                  </span>
                </div>
              ))}
            </div>

            {/* Células */}
            <div className="grid grid-cols-7">
              {cells.map((date, i) => {
                const dayEvents = eventsForDay(date)
                const current = isCurrentMonth(date)
                const todayCell = isToday(date)
                const selected = selectedDay ? isSameDay(date, selectedDay) : false
                const isLastRow = i >= cells.length - 7

                return (
                  <div
                    key={i}
                    onClick={() => setSelectedDay(selected ? null : date)}
                    className={`
                      cursor-pointer transition-colors select-none
                      min-h-[52px] sm:min-h-[80px] lg:min-h-[90px]
                      p-1 sm:p-2
                      ${!isLastRow ? 'border-b' : ''} border-[#F5F5F5]
                      ${(i % 7) < 6 ? 'border-r' : ''} border-[#F5F5F5]
                      ${selected ? 'bg-[#2D5A27]/5' : 'hover:bg-background'}
                      ${!current ? 'opacity-35' : ''}
                    `}
                  >
                    {/* Número do dia */}
                    <div className={`
                      w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center
                      text-xs sm:text-sm font-semibold mb-1 mx-auto
                      ${todayCell
                        ? 'bg-[#2D5A27] text-white'
                        : selected
                          ? 'bg-[#2D5A27]/15 text-brand'
                          : 'text-primary'}
                    `}>
                      {date.getDate()}
                    </div>

                    {/* Mobile: pontos coloridos */}
                    {dayEvents.length > 0 && (
                      <div className="flex sm:hidden justify-center gap-0.5 flex-wrap px-0.5">
                        {dayEvents.slice(0, 3).map(ev => {
                          const colors = PLATFORM_COLORS[ev.meeting_platform ?? 'other']
                          return (
                            <span
                              key={ev.event_id}
                              className={`w-1.5 h-1.5 rounded-full ${colors.dot}`}
                            />
                          )
                        })}
                        {dayEvents.length > 3 && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#CCCCCC]" />
                        )}
                      </div>
                    )}

                    {/* sm+: pills de evento */}
                    <div className="hidden sm:flex flex-col gap-0.5">
                      {dayEvents.slice(0, 3).map(ev => {
                        const colors = PLATFORM_COLORS[ev.meeting_platform ?? 'other']
                        return (
                          <div
                            key={ev.event_id}
                            className={`
                              rounded px-1 py-0.5 leading-tight truncate
                              text-[10px] font-medium border
                              ${colors.bg} ${colors.text} ${colors.border}
                            `}
                            title={ev.title}
                          >
                            {/* Show time only on lg+ to avoid overflow */}
                            <span className="hidden lg:inline">{formatTime(ev.start_time)} </span>
                            {ev.title}
                          </div>
                        )
                      })}
                      {dayEvents.length > 3 && (
                        <div className="text-[10px] text-tertiary font-medium pl-1">
                          +{dayEvents.length - 3}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Painel do dia selecionado ── */}
          {selectedDay && (
            <div className="bg-surface border border-neutral-light rounded-2xl shadow-sm overflow-hidden lg:self-start">
              {/* Cabeçalho */}
              <div className="px-4 py-3 border-b border-neutral-light flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-tertiary uppercase tracking-wider">
                    {WEEKDAYS_FULL[selectedDay.getDay()]}
                  </p>
                  <p className="text-base sm:text-lg font-bold text-primary">
                    {selectedDay.getDate()} de {MONTHS[selectedDay.getMonth()]}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedDay(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-[#BBBBBB] hover:text-secondary hover:bg-neutral-lighter transition"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Lista de eventos */}
              <div className="divide-y divide-[#F5F5F5] max-h-64 sm:max-h-96 lg:max-h-[calc(100vh-260px)] overflow-y-auto">
                {selectedDayEvents.length === 0 ? (
                  <div className="flex flex-col items-center py-10 gap-2">
                    <Calendar size={22} className="text-[#CCCCCC]" />
                    <p className="text-sm text-tertiary">Nenhum evento</p>
                  </div>
                ) : selectedDayEvents.map(ev => {
                  const platform = ev.meeting_platform ?? 'other'
                  const colors = PLATFORM_COLORS[platform]
                  return (
                    <div key={ev.event_id} className="px-4 py-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-primary leading-snug flex-1">
                          {ev.title}
                        </p>
                        {ev.meeting_url && (
                          <a
                            href={ev.meeting_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-tertiary hover:text-brand hover:bg-[#2D5A27]/10 transition"
                            title="Abrir reunião"
                          >
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-secondary">
                          {formatTime(ev.start_time)} – {formatTime(ev.end_time)}
                        </span>
                        {ev.meeting_platform && (
                          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}>
                            <Video size={9} />
                            {PLATFORM_LABELS[ev.meeting_platform] ?? ev.meeting_platform}
                          </span>
                        )}
                        {ev.bot_scheduled && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#2D5A27]/10 text-brand border border-[#2D5A27]/20">
                            🤖 Bot
                          </span>
                        )}
                        {ev.status === 'tentative' && (
                          <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 border border-amber-200 dark:border-amber-900/50">
                            Tentativo
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Legenda ── */}
        <div className="flex items-center gap-3 sm:gap-4 px-1 flex-wrap">
          {Object.entries(PLATFORM_LABELS).map(([key, label]) => {
            const colors = PLATFORM_COLORS[key]
            return (
              <div key={key} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-sm border ${colors.bg} ${colors.border}`} />
                <span className="text-xs text-tertiary">{label}</span>
              </div>
            )
          })}
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm bg-neutral-lighter border border-neutral-light" />
            <span className="text-xs text-tertiary">Sem link</span>
          </div>
        </div>

      </div>
    </MainLayout>
  )
}
