import {
  zonedWallClockToUtc,
  localDayRangeUtc,
  generateTimeSlots,
  doTimesOverlap,
  isBlockingEvent,
  eventBusyRange,
  membersFreeAt,
  pickAssignee,
  checkBookingWindow,
  bookingWindowFromConfig,
  selectAvailableSlots,
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

describe('checkBookingWindow', () => {
  // Config real de produção (starbem-comercial): 2h de antecedência, 30 dias.
  const JANELA = { minNoticeHours: 2, maxDaysAdvance: 30 }
  const AGORA = new Date('2026-08-27T18:00:00.000Z') // 15:00 BRT

  const emHoras = (h: number) => new Date(AGORA.getTime() + h * 60 * 60 * 1000)
  const emDias = (d: number) => new Date(AGORA.getTime() + d * 24 * 60 * 60 * 1000)

  it('aceita um slot bem depois da antecedência mínima', () => {
    expect(checkBookingWindow(emHoras(5), AGORA, JANELA)).toBeNull()
  })

  it('recusa um slot que está a menos de 2h', () => {
    // 16:00 BRT com 15:00 agora: aparece na tela hoje, mas viola o min_notice.
    expect(checkBookingWindow(emHoras(1), AGORA, JANELA)).toBe('too_soon')
  })

  it('recusa um slot no passado', () => {
    expect(checkBookingWindow(emHoras(-1), AGORA, JANELA)).toBe('too_soon')
  })

  it('aceita exatamente na fronteira da antecedência', () => {
    // A regra é "pelo menos 2h", então 2h cravadas passa.
    expect(checkBookingWindow(emHoras(2), AGORA, JANELA)).toBeNull()
  })

  it('recusa um minuto antes da fronteira', () => {
    expect(checkBookingWindow(new Date(emHoras(2).getTime() - 60000), AGORA, JANELA))
      .toBe('too_soon')
  })

  it('aceita exatamente no limite de dias no futuro', () => {
    expect(checkBookingWindow(emDias(30), AGORA, JANELA)).toBeNull()
  })

  it('recusa além do limite de dias', () => {
    expect(checkBookingWindow(emDias(31), AGORA, JANELA)).toBe('too_far')
  })

  it('sem antecedência configurada, aceita o horário seguinte', () => {
    const semNotice = { minNoticeHours: 0, maxDaysAdvance: 30 }
    expect(checkBookingWindow(emHoras(0.25), AGORA, semNotice)).toBeNull()
  })

  it('sem limite de dias configurado, aceita o futuro distante', () => {
    const semTeto = { minNoticeHours: 2, maxDaysAdvance: 0 }
    expect(checkBookingWindow(emDias(365), AGORA, semTeto)).toBeNull()
  })

  it('a janela é uma duração real, não hora de parede', () => {
    // O mesmo instante avaliado com o fuso do time em UTC-3 e em UTC+2 tem que
    // dar o mesmo veredito: comparar rótulo de horário reintroduziria o bug de
    // fuso de agosto.
    const slotSP = zonedWallClockToUtc('2026-08-27', '16:00', SP)          // 19:00Z
    const slotParis = zonedWallClockToUtc('2026-08-27', '21:00', 'Europe/Paris') // 19:00Z
    expect(slotSP.getTime()).toBe(slotParis.getTime())
    expect(checkBookingWindow(slotSP, AGORA, JANELA))
      .toBe(checkBookingWindow(slotParis, AGORA, JANELA))
  })
})

describe('bookingWindowFromConfig', () => {
  it('lê a config de produção', () => {
    expect(bookingWindowFromConfig({ min_notice_hours: 2, max_days_advance: 30 }))
      .toEqual({ minNoticeHours: 2, maxDaysAdvance: 30 })
  })

  it('tolera coluna nula sem virar NaN', () => {
    // `null * 3600000` é 0, mas `undefined` viraria NaN e toda comparação daria
    // false — a janela sumiria em silêncio em vez de falhar visível.
    expect(bookingWindowFromConfig({ min_notice_hours: null, max_days_advance: null }))
      .toEqual({ minNoticeHours: 0, maxDaysAdvance: 0 })
    expect(bookingWindowFromConfig({})).toEqual({ minNoticeHours: 0, maxDaysAdvance: 0 })
  })
})

describe('selectAvailableSlots', () => {
  // Formato real de produção (starbem-comercial): seg–sex 09:00–18:00, reunião
  // de 30min, buffers zerados, um único membro no rodízio.
  const DEIVE = '07147e88-bb65-4bfb-be29-1bef3e569df2'
  const GRADE = generateTimeSlots('09:00', '18:00', 30) // 09:00 … 17:30
  const JANELA = { minNoticeHours: 2, maxDaysAdvance: 30 }
  const DIA = '2026-08-28'

  const membroLivre = [{ userId: DEIVE, calendarUsable: true, events: [] }]
  const evento = (inicio: string, fim: string) => ({
    start: { dateTime: zonedWallClockToUtc(DIA, inicio, SP).toISOString() },
    end: { dateTime: zonedWallClockToUtc(DIA, fim, SP).toISOString() },
  })

  const rodar = (over: Partial<Parameters<typeof selectAvailableSlots>[0]> = {}) =>
    selectAvailableSlots({
      slotLabels: GRADE,
      date: DIA,
      timeZone: SP,
      durationMinutes: 30,
      now: zonedWallClockToUtc('2026-08-20', '09:00', SP), // bem antes: janela não morde
      window: JANELA,
      members: membroLivre,
      bookings: [],
      ...over,
    }).map(s => s.slot)

  it('agenda vazia devolve a grade inteira', () => {
    expect(rodar()).toHaveLength(18)
    expect(rodar()[0]).toBe('09:00')
    expect(rodar()[17]).toBe('17:30')
  })

  it('reproduz 28/08 em produção: um único horário livre, e ele é 13:30', () => {
    // O relato do usuário. A página fixa mostrava 7 horas cheias, nenhuma
    // reservável; o único slot real era 13:30, que ela nem exibia.
    const agendaCheia = [{
      userId: DEIVE,
      calendarUsable: true,
      events: [evento('09:00', '13:30'), evento('14:00', '18:00')],
    }]
    expect(rodar({ members: agendaCheia })).toEqual(['13:30'])
  })

  it('a antecedência mínima corta os horários cedo demais do dia de hoje', () => {
    // 12:00 BRT com min_notice de 2h: nada antes das 14:00 pode ser oferecido.
    const agora = zonedWallClockToUtc(DIA, '12:00', SP)
    const oferecidos = rodar({ now: agora })
    expect(oferecidos).not.toContain('13:30')
    expect(oferecidos[0]).toBe('14:00')
    expect(oferecidos).toHaveLength(8)
  })

  it('a fronteira de 2h é inclusiva e o minuto seguinte não é', () => {
    expect(rodar({ now: zonedWallClockToUtc(DIA, '11:30', SP) })).toContain('13:30')
    const umMinutoDepois = new Date(zonedWallClockToUtc(DIA, '11:30', SP).getTime() + 60000)
    expect(rodar({ now: umMinutoDepois })).not.toContain('13:30')
  })

  it('horário já passado não é oferecido', () => {
    expect(rodar({ now: zonedWallClockToUtc(DIA, '23:00', SP) })).toEqual([])
  })

  it('a janela é avaliada ANTES da agenda: livre mas cedo demais não aparece', () => {
    // Se a ordem invertesse, o slot passaria por estar livre na agenda.
    const oferecidos = rodar({ now: zonedWallClockToUtc(DIA, '09:15', SP), members: membroLivre })
    expect(oferecidos).not.toContain('10:00') // livre, mas a menos de 2h
    expect(oferecidos).toContain('11:30')
  })

  it('além do teto de dias, o dia inteiro some', () => {
    // 28/08 visto de 60 dias antes: dentro da agenda, fora da janela de 30 dias.
    const muitoAntes = zonedWallClockToUtc('2026-06-29', '09:00', SP)
    expect(rodar({ now: muitoAntes })).toEqual([])
  })

  it('membro sem calendário utilizável não gera horário (fail-closed)', () => {
    const semAgenda = [{ userId: DEIVE, calendarUsable: false, events: [] }]
    expect(rodar({ members: semAgenda })).toEqual([])
  })

  it('agendamento já existente na Lemon bloqueia o horário', () => {
    const bookings = [{
      assigned_to_user_id: DEIVE,
      scheduled_start: zonedWallClockToUtc(DIA, '10:00', SP).toISOString(),
      scheduled_end: zonedWallClockToUtc(DIA, '10:30', SP).toISOString(),
    }]
    expect(rodar({ bookings })).not.toContain('10:00')
    expect(rodar({ bookings })).toContain('10:30')
  })
})
