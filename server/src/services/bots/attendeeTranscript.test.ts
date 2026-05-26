import { normalizeAttendeeUtterances } from './attendeeTranscript.js'
import type { AttendeeUtterance } from './AttendeeProvider.js'

describe('normalizeAttendeeUtterances', () => {
  it('mapeia campos e converte ms → segundos, ancorando no menor timestamp', () => {
    const u: AttendeeUtterance[] = [
      { speaker_name: 'Ana', timestamp_ms: 1000, duration_ms: 500, transcription: { transcript: 'olá' } },
    ]
    // start é relativo ao início (menor timestamp), então o 1º segmento começa em 0.
    expect(normalizeAttendeeUtterances(u)).toEqual([
      { text: 'olá', start_seconds: 0, end_seconds: 0.5, speaker: 'Ana', sequence: 0 },
    ])
  })

  it('converte timestamp_ms epoch absoluto em offset relativo ao início', () => {
    // Regressão: o Attendee (Deepgram em tempo real) manda epoch ms (~1.7e12).
    // Sem ancorar, start_seconds viraria ~1.7e9 e o front exibiria milhões de
    // "minutos" sobre o nome do speaker.
    const epoch = 1_779_795_720_000 // ~2026-05, wall-clock
    const u: AttendeeUtterance[] = [
      { speaker_name: 'Luis', timestamp_ms: epoch, duration_ms: 2000, transcription: { transcript: 'Bom dia' } },
      { speaker_name: 'Luis', timestamp_ms: epoch + 5000, duration_ms: 1000, transcription: { transcript: 'pessoal' } },
    ]
    expect(normalizeAttendeeUtterances(u)).toEqual([
      { text: 'Bom dia', start_seconds: 0, end_seconds: 2, speaker: 'Luis', sequence: 0 },
      { text: 'pessoal', start_seconds: 5, end_seconds: 6, speaker: 'Luis', sequence: 1 },
    ])
  })

  it('ordena por tempo e renumera a sequência', () => {
    const u: AttendeeUtterance[] = [
      { speaker_name: 'B', timestamp_ms: 5000, duration_ms: 100, transcription: { transcript: 'segundo' } },
      { speaker_name: 'A', timestamp_ms: 1000, duration_ms: 100, transcription: { transcript: 'primeiro' } },
    ]
    const out = normalizeAttendeeUtterances(u)
    expect(out.map(s => s.text)).toEqual(['primeiro', 'segundo'])
    expect(out.map(s => s.sequence)).toEqual([0, 1])
  })

  it('descarta utterances vazias ou só com espaços', () => {
    const u: AttendeeUtterance[] = [
      { timestamp_ms: 0, duration_ms: 0, transcription: { transcript: '   ' } },
      { timestamp_ms: 10, duration_ms: 0, transcription: { transcript: '' } },
      { timestamp_ms: 20, duration_ms: 0, transcription: { transcript: 'válido' } },
    ]
    const out = normalizeAttendeeUtterances(u)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('válido')
  })

  it('trata campos ausentes (timestamp/duração default 0, speaker null)', () => {
    const u: AttendeeUtterance[] = [{ transcription: { transcript: 'sem tempo' } }]
    expect(normalizeAttendeeUtterances(u)).toEqual([
      { text: 'sem tempo', start_seconds: 0, end_seconds: 0, speaker: null, sequence: 0 },
    ])
  })

  it('aceita transcription como string', () => {
    const u = [{ timestamp_ms: 0, duration_ms: 0, transcription: 'texto direto' }] as unknown as AttendeeUtterance[]
    expect(normalizeAttendeeUtterances(u)[0].text).toBe('texto direto')
  })

  it('array vazio → []', () => {
    expect(normalizeAttendeeUtterances([])).toEqual([])
  })
})
