import {
  zonedWallClockToUtc,
  localDayRangeUtc,
  generateTimeSlots,
  doTimesOverlap,
  isBlockingEvent,
  eventBusyRange,
  membersFreeAt,
  pickAssignee,
  DEFAULT_TIME_ZONE,
} from './schedulingAvailability.js'

const SP = DEFAULT_TIME_ZONE // America/Sao_Paulo (UTC-3, sem DST desde 2019)

describe('zonedWallClockToUtc', () => {
  // O BUG: `new Date('2026-08-10T09:00:00')` num container UTC dava 09:00Z,
  // que é 06:00 em Brasília. Slots apareciam 3h antes do configurado.
  it('converte 09:00 em São Paulo para 12:00 UTC', () => {
    expect(zonedWallClockToUtc('2026-08-10', '09:00', SP).toISOString())
      .toBe('2026-08-10T12:00:00.000Z')
  })

  it('converte meia-noite local', () => {
    expect(zonedWallClockToUtc('2026-08-10', '00:00', SP).toISOString())
      .toBe('2026-08-10T03:00:00.000Z')
  })

  it('é identidade em UTC', () => {
    expect(zonedWallClockToUtc('2026-08-10', '09:00', 'UTC').toISOString())
      .toBe('2026-08-10T09:00:00.000Z')
  })

  it('respeita horário de verão em fuso que o pratica', () => {
    // Nova York: EST (-5) em janeiro, EDT (-4) em julho.
    expect(zonedWallClockToUtc('2026-01-15', '09:00', 'America/New_York').toISOString())
      .toBe('2026-01-15T14:00:00.000Z')
    expect(zonedWallClockToUtc('2026-07-15', '09:00', 'America/New_York').toISOString())
      .toBe('2026-07-15T13:00:00.000Z')
  })

  it('funciona em fuso a leste de Greenwich', () => {
    expect(zonedWallClockToUtc('2026-08-10', '09:00', 'Europe/Paris').toISOString())
      .toBe('2026-08-10T07:00:00.000Z')
  })
})

describe('localDayRangeUtc', () => {
  // O BUG: a janela do Google era T00:00:00Z–T23:59:59Z, que para UTC-3 pega
  // 21:00 do dia anterior e perde as 3 últimas horas do dia pedido.
  it('cobre o dia local inteiro, não o dia UTC', () => {
    const { startUtc, endUtc } = localDayRangeUtc('2026-08-10', SP)
    expect(startUtc.toISOString()).toBe('2026-08-10T03:00:00.000Z')
    expect(endUtc.toISOString()).toBe('2026-08-11T03:00:00.000Z')
  })

  it('inclui um evento às 21:30 local, que a janela UTC antiga perdia', () => {
    const { startUtc, endUtc } = localDayRangeUtc('2026-08-10', SP)
    const evento = new Date('2026-08-11T00:30:00.000Z') // 21:30 BRT do dia 10
    expect(evento >= startUtc && evento < endUtc).toBe(true)
  })
})

describe('generateTimeSlots', () => {
  it('gera slots dentro da janela', () => {
    expect(generateTimeSlots('09:00', '11:00', 60)).toEqual(['09:00', '10:00'])
  })

  it('não gera slot que ultrapassa o fim', () => {
    expect(generateTimeSlots('09:00', '10:30', 60)).toEqual(['09:00'])
  })

  it('devolve vazio com intervalo inválido em vez de travar', () => {
    expect(generateTimeSlots('09:00', '18:00', 0)).toEqual([])
  })
})

describe('doTimesOverlap', () => {
  const d = (s: string) => new Date(s)

  it('detecta sobreposição parcial', () => {
    expect(doTimesOverlap(d('2026-08-10T09:00Z'), d('2026-08-10T10:00Z'),
                          d('2026-08-10T09:30Z'), d('2026-08-10T10:30Z'))).toBe(true)
  })

  it('reuniões encostadas NÃO se sobrepõem', () => {
    expect(doTimesOverlap(d('2026-08-10T09:00Z'), d('2026-08-10T10:00Z'),
                          d('2026-08-10T10:00Z'), d('2026-08-10T11:00Z'))).toBe(false)
  })
})

describe('isBlockingEvent', () => {
  const base = { start: { dateTime: '2026-08-10T12:00:00Z' }, end: { dateTime: '2026-08-10T13:00:00Z' } }

  it('evento normal bloqueia', () => {
    expect(isBlockingEvent(base)).toBe(true)
  })

  it('evento marcado como "Livre" NÃO bloqueia', () => {
    expect(isBlockingEvent({ ...base, transparency: 'transparent' })).toBe(false)
  })

  it('evento cancelado NÃO bloqueia', () => {
    expect(isBlockingEvent({ ...base, status: 'cancelled' })).toBe(false)
  })

  it('convite que o dono recusou NÃO bloqueia', () => {
    expect(isBlockingEvent({ ...base, attendees: [{ self: true, responseStatus: 'declined' }] })).toBe(false)
  })

  it('convite recusado por OUTRA pessoa continua bloqueando', () => {
    expect(isBlockingEvent({ ...base, attendees: [{ self: false, responseStatus: 'declined' }] })).toBe(true)
  })
})

