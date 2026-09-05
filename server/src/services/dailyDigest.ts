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

export type DigestModo = 'diario' | 'semanal'

export interface DigestInput {
  nome: string
  /** 'diario' = ontem (ter a sex). 'semanal' = semana passada (segunda). */
  modo?: DigestModo
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
 * Devolve `null` quando não há o que mostrar.
 *
 * ⚠️ Regra do Pietro (05/09): **sem nenhuma reunião GRAVADA, não manda e-mail.**
 * Um resumo que só enumera o que falhou é cobrança, não resumo — e chegando
 * todo dia vira ruído que acaba filtrado.
 */
export function buildDigest(input: DigestInput): DigestEmail | null {
  const { nome, meetings, actionItems, appUrl, dataLabel } = input
  const modo: DigestModo = input.modo ?? 'diario'
  if (meetings.length === 0) return null

  const gravadas = meetings.filter((m) => m.status === 'completed')
  if (gravadas.length === 0) return null

  const perdidas = meetings.filter((m) => m.status !== 'completed')
  const naoAdmitidas = perdidas.filter((m) => NAO_ADMITIDO.has(codigo(m.failure_reason)))

  const prefixo = modo === 'semanal' ? 'Sua semana' : 'Ontem'
  const subject =
    perdidas.length === 0
      ? `${prefixo}: ${gravadas.length} ${gravadas.length === 1 ? 'reunião gravada' : 'reuniões gravadas'}`
      : `${prefixo}: ${gravadas.length} de ${meetings.length} reuniões gravadas`

  const linhasTexto: string[] = [
    modo === 'semanal' ? `Semana de ${dataLabel} — ${nome}` : `Resumo de ${dataLabel} — ${nome}`,
    '',
  ]

  const partes: string[] = []
  partes.push(
    // Logo hospedado no app web. E-mail não carrega asset local, e anexo inline
    // cai em spam com mais frequência do que URL pública.
    `<div style="text-align:center;padding:4px 0 22px">` +
      `<img src="${appUrl}/lemon.meet.png" alt="Lemon.meet" width="132" style="width:132px;height:auto;border:0;display:inline-block">` +
      `</div>`,
    `<p style="margin:0 0 2px;font:600 22px/1.3 ${FONT};color:#1a1a1a">` +
      (modo === 'semanal' ? `Boa semana, ${esc(nome)}` : `Bom dia, ${esc(nome)}`) +
      `</p>`,
    `<p style="margin:0 0 18px;font:15px/1.5 ${FONT};color:#777">` +
      (modo === 'semanal'
        ? `Antes de começar, como foi a sua semana de ${esc(dataLabel)}`
        : `Como foi o seu ${esc(dataLabel)}`) +
      `</p>`,
    numeros(meetings.length, gravadas.length, perdidas.length),
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
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border:1px solid #ececec;border-radius:10px;border-left:3px solid #2D5A27">` +
          `<tr><td style="padding:14px 16px">` +
            `<a href="${appUrl}/meetings/${m.id}" style="font:600 15px/1.4 ${FONT};color:#2D5A27;text-decoration:none">${esc(titulo)}</a>` +
            `<div style="font:13px/1.5 ${FONT};color:#999;margin-top:3px">${esc(meta)}</div>` +
            (passo
              ? `<div style="margin-top:10px;padding:9px 11px;background:#f6f8f5;border-radius:7px;font:13px/1.5 ${FONT};color:#3d4a3a">` +
                `<span style="color:#2D5A27;font-weight:600">Próximo passo</span><br>${esc(passo)}</div>`
              : '') +
          `</td></tr></table>`,
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
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border:1px solid #e6ecf5;border-radius:10px;border-left:3px solid #7fa1d8;background:#fbfcfe">` +
          `<tr><td style="padding:12px 16px">` +
            `<span style="font:500 14px/1.4 ${FONT};color:#1a1a1a">${esc(titulo)}</span>` +
            `<div style="font:13px/1.5 ${FONT};color:#4d6ea8;margin-top:2px">${esc(motivo)}</div>` +
          `</td></tr></table>`,
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
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
          `<td width="18" valign="top" style="padding:7px 0 0;font:14px/1 ${FONT};color:#FFD700">◆</td>` +
          `<td style="padding:5px 0;font:14px/1.55 ${FONT};color:#1a1a1a">${esc(a.text)}` +
          (a.meetingTitle ? `<span style="color:#aaa"> · ${esc(a.meetingTitle)}</span>` : '') +
          `</td></tr></table>`,
      )
      linhasTexto.push(`- ${a.text}${a.meetingTitle ? ` (${a.meetingTitle})` : ''}`)
    }
    if (actionItems.length > 8) {
      partes.push(
        `<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#888;padding-top:4px">e mais ${actionItems.length - 8}</div>`,
      )
    }
  }

  if (modo === 'semanal') {
    partes.push(
      `<div style="margin-top:24px;padding:14px 16px;background:#fffbe6;border-radius:10px;font:14px/1.6 ${FONT};color:#6b5a13">` +
        `Boa semana e bons fechamentos. 🍋</div>`,
    )
    linhasTexto.push('', 'Boa semana e bons fechamentos.')
  }

  partes.push(
    `<div style="text-align:center;padding:26px 0 6px">` +
      `<a href="${appUrl}/meetings" style="display:inline-block;padding:11px 22px;background:#2D5A27;color:#fff;border-radius:8px;font:600 14px/1 ${FONT};text-decoration:none">Ver tudo no Lemon.meet</a>` +
      `</div>`,
    `<p style="margin:16px 0 0;text-align:center;font:12px/1.6 ${FONT};color:#aaa">` +
      (modo === 'semanal'
        ? 'Você recebe este resumo às segundas, com a semana anterior.'
        : 'Você recebe este resumo porque teve reuniões gravadas ontem no Lemon.meet.') +
      `</p>`,
  )

  const html =
    `<div style="background:#f4f5f3;padding:28px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px">` +
    `<tr><td style="padding:28px 26px 30px">` +
    partes.join('') +
    `</td></tr></table></div>`

  return { subject, html, text: linhasTexto.join('\n') }
}

const FONT = '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif'

function secaoTitulo(t: string): string {
  return `<p style="margin:24px 0 8px;font:600 12px/1.4 ${FONT};color:#999;letter-spacing:.07em;text-transform:uppercase">${t}</p>`
}

/** Faixa de números em tabela — Outlook não faz flexbox. */
function numeros(total: number, gravadas: number, perdidas: number): string {
  const cel = (valor: number, rotulo: string, cor: string) =>
    `<td align="center" style="padding:12px 6px;background:#fafbfa;border-radius:10px">` +
    `<div style="font:700 22px/1.1 ${FONT};color:${cor}">${valor}</div>` +
    `<div style="font:11px/1.4 ${FONT};color:#999;text-transform:uppercase;letter-spacing:.05em;margin-top:3px">${rotulo}</div>` +
    `</td>`
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 0 6px">` +
    `<tr>` +
    cel(total, 'reuniões', '#1a1a1a') +
    cel(gravadas, 'gravadas', '#2D5A27') +
    (perdidas ? cel(perdidas, 'sem gravação', '#4d6ea8') : '') +
    `</tr></table>`
  )
}
