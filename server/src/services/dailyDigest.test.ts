import { buildDigest, type DigestMeeting } from './dailyDigest.js'

const base = { nome: 'Deive', appUrl: 'https://lemon-meet.web.app', dataLabel: '03/09' }

function reuniao(over: Partial<DigestMeeting>): DigestMeeting {
  return {
    id: 'abc',
    title: 'Cliente X',
    started_at: '2026-09-03T13:00:00Z',
    status: 'completed',
    failure_reason: null,
    insights: null,
    ...over,
  }
}

describe('buildDigest', () => {
  it('dia sem reunião não gera e-mail', () => {
    expect(buildDigest({ ...base, meetings: [], actionItems: [] })).toBeNull()
  })

  it('assunto conta gravadas x total', () => {
    const d = buildDigest({
      ...base,
      meetings: [
        reuniao({}),
        reuniao({ id: 'b', status: 'failed', failure_reason: 'skribby_not_admitted' }),
      ],
      actionItems: [],
    })!
    expect(d.subject).toBe('Ontem: 1 de 2 reuniões gravadas')
  })

  it('dia perfeito não menciona falha', () => {
    const d = buildDigest({ ...base, meetings: [reuniao({})], actionItems: [] })!
    expect(d.subject).toBe('Ontem: 1 reunião gravada')
    expect(d.html).not.toContain('Sem gravação')
  })

  it('traduz o motivo em vez de mostrar o código', () => {
    // Precisa de uma gravada junto: dia só com falha não gera e-mail (regra 05/09).
    const d = buildDigest({
      ...base,
      meetings: [
        reuniao({}),
        reuniao({ id: 'x', status: 'failed', failure_reason: 'skribby_not_admitted' }),
      ],
      actionItems: [],
    })!
    expect(d.text).toContain('ninguém admitiu o bot na sala')
    expect(d.text).not.toContain('skribby_not_admitted')
  })

  it('a dica do convite só aparece a partir de 2 não-admitidas', () => {
    const uma = buildDigest({
      ...base,
      meetings: [
        reuniao({}),
        reuniao({ id: 'x', status: 'failed', failure_reason: 'skribby_not_admitted' }),
      ],
      actionItems: [],
    })!
    expect(uma.html).not.toContain('contato@lemon-meet.com')

    const duas = buildDigest({
      ...base,
      meetings: [
        reuniao({}),
        reuniao({ id: 'b', status: 'failed', failure_reason: 'skribby_not_admitted' }),
        reuniao({ id: 'c', status: 'failed', failure_reason: 'bot_failed: request_to_join_denied' }),
      ],
      actionItems: [],
    })!
    expect(duas.html).toContain('contato@lemon-meet.com')
  })

  it('mostra o próximo passo dos insights', () => {
    const d = buildDigest({
      ...base,
      meetings: [
        reuniao({ insights: { closingProbability: 70, followUp: ['Enviar proposta até sexta'] } }),
      ],
      actionItems: [],
    })!
    expect(d.text).toContain('Enviar proposta até sexta')
    expect(d.html).toContain('70% de chance de fechar')
  })

  it('lista pendências e corta em 8', () => {
    const itens = Array.from({ length: 11 }, (_, i) => ({ text: `tarefa ${i}`, meetingTitle: 'X' }))
    const d = buildDigest({ ...base, meetings: [reuniao({})], actionItems: itens })!
    expect(d.html).toContain('tarefa 7')
    expect(d.html).not.toContain('tarefa 8')
    expect(d.html).toContain('e mais 3')
  })

  it('escapa HTML vindo do título da reunião', () => {
    const d = buildDigest({
      ...base,
      meetings: [reuniao({ title: '<script>alert(1)</script>' })],
      actionItems: [],
    })!
    expect(d.html).not.toContain('<script>')
    expect(d.html).toContain('&lt;script&gt;')
  })

})

describe('regras novas de 05/09', () => {
  it('nenhuma reunião gravada → NÃO manda e-mail', () => {
    const d = buildDigest({
      ...base,
      meetings: [
        reuniao({ status: 'failed', failure_reason: 'skribby_not_admitted' }),
        reuniao({ id: 'b', status: 'failed', failure_reason: 'bot_failed' }),
      ],
      actionItems: [],
    })
    expect(d).toBeNull()
  })

  it('uma gravada no meio das falhas → manda', () => {
    const d = buildDigest({
      ...base,
      meetings: [
        reuniao({}),
        reuniao({ id: 'b', status: 'failed', failure_reason: 'skribby_not_admitted' }),
      ],
      actionItems: [],
    })
    expect(d).not.toBeNull()
  })

  it('modo semanal muda assunto, saudação e fecho', () => {
    const d = buildDigest({
      ...base,
      modo: 'semanal',
      dataLabel: '31/08 a 06/09',
      meetings: [reuniao({})],
      actionItems: [],
    })!
    expect(d.subject).toBe('Sua semana: 1 reunião gravada')
    expect(d.html).toContain('Boa semana, Deive')
    expect(d.text).toContain('Boa semana e bons fechamentos')
  })

  it('modo diário continua falando de ontem', () => {
    const d = buildDigest({ ...base, meetings: [reuniao({})], actionItems: [] })!
    expect(d.subject).toBe('Ontem: 1 reunião gravada')
    expect(d.html).toContain('Bom dia, Deive')
    expect(d.html).not.toContain('Boa semana')
  })
})