describe('eventBusyRange — dia inteiro', () => {
  it('cobre o dia local, não meia-noite UTC', () => {
    const busy = eventBusyRange({ start: { date: '2026-08-10' }, end: { date: '2026-08-11' } }, SP)
    expect(busy!.start.toISOString()).toBe('2026-08-10T03:00:00.000Z')
    expect(busy!.end.toISOString()).toBe('2026-08-11T03:00:00.000Z')
  })

  it('férias de dia inteiro bloqueiam um slot das 09:00 locais', () => {
    const ferias = eventBusyRange({ start: { date: '2026-08-10' }, end: { date: '2026-08-11' } }, SP)!
    const slotStart = zonedWallClockToUtc('2026-08-10', '09:00', SP)
    const slotEnd = zonedWallClockToUtc('2026-08-10', '10:00', SP)
    expect(doTimesOverlap(slotStart, slotEnd, ferias.start, ferias.end)).toBe(true)
  })
})

describe('membersFreeAt', () => {
  const slotStart = zonedWallClockToUtc('2026-08-10', '09:00', SP)
  const slotEnd = zonedWallClockToUtc('2026-08-10', '10:00', SP)

  it('membro sem calendário utilizável é INDISPONÍVEL (fail-closed)', () => {
    const membros = [{ userId: 'sem-calendario', calendarUsable: false, events: [] }]
    expect(membersFreeAt(membros, slotStart, slotEnd, [], SP)).toEqual([])
  })

  it('membro com agenda vazia está livre', () => {
    const membros = [{ userId: 'ana', calendarUsable: true, events: [] }]
    expect(membersFreeAt(membros, slotStart, slotEnd, [], SP)).toEqual(['ana'])
  })

  it('evento no mesmo horário derruba o membro', () => {
    const membros = [{
      userId: 'ana',
      calendarUsable: true,
      // 09:30–10:30 BRT
      events: [{ start: { dateTime: '2026-08-10T12:30:00-00:00' }, end: { dateTime: '2026-08-10T13:30:00-00:00' } }],
    }]
    expect(membersFreeAt(membros, slotStart, slotEnd, [], SP)).toEqual([])
  })

  it('reserva já existente no sistema derruba o membro', () => {
    const membros = [{ userId: 'ana', calendarUsable: true, events: [] }]
    const bookings = [{
      assigned_to_user_id: 'ana',
      scheduled_start: '2026-08-10T12:00:00.000Z',
      scheduled_end: '2026-08-10T13:00:00.000Z',
    }]
    expect(membersFreeAt(membros, slotStart, slotEnd, bookings, SP)).toEqual([])
  })

  it('reserva de OUTRO membro não afeta', () => {
    const membros = [{ userId: 'ana', calendarUsable: true, events: [] }]
    const bookings = [{
      assigned_to_user_id: 'bruno',
      scheduled_start: '2026-08-10T12:00:00.000Z',
      scheduled_end: '2026-08-10T13:00:00.000Z',
    }]
    expect(membersFreeAt(membros, slotStart, slotEnd, bookings, SP)).toEqual(['ana'])
  })

  it('evento "Livre" não derruba o membro', () => {
    const membros = [{
      userId: 'ana',
      calendarUsable: true,
      events: [{
        transparency: 'transparent',
        start: { dateTime: '2026-08-10T12:00:00Z' },
        end: { dateTime: '2026-08-10T13:00:00Z' },
      }],
    }]
    expect(membersFreeAt(membros, slotStart, slotEnd, [], SP)).toEqual(['ana'])
  })
})

describe('pickAssignee', () => {
  const membros = [{ user_id: 'ana' }, { user_id: 'bruno' }, { user_id: 'caio' }]

  // O BUG: a reserva usava members[rotationIndex % n] sem olhar agenda — o slot
  // aparecia porque a Ana estava livre e o convite caía no Bruno, ocupado.
  it('pula quem está ocupado em vez de atribuir cegamente', () => {
    expect(pickAssignee(membros, ['caio'], 0)?.user_id).toBe('caio')
  })

  it('respeita a rotação quando há mais de um livre', () => {
    expect(pickAssignee(membros, ['ana', 'bruno'], 1)?.user_id).toBe('bruno')
  })

  it('dá a volta na lista a partir do índice', () => {
    expect(pickAssignee(membros, ['ana'], 2)?.user_id).toBe('ana')
  })

  it('devolve null quando ninguém está livre', () => {
    expect(pickAssignee(membros, [], 0)).toBeNull()
  })

  it('tolera índice maior que a lista', () => {
    expect(pickAssignee(membros, ['ana', 'bruno', 'caio'], 7)?.user_id).toBe('bruno')
  })

  it('não quebra sem membros', () => {
    expect(pickAssignee([], [], 0)).toBeNull()
  })
})
