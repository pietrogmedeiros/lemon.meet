import {
  janelaDiaAnterior,
  janelaSemanaAnterior,
  diaDaSemana,
  proximoDisparo,
} from './DailyDigestService.js'

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

describe('janelaSemanaAnterior (e-mail de segunda)', () => {
  it('na segunda 07/09 resume de 31/08 a 06/09', () => {
    const j = janelaSemanaAnterior(new Date('2026-09-07T10:47:00Z'))
    expect(j.ini).toBe('2026-08-31T03:00:00.000Z')
    expect(j.fim).toBe('2026-09-07T03:00:00.000Z')
    expect(j.label).toBe('31/08 a 06/09')
  })
})

describe('diaDaSemana (fuso de São Paulo, não do contêiner)', () => {
  it('segunda-feira às 07:47 local', () => {
    expect(diaDaSemana(new Date('2026-09-07T10:47:00Z'))).toBe(1)
  })
  it('sábado e domingo', () => {
    expect(diaDaSemana(new Date('2026-09-04T10:47:00Z'))).toBe(5) // sexta
    expect(diaDaSemana(new Date('2026-09-05T10:47:00Z'))).toBe(6) // sábado
    expect(diaDaSemana(new Date('2026-09-06T10:47:00Z'))).toBe(0) // domingo
  })
  it('01:00 UTC de segunda ainda é DOMINGO em São Paulo', () => {
    expect(diaDaSemana(new Date('2026-09-07T01:00:00Z'))).toBe(0)
  })
})

describe('proximoDisparo', () => {
  it('sábado à tarde → segunda, e marcado como semanal', () => {
    // 05/09 12:53 UTC = sábado 09:53 em São Paulo
    expect(proximoDisparo(new Date('2026-09-05T12:53:00Z'))).toBe(
      '2026-09-07 07:47 America/Sao_Paulo (semanal)',
    )
  })

  it('terça de manhã, antes do horário → hoje mesmo', () => {
    // 08/09 09:00 UTC = terça 06:00 em SP
    expect(proximoDisparo(new Date('2026-09-08T09:00:00Z'))).toBe(
      '2026-09-08 07:47 America/Sao_Paulo',
    )
  })

  it('terça depois da janela → quarta', () => {
    // 08/09 14:00 UTC = terça 11:00 em SP, janela já passou
    expect(proximoDisparo(new Date('2026-09-08T14:00:00Z'))).toBe(
      '2026-09-09 07:47 America/Sao_Paulo',
    )
  })

  it('sexta depois da janela pula o fim de semana', () => {
    // 04/09 14:00 UTC = sexta 11:00 em SP
    expect(proximoDisparo(new Date('2026-09-04T14:00:00Z'))).toBe(
      '2026-09-07 07:47 America/Sao_Paulo (semanal)',
    )
  })

  it('dentro da janela ainda conta como hoje', () => {
    // 08/09 10:50 UTC = terça 07:50 em SP (janela 07:47–07:51)
    expect(proximoDisparo(new Date('2026-09-08T10:50:00Z'))).toBe(
      '2026-09-08 07:47 America/Sao_Paulo',
    )
  })
})
