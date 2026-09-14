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
  // Acrescentados em 14/09/2026. Até 08/09 o Skribby transcrevia com idioma
  // AUTODETECTADO e errava para inglês, então a alucinação de silêncio vinha em
  // inglês ("Thank you." repetido) e esta lista bastava. Depois que passamos a
  // mandar `lang: pt-BR` (ver [[lemon-skribby-idioma]]), o modelo passou a
  // alucinar EM PORTUGUÊS e estes padrões escaparam da lista.
  //
  // ⚠️ "e aí" também é saudação legítima. Remover é seguro porque a regra só
  // DESCONTA a frase e depois exige 12 palavras distintas no que sobra: uma
  // reunião real tem muito mais do que cumprimentos. Mesmo compromisso que já
  // valia para 'obrigado' e 'tchau'.
  'e aí', 'e ai', 'inscreva-se', 'inscreva se',
]

/**
 * Alucinações com cauda variável — não dá para casar por texto fixo.
 * O Whisper credita um legendador inventado ("Legenda por Adriana Zanotto",
 * "Legenda por Sônia Ruberti"), que é o primo brasileiro do `amara.org`. Sem
 * remover o NOME junto, ele sobra como duas palavras distintas e ajuda a
 * transcrição de silêncio a passar do corte de 12.
 */
const ALUCINACOES_REGEX = [
  /legenda[s]?\s+(por|pela|pelo)\s+\S+(\s+\S+)?/g,
  /legendado[s]?\s+(por|pela|pelo)\s+\S+(\s+\S+)?/g,
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
  // Os padrões com cauda variável saem PRIMEIRO: "legenda por fulano de tal"
  // precisa levar o nome junto, antes que 'legendas' (texto fixo) quebre a
  // expressão e deixe o nome órfão.
  for (const padrao of ALUCINACOES_REGEX) {
    restante = restante.replace(padrao, ' ')
  }
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
