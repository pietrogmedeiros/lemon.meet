// ============================================================
// skribbyFailureWatch.ts — avisa por e-mail quando o Skribby começa a falhar
//
// POR QUE EXISTE: em 23/09/2026 o Skribby falhou em quatro bots entre 10h e 11h
// e duas reuniões de cliente foram perdidas de vez. O Pietro só descobriu à
// noite, olhando a tela. Não há conserto do nosso lado — a falha é do provedor —
// mas saber no mesmo dia permite remarcar a reunião, avisar o vendedor e abrir
// chamado enquanto o incidente ainda está acontecendo.
//
// É só VISIBILIDADE: não reescreve status, não reenvia bot, não muda nada.
//
// Config (EasyPanel → Environment), todas opcionais:
//   SKRIBBY_FAIL_ALERT_THRESHOLD  padrão 2 (ver LIMIAR_PADRAO)
//   ALERT_EMAIL_TO / RESEND_API_KEY  já usados pelo alerta de credencial
// ============================================================

import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import { sendAlertEmail } from '../utils/alertEmail.js'

const OFFSET_BRT_MS = 3 * 60 * 60 * 1000

/**
 * ⚠️ O limiar é DOIS, e é de propósito.
 *
 * Nos 30 dias até 23/09/2026 houve UMA ocorrência de `skribby_failed` em 356
 * reuniões. No dia do incidente, depois que os rótulos assentaram, sobraram
 * DUAS. Um limiar de 3 não teria disparado no único dia em que precisava —
 * porque duas das quatro falhas aparentes se resolveram sozinhas (uma virou
 * `not_admitted`, outra gravou na segunda tentativa).
 *
 * Duas falhas num dia são ~60x o basal diário. Se virar ruído, sobe por env.
 */
const LIMIAR_PADRAO = 2

/**
 * `skribby_failed` é PROVISÓRIO: o Skribby retenta em segundos e o desfecho real
 * pode ser `not_admitted` ou até uma gravação boa. Contar cedo demais gera
 * alarme falso, então só entram reuniões cujo início já passou disto.
 */
const ASSENTAR_MS = 10 * 60 * 1000

/** No máximo um e-mail a cada 2h, mesmo que o incidente continue crescendo. */
const THROTTLE_MS = 2 * 60 * 60 * 1000

const MOTIVO = 'skribby_failed'

/** Limites do dia corrente em Brasília, expressos em UTC. */
export function janelaDoDiaBrt(agora: Date): { inicio: string; fim: string; dia: string } {
  const brt = new Date(agora.getTime() - OFFSET_BRT_MS)
  const inicioBrt = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate())
  return {
    inicio: new Date(inicioBrt + OFFSET_BRT_MS).toISOString(),
    fim: new Date(inicioBrt + OFFSET_BRT_MS + 24 * 60 * 60 * 1000).toISOString(),
    dia: new Date(inicioBrt).toISOString().slice(0, 10),
  }
}

export interface EstadoAlerta {
  /** Dia BRT a que o estado se refere; muda à meia-noite e zera o resto. */
  dia: string
  /** Quantas falhas já foram comunicadas neste dia. */
  contagemAlertada: number
  /** Quando saiu o último e-mail (epoch ms). */
  ultimoEnvioMs: number
}

/**
 * Decide se este ciclo deve mandar e-mail. Pura de propósito: a regra de quando
 * incomodar alguém é o que mais erra, e é o que dá para testar sem banco.
 *
 * Alerta quando cruza o limiar E a contagem cresceu desde o último aviso —
 * assim um incidente que piora avisa de novo, e um estável não repete.
 */
export function deveAlertar(
  contagem: number,
  limiar: number,
  estado: EstadoAlerta | null,
  dia: string,
  agoraMs: number,
): boolean {
  if (contagem < limiar) return false
  if (!estado || estado.dia !== dia) return true          // primeiro do dia
  if (contagem <= estado.contagemAlertada) return false   // nada de novo
  return agoraMs - estado.ultimoEnvioMs >= THROTTLE_MS
}

