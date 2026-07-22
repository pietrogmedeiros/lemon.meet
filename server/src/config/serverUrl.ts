// Resolve a URL pública DESTE backend — usada para montar os callbacks de OAuth
// (gdrive/calendar/pipedrive/hubspot) e o webhook_url dos providers de bot
// (meetingbaas/attendee/skribby). Fonte única de verdade; precedência:
//
//   1) RAILWAY_PUBLIC_DOMAIN — injetada automaticamente pela Railway. Mantém o
//      backend funcionando enquanto ainda roda lá (período em paralelo durante
//      a migração p/ Contabo).
//   2) SERVER_URL — a env explícita. É o alvo na Contabo/EasyPanel.
//   3) Sem nenhuma das duas:
//        • produção → ERRO (fail-fast). NUNCA cair numa URL hardcoded, que
//          quebraria OAuth/webhook em silêncio (o antigo fallback pra Railway).
//        • dev → http://localhost:<PORT>.
let cached: string | null = null

export function getServerUrl(): string {
  if (cached) return cached

  const fromRailway = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : undefined
  const resolved = fromRailway ?? process.env.SERVER_URL

  if (resolved) {
    cached = resolved.replace(/\/+$/, '') // sem barra final
    return cached
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SERVER_URL não definida. Em produção é obrigatória — monta os callbacks ' +
      'de OAuth e o webhook_url dos bots. Configure SERVER_URL=https://<host> ' +
      'no ambiente do deploy (EasyPanel/Contabo).',
    )
  }

  cached = `http://localhost:${process.env.PORT ?? 3000}`
  return cached
}
