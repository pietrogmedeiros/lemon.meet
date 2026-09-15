import { janelaDoMes, minutosDaReuniao } from './admin-billing.routes.js'

describe('janelaDoMes — o mês de cobrança é o de Brasília, não o UTC', () => {
  it('setembro/2026 começa 03:00 UTC do dia 1 e termina 03:00 UTC do dia 1 de outubro', () => {
    // ⚠️ É AQUI que uma fatura fecha errada: reunião das 22h do dia 30 acontece
    // à 01h UTC do dia 1º. Fechando o mês em UTC puro, ela migraria para o mês
    // seguinte e o cliente receberia uma cobrança que não bate com a agenda dele.
    expect(janelaDoMes('2026-09')).toEqual({
      inicio: '2026-09-01T03:00:00.000Z',
      fim: '2026-10-01T03:00:00.000Z',
    })
  })

  it('dezembro vira o ano corretamente', () => {
    expect(janelaDoMes('2026-12')).toEqual({
      inicio: '2026-12-01T03:00:00.000Z',
      fim: '2027-01-01T03:00:00.000Z',
    })
  })

  it('recusa formato inválido em vez de faturar um período errado', () => {
    expect(janelaDoMes('2026-13')).toBeNull()
    expect(janelaDoMes('2026-00')).toBeNull()
    expect(janelaDoMes('setembro')).toBeNull()
    expect(janelaDoMes('2026-9')).toBeNull()
    expect(janelaDoMes('')).toBeNull()
  })

  it('uma reunião das 22h do último dia pertence ao mês que terminou', () => {
    const j = janelaDoMes('2026-09')!
    const reuniao22hDia30 = new Date('2026-10-01T01:00:00.000Z').toISOString() // 22h BRT de 30/09
    expect(reuniao22hDia30 >= j.inicio).toBe(true)
    expect(reuniao22hDia30 < j.fim).toBe(true)
  })
})

describe('minutosDaReuniao', () => {
  it('calcula pela diferença, porque duration_seconds está sempre nulo', () => {
    expect(minutosDaReuniao('2026-09-14T13:30:00Z', '2026-09-14T14:08:00Z')).toBe(38)
  })

  it('devolve null quando falta ended_at — o relatório marca como incompleto', () => {
    expect(minutosDaReuniao('2026-09-14T13:30:00Z', null)).toBeNull()
    expect(minutosDaReuniao(null, '2026-09-14T14:00:00Z')).toBeNull()
  })

  it('ignora duração negativa ou zero em vez de somar lixo na fatura', () => {
    expect(minutosDaReuniao('2026-09-14T14:00:00Z', '2026-09-14T13:00:00Z')).toBeNull()
    expect(minutosDaReuniao('2026-09-14T14:00:00Z', '2026-09-14T14:00:00Z')).toBeNull()
  })
})
