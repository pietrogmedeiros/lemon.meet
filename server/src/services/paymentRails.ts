// paymentRails.ts — quais trilhos de cobrança o servidor CONSEGUE usar hoje.
//
// POR QUE EXISTE: a loja da AbacatePay não tem recorrência habilitada. Cartão
// devolve "CARD is not available for this store" e PIX devolve "PIX Automático
// is not available for this store" — reproduzido em produção em 09/09/2026.
// Resultado: todo clique em "Assinar" batia num 500, e a tela ainda jogava a
// pessoa em /settings sem dizer nada.
//
// Em vez de esconder o botão no código do front (que exigiria outro deploy para
// religar), o servidor DECLARA o que consegue fazer e a tela obedece. No dia em
// que um trilho existir, é definir a variável no EasyPanel e o botão volta
// sozinho — sem deploy e sem ninguém precisar lembrar.

export type TrilhoPagamento = 'pix' | 'card'

export interface DisponibilidadePagamento {
  habilitado: boolean
  trilhos: TrilhoPagamento[]
  /** Texto para a tela quando não há trilho. Nunca expõe detalhe de provedor. */
  motivo?: string
}

/**
 * `pix`  → PIX avulso pela AbacatePay (ABACATEPAY_PIX_ONE_TIME=true).
 * `card` → link de checkout da InfinitePay (BILLING_INFINITEPAY_TAG=<handle>).
 *
 * Ambos são cobrança ÚNICA que libera um ciclo: não existe débito automático em
 * nenhum dos dois. Recorrência automática depende de habilitação na conta do
 * provedor e do banco do pagador — foi o que manteve a cobrança do Lemon
 * quebrada por um mês.
 */
export function trilhosDisponiveis(): DisponibilidadePagamento {
  const trilhos: TrilhoPagamento[] = []

  const chavePix = process.env.ABACATEPAY_API_KEY_V1 || process.env.ABACATEPAY_API_KEY
  if (process.env.ABACATEPAY_PIX_ONE_TIME === 'true' && chavePix) {
    trilhos.push('pix')
  }
  if ((process.env.BILLING_INFINITEPAY_TAG ?? '').trim()) {
    trilhos.push('card')
  }

  if (trilhos.length === 0) {
    return {
      habilitado: false,
      trilhos: [],
      motivo:
        'No momento a assinatura é feita com a nossa equipe. Fale com a gente que ativamos o seu plano.',
    }
  }
  return { habilitado: true, trilhos }
}

/**
 * Preço por plano, em centavos — a fonte é o SERVIDOR.
 *
 * Hoje o valor só existe escrito na tela (`MainLayout.tsx`), e no Autho CRM isso
 * já rendeu a lição: tela que calcula preço acaba mostrando um número e
 * cobrando outro. Aqui a tela exibe, mas quem cobra é este arquivo.
 */
export const PRECO_CENTAVOS: Record<'starter' | 'professional', number> = {
  starter: 8990,       // R$ 89,90
  professional: 11990, // R$ 119,90
}

/** Dias liberados por cobrança paga. Não há débito automático em nenhum trilho. */
export const DIAS_POR_CICLO = 30
