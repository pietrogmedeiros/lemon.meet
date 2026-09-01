import { decideBotInvite } from './calendarBotGuest.js'

const BOT = 'contato@lemon-meet.com'
const org = { email: 'pietro@starbem.app', self: true }

describe('decideBotInvite', () => {
  it('evento interno da própria conta → convida', () => {
    const d = decideBotInvite(
      { organizer: org, attendees: [{ email: 'pietro@starbem.app' }, { email: 'deive@starbem.app' }] },
      BOT,
    )
    expect(d.invite).toBe(true)
  })

  it('convidado de fora do domínio → não mexe na agenda', () => {
    const d = decideBotInvite(
      { organizer: org, attendees: [{ email: 'pietro@starbem.app' }, { email: 'cliente@viaveneto.com' }] },
      BOT,
    )
    expect(d).toEqual({ invite: false, reason: 'tem_externo' })
  })

  it('evento organizado por outra pessoa → não mexe', () => {
    const d = decideBotInvite(
      { organizer: { email: 'cliente@outra.com', self: false }, attendees: [{ email: 'pietro@starbem.app' }] },
      BOT,
    )
    expect(d).toEqual({ invite: false, reason: 'nao_organizador' })
  })

  it('bot já convidado → não repete', () => {
    const d = decideBotInvite(
      { organizer: org, attendees: [{ email: 'pietro@starbem.app' }, { email: BOT }] },
      BOT,
    )
    expect(d).toEqual({ invite: false, reason: 'ja_convidado' })
  })

  it('o próprio bot no evento não conta como externo', () => {
    // Regressão: o domínio do bot (lemon-meet.com) é diferente do da empresa;
    // se ele fosse avaliado como convidado, todo evento já convidado viraria
    // "tem_externo" e a regra nunca mais convidaria ninguém.
    const d = decideBotInvite({ organizer: org, attendees: [{ email: BOT }] }, BOT)
    expect(d).toEqual({ invite: false, reason: 'ja_convidado' })
  })

  it('sala de reunião (resource) não conta como convidado externo', () => {
    const d = decideBotInvite(
      {
        organizer: org,
        attendees: [{ email: 'pietro@starbem.app' }, { email: 'sala1@resource.calendar.google.com', resource: true }],
      },
      BOT,
    )
    expect(d.invite).toBe(true)
  })

  it('evento sem convidados → convida (reunião interna sozinha)', () => {
    const d = decideBotInvite({ organizer: org, attendees: [] }, BOT)
    expect(d.invite).toBe(true)
  })
})
