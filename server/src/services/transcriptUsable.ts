// transcriptUsable.ts — a transcrição tem conteúdo aproveitável?
//
// Pura e testada de propósito: é ela que decide se uma reunião vira análise de
// vendas ou vira "ninguém falou". Errar para o lado permissivo é pior do que
// errar para o restritivo — reunião muda virando insight parece que o produto
// entendeu a conversa.

/**
 * Alucinações clássicas do Whisper quando recebe SILÊNCIO. A Daily Comercial de
 * 03/09/2026 gravou 13 minutos de sala vazia e o modelo devolveu
 * "you Thank you. Thank you. Thank you. Thank you." — que virou reunião
 * "Concluída" com BANT zerado e follow-up inventado.
 */
const ALUCINACOES = [
  'thank you', 'thanks for watching', 'you', 'obrigado', 'obrigada', 'tchau',
  'legendas pela comunidade amara.org', 'amara.org', 'legendas', 'subscribe',
  'música', 'music', 'aplausos', 'applause', 'bye',
]

/** Normaliza: minúsculas, sem pontuação, espaços colapsados. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/[.,!?;:¡¿"'`´()\[\]…–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface UsabilidadeTranscricao {
  usavel: boolean
  /** Só preenchido quando não é usável — vai para o log e para o failure_reason. */
  motivo?: string
}

/**
 * Regras, em ordem:
 *  1. vazia → não usável;
 *  2. o texto inteiro é feito só de frases de alucinação → não usável, por mais
 *     que se repitam (o caso real tinha 47 caracteres e 4 segmentos);
 *  3. menos de 12 palavras distintas → não usável. Reuniões curtas de verdade
 *     do mesmo dia tinham 267 e 311 caracteres com dezenas de palavras
 *     distintas, então o corte não as pega.
 */
export function avaliarTranscricao(texto: string | null | undefined): UsabilidadeTranscricao {
  const t = normalizar(texto ?? '')
  if (!t) return { usavel: false, motivo: 'transcrição vazia' }

  let restante = t
  for (const frase of ALUCINACOES) {
    restante = restante.split(frase).join(' ')
  }
  restante = restante.replace(/\s+/g, ' ').trim()
  if (!restante) {
    return { usavel: false, motivo: 'só ruído de silêncio (alucinação do Whisper)' }
  }

  const distintas = new Set(restante.split(' ').filter(Boolean))
  if (distintas.size < 12) {
    return { usavel: false, motivo: `apenas ${distintas.size} palavra(s) distinta(s)` }
  }
  return { usavel: true }
}
