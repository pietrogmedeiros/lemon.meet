import { normalizeAttendeeUtterances } from './attendeeTranscript.js'
import type { AttendeeUtterance } from './AttendeeProvider.js'

describe('normalizeAttendeeUtterances', () => {
  it('mapeia campos e converte ms → segundos', () => {
    const u: AttendeeUtterance[] = [
      { speaker_name: 'Ana', timestamp_ms: 1000, duration_ms: 500, transcription: { transcript: 'olá' } },
    ]
    expect(normalizeAttendeeUtterances(u)).toEqual([
      { text: 'olá', start_seconds: 1, end_seconds: 1.5, speaker: 'Ana', sequence: 0 },
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
