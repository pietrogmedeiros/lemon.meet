import { fracaoCobrada, acessoDesdeMaisTarde, janelaDoMes } from './admin-billing.routes.js'

const NOVEMBRO = janelaDoMes('2026-11')!   // 30 dias
const OUTUBRO = janelaDoMes('2026-10')!    // 31 dias
const FEVEREIRO = janelaDoMes('2026-02')!  // 28 dias

describe('fracaoCobrada — quem entra no meio do mês paga só a parte dele', () => {
  it('quem já estava antes do mês paga o mês inteiro', () => {
    expect(fracaoCobrada('2026-05-12T16:50:00Z', NOVEMBRO)).toEqual({ dias: 30, diasDoMes: 30, fracao: 1 })
  })

  it('sem data de acesso, assume mês inteiro (não presenteia o mês)', () => {
    expect(fracaoCobrada(null, OUTUBRO)).toEqual({ dias: 31, diasDoMes: 31, fracao: 1 })
  })

  it('entrou no dia 10 de um mês de 30: 21 dias, o dia da entrada conta inteiro', () => {
    const r = fracaoCobrada('2026-11-10T13:08:00Z', NOVEMBRO)
    expect(r.dias).toBe(21)
    expect(r.diasDoMes).toBe(30)
    expect(r.fracao).toBeCloseTo(21 / 30, 10)
  })

  it('entrou no primeiro dia do mês paga tudo', () => {
    expect(fracaoCobrada('2026-11-01T12:00:00Z', NOVEMBRO).fracao).toBe(1)
  })

  it('entrou no último dia paga 1 dia', () => {
    expect(fracaoCobrada('2026-11-30T23:00:00Z', NOVEMBRO).dias).toBe(1)
  })

  it('entrou depois do mês fechar: zero, não entra na fatura daquele mês', () => {
    const r = fracaoCobrada('2026-12-02T10:00:00Z', NOVEMBRO)
    expect(r).toEqual({ dias: 0, diasDoMes: 30, fracao: 0 })
  })

  it('fevereiro tem 28 avos, não 30', () => {
    expect(fracaoCobrada('2026-02-15T12:00:00Z', FEVEREIRO)).toEqual({ dias: 14, diasDoMes: 28, fracao: 14 / 28 })
  })

  it('a virada do dia é a de Brasília, não a do UTC', () => {
    // 01/11 00:30 BRT = 03:30 UTC → dia 1º, mês inteiro.
    expect(fracaoCobrada('2026-11-01T03:30:00Z', NOVEMBRO).dias).toBe(30)
    // 31/10 22h BRT = 01:00 UTC do dia 1º: ainda é OUTUBRO, então em novembro
    // ele já estava dentro — mês inteiro.
    expect(fracaoCobrada('2026-11-01T01:00:00Z', NOVEMBRO).dias).toBe(30)
    // E no mês de outubro esse mesmo instante é o dia 31: 1 dia cobrado.
    expect(fracaoCobrada('2026-11-01T01:00:00Z', OUTUBRO).dias).toBe(1)
  })
})

describe('acessoDesdeMaisTarde — acesso começa quando a conta E o time existem', () => {
  it('fica com a data mais tarde', () => {
    // Débora: conta em 21/08, entrou no time em 01/09 → cobra de 01/09.
    expect(acessoDesdeMaisTarde('2026-08-21T12:39:09Z', '2026-09-01T15:02:40Z')).toBe('2026-09-01T15:02:40Z')
    expect(acessoDesdeMaisTarde('2026-09-01T15:02:40Z', '2026-08-21T12:39:09Z')).toBe('2026-09-01T15:02:40Z')
  })

  it('aceita faltar uma das duas', () => {
    expect(acessoDesdeMaisTarde(null, '2026-09-01T15:02:40Z')).toBe('2026-09-01T15:02:40Z')
    expect(acessoDesdeMaisTarde('2026-09-01T15:02:40Z', null)).toBe('2026-09-01T15:02:40Z')
    expect(acessoDesdeMaisTarde(null, null)).toBeNull()
  })
})
