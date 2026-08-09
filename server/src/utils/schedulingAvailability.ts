// ============================================================
// schedulingAvailability.ts — regras puras de disponibilidade do round-robin
//
// Extraído de scheduling.routes.ts pra ser testável sem rede. Cada função aqui
// existe por causa de um defeito real diagnosticado em 2026-08-09 (ver
// PLANO-ROUND-ROBIN-AGENDAS.md na raiz):
//
//   1. FUSO (causa raiz): `new Date(\`${date}T09:00:00\`)` sem sufixo é
//      interpretado no fuso do PROCESSO. O container roda em UTC, então o
//      working_hours 09:00–18:00 que o time configurou pensando em Brasília
//      virava 09:00–18:00 UTC = 06:00–15:00 BRT, enquanto os eventos do Google
//      chegam com offset real. Grade e compromissos ficavam 3h deslocados.
//   2. A janela de busca no Google era UTC, não o dia local.
//   5. Eventos marcados "Livre" (transparent) e convites recusados bloqueavam.
//
// Sem lib de data no projeto: a conversão usa Intl, que carrega o tzdata do
// próprio runtime e trata horário de verão corretamente.
// ============================================================

/** Fuso assumido quando a config do time não define um. */
export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo'

export interface DayHours { enabled: boolean; start: string; end: string }

/**
 * Horário comercial padrão (seg–sex, 09:00–18:00 no fuso do time).
 *
 * Usado só quando o time NUNCA definiu horário. Sem isso, `working_hours = {}`
 * faz o endpoint devolver zero slot em toda data — e a tela de config hoje nem
 * envia esse campo, então a config nascia vazia e a página pública ficava
 * permanentemente sem horários.
 */
export const DEFAULT_WORKING_HOURS: Record<string, DayHours> = {
  sunday:    { enabled: false, start: '09:00', end: '18:00' },
  monday:    { enabled: true,  start: '09:00', end: '18:00' },
  tuesday:   { enabled: true,  start: '09:00', end: '18:00' },
  wednesday: { enabled: true,  start: '09:00', end: '18:00' },
  thursday:  { enabled: true,  start: '09:00', end: '18:00' },
  friday:    { enabled: true,  start: '09:00', end: '18:00' },
  saturday:  { enabled: false, start: '09:00', end: '18:00' },
}

/**
 * Offset (em minutos) de `timeZone` no instante `utcDate`.
 * Positivo a leste de Greenwich. Ex.: America/Sao_Paulo → -180.
 */
function zoneOffsetMinutes(utcDate: Date, timeZone: string): number {
  // 'en-CA' dá YYYY-MM-DD; com hour12:false o relógio local do fuso é montado
  // sem ambiguidade e comparado com o mesmo instante em UTC.
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = Object.fromEntries(dtf.formatToParts(utcDate).map(p => [p.type, p.value]))
  // hour '24' aparece em algumas implementações para meia-noite.
  const hour = parts.hour === '24' ? '00' : parts.hour
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(hour), Number(parts.minute), Number(parts.second),
  )
  return (asUtc - utcDate.getTime()) / 60000
}

/**
 * Converte uma data/hora de parede ("2026-08-10", "09:00") no fuso informado
 * para o instante UTC correspondente.
 *
 * O offset depende do próprio instante (horário de verão), então resolvemos em
 * dois passos: estima com o offset do palpite e recalcula com o offset do
 * resultado. Isso acerta inclusive nos dias de virada de DST.
 */
export function zonedWallClockToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, 0)

  const firstGuess = new Date(naiveUtc - zoneOffsetMinutes(new Date(naiveUtc), timeZone) * 60000)
  const corrected = new Date(naiveUtc - zoneOffsetMinutes(firstGuess, timeZone) * 60000)
  return corrected
}

/** Início (inclusivo) e fim (exclusivo) do dia local, em UTC. */
export function localDayRangeUtc(date: string, timeZone: string): { startUtc: Date; endUtc: Date } {
  const startUtc = zonedWallClockToUtc(date, '00:00', timeZone)
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000)
  return { startUtc, endUtc }
}

/** Rótulos HH:MM entre start e end, de `intervalMinutes` em `intervalMinutes`. */
export function generateTimeSlots(start: string, end: string, intervalMinutes: number): string[] {
  if (intervalMinutes <= 0) return []
  const slots: string[] = []
  const [startHour, startMin] = start.split(':').map(Number)
  const [endHour, endMin] = end.split(':').map(Number)

  let currentMinutes = startHour * 60 + startMin
  const endMinutes = endHour * 60 + endMin

  while (currentMinutes + intervalMinutes <= endMinutes) {
    const h = Math.floor(currentMinutes / 60)
    const m = currentMinutes % 60
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    currentMinutes += intervalMinutes
  }
  return slots
}

