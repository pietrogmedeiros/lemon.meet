// ============================================================
// webhookSignature.ts — Verificação genérica de assinatura HMAC de webhooks
//
// Generaliza a lógica antes específica do Attendee (verifyAttendeeSignature)
// para reuso entre providers (Attendee, Skribby, …). Um provider assina o
// corpo com HMAC-SHA256; variam apenas:
//   • como a CHAVE é derivada do secret (bytes crus utf8 vs base64-decoded);
//   • o ENCODING do digest transmitido (base64 vs hex);
//   • se assina o JSON CANÔNICO (chaves ordenadas) e/ou o RAW body.
//
// A função tenta todas as combinações habilitadas e compara em tempo constante.
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto'

/** Serializa em JSON canônico: chaves ordadas recursivamente, sem espaços. */
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

function hmac(key: Buffer, data: string, digest: 'base64' | 'hex'): string {
  return createHmac('sha256', key).update(data, 'utf8').digest(digest)
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export interface WebhookSignatureOptions {
  /** Como derivar a chave HMAC do secret. 'base64' = decodifica; 'utf8' = bytes crus. */
  keyEncoding?: 'base64' | 'utf8'
  /** Encodings de digest aceitos para o header de assinatura. */
  digests?: Array<'base64' | 'hex'>
  /** Se true, tenta o HMAC sobre o JSON canônico (chaves ordenadas). */
  tryCanonical?: boolean
  /** Se true, tenta o HMAC sobre o raw body cru. */
  tryRawBody?: boolean
  /**
   * Timestamp do header (estilo Stripe/Skribby). Quando presente, também testa
   * o HMAC sobre `${timestamp}.${rawBody}` — o esquema de payload assinado.
   */
  timestamp?: string
}

/**
 * Remove um prefixo de algoritmo do header de assinatura (ex.: 'sha256=<hex>'
 * do Skribby). Só corta um prefixo curto e alfanumérico seguido de '=' no
 * INÍCIO — não confunde com o '=' de padding no fim de um base64.
 */
function stripAlgoPrefix(signature: string): string {
  const m = /^([a-z0-9]{1,10})=(.+)$/i.exec(signature)
  return m ? m[2] : signature
}

/**
 * Valida a assinatura HMAC-SHA256 de um webhook. Retorna true se QUALQUER
 * combinação habilitada (chave × digest × payload) bater com o header.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
  opts: WebhookSignatureOptions = {},
): boolean {
  if (!signature || !secret) return false

  const keyEncoding = opts.keyEncoding ?? 'utf8'
  const digests = opts.digests ?? ['base64']
  const tryCanonical = opts.tryCanonical ?? true
  const tryRawBody = opts.tryRawBody ?? true

  const key = Buffer.from(secret, keyEncoding)
  const sig = stripAlgoPrefix(signature)
  const rawStr = rawBody.toString('utf8')

  // Corpos a testar: JSON canônico (se parseável), raw body cru e/ou o payload
  // assinado estilo Stripe (`timestamp.body`).
  const payloads: string[] = []
  if (opts.timestamp) payloads.push(`${opts.timestamp}.${rawStr}`)
  if (tryCanonical) {
    try {
      const parsed = JSON.parse(rawStr)
      payloads.push(JSON.stringify(canonicalize(parsed)))
    } catch {
      // corpo não-JSON: só o raw body faz sentido
    }
  }
  if (tryRawBody) payloads.push(rawStr)

  for (const payload of payloads) {
    for (const digest of digests) {
      if (safeEqual(sig, hmac(key, payload, digest))) return true
    }
  }
  return false
}
