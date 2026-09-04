// dailyDigest.ts — monta o resumo do dia anterior.
//
// POR QUE EXISTE: o Deive fez 130 reuniões em 4 semanas — ~6 por dia. Não há
// como consumir isso abrindo uma a uma, e o produto hoje usa o canal de aviso
// para o contrário: das últimas 500 notificações, 367 eram de FALHA e 42 de
// sucesso, com 2% de leitura nas de falha.
//
// Também é o único caminho realista para os itens de ação: 277 foram criados no
// último mês e ZERO foram concluídos. Ninguém volta ao app para marcar caixinha;
// no e-mail, a pendência chega junto com o resto do dia.
//
// Puro e testado de propósito — o disparo (Resend, horário, destinatários) fica
// no DailyDigestService.

/** Espelha o texto do front (web/src/lib/failureReason.ts). Mexeu num, mexe no outro. */
const MOTIVO_CURTO: Record<string, string> = {
  skribby_not_admitted: 'ninguém admitiu o bot na sala',
  stuck_bot_not_admitted_cleanup: 'ninguém admitiu o bot na sala',
  request_to_join_denied: 'o bot não foi aceito na reunião',
  waiting_room_timeout: 'o bot ficou na sala de espera',
  bot_rejected: 'o bot foi recusado ao entrar',
  calendar_event_cancelled: 'o evento foi cancelado na agenda',
  no_usable_audio: 'não houve fala para transcrever',
  audio_too_large: 'a gravação passou do limite do serviço de transcrição',
  skribby_invalid_credentials: 'falha nossa na conta do bot',
  skribby_failed: 'o serviço de gravação falhou',
  bot_failed: 'o bot não chegou a entrar',
  insights_generation_failed: 'a análise por IA falhou',
}

/** Códigos em que a culpa é de admissão — é o que a dica no rodapé endereça. */
const NAO_ADMITIDO = new Set([
  'skribby_not_admitted',
  'stuck_bot_not_admitted_cleanup',
  'request_to_join_denied',
  'waiting_room_timeout',
  'bot_rejected',
])

export interface DigestMeeting {
  id: string
  title: string | null
  started_at: string | null
  status: string
  failure_reason: string | null
  insights: any | null
}

export interface DigestActionItem {
  text: string
  meetingTitle: string | null
}

export interface DigestInput {
  nome: string
  meetings: DigestMeeting[]
  actionItems: DigestActionItem[]
  appUrl: string
  /** Data do dia resumido, já no fuso do usuário (ex.: "04/09"). */
  dataLabel: string
}

export interface DigestEmail {
  subject: string
  html: string
  text: string
}

function codigo(reason: string | null): string {
  if (!reason) return ''
  let r = reason.trim()
  const wrapped = r.match(/^(?:bot_failed|attendee_fatal_error)\s*:\s*(.*)$/)
  if (wrapped) r = wrapped[1].trim()
  return r.split(':')[0].trim()
}

