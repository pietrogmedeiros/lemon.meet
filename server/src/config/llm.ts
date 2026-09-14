// llm.ts — o provedor de IA, em UM lugar só.
//
// POR QUE EXISTE: em 09/09/2026 o Google recusou a verificação OAuth do
// Lemon.meet porque o app mandava dado vindo da API do Google para o DeepSeek,
// cujos termos públicos reservam o direito de treinar modelos com o conteúdo
// recebido — o que viola o Limited Use da Google API Services User Data Policy.
// Não era papelada: eles não aprovam enquanto a integração existir.
//
// Trocar exigiu mexer em CINCO arquivos que construíam o cliente cada um por
// si. Este módulo existe para que a próxima troca seja em um.
//
// ⚠️ O tier GRATUITO do Gemini TREINA com os dados ("Google uses the content you
// submit (...) to improve, and develop Google products"). Só o PAGO não treina
// ("Google doesn't use your prompts (...) to improve our products"). Um projeto
// sem billing habilitado cai no gratuito EM SILÊNCIO e volta a violar a mesma
// política que causou a recusa. Conferir no console, não presumir.

import OpenAI from 'openai'
import { logger } from '../utils/logger.js'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

const chaveGemini = process.env.GEMINI_API_KEY?.trim()
const chaveDeepseek = process.env.DEEPSEEK_API_KEY?.trim()

/** Qual provedor está REALMENTE ativo. Vai para o /health de propósito: nesta
 *  mesma semana duas configurações falharam caladas (o `lang` do Skribby e o
 *  risco do tier gratuito). Configuração que não é visível volta a morder. */
export const LLM_PROVIDER: 'gemini' | 'deepseek' | 'nenhum' =
  chaveGemini ? 'gemini' : chaveDeepseek ? 'deepseek' : 'nenhum'

export const LLM_MODEL =
  process.env.LLM_MODEL?.trim() ||
  (LLM_PROVIDER === 'gemini' ? 'gemini-3.8-flash' : 'deepseek-chat')

export const llm = new OpenAI({
  apiKey: chaveGemini ?? chaveDeepseek ?? '',
  baseURL:
    LLM_PROVIDER === 'gemini'
      ? process.env.LLM_BASE_URL?.trim() || GEMINI_BASE_URL
      : DEEPSEEK_BASE_URL,
})

if (LLM_PROVIDER === 'deepseek') {
  // Não derruba o serviço: sem a chave do Gemini é melhor seguir gerando
  // insights do que parar o produto. Mas isso PRECISA gritar no log — enquanto
  // estiver assim, a verificação do Google continua bloqueada.
  logger.warn(
    '[LLM] Usando DeepSeek — GEMINI_API_KEY não está definida. ' +
      'A verificação OAuth do Google fica BLOQUEADA enquanto isso valer.',
  )
} else if (LLM_PROVIDER === 'nenhum') {
  logger.error('[LLM] Nenhuma chave de IA configurada: insights e chat vão falhar.')
} else {
  logger.info(`[LLM] Provedor: gemini | modelo: ${LLM_MODEL}`)
}

/**
 * Extrai o texto da resposta SEM explodir quando o provedor devolve outra coisa.
 *
 * ⚠️ Em 14/09/2026 três reuniões reais (26k–32k caracteres de transcrição, 38
 * minutos de conversa) ficaram `completed` SEM insights, e o usuário viu uma
 * caixa vermelha dizendo `Cannot read properties of undefined (reading '0')`.
 * A causa: `response.choices[0]` — o `?.` protegia o ELEMENTO, não o ARRAY.
 * Quando o provedor oscila e devolve um corpo sem `choices`, isso vira
 * TypeError e o motivo real se perde. Não era tamanho: 44 transcrições acima de
 * 26k geraram insights normalmente, uma delas com 70k.
 */
export function textoDaResposta(resposta: unknown): string | null {
  const escolhas = (resposta as { choices?: unknown })?.choices
  if (!Array.isArray(escolhas) || escolhas.length === 0) return null
  const conteudo = (escolhas[0] as { message?: { content?: unknown } })?.message?.content
  return typeof conteudo === 'string' ? conteudo : null
}

/** Falha que costuma passar se tentar de novo: oscilação do provedor, 429, 5xx. */
function ehTransitoria(err: any): boolean {
  const status = err?.status ?? err?.response?.status
  if (status === 429 || (typeof status === 'number' && status >= 500)) return true
  return /ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|timeout/i.test(String(err?.message ?? ''))
}

/**
 * Uma segunda tentativa para falha transitória. As três perdas de 14/09 foram
 * na mesma janela de uma hora — provavelmente teriam passado no retry.
 */
export async function comRetry<T>(rotulo: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err: any) {
    if (!ehTransitoria(err)) throw err
    logger.warn(`[LLM] ${rotulo}: falha transitória (${err?.status ?? err?.message}) — tentando de novo em 2s`)
    await new Promise((r) => setTimeout(r, 2000))
    return await fn()
  }
}
