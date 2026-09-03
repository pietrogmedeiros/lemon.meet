import { avaliarTranscricao } from './transcriptUsable.js'

describe('avaliarTranscricao', () => {
  it('o caso real da Daily de 03/09: silêncio virou "Thank you"', () => {
    const r = avaliarTranscricao('you Thank you.\nThank you.\nThank you.\nThank you.')
    expect(r.usavel).toBe(false)
    expect(r.motivo).toContain('silêncio')
  })

  it('vazia ou nula', () => {
    expect(avaliarTranscricao('').usavel).toBe(false)
    expect(avaliarTranscricao(null).usavel).toBe(false)
    expect(avaliarTranscricao('   ').usavel).toBe(false)
  })

  it('alucinação em português', () => {
    expect(avaliarTranscricao('Legendas pela comunidade Amara.org').usavel).toBe(false)
    expect(avaliarTranscricao('Obrigado. Obrigado. Tchau.').usavel).toBe(false)
  })

  it('reunião curta DE VERDADE continua usável', () => {
    // Tamanho comparável às de 267/311 caracteres que gravaram normalmente no
    // mesmo dia — o corte não pode engolir conversa real e curta.
    const real =
      'Oi Bianca, tudo bem? Então, sobre o plano para a sua equipe: hoje vocês têm ' +
      'quarenta vidas e o orçamento fecha em outubro. Vou te mandar a proposta ainda hoje ' +
      'e marcamos o retorno na terça que vem, pode ser?'
    expect(avaliarTranscricao(real).usavel).toBe(true)
  })

  it('conversa mínima porém real passa', () => {
    expect(
      avaliarTranscricao('bom dia pessoal vamos começar a daily o Caio fala primeiro sobre as propostas de ontem').usavel,
    ).toBe(true)
  })

  it('duas palavras repetidas mil vezes não é conversa', () => {
    expect(avaliarTranscricao('teste teste teste teste teste teste'.repeat(50)).usavel).toBe(false)
  })
})
