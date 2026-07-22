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
//
// A lógica foi generalizada em webhookSignature.ts (reuso entre providers);
// aqui só fixamos os parâmetros específicos do Attendee.
// ============================================================

import { verifyWebhookSignature } from './webhookSignature.js'

/**
 * Valida a assinatura do webhook do Attendee.
 * Retorna true se a assinatura bater com o JSON canônico OU com o raw body.
 */
export function verifyAttendeeSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  // Chave = bytes decodificados do secret base64; digest base64; canônico + raw.
  return verifyWebhookSignature(rawBody, signature, secret, {
    keyEncoding: 'base64',
    digests: ['base64'],
    tryCanonical: true,
    tryRawBody: true,
  })
}
