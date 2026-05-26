import { decideProvider, type CapacityDecisionInput } from './botRouterDecision.js'

const base: CapacityDecisionInput = {
  attendeeEnabled: true,
  maxConcurrent: 2,
  attendeeNearbyCount: 0,
}

describe('decideProvider (capacity-first)', () => {
  it('Attendee desabilitado → sempre meetingbaas', () => {
    expect(decideProvider({ ...base, attendeeEnabled: false, attendeeNearbyCount: 0 })).toBe('meetingbaas')
  })

  it('slot livre → attendee', () => {
    expect(decideProvider({ ...base, attendeeNearbyCount: 0 })).toBe('attendee')
    expect(decideProvider({ ...base, attendeeNearbyCount: 1 })).toBe('attendee')
  })

  it('no teto → overflow para meetingbaas', () => {
    expect(decideProvider({ ...base, attendeeNearbyCount: 2 })).toBe('meetingbaas')
    expect(decideProvider({ ...base, attendeeNearbyCount: 5 })).toBe('meetingbaas')
  })

  it('teto = 3 → enche 3 e transborda o 4º', () => {
    expect(decideProvider({ ...base, maxConcurrent: 3, attendeeNearbyCount: 2 })).toBe('attendee')
    expect(decideProvider({ ...base, maxConcurrent: 3, attendeeNearbyCount: 3 })).toBe('meetingbaas')
  })

  it('teto = 0 → nunca attendee', () => {
    expect(decideProvider({ ...base, maxConcurrent: 0, attendeeNearbyCount: 0 })).toBe('meetingbaas')
  })
})
