import { normalizeSkribbyTranscript } from './skribbyTranscript.js'
import type { SkribbyTranscriptBlock } from './skribbyTranscript.js'

// Fixtures baseadas no schema REAL capturado ao vivo (GET /api/v1/bot/{id},
// campo transcript[] → blocos → utterances[]). Campo de texto = 'transcript',
// timestamps = segundos relativos float, speaker=null no modelo default.

describe('normalizeSkribbyTranscript', () => {
  it('achata utterances dos blocos e mapeia transcript/start/end/speaker', () => {
    const blocks: SkribbyTranscriptBlock[] = [
      {
        transcript: 'olá pessoal',
        start: 0,
        end: 30.04,
        utterances: [
          { start: 0, end: 2.92, speaker: null, transcript: 'olá' },
          { start: 3, end: 5, speaker: null, transcript: 'pessoal' },
        ],
      },
    ]
    expect(normalizeSkribbyTranscript(blocks)).toEqual([
      { text: 'olá', start_seconds: 0, end_seconds: 2.92, speaker: null, sequence: 0 },
      { text: 'pessoal', start_seconds: 3, end_seconds: 5, speaker: null, sequence: 1 },
    ])
  })

  it('ancora o menor start em offset relativo ao início', () => {
    // Defensivo: se um dia vier absoluto, ancorar evita "milhões de minutos".
    const base = 1_779_795_720
    const blocks: SkribbyTranscriptBlock[] = [
      { utterances: [
        { start: base, end: base + 2, speaker: 'spk_0', transcript: 'Bom dia' },
        { start: base + 5, end: base + 6, speaker: 'spk_0', transcript: 'a todos' },
      ] },
    ]
    expect(normalizeSkribbyTranscript(blocks)).toEqual([
      { text: 'Bom dia', start_seconds: 0, end_seconds: 2, speaker: 'spk_0', sequence: 0 },
      { text: 'a todos', start_seconds: 5, end_seconds: 6, speaker: 'spk_0', sequence: 1 },
    ])
  })

  it('ordena por tempo (entre blocos) e renumera a sequência', () => {
    const blocks: SkribbyTranscriptBlock[] = [
      { utterances: [{ start: 5, end: 5.1, transcript: 'segundo' }] },
      { utterances: [{ start: 1, end: 1.1, transcript: 'primeiro' }] },
    ]
    const out = normalizeSkribbyTranscript(blocks)
    expect(out.map(x => x.text)).toEqual(['primeiro', 'segundo'])
    expect(out.map(x => x.sequence)).toEqual([0, 1])
  })

  it('descarta utterances vazias ou só com espaços', () => {
    const blocks: SkribbyTranscriptBlock[] = [
      { utterances: [
        { start: 0, end: 0, transcript: '   ' },
        { start: 1, end: 1, transcript: '' },
        { start: 2, end: 2, transcript: 'válido' },
      ] },
    ]
    const out = normalizeSkribbyTranscript(blocks)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('válido')
  })

  it('usa o speaker quando presente (diarização via Deepgram/AssemblyAI)', () => {
    const blocks: SkribbyTranscriptBlock[] = [
      { utterances: [{ start: 0, end: 1, speaker: 'spk_2', transcript: 'com nome' }] },
    ]
    expect(normalizeSkribbyTranscript(blocks)[0].speaker).toBe('spk_2')
  })

  it('speaker null no modelo default (sem diarização)', () => {
    const blocks: SkribbyTranscriptBlock[] = [
      { utterances: [{ start: 0, end: 1, speaker: null, transcript: 'anônimo' }] },
    ]
    expect(normalizeSkribbyTranscript(blocks)[0].speaker).toBeNull()
  })

  it('trata campos ausentes (start/end default 0, speaker null)', () => {
    const blocks: SkribbyTranscriptBlock[] = [{ utterances: [{ transcript: 'sem tempo' }] }]
    expect(normalizeSkribbyTranscript(blocks)).toEqual([
      { text: 'sem tempo', start_seconds: 0, end_seconds: 0, speaker: null, sequence: 0 },
    ])
  })

  it('bloco sem utterances → ignorado; array vazio → []', () => {
    expect(normalizeSkribbyTranscript([{ transcript: 'x', start: 0, end: 1 }])).toEqual([])
    expect(normalizeSkribbyTranscript([])).toEqual([])
  })
})
