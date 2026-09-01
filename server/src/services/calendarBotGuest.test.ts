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

  it('devolve a lista COMPLETA para o PATCH, com a sala preservada', () => {
    // Regressão séria: o PATCH do Google troca a lista inteira de convidados.
    // Se devolvêssemos só as pessoas, convidar o bot CANCELARIA a sala
    // reservada da reunião.
    const sala = { email: 'sala1@resource.calendar.google.com', resource: true }
    const d = decideBotInvite({ organizer: org, attendees: [{ email: 'pietro@starbem.app' }, sala] }, BOT)
    expect(d.invite && d.attendees).toEqual([{ email: 'pietro@starbem.app' }, sala])
  })

  it('agenda pessoal em domínio público → NUNCA convida', () => {
    // Dado real (01/09): a agenda conectada é @gmail.com e os convidados de uma
    // reunião externa também. Sem esta regra, o bot entraria na frente de gente
    // de fora achando que era reunião interna.
    const d = decideBotInvite(
      {
        organizer: { email: 'pietrogoncalvesmedeiros@gmail.com', self: true },
        attendees: [
          { email: 'pietrogoncalvesmedeiros@gmail.com' },
          { email: 'alexandrelassancesoares@gmail.com' },
        ],
      },
      BOT,
    )
    expect(d).toEqual({ invite: false, reason: 'dominio_publico' })
  })

  it('evento sem convidados → convida (reunião interna sozinha)', () => {
    const d = decideBotInvite({ organizer: org, attendees: [] }, BOT)
    expect(d.invite).toBe(true)
  })
})
