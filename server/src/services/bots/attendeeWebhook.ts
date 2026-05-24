// ============================================================
// attendeeWebhook.ts — Verificação de assinatura do webhook do Attendee
//
// O Attendee assina o ENVELOPE inteiro com HMAC-SHA256 (base64) sobre o
// JSON CANÔNICO: json.dumps(payload, sort_keys=True, ensure_ascii=False,
// separators=(",",":")). Porém transmite o corpo via requests(json=...),
// que serializa diferente. Logo, para validar, re-serializamos
// canonicamente o JSON parseado (chaves ordenadas, sem espaços).
//
// ⚠️ CRÍTICO: o ATTENDEE_WEBHOOK_SECRET é uma string BASE64. A chave HMAC
// são os BYTES DECODIFICADOS do secret (base64decode), não a string crua.
// Verificado contra o Attendee 1.38.2 ao vivo (2026-05-24).
//
// Por robustez, também aceitamos o HMAC sobre o raw body cru.
//
// Header: X-Webhook-Signature
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto'

/** Serializa em JSON canônico equivalente ao do Attendee (Python). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonicalize(obj[k])
        return acc
      }, {})
  }
  return value
}

function hmacBase64(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('base64')
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/**
 * Valida a assinatura do webhook do Attendee.
 * Retorna true se a assinatura bater com o JSON canônico OU com o raw body.
 */
export function verifyAttendeeSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false

  // A chave HMAC são os bytes decodificados do secret base64.
  const key = Buffer.from(secret, 'base64')

  // 1) JSON canônico (caso esperado).
  try {
    const parsed = JSON.parse(rawBody.toString('utf8'))
    const canonical = JSON.stringify(canonicalize(parsed))
    if (safeEqual(signature, hmacBase64(key, canonical))) return true
  } catch {
    // corpo não-JSON: cai para a verificação por raw body
  }

  // 2) Fallback: HMAC sobre o raw body cru.
  return safeEqual(signature, hmacBase64(key, rawBody.toString('utf8')))
}
