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

  // ── Alucinações em PORTUGUÊS (regressão de 14/09/2026) ──────────────
  // Até 08/09 o Skribby autodetectava o idioma e errava para inglês, então a
  // alucinação de silêncio vinha como "Thank you." repetido. Depois que
  // passamos a mandar `lang: pt-BR`, ela passou a vir em português — e estes
  // casos ESCAPARAM do guard, virando reunião "Concluída" com insights
  // inventados sobre silêncio.

  it('"E aí" repetido (silêncio em pt) não é conversa', () => {
    // Transcrição real da reunião be7f0d84 (14/09/2026), 16 minutos de sala
    // com gente mas sem áudio de voz chegando ao bot.
    const real =
      'E aí E aí E aí Legenda Adriana Zanotto Legenda Adriana Zanotto Legenda Adriana Zanotto ' +
      'E aí E aí E aí E aí E aí E aí E aí E aí E aí E aí E aí E aí E aí E aí E aí E aí'
    const r = avaliarTranscricao(real)
    expect(r.usavel).toBe(false)
  })

  it('crédito de legendador inventado sai COM o nome junto', () => {
    // Sem remover o nome, "Sônia Ruberti" sobra como duas palavras distintas e
    // ajuda o silêncio a passar do corte de 12.
    const real = 'Legenda por Sônia Ruberti E aí E aí E aí E aí'
    expect(avaliarTranscricao(real).usavel).toBe(false)
  })

  it('variações de legendagem também caem', () => {
    expect(avaliarTranscricao('Legendas pela Ana Maria Silva e aí e aí').usavel).toBe(false)
    expect(avaliarTranscricao('Legendado por João Pedro obrigado obrigado').usavel).toBe(false)
  })

  it('reunião real que CUMPRIMENTA com "e aí" continua usável', () => {
    // A trava: 'e aí' é saudação legítima. Descontá-la não pode derrubar
    // conversa de verdade — sobram palavras distintes de sobra.
    const real =
      'E aí Marcos, tudo certo? Então, fechamos o escopo do piloto com quarenta licenças, ' +
      'o financeiro aprovou o orçamento e eu te mando o contrato revisado amanhã cedo.'
    expect(avaliarTranscricao(real).usavel).toBe(true)
  })
})
