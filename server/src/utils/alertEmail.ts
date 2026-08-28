// alertEmail.ts — e-mail de alerta operacional para o administrador.
//
// POR QUE EXISTE: quando a conta autenticada do Skribby é recusada pelo Google,
// NENHUMA reunião é gravada até alguém destravar. O conserto leva dois minutos;
// o problema sempre foi a DETECÇÃO. Em 28/08 uma reunião de cliente morreu às
// 13:28 e ninguém soube — o alerta existia, mas só dentro do app, no sininho.
//
// Quarta ocorrência em cinco semanas (24/07, 03/08, 24/08, 28/08), com o
// intervalo caindo de 21 dias para 4. Saber em dois minutos em vez de meia hora
// é a maior redução de dano possível sem mexer na arquitetura.
//
// Config (EasyPanel → Environment):
//   RESEND_API_KEY   chave da conta Resend
//   ALERT_EMAIL_TO   destinatário
//   ALERT_EMAIL_FROM opcional; padrão onboarding@resend.dev, que só entrega
//                    para o e-mail dono da conta Resend. Para enviar a qualquer
//                    endereço, use um remetente de domínio verificado.
//
// Sem RESEND_API_KEY o envio é ignorado com aviso no log — o alerta in-app
// continua funcionando de qualquer jeito.

import { logger } from './logger.js'

const RESEND_URL = 'https://api.resend.com/emails'

export interface AlertEmail {
  subject: string
  /** Texto puro. Alerta de plantão não é peça de marketing. */
  body: string
}

export async function sendAlertEmail({ subject, body }: AlertEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.ALERT_EMAIL_TO
  const from = process.env.ALERT_EMAIL_FROM || 'Lemon.meet <onboarding@resend.dev>'

  if (!apiKey || !to) {
    logger.warn(
      '[alertEmail] RESEND_API_KEY ou ALERT_EMAIL_TO não configurados — ' +
      `alerta "${subject}" NÃO foi enviado por e-mail (o alerta in-app segue valendo).`,
    )
    return false
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, text: body }),
    })

    if (!res.ok) {
      // A mensagem do Resend diz o que houve (domínio não verificado, chave
      // inválida, destinatário recusado). Sem ela, um alerta que não chega é
      // indistinguível de um problema que não aconteceu.
      const detail = await res.text()
      logger.error(`[alertEmail] Resend recusou (${res.status}): ${detail.slice(0, 300)}`)
      return false
    }

    logger.info(`[alertEmail] enviado para ${to}: ${subject}`)
    return true
  } catch (err) {
    logger.error('[alertEmail] falha ao enviar:', err)
    return false
  }
}