/** Sobreposição de intervalos meio-abertos [start, end). */
export function doTimesOverlap(start1: Date, end1: Date, start2: Date, end2: Date): boolean {
  return start1 < end2 && start2 < end1
}

export interface CalendarEventLike {
  status?: string | null
  transparency?: string | null
  start?: { dateTime?: string | null; date?: string | null } | null
  end?: { dateTime?: string | null; date?: string | null } | null
  attendees?: Array<{ self?: boolean; responseStatus?: string | null }> | null
}

/**
 * O evento realmente ocupa a agenda?
 *
 * Ignora: cancelado, marcado como "Livre" (transparency=transparent) e convite
 * que o próprio dono recusou — os três apareciam como ocupado e derrubavam
 * horários que estavam livres de fato.
 */
export function isBlockingEvent(event: CalendarEventLike): boolean {
  if (!event?.start || !event?.end) return false
  if (event.status === 'cancelled') return false
  if (event.transparency === 'transparent') return false

  const self = event.attendees?.find(a => a.self)
  if (self?.responseStatus === 'declined') return false

  return true
}

/**
 * Intervalo UTC ocupado pelo evento, ou null se ele não bloqueia.
 * Evento de dia inteiro (`date` em vez de `dateTime`) cobre o dia LOCAL inteiro
 * — tratá-lo como meia-noite UTC erraria por horas.
 */
export function eventBusyRange(event: CalendarEventLike, timeZone: string): { start: Date; end: Date } | null {
  if (!isBlockingEvent(event)) return null

  const rawStart = event.start!.dateTime ?? event.start!.date
  const rawEnd = event.end!.dateTime ?? event.end!.date
  if (!rawStart || !rawEnd) return null

  // dateTime vem com offset explícito → Date parseia certo.
  if (event.start!.dateTime && event.end!.dateTime) {
    return { start: new Date(rawStart), end: new Date(rawEnd) }
  }

  // All-day: `end.date` é exclusivo no Google (termina na virada do dia local).
  return {
    start: zonedWallClockToUtc(rawStart, '00:00', timeZone),
    end: zonedWallClockToUtc(rawEnd, '00:00', timeZone),
  }
}

export interface BookingLike {
  assigned_to_user_id: string
  scheduled_start: string
  scheduled_end: string
}

export interface MemberAvailabilityInput {
  userId: string
  /** false quando não há calendário conectado ou a API do Google falhou. */
  calendarUsable: boolean
  events: CalendarEventLike[]
}

/**
 * Quais membros estão livres no intervalo.
 *
 * ⚠️ FAIL-CLOSED: membro sem calendário utilizável é considerado INDISPONÍVEL.
 * Antes o código setava `events = []` nesse caso — o que significa "nenhum
 * compromisso", ou seja, livre o dia inteiro. O comentário no código dizia
 * justamente o contrário do que ele fazia.
 */
export function membersFreeAt(
  members: MemberAvailabilityInput[],
  slotStart: Date,
  slotEnd: Date,
  bookings: BookingLike[],
  timeZone: string,
): string[] {
  return members
    .filter(member => {
      if (!member.calendarUsable) return false

      const hasBooking = bookings.some(b =>
        b.assigned_to_user_id === member.userId &&
        doTimesOverlap(slotStart, slotEnd, new Date(b.scheduled_start), new Date(b.scheduled_end)),
      )
      if (hasBooking) return false

      return !member.events.some(ev => {
        const busy = eventBusyRange(ev, timeZone)
        return busy !== null && doTimesOverlap(slotStart, slotEnd, busy.start, busy.end)
      })
    })
    .map(m => m.userId)
}

/**
 * Escolhe quem atende, entre os elegíveis, respeitando o rodízio.
 *
 * Antes a reserva fazia `members[current_rotation_index % members.length]` sem
 * olhar agenda: o horário aparecia porque a Ana estava livre e o convite caía
 * para o Bruno, ocupado. Aqui a rotação continua sendo a ordem de preferência,
 * mas só entre quem está realmente livre.
 */
export function pickAssignee<T extends { user_id: string }>(
  membersInRotationOrder: T[],
  freeUserIds: string[],
  rotationIndex: number,
): T | null {
  if (membersInRotationOrder.length === 0) return null
  const free = new Set(freeUserIds)
  const n = membersInRotationOrder.length
  const start = ((rotationIndex % n) + n) % n // tolera índice negativo

  for (let i = 0; i < n; i++) {
    const candidate = membersInRotationOrder[(start + i) % n]
    if (free.has(candidate.user_id)) return candidate
  }
  return null
}