function hora(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(d)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Próximo passo mais concreto que os insights oferecem, se houver. */
function proximoPasso(insights: any): string | null {
  if (!insights) return null
  const f = insights.followUp
  if (Array.isArray(f) && f.length && typeof f[0] === 'string') return f[0]
  const s = insights.followUpSuggestions
  if (Array.isArray(s) && s.length) {
    const p = s[0]
    if (typeof p === 'string') return p
    if (p && typeof p.text === 'string') return p.text
  }
  return null
}

/**
 * Devolve `null` quando não há nada a dizer — dia sem reunião não gera e-mail.
 * Silêncio é melhor que um "você não teve reuniões ontem" diário.
 */
export function buildDigest(input: DigestInput): DigestEmail | null {
  const { nome, meetings, actionItems, appUrl, dataLabel } = input
  if (meetings.length === 0) return null

  const gravadas = meetings.filter((m) => m.status === 'completed')
  const perdidas = meetings.filter((m) => m.status !== 'completed')
  const naoAdmitidas = perdidas.filter((m) => NAO_ADMITIDO.has(codigo(m.failure_reason)))

  const subject =
    perdidas.length === 0
      ? `Ontem: ${gravadas.length} ${gravadas.length === 1 ? 'reunião gravada' : 'reuniões gravadas'}`
      : `Ontem: ${gravadas.length} de ${meetings.length} reuniões gravadas`

  const linhasTexto: string[] = [`Resumo de ${dataLabel} — ${nome}`, '']

  const partes: string[] = []
  partes.push(
    `<p style="margin:0 0 4px;font:600 20px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a">Seu dia de ${esc(dataLabel)}</p>`,
    `<p style="margin:0 0 20px;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#666">` +
      `${meetings.length} ${meetings.length === 1 ? 'reunião' : 'reuniões'} · ${gravadas.length} com transcrição` +
      (perdidas.length ? ` · ${perdidas.length} sem gravação` : '') +
      `</p>`,
  )

  if (gravadas.length) {
    partes.push(secaoTitulo('Gravadas'))
    linhasTexto.push('GRAVADAS')
    for (const m of gravadas) {
      const titulo = m.title || 'Reunião'
      const passo = proximoPasso(m.insights)
      const prob = m.insights?.closingProbability
      const meta = [
        hora(m.started_at),
        typeof prob === 'number' ? `${prob}% de chance de fechar` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      partes.push(
        `<div style="padding:12px 0;border-bottom:1px solid #eee">` +
          `<a href="${appUrl}/meetings/${m.id}" style="font:600 15px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#2D5A27;text-decoration:none">${esc(titulo)}</a>` +
          `<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#888;margin-top:2px">${esc(meta)}</div>` +
          (passo
            ? `<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#444;margin-top:6px"><b>Próximo passo:</b> ${esc(passo)}</div>`
            : '') +
          `</div>`,
      )
      linhasTexto.push(`- ${titulo} (${meta})${passo ? ` — próximo passo: ${passo}` : ''}`)
    }
  }

  if (perdidas.length) {
    partes.push(secaoTitulo('Sem gravação'))
    linhasTexto.push('', 'SEM GRAVAÇÃO')
    for (const m of perdidas) {
      const titulo = m.title || 'Reunião'
      const motivo = MOTIVO_CURTO[codigo(m.failure_reason)] ?? 'a gravação não foi concluída'
      partes.push(
        `<div style="padding:10px 0;border-bottom:1px solid #eee">` +
          `<span style="font:500 14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a">${esc(titulo)}</span>` +
          `<span style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#3b6bb8"> — ${esc(motivo)}</span>` +
          `</div>`,
      )
      linhasTexto.push(`- ${titulo} — ${motivo}`)
    }
    if (naoAdmitidas.length >= 2) {
      partes.push(
        `<div style="margin-top:12px;padding:12px 14px;background:#eef3fb;border-radius:8px;font:13px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#24457d">` +
          `<b>${naoAdmitidas.length} reuniões não foram gravadas porque ninguém admitiu o bot.</b> ` +
          `Convide <b>contato@lemon-meet.com</b> nos eventos recorrentes e o Google Meet passa a admitir sozinho.` +
          `</div>`,
      )
      linhasTexto.push(
        '',
        `${naoAdmitidas.length} reuniões não foram gravadas porque ninguém admitiu o bot. ` +
          'Convide contato@lemon-meet.com nos eventos recorrentes.',
      )
    }
  }

  if (actionItems.length) {
    partes.push(secaoTitulo('Ficou pendente'))
    linhasTexto.push('', 'FICOU PENDENTE')
    for (const a of actionItems.slice(0, 8)) {
      partes.push(
        `<div style="padding:8px 0;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a">` +
          `• ${esc(a.text)}` +
          (a.meetingTitle
            ? `<span style="color:#999"> — ${esc(a.meetingTitle)}</span>`
            : '') +
          `</div>`,
      )
      linhasTexto.push(`- ${a.text}${a.meetingTitle ? ` (${a.meetingTitle})` : ''}`)
    }
    if (actionItems.length > 8) {
      partes.push(
        `<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#888;padding-top:4px">e mais ${actionItems.length - 8}</div>`,
      )
    }
  }

  partes.push(
    `<p style="margin:24px 0 0;font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#888">` +
      `<a href="${appUrl}/meetings" style="color:#2D5A27">Ver tudo no Lemon.meet</a></p>`,
  )

  const html =
    `<div style="max-width:560px;margin:0 auto;padding:24px;background:#fff">` +
    partes.join('') +
    `</div>`

  return { subject, html, text: linhasTexto.join('\n') }
}

function secaoTitulo(t: string): string {
  return `<p style="margin:22px 0 2px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#999;letter-spacing:.06em;text-transform:uppercase">${t}</p>`
}
