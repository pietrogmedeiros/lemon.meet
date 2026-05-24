import { createHmac } from 'crypto'
import { verifyAttendeeSignature } from './attendeeWebhook.js'

// Secret base64 de teste (32 bytes). Igual ao formato real do Attendee.
const SECRET_B64 = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')

function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((a: any, k) => ((a[k] = sortKeys(v[k])), a), {})
  }
  return v
}

/** Replica a assinatura do Attendee: HMAC-SHA256(base64decode(secret), canonical) → base64. */
function attendeeSign(envelope: unknown, secretB64: string): string {
  const key = Buffer.from(secretB64, 'base64')
  const canonical = JSON.stringify(sortKeys(envelope))
  return createHmac('sha256', key).update(canonical, 'utf8').digest('base64')
}

const envelope = {
  idempotency_key: 'uuid-1',
  bot_id: 'bot_xyz',
  bot_metadata: { lemon_meeting_id: 'm-42' },
  trigger: 'bot.state_change',
  data: { old_state: 'joining', new_state: 'ended', note: 'reunião com ação' },
}

describe('verifyAttendeeSignature', () => {
  it('aceita assinatura válida (corpo canônico)', () => {
    const raw = Buffer.from(JSON.stringify(sortKeys(envelope)), 'utf8')
    const sig = attendeeSign(envelope, SECRET_B64)
    expect(verifyAttendeeSignature(raw, sig, SECRET_B64)).toBe(true)
  })

  it('aceita corpo transmitido desordenado e com espaços (como requests json=)', () => {
    // Corpo como o Attendee realmente transmite: ordem de inserção + espaços.
    const raw = Buffer.from(JSON.stringify(envelope), 'utf8')
    const sig = attendeeSign(envelope, SECRET_B64)
    expect(verifyAttendeeSignature(raw, sig, SECRET_B64)).toBe(true)
  })

  it('preserva unicode na canonicalização', () => {
    const e = { trigger: 't', data: { txt: 'café com açúcar — ção' } }
    const raw = Buffer.from(JSON.stringify(e), 'utf8')
    expect(verifyAttendeeSignature(raw, attendeeSign(e, SECRET_B64), SECRET_B64)).toBe(true)
  })

  it('rejeita corpo adulterado', () => {
    const sig = attendeeSign(envelope, SECRET_B64)
    const tampered = Buffer.from(JSON.stringify({ ...envelope, bot_id: 'bot_OUTRO' }), 'utf8')
    expect(verifyAttendeeSignature(tampered, sig, SECRET_B64)).toBe(false)
  })

  it('rejeita secret errado', () => {
    const raw = Buffer.from(JSON.stringify(envelope), 'utf8')
    const sig = attendeeSign(envelope, SECRET_B64)
    const otherSecret = Buffer.from('ffffffffffffffffffffffffffffffff').toString('base64')
    expect(verifyAttendeeSignature(raw, sig, otherSecret)).toBe(false)
  })

  it('rejeita assinatura ausente', () => {
    const raw = Buffer.from(JSON.stringify(envelope), 'utf8')
    expect(verifyAttendeeSignature(raw, undefined, SECRET_B64)).toBe(false)
  })

  it('exige a chave base64-DECODIFICADA (assinar com a string crua não valida)', () => {
    // Assina usando a string base64 como chave (erro comum) → não deve validar.
    const canonical = JSON.stringify(sortKeys(envelope))
    const wrongSig = createHmac('sha256', SECRET_B64).update(canonical, 'utf8').digest('base64')
    const raw = Buffer.from(JSON.stringify(envelope), 'utf8')
    expect(verifyAttendeeSignature(raw, wrongSig, SECRET_B64)).toBe(false)
  })
})
