import { janelaDiaAnterior } from './DailyDigestService.js'

describe('janelaDiaAnterior', () => {
  it('às 07:47 de 04/09 (São Paulo) resume o dia 03/09 inteiro', () => {
    // 04/09 07:47 -03 = 10:47 UTC
    const j = janelaDiaAnterior(new Date('2026-09-04T10:47:00Z'))
    expect(j.ini).toBe('2026-09-03T03:00:00.000Z') // 03/09 00:00 -03
    expect(j.fim).toBe('2026-09-04T03:00:00.000Z') // 04/09 00:00 -03
    expect(j.label).toBe('03/09')
  })

  it('vira o mês corretamente', () => {
    const j = janelaDiaAnterior(new Date('2026-10-01T10:47:00Z'))
    expect(j.ini).toBe('2026-09-30T03:00:00.000Z')
    expect(j.label).toBe('30/09')
  })

  it('não usa o fuso do contêiner: madrugada UTC ainda é o dia anterior de SP', () => {
    // 04/09 01:00 UTC = 03/09 22:00 em São Paulo → dia anterior é 02/09
    const j = janelaDiaAnterior(new Date('2026-09-04T01:00:00Z'))
    expect(j.label).toBe('02/09')
  })
})
