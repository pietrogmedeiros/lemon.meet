import {
  janelaDoDiaBrt,
  deveAlertar,
  corpoDoAlerta,
  type EstadoAlerta,
} from './skribbyFailureWatch.js'

describe('janelaDoDiaBrt — o dia é o de Brasília', () => {
  it('às 22h de BRT ainda é o mesmo dia, não o seguinte', () => {
    // ⚠️ 01h UTC do dia 24 é 22h BRT do dia 23. Em UTC puro a reunião cairia no
    // dia seguinte e o alerta contaria as falhas em dois baldes separados,
    // nunca cruzando o limiar.
    const j = janelaDoDiaBrt(new Date('2026-09-24T01:00:00Z'))
    expect(j.dia).toBe('2026-09-23')
    expect(j.inicio).toBe('2026-09-23T03:00:00.000Z')
    expect(j.fim).toBe('2026-09-24T03:00:00.000Z')
  })

  it('às 00h30 BRT já virou o dia', () => {
    expect(janelaDoDiaBrt(new Date('2026-09-24T03:30:00Z')).dia).toBe('2026-09-24')
  })
})

describe('deveAlertar', () => {
  const dia = '2026-09-23'
  const agora = Date.parse('2026-09-23T20:00:00Z')

  it('não incomoda abaixo do limiar', () => {
    expect(deveAlertar(1, 2, null, dia, agora)).toBe(false)
    expect(deveAlertar(0, 2, null, dia, agora)).toBe(false)
  })

  it('alerta na primeira vez que cruza o limiar', () => {
    // O caso real de 23/09: duas reuniões perdidas depois que os rótulos
    // assentaram. Com limiar 3 este alerta nunca teria existido.
    expect(deveAlertar(2, 2, null, dia, agora)).toBe(true)
  })

  it('não repete enquanto a contagem não cresce', () => {
    const estado: EstadoAlerta = { dia, contagemAlertada: 2, ultimoEnvioMs: agora }
    expect(deveAlertar(2, 2, estado, dia, agora + 5 * 60 * 60 * 1000)).toBe(false)
  })

  it('avisa de novo quando o incidente piora, mas só depois do throttle', () => {
    const estado: EstadoAlerta = { dia, contagemAlertada: 2, ultimoEnvioMs: agora }
    expect(deveAlertar(5, 2, estado, dia, agora + 30 * 60 * 1000)).toBe(false)
    expect(deveAlertar(5, 2, estado, dia, agora + 3 * 60 * 60 * 1000)).toBe(true)
  })

  it('o estado de ontem não cala o alerta de hoje', () => {
    const ontem: EstadoAlerta = { dia: '2026-09-22', contagemAlertada: 9, ultimoEnvioMs: agora }
    expect(deveAlertar(2, 2, ontem, dia, agora + 60 * 1000)).toBe(true)
  })
})

describe('corpoDoAlerta', () => {
  it('mostra a hora em Brasília e o link da reunião', () => {
    const texto = corpoDoAlerta(
      [{ id: 'abc-123', title: 'Starbem <> DPSP', started_at: '2026-09-23T13:00:00Z' }],
      5,
    )
    expect(texto).toContain('10:00  Starbem <> DPSP')
    expect(texto).toContain('https://lemon-meet.web.app/meetings/abc-123')
    expect(texto).toContain('5 reunião(ões) com "ninguém admitiu o bot"')
  })

  it('aguenta reunião sem título e sem horário sem quebrar o e-mail', () => {
    const texto = corpoDoAlerta([{ id: 'x', title: null, started_at: null }], 0)
    expect(texto).toContain('--:--  (sem título)')
  })
})