export function limiarConfigurado(): number {
  const bruto = Number(process.env.SKRIBBY_FAIL_ALERT_THRESHOLD)
  return Number.isFinite(bruto) && bruto > 0 ? Math.floor(bruto) : LIMIAR_PADRAO
}

/** Monta o corpo do e-mail. Texto puro: alerta de plantão não é peça gráfica. */
export function corpoDoAlerta(
  falhas: { title: string | null; started_at: string | null; id: string }[],
  naoAdmitidas: number,
): string {
  const linhas = falhas.map((m) => {
    const hora = m.started_at
      ? new Date(new Date(m.started_at).getTime() - OFFSET_BRT_MS).toISOString().slice(11, 16)
      : '--:--'
    return `  ${hora}  ${m.title ?? '(sem título)'}\n         https://lemon-meet.web.app/meetings/${m.id}`
  })

  return [
    `${falhas.length} reunião(ões) morreram hoje com "o serviço de gravação falhou".`,
    '',
    'O normal é ZERO: foi 1 ocorrência em 356 reuniões nos 30 dias até 23/09.',
    '',
    ...linhas,
    '',
    'ISSO NÃO TEM CONSERTO DO NOSSO LADO — a falha é do Skribby, que tenta',
    'entrar duas vezes e desiste sem dizer o motivo (stop_reason vem nulo).',
    'Sem gravação não há o que reprocessar.',
    '',
    'O QUE FAZER AGORA:',
    '1. Avisar quem conduziu as reuniões acima — elas não têm transcrição.',
    '2. Se ainda houver reunião importante nas próximas horas, gravar por fora:',
    '   o app do Mac (Lemon Desktop) captura e sobe sozinho, e a gravação do',
    '   próprio Meet serve de último recurso. Não existe upload pela web.',
    '3. Abrir chamado no Skribby com os horários acima; eles têm o log de',
    '   join que a gente não tem.',
    '',
    `Contexto do dia: ${naoAdmitidas} reunião(ões) com "ninguém admitiu o bot".`,
    'Esse é o problema crônico de sempre e NÃO indica incidente.',
  ].join('\n')
}

let estado: EstadoAlerta | null = null

/**
 * Roda a checagem e manda o e-mail se for o caso.
 *
 * O estado mora em memória: se o processo reiniciar durante um incidente, um
 * e-mail pode repetir. Preferi isso a criar tabela — repetir um alerta de
 * incidente custa um e-mail, e perder o alerta custa a reunião.
 */
export async function checarFalhasDoSkribby(agora = new Date()): Promise<void> {
  const limiar = limiarConfigurado()
  const { inicio, fim, dia } = janelaDoDiaBrt(agora)
  const teto = new Date(agora.getTime() - ASSENTAR_MS).toISOString()

  const { data, error } = await supabase
    .from('meetings')
    .select('id, title, started_at, failure_reason')
    .gte('started_at', inicio)
    .lt('started_at', fim)
    .lte('started_at', teto)
    .in('failure_reason', [MOTIVO, 'skribby_not_admitted'])
    .is('bot_owner_meeting_id', null)

  if (error) {
    logger.warn('[SkribbyWatch] Falha ao consultar reuniões:', error)
    return
  }

  const linhas = data ?? []
  const falhas = linhas.filter((m) => m.failure_reason === MOTIVO)
  const naoAdmitidas = linhas.length - falhas.length

  if (!deveAlertar(falhas.length, limiar, estado, dia, agora.getTime())) return

  logger.error(`[SkribbyWatch] ${falhas.length} reunião(ões) com ${MOTIVO} hoje (limiar ${limiar}) — alertando`)
  const enviado = await sendAlertEmail({
    subject: `🔴 Skribby falhando — ${falhas.length} reunião(ões) perdidas hoje`,
    body: corpoDoAlerta(falhas, naoAdmitidas),
  })
  // Só marca como avisado se o e-mail saiu: senão o próximo ciclo tenta de novo.
  if (enviado) estado = { dia, contagemAlertada: falhas.length, ultimoEnvioMs: agora.getTime() }
}

/** Só para teste: zera o estado entre casos. */
export function _resetEstado(): void {
  estado = null
}
