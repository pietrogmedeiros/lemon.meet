import { motivoQueDeveFicar } from './skribby.routes.js'

describe('motivoQueDeveFicar — o desfecho real corrige o rótulo genérico', () => {
  it('troca o genérico pelo motivo específico que chega depois', () => {
    // ⚠️ O caso real de 23/09/2026: a "VR & Starbem [Proposta Comercial]" ficou
    // com "o serviço de gravação falhou" quando o bot terminou em not_admitted
    // com stop_reason=request_denied — alguém negou a entrada. O rótulo errado
    // põe em nós a culpa de uma recusa do outro lado da sala.
    expect(motivoQueDeveFicar('skribby_failed', 'skribby_not_admitted')).toBe('skribby_not_admitted')
    expect(motivoQueDeveFicar('skribby_failed', 'skribby_waiting_room_timeout')).toBe('skribby_waiting_room_timeout')
  })

  it('NUNCA rebaixa um motivo específico para o genérico', () => {
    expect(motivoQueDeveFicar('skribby_not_admitted', 'skribby_failed')).toBeNull()
    expect(motivoQueDeveFicar('no_usable_audio: só ruído', 'skribby_failed')).toBeNull()
    expect(motivoQueDeveFicar('skribby_invalid_credentials', 'skribby_not_admitted')).toBeNull()
  })

  it('não escreve de novo quando nada mudou', () => {
    expect(motivoQueDeveFicar('skribby_failed', 'skribby_failed')).toBeNull()
  })

  it('sem motivo gravado, não há o que corrigir aqui', () => {
    expect(motivoQueDeveFicar(null, 'skribby_not_admitted')).toBeNull()
  })
})
