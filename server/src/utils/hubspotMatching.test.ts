import { orderParticipantEmails, isInternalEmail, chooseDealId, type DealCandidate } from './hubspotMatching.js'

describe('orderParticipantEmails', () => {
  // Incidente real 06/08/2026: reunião "Apresentação NR1 Starbem - Construtora Uni".
  // O loop parava no Adriano (vendedor) e gravava no deal DELE, "Inspirali <> Starbem".
  it('coloca a cliente externa antes dos vendedores da casa', () => {
    const participantes = [
      'adriano.palombo@starbem.app',
      'maicon.vilian@starbem.app',
      'mayra.poleto@somosauni.com.br',
    ]
    expect(orderParticipantEmails(participantes, 'adriano.palombo@starbem.app')).toEqual([
      'mayra.poleto@somosauni.com.br',
      'adriano.palombo@starbem.app',
      'maicon.vilian@starbem.app',
    ])
  })

  it('mantém internos como fallback em reunião 100% interna', () => {
    const participantes = ['adriano.palombo@starbem.app', 'maicon.vilian@starbem.app']
    expect(orderParticipantEmails(participantes, 'adriano.palombo@starbem.app')).toEqual(participantes)
  })

  it('preserva a ordem original quando não dá pra saber o domínio interno', () => {
    const participantes = ['b@x.com', 'a@y.com']
    expect(orderParticipantEmails(participantes, null)).toEqual(participantes)
    expect(orderParticipantEmails(participantes, 'sem-arroba')).toEqual(participantes)
  })

  it('ignora diferença de caixa no domínio', () => {
    const participantes = ['VENDEDOR@Starbem.app', 'cliente@empresa.com']
    expect(orderParticipantEmails(participantes, 'outro@starbem.APP')).toEqual([
      'cliente@empresa.com',
      'VENDEDOR@Starbem.app',
    ])
  })

  it('não confunde domínio que apenas termina igual', () => {
    // "naostarbem.app" NÃO é interno de "starbem.app"
    expect(isInternalEmail('alguem@naostarbem.app', 'eu@starbem.app')).toBe(false)
    expect(isInternalEmail('alguem@starbem.app', 'eu@starbem.app')).toBe(true)
  })
})

describe('chooseDealId', () => {
  const deal = (id: string, closed: boolean, createdate: string): DealCandidate => ({
    id,
    properties: { hs_is_closed: closed ? 'true' : 'false', createdate },
  })

  // Incidente real 06/08/2026 (SAKATA): escrevia no closedlost de 2025.
  it('ignora deal fechado mesmo sendo o primeiro da lista', () => {
    const deals = [
      deal('45681892641', true, '2025-10-10T15:17:20.087Z'),   // closedlost
      deal('63260706921', false, '2026-07-29T20:20:57.246Z'),  // ativo
    ]
    expect(chooseDealId(deals)).toBe('63260706921')
  })

  it('entre abertos, escolhe o de criação mais recente', () => {
    const deals = [
      deal('antigo', false, '2026-01-01T00:00:00Z'),
      deal('novo', false, '2026-07-29T00:00:00Z'),
      deal('meio', false, '2026-03-01T00:00:00Z'),
    ]
    expect(chooseDealId(deals)).toBe('novo')
  })

  it('devolve null quando todos estão fechados (caller cria deal novo)', () => {
    const deals = [
      deal('a', true, '2025-10-10T00:00:00Z'),
      deal('b', true, '2026-02-02T00:00:00Z'),
    ]
    expect(chooseDealId(deals)).toBeNull()
  })

  it('devolve null sem candidatos', () => {
    expect(chooseDealId([])).toBeNull()
  })

  it('não quebra com createdate ausente', () => {
    const deals: DealCandidate[] = [
      { id: 'sem-data', properties: { hs_is_closed: 'false' } },
      { id: 'com-data', properties: { hs_is_closed: 'false', createdate: '2026-07-01T00:00:00Z' } },
    ]
    expect(chooseDealId(deals)).toBe('com-data')
  })
})
