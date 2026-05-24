import { decideImmediateProvider, type ImmediateDecisionInput } from './botRouterDecision.js'

const base: ImmediateDecisionInput = {
  attendeeEnabled: true,
  trafficPercent: 10,
  maxConcurrent: 3,
  attendeeActiveCount: 0,
  roll: 5,
}

describe('decideImmediateProvider', () => {
  it('Attendee desabilitado → sempre meetingbaas', () => {
    expect(decideImmediateProvider({ ...base, attendeeEnabled: false, roll: 0 })).toBe('meetingbaas')
  })

  it('sorteio dentro do percentual e com capacidade → attendee', () => {
    expect(decideImmediateProvider({ ...base, roll: 9.9 })).toBe('attendee')
  })

  it('sorteio fora do percentual → meetingbaas', () => {
    expect(decideImmediateProvider({ ...base, roll: 10 })).toBe('meetingbaas')
    expect(decideImmediateProvider({ ...base, roll: 80 })).toBe('meetingbaas')
  })

  it('roll == trafficPercent é exclusivo (>=) → meetingbaas', () => {
    expect(decideImmediateProvider({ ...base, trafficPercent: 10, roll: 10 })).toBe('meetingbaas')
  })

  it('no teto de capacidade → overflow para meetingbaas', () => {
    expect(decideImmediateProvider({ ...base, roll: 0, attendeeActiveCount: 3, maxConcurrent: 3 })).toBe('meetingbaas')
    expect(decideImmediateProvider({ ...base, roll: 0, attendeeActiveCount: 5, maxConcurrent: 3 })).toBe('meetingbaas')
  })

  it('abaixo do teto e dentro do percentual → attendee', () => {
    expect(decideImmediateProvider({ ...base, roll: 0, attendeeActiveCount: 2, maxConcurrent: 3 })).toBe('attendee')
  })

  it('trafficPercent=0 → nunca attendee', () => {
    expect(decideImmediateProvider({ ...base, trafficPercent: 0, roll: 0 })).toBe('meetingbaas')
  })

  it('trafficPercent=100 com capacidade → attendee', () => {
    expect(decideImmediateProvider({ ...base, trafficPercent: 100, roll: 99.99, attendeeActiveCount: 0 })).toBe('attendee')
  })
})
